# Browser tests (e2e)

Journeys drive the real dashboard in Playwright (Chromium and WebKit; desk 1440 and phone 390) on a throwaway server copy,
and check both the screen and the server's state. The app itself stays dependency-free: Playwright is a test-only npm package here.

```bash
cd tests/e2e && npm ci && npx playwright install chromium webkit   # once
python3 tests/run.py e2e                                           # every journey, Chromium, fixture board
python3 tests/run.py e2e -k card --engines chromium,webkit         # one journey, both engines
```

`run.py e2e` gives every journey its own fresh server copy on port 8796 (never 8765) and writes evidence to
`tests/e2e/out/<engine>/<journey>/` (log.txt, results.json, one png per step). Exit code 1 if any check failed or a page threw.

## Pieces

| File | What it does |
|---|---|
| `scratch.sh up/down/wipe/path` | Copies the checkout to `/tmp/rt-verify-<port>` (no .git, logs, uploads, work, backups, node_modules) and starts `server.py` there with `NO_LOOPS=1`. `VERIFY_DATA=fixtures` loads the fixture board; `live` keeps a copy of your own state; `auto` (default) = live if the checkout has a state.json. |
| `doctor.sh` | Read-only safety check of a running scratch server (port, pid, cwd, no push devices, loops off). |
| `drive.js run <journey> --out <dir>` | Runs one journey per engine x view, each view in its own browser. Also `shot`, `sheet` (labelled side-by-side image) and `smoke` (navall on both engines). |
| `fixtures/build.py` | Builds `fixtures/state.json` + `config.json` from tools/demo.py's sample jobs with the real stateutil on a fixed clock (same bytes on every machine). `--check` fails if the committed files are stale. |
| `fixtures/load.py <dir>` | Puts the fixtures into a server copy, shifting every timestamp so the newest event is a minute ago. |
| `known-issues.json` | Real page errors tracked elsewhere: logged as "known", they do not fail a run. Remove an entry once fixed. |
| `journeys/*.js` | One module per user-facing feature: `{ views, hash(view), run(c), cleanup(o) }`. |

Playwright comes from `tests/e2e/node_modules`, or from `$PW` (a path to a `playwright` package) if you already have one.

## Fixture board

Stable ids journeys may use: `fx-1` … `fx-7` (demo jobs; review: fx-1, fx-3, fx-5, fx-7 with an open question; doing: fx-2;
done: fx-4; todo: fx-6), the 4 `q-demo-*` sample cards, two schedules, a daily report, DMs from scout and writer.
Change the board in `fixtures/build.py`, run it, commit both files.

## Writing a journey

Copy `journeys/card.js`. The context `c` has `tap(sel)` (tap on phone, click on desk), `go(page)`, `shot(name, sel?)`,
`check(name, cond, detail?)`, `state()` (GET /api/state), `su(...args)` (stateutil in the scratch copy), `until(fn, ms)`,
`sleep(ms)`, `p` (the Playwright page), `SCRATCH` (the copy's folder).

- Make test data with `c.su(...)` or through the UI, with ids unique per run; never write state.json by hand.
- Pages rebuild on every poll (~2.5 s): assert again after two polls when a check could be undone by a re-render.
- Use stable selectors (`data-*`, roles), not coordinates. Phone pages ignore `#page=`; use `c.go(page)` or the tab bar.
- A journey that needs your own data, a private role or one card's history belongs in `local/tests/journeys/` (your layer, never shipped).
