#!/usr/bin/env python3
"""t-onb-polish: tick an optional step of the 开工清单 from outside the page.

    python3 tools/onb_mark.py chrome

.claude/settings.json runs it as an async PostToolUse hook on mcp__claude-in-chrome__* tools, so the first time any session in this
folder really uses Claude in Chrome, meta.onboarding.chrome_at is written (once; every later call returns after one read of
the state through core.store). The hook payload on stdin is not read. Never fails the tool call: every error exits 0 quietly."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELD = {"chrome": "chrome_at"}


def main(argv):
    k = argv[1] if len(argv) > 1 else ""
    if k not in FIELD:
        print("usage: onb_mark.py chrome", file=sys.stderr)
        return 2
    sys.path.insert(0, ROOT)
    from core import store as S
    from core.paths import STATE
    if not os.path.exists(STATE):
        return 0   # no board here: nothing to tick (and never seed one from a hook)
    try:
        ob = (S.read().get("meta") or {}).get("onboarding")   # shared lock, the same reader as everything else
    except (OSError, ValueError):
        return 0
    if isinstance(ob, dict) and ob.get(FIELD[k]):
        return 0   # already ticked: one read and out
    with S.mutate() as st:
        ob = st["meta"].get("onboarding")
        if not isinstance(ob, dict):
            ob = st["meta"]["onboarding"] = {}
        if not ob.get(FIELD[k]):
            ob[FIELD[k]] = S.now()
            ob.setdefault("tick_by", {})[k] = "auto"
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception:  # noqa: BLE001  a hook must never get in the way of the tool call
        sys.exit(0)
