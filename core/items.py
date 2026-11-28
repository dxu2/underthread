"""Cards: create / update, find (also in the archive), and the voice-memo transcripts attached to them.
Moved from stateutil.py (t-oss-struct B1); stateutil re-exports every name."""
import re

from core.store import (CATEGORIES, KINDS, STAGES, _restore, add_thread, archive_find, check_id, new_id, norm_attach,  # noqa: F401
                        now)

# ---------- t-voice-memo: voice memos ----------
# Attachments stay plain path strings. Facts about an audio file live in st["media"][path]:
#   {"kind": "audio"|"video", "dur": s, "peaks": [48 x 0..1], "tx": {"status": queued|working|done|failed, "text", "lang", "model", "secs", "error", "notified"}}
AUDIO_EXT = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".webm")


def is_audio_path(p):
    return isinstance(p, str) and p.lower().endswith(AUDIO_EXT)


def set_media(st, path, tx=None, **fields):
    m = st.setdefault("media", {}).setdefault(path, {})
    m.update(fields)
    if tx is not None:
        m.setdefault("tx", {}).update(tx)
    return m


def _tx_text(st, path):
    tx = (st.get("media", {}).get(path) or {}).get("tx") or {}
    return tx.get("text") if tx.get("status") == "done" else None


def item_transcripts(st, it):
    paths = list(it.get("attachments") or []) + list(it.get("draft_attachments") or [])
    for e in it.get("thread") or []:
        paths += e.get("attachments") or []
    for v in it.get("versions") or []:
        paths += v.get("attachments") or []
    out = {}
    for p in paths:
        t = _tx_text(st, p) if is_audio_path(p) else None
        if t is not None:
            out[p] = t
    return out


def memo_name(path):
    return re.sub(r"^\d{8}-\d{6}-[0-9a-f]{4}-", "", path.rsplit("/", 1)[-1])


def claim_transcripts(st, entry):
    """Message just sent: fold transcripts that are already done into its inbox entry (marks them notified)."""
    added = []
    for p in entry.get("attachments") or []:
        m = st.get("media", {}).get(p) or {}
        tx = m.get("tx") or {}
        if is_audio_path(p) and tx.get("status") == "done" and not tx.get("notified"):
            tx["notified"] = now()
            added.append(f"【录音转写 · {memo_name(p)}（机器转写）】\n{tx.get('text') or '（没听到说话）'}")
    if added:
        entry["text"] = (entry.get("text") or "").rstrip() + "\n\n" + "\n\n".join(added)
        entry["transcripts"] = len(added)
    return entry


def memo_followup(st, path):
    """Transcript finished after the message went out: an inbox entry shaped like the original message's kind."""
    tx = (st.get("media", {}).get(path) or {}).get("tx") or {}
    if tx.get("status") != "done" or tx.get("notified"):
        return None
    head = f"【录音转写 · {memo_name(path)}（机器转写）】\n{tx.get('text') or '（没听到说话）'}"
    hit = lambda e: path in (e.get("attachments") or [])
    for e in reversed(st.get("chat") or []):
        if hit(e):
            tx["notified"] = now()
            return {"kind": "manager", "text": f"{head}\n\n（补充上一条消息：{(e.get('text') or '')[:80]}）", "attachments": [path], "transcript_of": path}
    for aid, msgs in (st.get("dms") or {}).items():
        for e in reversed(msgs):
            if hit(e):
                tx["notified"] = now()
                return {"kind": "dm", "agent": aid, "text": f"{head}\n\n（补充上一条私信：{(e.get('text') or '')[:80]}）", "attachments": [path], "transcript_of": path}
    for it in st.get("items") or []:
        for e in reversed(it.get("thread") or []):
            if hit(e):
                tx["notified"] = now()
                return {"kind": "comment", "item": it["id"], "to": e.get("to") or it.get("owner"), "text": f"{head}\n\n（补充这张卡上的评论：{(e.get('text') or '')[:80]}）", "attachments": [path], "transcript_of": path}
    return None   # not sent yet: the send path (claim_transcripts) picks it up


def find_item(st, item_id, restore=True):
    """t-perf A: a card that is not in state.json is looked up in archive.json. Inside mutate() (restore=True) it is moved back;
    in a plain read() a copy is returned and nothing moves. restore=False never looks in the archive."""
    for it in st["items"]:
        if it["id"] == item_id:
            return it
    if not item_id or not restore:
        return None
    if isinstance(st.get("_mut"), list):
        return _restore(st, item_id)
    return archive_find(item_id)


def upsert_item(st, fields, who="manager"):
    if fields.get("attachments"):
        fields = dict(fields, attachments=norm_attach(fields["attachments"] if isinstance(fields["attachments"], list) else [fields["attachments"]]))
    item_id = fields.get("id")
    it = find_item(st, item_id) if item_id else None
    created = it is None
    if created and item_id:
        check_id(item_id, "card id")   # t-oss-secreview P1-3: a new card id is a plain token (old cards keep theirs)
    if fields.get("owner") is not None:
        check_id(fields["owner"], "owner")
    if fields.get("platforms") is not None:
        for p in fields["platforms"] if isinstance(fields["platforms"], list) else [fields["platforms"]]:
            check_id(p, "platform")
    if created:
        it = {"id": item_id or new_id("q"), "title": "", "summary": "", "category": "daily",
              "stage": "todo", "kind": "task", "owner": "manager", "platforms": [], "tags": [],
              "draft": "", "versions": [], "evidence": [], "attachments": [], "confidence": None,
              "confidence_note": "", "due": None, "links": [], "thread": [], "rejects": 0,
              "created": now(), "updated": now(), "activity": now()}
        st["items"].append(it)
    for k in ("category", "stage", "kind"):
        allowed = {"category": CATEGORIES, "stage": STAGES, "kind": KINDS}[k]
        if fields.get(k) is not None and fields[k] not in allowed:
            raise SystemExit(f"bad {k} {fields[k]!r}; one of {allowed}")
    if "draft" in fields and fields["draft"] is not None and fields["draft"] != it.get("draft"):
        if it.get("draft"):
            ver = {"t": it.get("draft_at") or it["updated"], "draft": it["draft"],
                   "label": it.get("draft_label", "")}
            if it.get("draft_attachments"):
                ver["attachments"] = it["draft_attachments"]
            it["versions"].append(ver)
        it["draft_attachments"] = []  # ui6: files belong to the version they were submitted with
        it["draft_at"] = now()
        it["draft_label"] = fields.get("draft_label") or f"v{len(it['versions']) + 1}"
    if fields.get("draft") is not None and fields.get("attachments"):
        av = fields["attachments"] if isinstance(fields["attachments"], list) else [fields["attachments"]]
        it["draft_attachments"] = it.get("draft_attachments", []) + [x for x in av if x not in it.get("draft_attachments", [])]
    for k, v in fields.items():
        if v is None or k in ("id", "draft_label"):
            continue
        if k in ("evidence", "attachments", "links", "platforms", "tags") and not isinstance(v, list):
            v = [v]
        if k in ("evidence", "attachments", "links"):
            it[k] = it.get(k, []) + [x for x in v if x not in it.get(k, [])]
        else:
            it[k] = v
    # r-improve-1118 P1: a plan the user already approved (「批准开工」 in its thread) that comes back to review without an explicit kind
    # is the finished work, not a new plan: make it a deliverable so the big button says 验收 · 关单 instead of 批准开工 again.
    if (not created and fields.get("stage") == "review" and "kind" not in fields and it.get("kind") == "plan"
            and any(e.get("kind") == "approve" and str(e.get("text", "")).startswith("批准开工") for e in it.get("thread") or [])):
        it["kind"] = "deliverable"
    it["updated"] = it["activity"] = now()
    if created:
        add_thread(it, who, f"created · {it['title']}", "event")
    return it
