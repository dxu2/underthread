# Extensions

An extension adds a feature to Underthread without changing a core file: an endpoint, a button action, a card kind, a scheduled
job, a line on the health panel, a `stateutil.py` command, or its own page scripts and styles. Extensions live in your own layer
(`local/ext/<name>/`, see `docs/local.md`), so updates never touch them.

## Layout

```
local/ext/<name>/
├─ ext.json          the manifest (required for this API)
├─ server_ext.py     register(R) for the dashboard server       (optional)
├─ stateutil_ext.py  register(R) for the stateutil.py command   (optional)
└─ web/              your page files, served at /static/ext/<name>/<file>
```

`ext.json`:

```json
{
  "name": "clips",
  "api": 1,
  "requires": ">=0.2",
  "card_kinds": [{"id": "clip", "label": ["剪辑", "Clip"]}],
  "web": {
    "css": [{"href": "clips.css", "after": "mobile.css"}],
    "js": [{"src": "clips.js"}],
    "drop": []
  }
}
```

- `name` must match the folder name. `api` is the registry API this extension was written for (now **1**).
  `requires` is an optional version range for Underthread itself (`>=0.2`, `>=0.2,<1`, `==0.2.1`).
- `web.css` / `web.js`: paths inside the extension's `web/` folder. `after` puts the tag right after a core file
  (`style.css`, `mobile.css`, `skin-ink.css`, `icon-180.png` for a script that must run in `<head>`); a script with `after` is a
  plain `<script>` that runs while the page is parsed. Without `after` a script goes to the end of the page as `<script defer>`:
  it runs after every core page script (they are ES modules, see `web/main.js`) and before `DOMContentLoaded`, in the order listed.
  `{"src": "x.js", "module": true}` loads it as an ES module instead (same place, same order; it may `import` other files
  by relative path). Every file gets a content hash in its URL (scripts through the page's import map), so a change shows up
  without a restart. The core page scripts are no longer `<script>` tags, so `after` a core `.js` file falls back to the end.
- `web.drop`: core files to leave out of the page (for example `oss.css`).
- `card_kinds`: new card kinds (see below). Both the server and `stateutil.py` read them from here.

## register(R)

`server_ext.py` and `stateutil_ext.py` each define `register(R)`. `R` is the registry handle of this extension:

| Call | Where | What it adds |
|---|---|---|
| `R.route(method, path, fn, prefix=False)` | server | `GET` endpoint `fn(h, u, q)` or `POST` endpoint `fn(h, u, body)`; answer with `h._send(code, obj)`; return `R.NEXT` from a prefix route to pass the request on. A path core already has is refused. Use `/api/ext/<name>/...` for new paths. |
| `R.action(kind, fn, lock=True)` | server | a new `POST /api/action` kind. `fn(a)` gets `a.body`, `a.st` (the locked state), `a.it` (the card named by `item`), and sets `a.inbox` to tell the manager. With `lock=False` it runs on a read-only copy outside the state lock and may return a dict that is added to the answer. |
| `R.card_kind(id, label_zh, label_en=None, icon=None)` | either | a card kind: `stateutil.py upsert-item --kind <id>` accepts it, `/api/ext` lists its labels for the page. |
| `R.job(id, fn, default_rule="daily 09:00", label=None)` | server | a scheduled job. It appears on the 定时 page once (id `s-job-<id>`), where you can pause it, change its time, run it now or delete it (deleting sticks). When due, the server calls `fn(ctx)` in its own thread; `ctx` has `job`, `schedule`, `for`, `manual` and `S`. Rules: `daily 09:00`, `weekly mon,thu 09:00`, `monthly last 18:00`. |
| `R.cli(fn)` | stateutil | `fn(subparsers)` adds commands to `stateutil.py`. |
| `R.on_set_agent(fn)` | stateutil | `fn(st, agent_id, agent, auto, tool)` after `set-agent`, inside the state lock. |
| `R.on_upsert(fn)` | stateutil | `fn(phase, ctx)` around `upsert-item`: `before` / `after` inside the lock, `done` after it. |
| `R.health(fn)` | server | `fn()` returns a dict or a short text, shown under `ext.health` in `/api/health`. |

Also on `R`: `R.name`, `R.dir` (the extension folder, which is on `sys.path`), `R.api`, `R.S` (the `stateutil` module: `R.S.read()`,
`R.S.mutate()`, `R.S.add_thread(...)`, ...), `R.srv` (the server module, server side only) and `R.NEXT`.

A small example, `server_ext.py`:

```python
def register(R):
    R.route("GET", "/api/ext/clips/count", lambda h, u, q: h._send(200, {"n": sum(i["kind"] == "clip" for i in R.S.read()["items"])}))

    def tag(a):
        a.it.setdefault("tags", []).append("clip")
        a.inbox = {"kind": "clip_tagged", "item": a.it["id"]}
    R.action("clip_tag", tag)

    R.job("clips.sweep", lambda ctx: print("sweep", ctx["for"]), "daily 07:30", label="Clip sweep")
```

## In the page: App.ext

`web/ext.js` loads before every other core page script and is `window.UTExt` (also `App.ext`); extension scripts run after all of them. Core registers its own nine home
widgets through it, so a widget from an extension sizes, moves, drags and hides like a core one.

```js
UTExt.widget({
  id: "clips",                         // a-z, 0-9, - and _, up to 24 characters
  name: ["剪辑", "Clips"],              // [Chinese, English]
  sizes: ["s", "m"], size: "m",        // which sizes 编辑小组件 offers, and the size it starts at
  html: (size, D, kit) => kit.eb("clips", 3) + "<div class=\"wg-row\">…</div>",   // the tile's inside
  empty: D => false,                   // true: the tile leaves the grid and `calm` becomes one quiet line above it
  calm: ["没有剪辑", "No clips"],
  first: false,                        // true: a new widget goes in at the front instead of the end
});
UTExt.cardKind({ id: "clip", label: ["剪辑", "Clip"] });   // kinds from ext.json "card_kinds" are loaded for you
UTExt.toolPill((agent, toolKey, stale) => "");            // extra HTML in a working teammate's tool pill
UTExt.statusRow(en => ({ t: "Clips", s: "3 today", lv: "ok" }));   // one more row in 系统状态 (ok / warn / bad)
```

`D` is the data core widgets draw from (`waiting`, `busy`, `nr`, `shipped`, `days`, `ongoing`, `imgs`); `kit` has `eb` (the
widget's title line), `esc`, `ago`, `hm` and `en`. A widget that throws shows a short error in its tile instead of breaking the
home. The home layout lives on the server (`meta.widgets`), with `seen`: every widget id this board has met. A widget that is
new to the board goes into the layout once; if you remove it, it stays removed. When its extension goes away, its tile drops out.
Register at the top level of your script (it runs before the first draw); registering later redraws the page.

## Safety and versions

- A broken extension never takes the dashboard down: an error while loading is shown under `ext` in `/api/health` and in
  `/api/ext`, and the rest keeps running.
- An extension whose `api` or `requires` does not match this version is **skipped**: none of its code or files load, and one
  card (`t-ext-<name>`) on the board says why. Fix `ext.json` or update the extension, then restart the dashboard.
- Removing an extension is safe: its routes and actions are gone, cards of its kinds show as ordinary cards, and its scheduled
  job stays on the 定时 page doing nothing until you delete it.
- Core changes the API number only in a major version. Every release's upgrade notes have an `Extension API:` line;
  `tools/release.py` checks it against `API` and `SURFACE` in `core/registry.py`.
- `GET /api/ext` shows the API number, every extension with its state, the card kinds and the jobs.

## The old way (until 0.3.0)

A folder without `ext.json` still loads as before: `register(module)` gets the `stateutil` or `server` module and appends to
`CLI_EXT`, `SET_AGENT_HOOKS`, `UPSERT_HOOKS` or `EXT_GET`; `local/ext.json` still adds web files. Both are marked `legacy` in
`/api/ext` and stop working in 0.3.0. To move: add an `ext.json` with `"api": 1`, change `register(srv)` / `register(S)` to
`register(R)` and use the calls above (`srv.EXT_GET.append(fn)` becomes `R.route("GET", path, fn, prefix=True)` with `R.NEXT`
instead of `None` for "not mine"), and move the web files from `local/web/` and `local/ext.json` into the extension's `web/`.
