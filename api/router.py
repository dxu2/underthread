"""Route table and action table of the dashboard server (t-oss-struct B2 / B3).

Routes. A feature module under api/routes/ registers its endpoints with a decorator:

    @route("GET", "/api/health")                        def _(h, u, q)       exact path
    @route("GET", "/api/voice/", prefix=True)           def _(h, u, q)       path prefix, tried after the exact paths, in registration order
    @route("GET", "/static/", prefix=True, late=True)   def _(h, u, q)       tried after the extension routes (the file fallbacks)
    @route("POST", "/api/memo", raw=True)               def _(h, u, q, n)    reads the request body itself (n = Content-Length)
    @route("POST", "/api/action")                       def _(h, u, body)    body = the parsed JSON body

h is the request handler (api/http.py H): a handler answers through h._send / h._file. It returns NEXT to pass the request on,
as if it had not matched; anything else ends the request.
    GET  (and HEAD): exact, prefix, EXT_GET (local/ext server extensions), late exact, late prefix, 404.
    POST: raw exact, raw prefix, then the JSON body is read and parsed, exact, 404.

Actions. POST /api/action {"kind": k, ...}: @action("approve") registers the function that handles kind k inside the state lock
(api/routes/actions.py act() has the frame: find the card, call the handler, stamp the card, log, append the inbox entry).
One function may take several kinds: @action("routine_pause", "routine_resume").

Extensions (core/registry.py, t-oss-struct S8) add to the same tables through R.route / R.action; an exact path or a kind that is
already taken raises, so an extension can never replace a core endpoint.

Nothing here imports another api module (only core/registry.py, to hand it these tables).
"""
NEXT = object()   # a route handler's "not mine after all"
ME = "me"         # who a click is from, in threads / logs / chat

# core / local split: extensions (local/ext/<name>/server_ext.py, register(server)) add GET routes here.
# fn(handler, u, q) -> anything not None = handled (the handler already answered). Checked before the late (file) routes.
EXT_GET = []

_T = {}        # (method, late, raw) -> {"exact": {path: fn}, "prefix": [(path, fn)]}
ACTIONS = {}   # action kind -> fn(a)
NOLOCK = set()   # t-oss-struct S8: extension action kinds registered with lock=False (run on a read() copy, outside the state lock)


class OpenAsks(Exception):
    """t-open-questions: approve / done while the item still has unanswered asks and the click didn't say skip_asks."""
    def __init__(self, asks):
        super().__init__(f"还有 {len(asks)} 个问题没回答。刷新页面后在单子里点选，或者选择跳过。")
        self.asks = asks


def route(method, path, prefix=False, raw=False, late=False):
    def deco(fn):
        t = _T.setdefault((method, late, raw), {"exact": {}, "prefix": []})
        if prefix:
            t["prefix"].append((path, fn))
        elif path in t["exact"]:
            raise ValueError(f"route {method} {path} registered twice")
        else:
            t["exact"][path] = fn
        return fn
    return deco


def find(method, path, late=False, raw=False):
    """The handlers that match, in the order they are tried."""
    t = _T.get((method, late, raw))
    if not t:
        return []
    out = [t["exact"][path]] if path in t["exact"] else []
    return out + [fn for p, fn in t["prefix"] if path.startswith(p)]


def action(*kinds):
    def deco(fn):
        for k in kinds:
            if k in ACTIONS:
                raise ValueError(f"action {k} registered twice")
            ACTIONS[k] = fn
        return fn
    return deco


def table():
    """Every registered route as (method, path, flags) and every action kind with its module, for docs and tests."""
    rows = []
    for (method, late, raw), t in sorted(_T.items(), key=lambda kv: (kv[0][0], kv[0][1], not kv[0][2])):
        flags = ",".join(f for f, on in (("late", late), ("raw", raw)) if on)
        rows += [(method, p, flags, fn.__module__) for p, fn in t["exact"].items()]
        rows += [(method, p + "*", flags, fn.__module__) for p, fn in t["prefix"]]
    return {"routes": rows, "actions": {k: fn.__module__ for k, fn in sorted(ACTIONS.items())}}


def _bind():   # t-oss-struct S8: extensions register through core/registry.py, which reaches these tables only through this hook
    from core import registry
    registry.bind(route=route, action=action, nolock=NOLOCK, next=NEXT)


_bind()
