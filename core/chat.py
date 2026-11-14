"""Manager chat and DM entries, and quoting an earlier message (t-option-quote). Moved from stateutil.py (t-oss-struct B1)."""
import re
import uuid

from core.store import norm_attach, now

# t-option-quote: a reply that quotes an earlier chat / DM message (a quick-option click). The quote is taken from the server's own copy,
# never from the browser: rq = {who, text} (plain text, first 80 chars) stays readable after the original is trimmed out of the list.
def plain_text(t):
    t = re.sub(r"```[\s\S]*?```", " ", str(t or ""))
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+", "", t, flags=re.M)
    t = re.sub(r"[*_`~]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def find_msg(lst, mid):
    if not mid or not isinstance(mid, str):
        return None
    return next((m for m in reversed(lst or []) if m.get("id") == mid), None)


def quote_of(src):
    return {"who": src.get("who"), "text": plain_text(src.get("text"))[:80]}


def reply_fields(src):
    """inbox fields for a reply: reply_to = message id, reply_q = original text (head + tail, 300 chars), reply_opts = its options."""
    q = plain_text(src.get("text"))
    if len(q) > 300:
        q = q[:120] + " … " + q[-170:]
    out = {"reply_to": src.get("id"), "reply_q": q}
    if src.get("options"):
        out["reply_opts"] = [re.sub(r"\s*[*＊]\s*$", "", o) for o in src["options"]]
    return out


def _chat_entry(who, text, options=None, attachments=None, quote=None, multi=False):
    e = {"id": uuid.uuid4().hex[:8], "t": now(), "who": who, "text": text}
    if quote:
        e["reply_to"] = quote.get("id")
        e["rq"] = quote_of(quote)
    if options:
        e["options"] = [o.strip() for o in options.split("|") if o.strip()]
        if multi and len(e["options"]) > 1:
            e["multi"] = True   # t-hr-multiselect: chips toggle, one 发送（n） sends 「A、B」
    if attachments:
        e["attachments"] = norm_attach(list(attachments))
    return e
