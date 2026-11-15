"""The dashboard server, split by feature (t-oss-struct S7, B2-B4). server.py is the entry point and stays the only thing to run.

    api/ctx.py      paths, config, optional modules, small helpers
    api/router.py   route table (@route) and action table (@action), NEXT, EXT_GET, OpenAsks
    api/http.py     request handler H (guards, gzip, keep-alive, files) + server class; dispatches through the route table
    api/loops.py    background threads
    api/routes/     one module per feature: state, actions, schedules, snooze, push, health, secret, hr, media, docs, voice, web

Rule: core/ never imports api/; api/ imports core/ and stateutil."""
