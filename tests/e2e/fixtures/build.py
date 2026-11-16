#!/usr/bin/env python3
"""Test fixtures: a small, believable board built from tools/demo.py's sample jobs on a FIXED clock.

    python3 tests/e2e/fixtures/build.py            # rewrite tests/e2e/fixtures/state.json + config.json
    python3 tests/e2e/fixtures/build.py --check    # exit 1 if the committed files differ from a fresh build
    python3 tests/e2e/fixtures/build.py --out DIR  # write somewhere else

How it stays deterministic: the real stateutil.py runs in this process against a throwaway folder, with the clock pinned
(FIXED, +37 s per reading), uuid4 drawn from a seeded generator, TZ=UTC and archiving off. Same code, same bytes, on any
machine. Loading the fixture into a server copy (load.py) shifts every timestamp by (now - END) so the board looks like
it happened a few minutes ago, with the same spacing every run.

What is in it (ids are stable, journeys may rely on them):
  q-demo-*        the 4 sample cards from state.example.json
  fx-1 .. fx-7    the 7 demo.py jobs, spread over review / doing / done / todo, one with an open question (fx-7)
  chat / dms      steward lines (one with quick replies), your own lines, DMs from scout and writer
  mail, reports   one daily report (mail kind update), DM mail, a lesson proposal from writer
  schedules       one daily, one weekly
  agents          scout working on fx-1 (Chrome), writer working on fx-2, the rest idle
"""
import contextlib
import datetime as _dtm
import importlib.util
import io
import json
import os
import random
import shutil
import sys
import tempfile
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXED = _dtm.datetime(2026, 1, 15, 9, 0, 0, tzinfo=_dtm.timezone.utc)
STEP = _dtm.timedelta(seconds=37)
SEED = 20260115
FILES = ("state.json", "config.json")
MODS = ("stateutil", "schedules", "core")   # plus every core.* submodule (see _ours)


def _ours():
    return [m for m in sys.modules if m in MODS or m.startswith("core.")]


def _demo():
    spec = importlib.util.spec_from_file_location("rt_demo", os.path.join(ROOT, "tools", "demo.py"))
    m = importlib.util.module_from_spec(spec)
    argv = sys.argv
    sys.argv = [argv[0], "--lang", "en"]   # demo.py reads its language at import
    try:
        spec.loader.exec_module(m)
    finally:
        sys.argv = argv
    return m


class _Clock:
    t = FIXED

    @classmethod
    def tick(cls):
        cls.t = cls.t + STEP
        return cls.t


class _FakeDT(_dtm.datetime):
    @classmethod
    def now(cls, tz=None):
        t = _Clock.tick()
        return t.astimezone(tz) if tz else t.replace(tzinfo=None)

    @classmethod
    def today(cls):
        return cls.now()


class _FakeDate(_dtm.date):
    @classmethod
    def today(cls):
        return _Clock.t.date()


def build(out):
    os.environ["TZ"] = "UTC"
    os.environ["ARCHIVE_OFF"] = "1"
    import time
    time.tzset()
    _Clock.t = FIXED
    rnd = random.Random(SEED)
    demo = _demo()
    work = tempfile.mkdtemp(prefix="rt-fixture-")
    try:
        for f in ("stateutil.py",):
            shutil.copy(os.path.join(ROOT, f), work)
        shutil.copytree(os.path.join(ROOT, "core"), os.path.join(work, "core"), ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy(os.path.join(ROOT, "presets", "classic", "roster.json"), os.path.join(work, "roster.json"))   # t-oss-gen-s2: see load.py
        os.makedirs(os.path.join(work, "roles"))
        with open(os.path.join(ROOT, "state.example.json"), encoding="utf-8") as f:
            st = json.load(f)
        # the sample cards keep their own (older) stamps; pin them to the fixed day so a rebuild never depends on the example's dates
        st["meta"]["updated"] = FIXED.isoformat()
        st["meta"]["stamina"]["at"] = FIXED.isoformat()
        for it in st["items"]:
            for k in ("created", "updated", "activity"):
                if k in it:
                    it[k] = FIXED.isoformat()
            for e in it.get("thread", []):
                e["t"] = FIXED.isoformat()
        for n in st.get("notices", []):
            n["t"] = FIXED.isoformat()
        with open(os.path.join(work, "state.json"), "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False)

        real_dt, real_date, real_uuid4 = _dtm.datetime, _dtm.date, uuid.uuid4
        _dtm.datetime, _dtm.date = _FakeDT, _FakeDate
        uuid.uuid4 = lambda: uuid.UUID(int=rnd.getrandbits(128), version=4)
        sys.path.insert(0, work)
        try:
            for m in _ours():
                sys.modules.pop(m, None)
            import stateutil as S   # noqa: E402  (the copy in `work`, ROOT = work)

            def su(*args):
                argv = sys.argv
                sys.argv = ["stateutil.py", *args]
                try:
                    with contextlib.redirect_stdout(io.StringIO()) as o:
                        S.main()
                    return o.getvalue().strip()
                finally:
                    sys.argv = argv

            _script(su, S, demo)
        finally:
            sys.path.remove(work)
            for m in _ours():
                sys.modules.pop(m, None)
            _dtm.datetime, _dtm.date, uuid.uuid4 = real_dt, real_date, real_uuid4

        with open(os.path.join(work, "state.json"), encoding="utf-8") as f:
            st = json.load(f)
        st["meta"]["fixture"] = {"end": _Clock.t.isoformat(), "seed": SEED, "built_by": "tests/e2e/fixtures/build.py"}
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "state.json"), "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        cfg = {"owner": {"display_name": "You"}, "report_time": "18:00", "routines": []}
        with open(os.path.join(out, "config.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _script(su, S, demo):
    stages = ["review", "doing", "review", "done", "review", "todo", "review"]
    for n, (owner, kind, cat, zh, en, summary, logs, draft) in enumerate(demo.JOBS, 1):
        cid = f"fx-{n}"
        su("upsert-item", "--id", cid, "--title", zh, "--summary", summary, "--category", cat, "--kind", kind,
           "--owner", owner, "--stage", "todo", "--who", "manager", "--json", json.dumps({"title_en": en, "summary_en": summary}))
        st = stages[n - 1]
        if st == "todo":
            continue
        su("upsert-item", "--id", cid, "--stage", "doing", "--who", owner)
        su("set-agent", owner, "--status", "working", "--item", cid, "--activity", logs[0])
        for line in logs:
            su("log", cid, owner, line)
        if st in ("review", "done"):
            args = ["upsert-item", "--id", cid, "--who", owner, "--stage", "review", "--draft", draft,
                    "--label", "v1", "--confidence", "med", "--confidence-note", "Fixture card"]
            if kind == "question":
                args += ["--ask", f"{en} :: London | Berlin* | Lisbon"]
            su(*args)
            su("set-agent", owner, "--status", "idle")
        if st == "done":
            su("upsert-item", "--id", cid, "--stage", "done", "--who", "me")
    su("reply", "fx-1", "scout", "Model B wins on noise cancelling; table is in the draft.")
    su("set-agent", "scout", "--status", "working", "--item", "fx-1", "--activity", "Checking prices again", "--tool", "chrome")
    su("set-agent", "writer", "--status", "working", "--item", "fx-2", "--activity", "Tightening the opening")

    su("say-mgr", "Morning. Two cards wait for you, one has a question.")
    with S.mutate() as st:
        st["chat"].append(S._chat_entry("me", "What is the headphone pick?"))
    su("say-mgr", "Model B. Want me to order it?", "--options", "Yes|Not now")
    with S.mutate() as st:
        st["chat"].append(S._chat_entry("me", "Not now"))
    su("dm", "scout", "Prices checked on three sites; B is cheapest at the first one.")
    su("dm", "writer", "Should the update mention the export fix?", "--options", "Yes|No")
    su("lesson", "writer", "Weekly updates open with the one decision the team must make.", "--item", "fx-2")
    su("report", "--title", "Daily report", "--text", "## Today\n\n- 3 cards handed in\n- 1 question open (fx-7)\n")
    su("schedule", "add", "--title", "Morning digest", "--kind", "task", "--rule", "daily 09:00", "--agent", "scout",
       "--text", "Collect overnight news into a card", "--tz", "UTC")
    su("schedule", "add", "--title", "Weekly review", "--kind", "remind", "--rule", "weekly mon 10:00", "--tz", "UTC")


def main():
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else HERE
    if "--check" in sys.argv:
        tmp = tempfile.mkdtemp(prefix="rt-fixture-check-")
        try:
            build(tmp)
            bad = [f for f in FILES if open(os.path.join(tmp, f), "rb").read() != open(os.path.join(HERE, f), "rb").read()]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        if bad:
            print("fixtures out of date:", ", ".join(bad), "- run python3 tests/e2e/fixtures/build.py and commit")
            sys.exit(1)
        print("fixtures up to date")
        return
    build(out)
    print("wrote", ", ".join(os.path.join(out, f) for f in FILES))


if __name__ == "__main__":
    main()
