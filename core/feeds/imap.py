"""IMAP sources (t-feed-inbox). Read-only on purpose: the mailbox is opened with EXAMINE and messages are fetched with
BODY.PEEK, so nothing is marked read, moved, archived or deleted. Stdlib only (imaplib, email).

The cursor is {"uidvalidity": V, "uid": U}: everything with a UID up to U is old. A new connection sets U to the newest UID
(UIDNEXT - 1), so old mail is never replayed. If the server changes UIDVALIDITY (the mailbox was rebuilt), the cursor is set
to "now" again and that poll returns nothing.

Test-only override: UNDERTHREAD_FEED_IMAP=host:port[:plain] points GmailSource at another server (the fake one in tests).
"""
import email
import email.policy
import email.utils
import html
import imaplib
import os
import re
import socket
import ssl
import urllib.parse

from core.feeds.base import FeedError, Source, clean

SNIP = 120          # default snippet length (config feeds.snippet_chars)
BODY_CAP = 2000     # characters of body text handed to the classifier per message
FETCH_CAP = 65536   # bytes fetched per message (headers + the start of the body)
_UID = re.compile(rb"\bUID (\d+)")
_THR = re.compile(rb"\bX-GM-THRID (\d+)")
_ADDR = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _html_text(s):
    s = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return html.unescape(s)


def _body_text(msg):
    try:
        part = msg.get_body(preferencelist=("plain", "html"))
        if part is None:
            return ""
        txt = part.get_content()
        if part.get_content_subtype() == "html":
            txt = _html_text(txt)
        return txt if isinstance(txt, str) else ""
    except Exception:  # noqa: BLE001  (a truncated or broken MIME part: no body for the classifier, headers still go out)
        return ""


def _hdr(msg, name):
    try:
        v = msg.get(name)
        return str(v) if v is not None else ""
    except Exception:  # noqa: BLE001
        return ""


class ImapSource(Source):
    host, port, use_ssl = "", 993, True
    mailbox = "INBOX"

    def _endpoint(self):
        return self.host, self.port, self.use_ssl

    def _open(self):
        host, port, use_ssl = self._endpoint()
        try:
            if use_ssl:
                c = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=30)
            else:
                c = imaplib.IMAP4(host, port, timeout=30)
        except (socket.timeout, TimeoutError):
            raise FeedError("timeout") from None
        except ssl.SSLError:
            raise FeedError("tls") from None
        except (OSError, imaplib.IMAP4.error):
            raise FeedError("connect") from None
        return c

    def _session(self, account, secret):
        self.check_input(account, secret)
        c = self._open()
        try:
            c.login(account.strip(), secret.replace(" ", ""))   # Google shows app passwords in groups of four with spaces
        except imaplib.IMAP4.error:
            self._close(c)
            raise FeedError("auth") from None
        except (socket.timeout, TimeoutError):
            self._close(c)
            raise FeedError("timeout") from None
        except OSError:
            self._close(c)
            raise FeedError("connect") from None
        try:
            typ, _ = c.select(self.mailbox, readonly=True)   # EXAMINE: read-only
        except (imaplib.IMAP4.error, OSError):
            typ = "NO"
        if typ != "OK":
            self._close(c)
            raise FeedError("mailbox")
        return c

    @staticmethod
    def _close(c):
        try:
            c.logout()
        except Exception:  # noqa: BLE001
            pass

    @staticmethod
    def _num(c, code):
        try:
            _, v = c.response(code)
            return int(v[0]) if v and v[0] is not None else None
        except (TypeError, ValueError, IndexError):
            return None

    def _head(self, c):
        """(uidvalidity, newest uid) of the selected mailbox."""
        validity, nxt = self._num(c, "UIDVALIDITY"), self._num(c, "UIDNEXT")
        if nxt is not None:
            return validity, max(0, nxt - 1)
        typ, data = c.uid("SEARCH", None, "ALL")
        if typ != "OK":
            raise FeedError("protocol")
        ids = [int(x) for x in (data[0] or b"").split() if x.isdigit()]
        return validity, max(ids) if ids else 0

    def check_input(self, account, secret):
        super().check_input(account, secret)
        if not _ADDR.match(account.strip()) or len(secret) > 200:
            raise FeedError("input")

    def test(self, account, secret):
        c = self._session(account, secret)
        try:
            validity, top = self._head(c)
            return {"uidvalidity": validity, "uid": top}
        except (imaplib.IMAP4.error, OSError):
            raise FeedError("protocol") from None
        finally:
            self._close(c)

    def _gmail(self, c):
        return "X-GM-EXT-1" in (getattr(c, "capabilities", ()) or ())

    def _search(self, c, after):
        crit = f"UID {after + 1}:*"
        if self._gmail(c) and self.cfg.get("primary_only", True):
            typ, data = c.uid("SEARCH", "X-GM-RAW", '"category:primary"', crit)
        else:
            typ, data = c.uid("SEARCH", None, crit)
        if typ != "OK":
            raise FeedError("protocol")
        # "n:*" always matches the newest message even when it is older than n: keep only real new ones
        return sorted(u for u in (int(x) for x in (data[0] or b"").split() if x.isdigit()) if u > after)

    def link(self, account, msgid, thread):
        return ""

    def _fetch(self, c, uid, account):
        items = "(UID X-GM-THRID BODY.PEEK[]<0.%d>)" % FETCH_CAP if self._gmail(c) else "(UID BODY.PEEK[]<0.%d>)" % FETCH_CAP
        typ, data = c.uid("FETCH", str(uid), items)
        if typ != "OK" or not data:
            return None
        raw, meta = b"", b""
        for part in data:
            if isinstance(part, tuple):
                meta += part[0] or b""
                raw = part[1] or raw
            elif isinstance(part, bytes):
                meta += part
        m = _UID.search(meta)
        if not raw or (m and int(m.group(1)) != uid):
            return None
        msg = email.message_from_bytes(raw, policy=email.policy.default)
        msgid = clean(_hdr(msg, "Message-ID"), 300)
        refs = (_hdr(msg, "References") or "").split()
        thr = _THR.search(meta)
        thread = ("gm:" + format(int(thr.group(1)), "x")) if thr else clean(refs[0] if refs else (_hdr(msg, "In-Reply-To") or msgid), 300)
        when = ""
        try:
            d = email.utils.parsedate_to_datetime(_hdr(msg, "Date"))
            when = d.isoformat(timespec="seconds") if d else ""
        except (TypeError, ValueError, IndexError):
            pass
        body = _body_text(msg)
        snip = int(self.cfg.get("snippet_chars", SNIP))
        return {"uid": uid, "thread": thread or f"uid:{uid}", "msgid": msgid, "date": when,
                "from": clean(_hdr(msg, "From"), 160), "subject": clean(_hdr(msg, "Subject"), 200),
                "snippet": clean(body, snip) if snip > 0 else "", "body": clean(body, BODY_CAP),
                "link": self.link(account, msgid, thread)}

    def poll(self, account, secret, cursor, limit):
        c = self._session(account, secret)
        try:
            validity, top = self._head(c)
            cur = cursor or {}
            if cur.get("uid") is None or (validity is not None and cur.get("uidvalidity") not in (None, validity)):
                return [], {"uidvalidity": validity, "uid": top}, 0   # first poll or mailbox rebuilt: start from now
            after = int(cur["uid"])
            if top <= after:
                return [], {"uidvalidity": validity, "uid": after}, 0
            uids = self._search(c, after)
            more = max(0, len(uids) - limit)
            out = []
            for uid in uids[-limit:] if limit > 0 else []:   # the newest `limit`; the rest are counted, not fetched
                m = self._fetch(c, uid, account)
                if m:
                    out.append(m)
            return out, {"uidvalidity": validity, "uid": max([after, top] + uids)}, more
        except (socket.timeout, TimeoutError):
            raise FeedError("timeout") from None
        except (imaplib.IMAP4.error, OSError):
            raise FeedError("protocol") from None
        finally:
            self._close(c)


class GmailSource(ImapSource):
    id = "gmail"
    label = ("Gmail", "Gmail")
    host, port, use_ssl = "imap.gmail.com", 993, True
    account_hint = ("你的 Gmail 地址", "Your Gmail address")
    secret_label = ("应用专用密码", "App password")
    help_url = "https://myaccount.google.com/apppasswords"
    help = ("用 Google 的「应用专用密码」（16 位），不是你的登录密码；要先在 Google 账号里开启两步验证才能生成。只读：不会标已读、不会删、不会归档。",
            "Use a Google app password (16 characters), not your sign-in password. It needs 2-Step Verification on your Google account. Read-only: nothing is marked read, deleted or archived.")

    def _endpoint(self):
        o = os.environ.get("UNDERTHREAD_FEED_IMAP", "")
        if o:
            p = o.split(":")
            return p[0], int(p[1]), not (len(p) > 2 and p[2] == "plain")
        return super()._endpoint()

    def link(self, account, msgid, thread):
        if not msgid:
            return ""
        q = urllib.parse.quote("rfc822msgid:" + msgid.strip("<>"), safe="")
        return f"https://mail.google.com/mail/u/?authuser={urllib.parse.quote(account.strip(), safe='@')}#search/{q}"
