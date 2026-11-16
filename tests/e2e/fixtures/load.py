#!/usr/bin/env python3
"""Put the test fixtures into a server copy (never the project itself).

    python3 tests/e2e/fixtures/load.py <dir>

Writes <dir>/state.json (every timestamp shifted by now - fixture end, so the newest event is "just now" and the spacing
is the same on every run), <dir>/config.json, <dir>/roster.json (from presets/classic/roster.json), and removes inbox.jsonl,
archive.json, push_subs.json and the local/ layer from <dir>. Refuses the checkout this file lives in.
"""
import datetime as dt
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def rebase(st, now=None):
    end = dt.datetime.fromisoformat(st["meta"]["fixture"]["end"])
    now = now or dt.datetime.now().astimezone()
    shift = now - dt.timedelta(minutes=1) - end
    days = (now.date() - end.date()).days

    def walk(o):
        if isinstance(o, dict):
            return {k: walk(v) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v) for v in o]
        if isinstance(o, str):
            if _ISO.match(o):
                t = dt.datetime.fromisoformat(o.replace("Z", "+00:00"))
                t = t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
                return (t + shift).astimezone().isoformat(timespec="seconds")
            if _DAY.match(o):
                return (dt.date.fromisoformat(o) + dt.timedelta(days=days)).isoformat()
        return o
    return walk(st)


def load(d):
    d = os.path.abspath(d)
    if os.path.realpath(d) == os.path.realpath(os.path.join(HERE, "..", "..", "..")):
        sys.exit(f"refuse: {d} is this checkout; load fixtures into a copy")
    if not os.path.exists(os.path.join(d, "server.py")):
        sys.exit(f"refuse: {d} has no server.py")
    with open(os.path.join(HERE, "state.json"), encoding="utf-8") as f:
        st = rebase(json.load(f))
    with open(os.path.join(d, "state.json"), "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)
    shutil.copy(os.path.join(HERE, "config.json"), os.path.join(d, "config.json"))
    # t-oss-gen-s2: the fixture board keeps the seven-person classic crew (its cards and golden answers name writer / director / ops);
    # the four-person default (roster.example.json) is covered by tests/smoke.py and the nocrew journey
    # (read from this checkout: test copies skip every file named roster.json)
    shutil.copy(os.path.join(HERE, "..", "..", "..", "presets", "classic", "roster.json"), os.path.join(d, "roster.json"))
    for f in ("inbox.jsonl", "archive.json", "push_subs.json"):
        if os.path.exists(os.path.join(d, f)):
            os.remove(os.path.join(d, f))
    if os.path.isdir(os.path.join(d, "local")):
        shutil.rmtree(os.path.join(d, "local"))
    print(f"fixtures loaded into {d}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    load(sys.argv[1])
