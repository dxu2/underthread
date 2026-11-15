"""A tiny IMAP server for the feed tests (t-feed-inbox). Plain TCP on 127.0.0.1, one mailbox, just enough of RFC 3501 (+ Gmail's
X-GM-EXT-1 when gmail=True) for imaplib: CAPABILITY, LOGIN, EXAMINE/SELECT, UID SEARCH, UID FETCH, LOGOUT. Any other command
(STORE, COPY, EXPUNGE, ...) is answered BAD and recorded in .bad, so a test can prove the collector never changes the mailbox.
No real mailbox and no real credentials are ever involved.

    srv = FakeImap(user="me@example.com", password="abcd efgh ijkl mnop").start()
    srv.add(subject="Hi", sender="A <a@example.com>", body="hello", thread=1)
    ... GmailSource with UNDERTHREAD_FEED_IMAP=f"127.0.0.1:{srv.port}:plain"
    srv.stop()
"""
import re
import socket
import socketserver
import threading


class FakeImap:
    def __init__(self, user="me@example.com", password="abcdefghijklmnop", gmail=True, uidvalidity=7):
        self.user, self.password, self.gmail, self.uidvalidity = user, password.replace(" ", ""), gmail, uidvalidity
        self.msgs = []          # [uid, raw bytes, thread id]
        self.next_uid = 1
        self.log, self.bad, self.logins, self.fetch_items = [], [], 0, []
        self.searches = []
        self.lock = threading.Lock()

    def add(self, subject="Hello", sender="Alice <alice@example.com>", body="Body text", thread=None, msgid=None, html=False, refs=None):
        with self.lock:
            uid = self.next_uid
            self.next_uid += 1
            mid = msgid or f"<m{uid}@example.com>"
            ctype = "text/html" if html else "text/plain"
            hdr = f"From: {sender}\r\nTo: me@example.com\r\nSubject: {subject}\r\nDate: Sat, 15 Nov 2026 01:0{uid % 10}:00 -0800\r\nMessage-ID: {mid}\r\n"
            if refs:
                hdr += f"References: {refs}\r\nIn-Reply-To: {refs.split()[-1]}\r\n"
            raw = (hdr + f"MIME-Version: 1.0\r\nContent-Type: {ctype}; charset=utf-8\r\n\r\n{body}\r\n").encode()
            self.msgs.append([uid, raw, thread if thread is not None else 1000 + uid])
            return uid

    # ---------------- server ----------------
    def start(self):
        outer = self

        class H(socketserver.StreamRequestHandler):
            def w(self, s):
                self.wfile.write(s if isinstance(s, bytes) else s.encode())

            def handle(self):
                caps = "IMAP4rev1" + (" X-GM-EXT-1" if outer.gmail else "")
                self.w(f"* OK [CAPABILITY {caps}] fake ready\r\n")
                authed = False
                while True:
                    line = self.rfile.readline()
                    if not line:
                        return
                    text = line.decode("utf-8", "replace").rstrip("\r\n")
                    m = re.match(r"(\S+) (\S+)(?: (.*))?$", text)
                    if not m:
                        continue
                    tag, cmd, rest = m.group(1), m.group(2).upper(), m.group(3) or ""
                    outer.log.append(cmd if cmd != "LOGIN" else "LOGIN")   # never the password
                    if cmd == "CAPABILITY":
                        self.w(f"* CAPABILITY {caps}\r\n{tag} OK done\r\n")
                    elif cmd == "LOGIN":
                        a = re.match(r'("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$', rest)
                        un = lambda s: re.sub(r"\\(.)", r"\1", s[1:-1]) if s.startswith('"') else s
                        outer.logins += 1
                        if a and un(a.group(1)) == outer.user and un(a.group(2)) == outer.password:
                            authed = True
                            self.w(f"{tag} OK logged in\r\n")
                        else:
                            self.w(f"{tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n")
                    elif cmd in ("EXAMINE", "SELECT") and authed:
                        with outer.lock:
                            n = len(outer.msgs)
                            self.w(f"* {n} EXISTS\r\n* OK [UIDVALIDITY {outer.uidvalidity}] ok\r\n* OK [UIDNEXT {outer.next_uid}] ok\r\n")
                        self.w(f"{tag} OK [READ-ONLY] done\r\n" if cmd == "EXAMINE" else f"{tag} OK [READ-WRITE] done\r\n")
                        if cmd == "SELECT":
                            outer.bad.append("SELECT")
                    elif cmd == "UID" and authed:
                        sub, _, args = rest.partition(" ")
                        sub = sub.upper()
                        if sub == "SEARCH":
                            outer.searches.append(args)
                            mm = re.search(r"UID (\d+):\*", args)
                            lo = int(mm.group(1)) if mm else 1
                            with outer.lock:
                                uids = [u for u, _, _ in outer.msgs if u >= lo]
                                if not uids and outer.msgs:
                                    uids = [outer.msgs[-1][0]]   # n:* matches the newest message even when it is below n
                            self.w(f"* SEARCH {' '.join(map(str, uids))}\r\n{tag} OK done\r\n".replace("SEARCH \r", "SEARCH\r"))
                        elif sub == "FETCH":
                            uid_s, _, items = args.partition(" ")
                            outer.fetch_items.append(items)
                            if "BODY.PEEK" not in items.upper() and "BODY[" in items.upper():
                                outer.bad.append("FETCH without PEEK")
                            with outer.lock:
                                hit = [(i + 1, x) for i, x in enumerate(outer.msgs) if str(x[0]) == uid_s]
                            for seq, (u, raw, thr) in hit:
                                g = f" X-GM-THRID {thr}" if outer.gmail and "X-GM-THRID" in items.upper() else ""
                                self.w(f"* {seq} FETCH (UID {u}{g} BODY[]<0> {{{len(raw)}}}\r\n".encode() + raw + b")\r\n")
                            self.w(f"{tag} OK done\r\n")
                        else:
                            outer.bad.append("UID " + sub)
                            self.w(f"{tag} BAD no\r\n")
                    elif cmd == "LOGOUT":
                        self.w(f"* BYE bye\r\n{tag} OK done\r\n")
                        return
                    else:
                        outer.bad.append(cmd)
                        self.w(f"{tag} BAD not here\r\n")

        class S(socketserver.ThreadingTCPServer):
            daemon_threads = True
            allow_reuse_address = True

        self.srv = S(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
