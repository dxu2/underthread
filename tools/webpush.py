#!/usr/bin/env python3
"""Web Push (VAPID) with the standard library only.

Pushes carry no payload: the phone's service worker wakes up and fetches the
notification text from /api/push/latest, so no message encryption is needed.
VAPID needs an ES256 (ECDSA P-256 / SHA-256) signature, implemented below.

    python3 tools/webpush.py selftest   # sign + verify with openssl
"""
import base64
import hashlib
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYFILE = os.path.join(ROOT, "vapid.json")

# ---------- P-256 ----------
_P = 2**256 - 2**224 + 2**192 + 2**96 - 1
_A = _P - 3
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
      0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def _add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    (x1, y1), (x2, y2) = p, q
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p == q:
        lam = (3 * x1 * x1 + _A) * pow(2 * y1, -1, _P) % _P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, _P) % _P
    x3 = (lam * lam - x1 - x2) % _P
    return x3, (lam * (x1 - x3) - y1) % _P


def _mul(k, p):
    r = None
    while k:
        if k & 1:
            r = _add(r, p)
        p = _add(p, p)
        k >>= 1
    return r


def _b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _i2b(i):
    return i.to_bytes(32, "big")


def sign(msg, d):
    z = int.from_bytes(hashlib.sha256(msg).digest(), "big")
    while True:
        k = secrets.randbelow(_N - 1) + 1
        r = _mul(k, _G)[0] % _N
        if not r:
            continue
        s = pow(k, -1, _N) * (z + r * d) % _N
        if s:
            return r, s


# ---------- keys ----------
def keys():
    """(private int, public uncompressed point as base64url). Created on first use."""
    if os.path.exists(KEYFILE):
        with open(KEYFILE) as f:
            k = json.load(f)
        return int(k["d"], 16), k["public"]
    d = secrets.randbelow(_N - 1) + 1
    x, y = _mul(d, _G)
    pub = _b64u(b"\x04" + _i2b(x) + _i2b(y))
    with open(KEYFILE, "w") as f:
        json.dump({"d": format(d, "x"), "public": pub}, f)
    os.chmod(KEYFILE, 0o600)
    return d, pub


def vapid_header(endpoint, subject):
    d, pub = keys()
    u = urllib.parse.urlparse(endpoint)
    head = _b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = _b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": subject},
                              separators=(",", ":")).encode())
    r, s = sign(f"{head}.{claims}".encode(), d)
    return f"vapid t={head}.{claims}.{_b64u(_i2b(r) + _i2b(s))}, k={pub}"


def send(sub, subject, ttl=86400, urgency="high"):
    """POST an empty push. Returns the HTTP status (201 = accepted, 404/410 = subscription gone)."""
    req = urllib.request.Request(sub["endpoint"], data=b"", method="POST", headers={
        "TTL": str(ttl), "Urgency": urgency, "Content-Length": "0",
        "Authorization": vapid_header(sub["endpoint"], subject)})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return 0


def _selftest():
    import subprocess
    import tempfile
    d = secrets.randbelow(_N - 1) + 1
    x, y = _mul(d, _G)
    msg = b"underthread"
    r, s = sign(msg, d)

    def der_int(i):
        b = i.to_bytes((i.bit_length() + 7) // 8 or 1, "big")
        if b[0] & 0x80:
            b = b"\x00" + b
        return b"\x02" + bytes([len(b)]) + b
    body = der_int(r) + der_int(s)
    sig = b"\x30" + bytes([len(body)]) + body
    spki = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d030107034200") + b"\x04" + _i2b(x) + _i2b(y)
    pem = "-----BEGIN PUBLIC KEY-----\n" + base64.encodebytes(spki).decode() + "-----END PUBLIC KEY-----\n"
    with tempfile.TemporaryDirectory() as t:
        for name, data in (("pub.pem", pem.encode()), ("sig.der", sig), ("msg", msg)):
            with open(os.path.join(t, name), "wb") as f:
                f.write(data)
        out = subprocess.run(["openssl", "dgst", "-sha256", "-verify", "pub.pem", "-signature", "sig.der", "msg"],
                             cwd=t, capture_output=True, text=True)
    print(out.stdout.strip() or out.stderr.strip())


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["selftest"]:
        _selftest()
    else:
        print(__doc__)
