#!/usr/bin/env python3
"""Underthread local dashboard server (127.0.0.1 only, stdlib only).

    python3 server.py            # http://127.0.0.1:8765
    PORT=8799 python3 server.py  # scratch copy for UI testing
    NO_LOOPS=1 python3 server.py # no background threads (report, schedules, push, ...)
    NO_LOOPS=1 FEEDS_LOOP=1 ...  # ... except the feed collector (core/feeds)
    python3 server.py --demo     # sample crew in .demo/ (tools/demo.py)

Serves web/, a JSON API over state.json, and turns your clicks into inbox.jsonl entries the manager session watches.
The code lives in api/ (t-oss-struct S7): api/router.py is the route and action table, api/routes/* one module per feature,
api/http.py the request handler, api/loops.py the background threads. This file is the entry point only.

Extensions (local/ext/<name>/server_ext.py): with an ext.json manifest, register(R) gets a registry handle (core/registry.py,
docs/extensions.md). Without one (the old way, until 0.3.0) register(srv) gets this module: srv.S, srv.EXT_GET, srv.route,
srv.action and every name the old single-file server had (they are re-exported below) keep working.
"""
import os
import sys

from api import ctx, router, http, loops
import api.routes  # noqa: F401  (registers every route and action)
from api.routes import schedules, snooze, state, push, health as _health_mod, secret, hr, actions, media, docs, voice, web

from api.ctx import S, C, MG, ROOT, CONFIG
from core import registry as REG
from core import install_seed
from api.http import H, QuietServer
from api.routes.schedules import schedules_import
from api.routes.state import sync_roster

# Every name the single-file server.py had stays reachable as server.<name> (extensions and scripts used srv.S, srv.EXT_GET, ...).
# Assigning srv.<name> = x only changes this module, not the api module that owns the name.
for _m in (ctx, router, http, loops, schedules, snooze, state, push, _health_mod, secret, hr, actions, media, docs, voice, web):
    for _k, _v in vars(_m).items():
        if not _k.startswith("__"):
            globals().setdefault(_k, _v)
routines_fire = schedules.schedules_fire   # old name

S.load_ext("server", sys.modules[__name__])   # core / local split: local/ext/<name>/server_ext.py (after every route above)


def main():
    if "--demo" in sys.argv[1:]:   # demo mode: tools/demo.py builds .demo/ with sample data and runs this server there
        os.execv(sys.executable, [sys.executable, os.path.join(ROOT, "tools", "demo.py")] + [a for a in sys.argv[1:] if a != "--demo"])
    ctx.ensure_live_files()
    CONFIG.clear()
    CONFIG.update(C.load(ROOT))   # migrated in memory; config.json is rewritten only when a migration changes it
    if S.EXT:
        print("extensions: " + ", ".join(f"{n}" + (" [legacy]" if (REG.EXTS.get(n) or {}).get("legacy") else "")
                                         + (f" (error: {e['error']})" if e.get("error") else "") for n, e in S.EXT.items()), flush=True)
    sync_roster()
    install_seed.run(ROOT)   # t-oss-generic: missing preset role notes and default avatars come back (never overwrites)
    st0 = S.read()   # t-oss-struct E1: the first read after an update runs the state migrations (backup in local/backups/migrate)
    sc = MG.status(ROOT, st0)
    print(f"schema: code {sc['code']}, state {sc['state']}" + (f"; data newer than this code: {', '.join(sc['ahead'])}" if sc["ahead"] else ""), flush=True)
    try:
        schedules_import()   # t-schedule-backend: also with NO_LOOPS, so a scratch copy shows the imported routines
    except Exception as e:
        print("schedules_import:", e)
    try:
        schedules.jobs_import()   # t-oss-struct S8: extension jobs get their 定时 entry once
        REG.notice_skipped(S)   # an extension whose api / requires does not match: one card says why
    except Exception as e:
        print("extensions:", e)
    port = int(os.environ.get("PORT") or CONFIG.get("port") or 8765)
    if not os.environ.get("NO_LOOPS"):
        loops.start()
    elif os.environ.get("FEEDS_LOOP"):
        loops.start(only=("feeds_loop",))   # t-feed-inbox: a scratch copy that tests the collector
    try:
        srv = QuietServer(("127.0.0.1", port), H)
    except OSError as e:   # audit SM-14: a clear line instead of a traceback when the port is taken
        print(f"Underthread: cannot listen on 127.0.0.1:{port} ({e.strerror or e}). Is another copy running? "
              f"Stop it, or start this one with PORT=<other port>.", file=sys.stderr, flush=True)
        sys.exit(1)
    print(f"Underthread → http://127.0.0.1:{port}", flush=True)
    try:   # t-onboarding P0: a fresh board points at the 开工清单 (setup checklist) once; a board in use stays quiet
        from api.routes import setup as SU
        if not SU.retired(S.read()["meta"].get("onboarding") or {}):
            print(f"Open http://127.0.0.1:{port} — the setup checklist on the home page walks you through the rest.", flush=True)
    except Exception:
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
