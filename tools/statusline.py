#!/usr/bin/env python3
"""Claude Code statusLine bridge: feeds plan usage into the dashboard's stamina orb.

Claude Code pipes a JSON blob to the statusLine command on every refresh. On a Pro/Max
plan it carries rate_limits.five_hour / seven_day (used_percentage, resets_at) and the
session's context window. We store them in state.json (meta.usage) and print a short
status line back.

.claude/settings.json:
  {"statusLine": {"type": "command", "command": "python3 tools/statusline.py"}}
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import stateutil as S  # noqa: E402


def _iso(v):
    """resets_at arrives as epoch seconds or an ISO string depending on the version."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(v, dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    return str(v)


def _win(d):
    if not isinstance(d, dict):
        return None
    used = d.get("used_percentage", d.get("percent_used"))
    if used is None:
        return None
    return {"used": round(float(used), 1), "resets_at": _iso(d.get("resets_at"))}


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    rl = data.get("rate_limits") or {}
    five, week = _win(rl.get("five_hour")), _win(rl.get("seven_day"))
    cw = data.get("context_window") or {}
    ctx = cw.get("used_percentage")
    if ctx is None and cw.get("total_input_tokens") and cw.get("context_window_size"):
        ctx = 100 * cw["total_input_tokens"] / cw["context_window_size"]

    if five or week or ctx is not None:
        new = {"five_hour": five, "seven_day": week, "context": None if ctx is None else round(float(ctx)),
               "source": "statusline"}
        old = (S.read()["meta"].get("usage") or {})
        # only write on change (or once a minute) so the dashboard isn't re-rendered on every keystroke
        same = all(old.get(k) == new[k] for k in ("five_hour", "seven_day", "context"))
        stale = not old.get("at") or (dt.datetime.now().astimezone() - dt.datetime.fromisoformat(old["at"])).total_seconds() > 60
        if not same or stale:
            with S.mutate() as st:
                new["at"] = S.now()
                st["meta"]["usage"] = new

    parts = []
    if five:
        parts.append(f"体力 {100 - five['used']:.0f}%")
    if week:
        parts.append(f"本周 {100 - week['used']:.0f}%")
    if ctx is not None:
        parts.append(f"ctx {float(ctx):.0f}%")
    model = (data.get("model") or {}).get("display_name")
    print(" · ".join(([model] if model else []) + parts) or "Underthread")


if __name__ == "__main__":
    main()
