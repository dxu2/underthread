"""The HTTP layer: request handler H (host / browser guards, keep-alive, gzip, static and media files with Range) and the
server class. Requests are dispatched through the route table (api/router.py); the routes live in api/routes/*."""
import datetime as dt
import gzip
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from api import router as R
from api.ctx import S, ROOT, WEB, UPLOADS, CONFIG


GZ_MIN = 2048
KEEPALIVE_IDLE = 15   # ri1105-P2: idle seconds a kept-alive connection may wait for its next request
_GZC, _GZL, _SV = {}, threading.Lock(), {}   # ri1105-P2: static gzip cache (path -> etag, raw, gz); (path, ?v=) -> file version seen


def _gz_type(ctype):
    c = (ctype or "").split(";")[0].strip()
    return c.startswith("text/") or c in ("application/json", "application/javascript", "application/manifest+json", "image/svg+xml")


# t-csrf-live (OSS audit SM-01/02): who may talk to this server.
# 1) Host allowlist on every request, against DNS rebinding: a page on attacker.example that re-resolves to 127.0.0.1 sends
#    Host: attacker.example and gets 421. Allowed: loopback names, this machine's hostname / .local name / LAN and tailnet IPs,
#    any *.ts.net name (the phone comes in through Tailscale Serve), plus config.allowed_hosts. A missing Host is let through.
# 2) Browser guard on every POST, against cross-site requests: a request that carries Origin or Sec-Fetch-Site comes from a
#    browser and must be same-origin AND carry X-Underthread: 1 (a custom header forces a CORS preflight, which this server never
#    grants). Scripts, curl and the iPhone Shortcut send neither header and are not affected.
_HOSTS = {"at": 0.0, "names": set(), "resolved": set(), "busy": False}
LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def _resolve_hostname(hn):
    """The addresses this machine's hostname resolves to. Runs in a thread: where the name is not in DNS (macOS CI runners,
    some offline Macs) getaddrinfo waits on mDNS for many seconds, which stalled every request behind the Host check."""
    got = set()
    try:
        for info in socket.getaddrinfo(hn, None):
            got.add(str(info[4][0]).lower())
    except OSError:
        pass
    _HOSTS.update(resolved=got, busy=False)


def local_names():
    if time.time() - _HOSTS["at"] < 60:
        return _HOSTS["names"] | _HOSTS["resolved"]
    names = set(LOOPBACK)
    try:
        hn = socket.gethostname().lower().rstrip(".")
        short = hn.split(".")[0]
        names |= {hn, short, short + ".local"}
        if not _HOSTS["busy"]:
            _HOSTS["busy"] = True
            threading.Thread(target=_resolve_hostname, args=(hn,), daemon=True).start()
    except OSError:
        pass
    try:   # the LAN address of the default route; connect() on UDP sends nothing
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 9))
            names.add(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    names |= {str(h).lower().rstrip(".") for h in (CONFIG.get("allowed_hosts") or [])}
    _HOSTS.update(at=time.time(), names=names)
    return names | _HOSTS["resolved"]


def host_name(h):
    """'[::1]:8765' -> '::1', 'Mini.local:8765' -> 'mini.local', 'host' -> 'host'."""
    h = (h or "").strip().lower()
    if h.startswith("["):
        return h[1:h.find("]")] if "]" in h else h[1:]
    if h.count(":") == 1:
        h = h.split(":")[0]
    return h.rstrip(".")


def host_ok(h):
    if not (h or "").strip():
        return True
    n = host_name(h)
    return n in LOOPBACK or n in local_names() or n.endswith(".ts.net")


_GUARD_LOG = {"at": 0.0, "n": 0}


def guard_log(kind, h, path):
    """One line per refusal, at most 30 a minute, so a probe storm cannot fill server.log."""
    t = time.time()
    if t - _GUARD_LOG["at"] > 60:
        _GUARD_LOG.update(at=t, n=0)
    _GUARD_LOG["n"] += 1
    if _GUARD_LOG["n"] <= 30:
        print(f"[{S.now()}] guard: refused {kind} {h.command} {path[:120]} host={(h.headers.get('Host') or '')[:80]!r} "
              f"origin={(h.headers.get('Origin') or '')[:80]!r} site={h.headers.get('Sec-Fetch-Site') or ''}", flush=True)


class H(BaseHTTPRequestHandler):
    server_version = "Underthread/1"
    # ri1105-P2: HTTP/1.1 keep-alive. Every answer carries Content-Length (304 / HEAD carry no body). A connection may sit idle between
    # requests for KEEPALIVE_IDLE s, then it is closed (a phone that holds a socket does not pin a thread forever). Reading a request body
    # and writing an answer have no timeout, as before (big uploads / video). POSTs whose body was not read in full close the connection.
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("VERBOSE"):
            super().log_message(fmt, *args)

    def handle_one_request(self):
        self._sent = False
        self._body_ok = False
        try:
            self.connection.settimeout(KEEPALIVE_IDLE)
        except OSError:
            pass
        super().handle_one_request()

    def parse_request(self):
        ok = super().parse_request()
        try:
            self.connection.settimeout(None)
        except OSError:
            pass
        self._body_ok = False
        return ok

    def _keep(self):
        """False = close the connection after this answer (a POST body we did not read in full would be read as the next request)."""
        if self.command == "POST" and not self._body_ok:
            self.close_connection = True
            return False
        return True

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        enc = None
        if (len(body) >= GZ_MIN and _gz_type(ctype) and "gzip" in (self.headers.get("Accept-Encoding") or "")
                and not self.path.startswith("/api/voice/") and not (extra or {}).get("Content-Encoding")):
            body, enc = gzip.compress(body, 5), "gzip"   # t-mobile-crash-state: /api/state 2.5 MB -> ~0.7 MB
        self._sent = True
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if not (extra or {}).get("Cache-Control"):
            self.send_header("Cache-Control", "no-store")
        if enc:
            self.send_header("Content-Encoding", enc)
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if not self._keep():
            self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":   # ri1105-P2: on a kept-alive connection a HEAD body would be read as the next answer
            self.wfile.write(body)

    def _static(self, path, ctype, extra):
        """ri1105-P2: web/ files. A ?v= js / css / font never changes under the same URL (?v= is the content hash the server writes into
        the page and its import map, S9): cached for a year, immutable.
        Everything else (images, ?v= images too, files without ?v=): ETag + 304. index.html and sw.js stay no-store (their own routes).
        Gzip is done once per file version and kept in memory."""
        st = os.stat(path)
        etag = '"%x-%x"' % (st.st_mtime_ns // 1000, st.st_size)
        v = parse_qs(urlparse(self.path).query).get("v", [""])[0]
        imm = bool(v) and path.endswith((".js", ".css", ".woff2", ".woff"))
        if imm:
            k, sig = (path, v), (st.st_mtime_ns, st.st_size)
            old = _SV.setdefault(k, sig)
            if old != sig:   # the file changed but the URL did not: browsers that cached it keep the old copy
                print(f"[{S.now()}] static: {os.path.relpath(path, WEB)} changed under the same ?v={v} (an open page asked for an old version)", flush=True)
                _SV[k] = sig
        hdr = {"ETag": etag, "Cache-Control": "public, max-age=31536000, immutable" if imm else "no-cache"}
        hdr.update(extra or {})
        if self.headers.get("If-None-Match") == etag:
            self._sent = True
            self.send_response(304)
            for k2, v2 in hdr.items():
                self.send_header(k2, v2)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        gz = "gzip" in (self.headers.get("Accept-Encoding") or "") and _gz_type(ctype) and st.st_size >= GZ_MIN
        with _GZL:
            c = _GZC.get(path)
        if not c or c[0] != etag:
            with open(path, "rb") as f:
                raw = f.read()
            c = (etag, raw, gzip.compress(raw, 6) if _gz_type(ctype) and len(raw) >= GZ_MIN else None)
            with _GZL:
                _GZC[path] = c
        if gz and c[2] is not None:
            hdr.update({"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
            return self._send(200, c[2], ctype, hdr)
        return self._send(200, c[1], ctype, hdr)

    def _file(self, path, extra=None, media=False):
        """Serve a file. media=True (uploads/work/avatars): Range/206, ETag/304, streamed in 64KB chunks."""
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = "application/manifest+json" if path.endswith(".webmanifest") else (mimetypes.guess_type(path)[0] or "application/octet-stream")
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        if media == "static":
            return self._static(path, ctype, extra)
        if not media:
            with open(path, "rb") as f:
                return self._send(200, f.read(), ctype, extra)
        self._sent = True
        st = os.stat(path)
        size = st.st_size
        etag = '"%x-%x"' % (int(st.st_mtime), size)
        hdr = {"Accept-Ranges": "bytes", "ETag": etag, "Cache-Control": "private, max-age=0, must-revalidate"}
        hdr.update(extra or {})
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            for k, v in hdr.items():
                self.send_header(k, v)
            self.end_headers()
            return
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", rng)
            ok = bool(m) and (m.group(1) or m.group(2))
            if ok:
                if m.group(1) == "":  # suffix: last N bytes
                    n = int(m.group(2))
                    start, end = max(size - n, 0), size - 1
                else:
                    start = int(m.group(1))
                    end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
                ok = size > 0 and start < size and start <= end
            if not ok:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            code = 206
            hdr["Content-Range"] = f"bytes {start}-{end}/{size}"
        length = end - start + 1 if size else 0
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        for k, v in hdr.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def _host_guard(self):
        """t-csrf-live: False (and a 421 already sent) when the Host header is not one of ours."""
        if host_ok(self.headers.get("Host")):
            return True
        guard_log("host", self, self.path)
        self._send(421, {"error": "unknown host"})
        return False

    def _hdr_ok(self):
        """X-Underthread: 1, or a header named in config.json "legacy_headers" (pages opened before a rename keep working until reloaded)."""
        return self.headers.get("X-Underthread") == "1" or any(self.headers.get(h) == "1" for h in CONFIG.get("legacy_headers") or [] if isinstance(h, str))

    def _browser_ok(self):
        """t-csrf-live: a POST from a browser must be same-origin and carry X-Underthread: 1; non-browser callers pass."""
        o, site = self.headers.get("Origin"), (self.headers.get("Sec-Fetch-Site") or "").lower()
        if o is None and not site:
            return True
        if site == "cross-site":
            return False
        if o is not None:
            net = urlparse(o).netloc if o != "null" else ""
            if not net or not (net == (self.headers.get("Host") or "") or net == self.headers.get("X-Forwarded-Host") or host_ok(net)):
                return False
        return self._hdr_ok()

    def do_HEAD(self):
        self.do_GET()

    def _thumb(self, rel, w):
        """JPEG thumbnail of an image/video under uploads/ or work/, cached in work/.thumbs/ (originals untouched)."""
        import hashlib
        import subprocess
        rel = rel.lstrip("/")
        base = UPLOADS if rel.startswith("uploads/") else os.path.join(ROOT, "work") if rel.startswith("work/") else None
        if base is None:
            return self._send(403, {"error": "forbidden"})
        src = self._safe(base, rel.split("/", 1)[1])
        if not src or not os.path.isfile(src) or "/.thumbs/" in src:
            return self._send(404, {"error": "not found"})
        w = max(64, min(w, 1200))
        st = os.stat(src)
        key = hashlib.sha1(f"{rel}|{st.st_mtime_ns}|{st.st_size}|{w}".encode()).hexdigest()[:24]
        tdir = os.path.join(ROOT, "work", ".thumbs")
        os.makedirs(tdir, exist_ok=True)
        out = os.path.join(tdir, key + ".jpg")
        if not os.path.isfile(out):
            tmp = out + f".{os.getpid()}.{threading.get_ident()}.tmp.jpg"
            try:
                if re.search(r"\.(mp4|mov|m4v|webm)$", src, re.I):
                    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", "0.1", "-i", src, "-frames:v", "1",
                           "-vf", f"scale='min({w},iw)':-2", "-q:v", "4", tmp]
                else:
                    cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", str(w), src, "--out", tmp]
                env = dict(os.environ, PATH="/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", ""))
                subprocess.run(cmd, check=True, capture_output=True, timeout=30, env=env)
                os.replace(tmp, out)
            except Exception:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                return self._send(415, {"error": "no thumbnail"})
        return self._file(out, media=True)

    def _safe(self, base, rel):
        p = os.path.realpath(os.path.join(base, rel))
        return p if p.startswith(os.path.realpath(base) + os.sep) else None

    def do_GET(self):
        if not self._host_guard():
            return
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            for fn in R.find("GET", u.path):
                if fn(self, u, q) is not R.NEXT:
                    return
            for fn in R.EXT_GET:   # core / local split: extension routes
                r = fn(self, u, q)
                if r is not None:
                    return r
            for fn in R.find("GET", u.path, late=True):   # the file routes (/static/ ...)
                if fn(self, u, q) is not R.NEXT:
                    return
            self._send(404, {"error": "not found"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception as e:
            if self._sent:   # ri1105-P2: an answer is already on the wire; a second one would corrupt the kept-alive stream
                self.close_connection = True
                print("GET after send:", u.path, repr(e))
                return
            self._send(400, {"error": str(e)})

    def do_POST(self):
        if not self._host_guard():
            return
        u = urlparse(self.path)
        if not self._browser_ok():   # t-csrf-live: before the body is read; _keep() then closes the connection
            guard_log("origin", self, u.path)
            return self._send(403, {"error": "forbidden"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            q = parse_qs(u.query)
            for fn in R.find("POST", u.path, raw=True):   # routes that read the body themselves (uploads, memo, token, voice clips)
                if fn(self, u, q, n) is not R.NEXT:
                    return
            body = json.loads(self.rfile.read(n) or b"{}")
            self._body_ok = True   # ri1105-P2: the whole body is read, this connection can stay open
            for fn in R.find("POST", u.path):
                if fn(self, u, body) is not R.NEXT:
                    return
            self._send(404, {"error": "not found"})
        except R.OpenAsks as e:   # t-open-questions: the page shows its 还有问题没回答 sheet
            self._send(409, {"error": str(e), "open_asks": e.asks})
        except (ValueError, KeyError, SystemExit) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            self._send(500, {"error": repr(e)})


class QuietServer(ThreadingHTTPServer):
    """t-ri1106-b (r-improve-1106 P2): a phone or browser dropping an idle keep-alive connection raised BrokenPipe / ConnectionReset /
    ConnectionAborted inside socketserver, which printed a ~30-line traceback each time (45% of logs/server.log on 11-06).
    Those are now only counted, and one line per hour sums them up: "[time] conn: N client disconnects in the last hour".
    Every other exception still goes to the stock handle_error (full traceback ending in "XxxError: ...")."""
    QUIET = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._qlock = threading.Lock()
        self._qn = 0
        self._qt = time.time()

    def server_bind(self):
        """HTTPServer.server_bind asks socket.getfqdn(host) for a name nobody reads here; on macOS CI runners that reverse
        lookup of 127.0.0.1 can stall past the smoke test's 20 s start wait (CI red 11-16..11-17). Same bind, no lookup."""
        import socketserver
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port

    def handle_error(self, request, client_address):
        e = sys.exc_info()[1]
        if not isinstance(e, self.QUIET):
            return super().handle_error(request, client_address)
        with self._qlock:
            self._qn += 1
            now = time.time()
            if now - self._qt < 3600:
                return
            n, self._qn, self._qt = self._qn, 0, now
        print(f"[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] conn: {n} client disconnects in the last hour", flush=True)
