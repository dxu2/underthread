## What changed

## Why
<!-- Link the issue if there is one: Fixes #123 -->

## How I tested it
- [ ] `python3 tests/smoke.py` and `python3 tests/scan.py` pass
- [ ] Ran a scratch copy: `PORT=8799 NO_LOOPS=1 python3 server.py`
- [ ] UI change: checked desktop and phone width (about 390px), light and dark
- [ ] UI change: checked both English and Chinese
- [ ] Prompt change (`manager.md`, `policy.md`, `roles/`, `make_agents.py`): ran a steward on a copy for a few cards

## Screenshots
<!-- For UI changes. Before / after side by side if you can. -->

## Checklist
- [ ] Python standard library only; no new dependency for the core
- [ ] Changed `web/` files have their `?v=N` bumped in `web/index.html`
- [ ] Added a line under **Unreleased** in `CHANGELOG.md` if users will notice
- [ ] No personal data: no `state.json`, `config.json`, `roster.json`, `work/`, `uploads/`, logs, keys or tokens
