"""The source interface (t-feed-inbox). A source knows how to check credentials and how to fetch what is new since a cursor.

Everything a source returns is untrusted text from outside. It is cleaned here (control and direction characters out, one line,
length capped) before it is stored or written to the inbox; the message body is handed only to the classifier.
"""
import re
import unicodedata


class FeedError(Exception):
    """A failure with a fixed code. Never carries text from the remote server (it could echo what we sent)."""
    MSG = {
        "auth": ("账号或应用专用密码不对（或者没开两步验证）", "Wrong address or app password (or 2-Step Verification is off)"),
        "connect": ("连不上邮件服务器", "Can't reach the mail server"),
        "tls": ("和邮件服务器的加密连接没建立起来", "The secure connection to the mail server failed"),
        "mailbox": ("打不开收件箱", "Can't open the inbox"),
        "protocol": ("邮件服务器的回答看不懂", "The mail server's answer made no sense"),
        "timeout": ("邮件服务器太久没回", "The mail server took too long"),
        "unavailable": ("这个来源还不能用", "This source isn't available yet"),
        "input": ("地址或密码格式不对", "Address or password looks wrong"),
        "cred": ("读不出存好的密码", "Can't read the stored password"),
    }

    def __init__(self, code):
        super().__init__(code)
        self.code = code if code in self.MSG else "protocol"

    def text(self, en=False):
        return self.MSG[self.code][1 if en else 0]


class Source:
    """Subclass and set the class attributes; implement test() and poll()."""
    id = ""                       # a-z0-9_, also the keychain item name and the key in feeds.json
    label = ("", "")              # [Chinese, English]
    available = True              # False: listed on Settings -> Connections as "coming soon", cannot connect
    account_hint = ("", "")       # placeholder for the account field
    secret_label = ("密码", "Password")
    help_url = ""                 # where the user gets the secret (shown as a link)
    help = ("", "")               # one or two sentences next to the form

    def __init__(self, cfg=None):
        self.cfg = cfg or {}

    def check_input(self, account, secret):
        if not isinstance(account, str) or not isinstance(secret, str) or not account.strip() or not secret.strip():
            raise FeedError("input")

    def test(self, account, secret):
        """Log in and look. Returns a cursor (dict) that marks "everything up to now is old". Raises FeedError."""
        raise FeedError("unavailable")

    def poll(self, account, secret, cursor, limit):
        """Fetch what is new since cursor. Returns (messages, new_cursor, more). Each message is a dict:
        uid, thread, from, subject, date, msgid, link, snippet (cleaned) and body (cleaned, for the classifier only)."""
        raise FeedError("unavailable")


_BAD = re.compile("[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]")


def clean(s, cap):
    """One line of plain text, at most cap characters: no control, zero-width or direction characters, whitespace squeezed."""
    if not s:
        return ""
    s = unicodedata.normalize("NFC", str(s))
    s = _BAD.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= cap else s[:max(0, cap - 1)].rstrip() + "…"
