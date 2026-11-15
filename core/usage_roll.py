"""t-home-usage: per-role token usage for the dashboard, read from this machine's Claude Code transcripts.

Where the numbers come from
- ~/.claude/projects/<this project>/<session>.jsonl : top-level sessions (the manager, voice calls / meetings / DMs).
- ~/.claude/projects/<this project>/<session>/subagents/agent-*.jsonl : specialists the manager dispatched;
  the sibling agent-*.meta.json carries agentType ("underthread-smith" -> smith).
- Every assistant line has message.usage. One reply is written as several lines with the same message.id, so ids are de-duplicated.

Role of a session (resolved when asked, so a late custom title still counts)
- subagent with agentType underthread-<id>  -> <id>
- top-level session titled "...管家..." -> manager
- top-level session found in work/voice/sessions.json (now or ever: we keep our own ledger) -> that role
- anything else -> "other"

Files are read incrementally (byte offset per file), counters are kept per local day per session and saved to
work/usage/rollup.json, so a restart does not re-read the ~1 GB of transcripts. Days older than KEEP_DAYS are dropped.
"""
import datetime as dt
import glob
import json
import os
import re
import threading
import time


def _agent_role(t):
    """A subagent's agentType -> roster id: the roster's agent_name first (installs may use another prefix), then "underthread-<id>"."""
    try:
        from core import config as C
        from core.paths import ROOT   # t-oss-tidy: this file moved into core/; the roster is still in the project root
        for r in C.roster(ROOT).get("roles", []):
            if t and r.get("agent_name") == t:
                return r["id"]
    except (OSError, ValueError, KeyError, ImportError):
        pass
    return t[len("underthread-"):] if t.startswith("underthread-") else "other"

KEEP_DAYS = 14
CACHE_S = 60
FIELDS = ("in", "cw", "cr", "out", "msgs")


class Roll:
    def __init__(self, root):
        self.root = root
        slug = re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(root))
        self.proj = os.environ.get("USAGE_PROJ") or os.path.join(os.path.expanduser("~/.claude/projects"), slug)   # USAGE_PROJ: scratch copies point at the real transcripts
        self.dir = os.path.join(root, "work", "usage")
        self.path = os.path.join(self.dir, "rollup.json")
        self.ledger_path = os.path.join(self.dir, "sessions-roles.json")
        self.voice = os.path.join(root, "work", "voice", "sessions.json")
        self.lock = threading.Lock()
        self.t = 0.0
        self.scan_ms = 0
        self.err = None
        self.data = self._load(self.path, {"files": {}, "days": {}})
        self.ledger = self._load(self.ledger_path, {})

    @staticmethod
    def _load(p, d):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return d

    def _save(self, p, obj):
        os.makedirs(self.dir, exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, p)

    # ---------- roles ----------
    def _ledger_sync(self):
        """Remember every voice session we ever saw, since work/voice/sessions.json only holds the current one per role."""
        v = self._load(self.voice, {})
        changed = False
        for role, s in (v.items() if isinstance(v, dict) else []):
            sid = isinstance(s, dict) and s.get("sid")
            if sid and self.ledger.get(sid) != role:
                self.ledger[sid] = role
                changed = True
        if changed:
            self._save(self.ledger_path, self.ledger)

    def _role(self, key):
        if "/" in key:   # "<session>/agent-xxx"
            meta = os.path.join(self.proj, key.split("/")[0], "subagents", key.split("/")[1] + ".meta.json")
            t = self._load(meta, {}).get("agentType") or ""
            return _agent_role(t)
        try:
            with open(os.path.join(self.proj, key, "custom-title.json"), encoding="utf-8") as f:
                if "管家" in (json.load(f).get("customTitle") or ""):
                    return "manager"
        except (OSError, ValueError):
            pass
        return self.ledger.get(key, "other")

    # ---------- scan ----------
    def _files(self):
        out = []
        for p in glob.glob(os.path.join(self.proj, "*.jsonl")):
            out.append((os.path.basename(p)[:-6], p))
        for p in glob.glob(os.path.join(self.proj, "*", "subagents", "agent-*.jsonl")):
            out.append((p.split(os.sep)[-3] + "/" + os.path.basename(p)[:-6], p))
        return out

    def _scan(self):
        t0 = time.time()
        files, days = self.data["files"], self.data["days"]
        horizon = time.time() - KEEP_DAYS * 86400
        for key, p in self._files():
            try:
                stt = os.stat(p)
            except OSError:
                continue
            rec = files.get(key)
            if rec is None:
                rec = files[key] = {"off": 0, "ids": []}
                if stt.st_mtime < horizon:   # older than what we keep: never read it
                    rec["off"] = stt.st_size
                    continue
            if stt.st_size < rec["off"]:   # rewritten: start over (counters for it may double once; acceptable, very rare)
                rec["off"], rec["ids"] = 0, []
            if stt.st_size == rec["off"]:
                continue
            seen = set(rec["ids"])
            with open(p, "rb") as f:
                f.seek(rec["off"])
                buf = f.read()
            end = buf.rfind(b"\n")
            if end < 0:
                continue
            for line in buf[:end].split(b"\n"):
                if b'"usage"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                m = d.get("message") or {}
                u, mid, ts = m.get("usage"), m.get("id"), d.get("timestamp")
                if not u or not ts or (mid and mid in seen):
                    continue
                if mid:
                    seen.add(mid)
                    rec["ids"].append(mid)
                try:
                    day = dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().date().isoformat()
                except ValueError:
                    continue
                c = days.setdefault(day, {}).setdefault(key, [0, 0, 0, 0, 0])
                c[0] += int(u.get("input_tokens") or 0)
                c[1] += int(u.get("cache_creation_input_tokens") or 0)
                c[2] += int(u.get("cache_read_input_tokens") or 0)
                c[3] += int(u.get("output_tokens") or 0)
                c[4] += 1
            rec["ids"] = rec["ids"][-200:]
            rec["off"] += end + 1
        keep = (dt.date.today() - dt.timedelta(days=KEEP_DAYS)).isoformat()
        for d in [d for d in days if d < keep]:
            del days[d]
        self._save(self.path, self.data)
        self.scan_ms = int((time.time() - t0) * 1000)

    def refresh(self, force=False):
        with self.lock:
            if not force and time.time() - self.t < CACHE_S:
                return
            try:
                if not os.path.isdir(self.proj):
                    self.err = None   # no Claude Code session has run in this folder yet: nothing to count, not an error
                else:
                    self._ledger_sync()
                    self._scan()
                    self.err = None
            except Exception as e:  # noqa: BLE001  (never take /api/usage down; say why instead)
                self.err = type(e).__name__
            self.t = time.time()

    # ---------- answer ----------
    def report(self, day=None, n_days=7):
        self.refresh()
        today = dt.date.today()
        day = day or today.isoformat()
        with self.lock:
            days = self.data["days"]
            roles = {}
            for key, c in (days.get(day) or {}).items():
                r = roles.setdefault(self._role(key), {"in": 0, "cw": 0, "cr": 0, "out": 0, "msgs": 0, "sessions": 0})
                for i, f in enumerate(FIELDS):
                    r[f] += c[i]
                r["sessions"] += 1
            hist = []
            for k in range(n_days - 1, -1, -1):
                d = (today - dt.timedelta(days=k)).isoformat()
                per = {}
                for key, c in (days.get(d) or {}).items():
                    rid = self._role(key)
                    per[rid] = per.get(rid, 0) + c[0] + c[1] + c[3]
                hist.append({"day": d, "roles": per})
        out = []
        for rid, r in roles.items():
            r["id"] = rid
            r["new"] = r["in"] + r["cw"] + r["out"]
            out.append(r)
        out.sort(key=lambda r: -r["new"])
        return {"day": day, "at": dt.datetime.fromtimestamp(self.t).astimezone().isoformat(timespec="seconds"),
                "roles": out, "total": sum(r["new"] for r in out), "cache_read": sum(r["cr"] for r in out),
                "history": hist, "scan_ms": self.scan_ms, "error": self.err}
