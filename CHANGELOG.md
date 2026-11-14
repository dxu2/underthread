# Changelog

What changed in Underthread, newest first. Underthread is developed in the open from the author's daily use; a few features that depend on private artwork or aren't ready for others yet are left out.

## Unreleased

### Added
- **Seamless data upgrades**: `state.json` carries a schema number (`meta.schema`) and ordered migrations in `core/migrations/` run on the first read after an update, with the old file saved to `local/backups/migrate/` first. Config defaults live in `core/config.py` and are merged at read time, so new settings need no edit to your `config.json`; `stateutil.py schema` and `stateutil.py config show` show where things stand. Browser settings get the same treatment through `web/lsmigrate.js`. Upgrade notes: migrations 0001 (stamp) and 0002 (routines log backfill, already done on most installs); manual steps: none.
- **Demo mode**: `python3 server.py --demo` (or `python3 tools/demo.py`) shows the dashboard with a crew at work, without Claude Code. It runs in a separate `.demo/` folder that is rebuilt on every start and never touches your own cards. The steward's chat lines follow `--lang zh|en` or `$LANG`, and what you click gets a canned "(Demo) …" reply. `PORT` picks the port.
- **Presets**: `python3 tools/preset.py list|apply <name> [--dry]` switches the whole team. The Chinese content-creator team (B站 / YouTube / 小红书) now lives in `presets/content-zh/`. Every replaced file is backed up as `<file>.bak-preset-<time>`.
- **Tests and CI**: `tests/smoke.py` (about 15 s, runs in a temporary copy), `tests/scan.py` (leak scan, optional private word list in the git-ignored `tests/scan-words.txt`), and a GitHub Actions workflow on Ubuntu and macOS with Python 3.10 and 3.12.
- **Request guard**: the server answers only known host names (against DNS rebinding; extra names go in `allowed_hosts` in `config.json`), and a POST from a browser must be same-origin and carry the `X-Underthread` header (against cross-site requests).
- **Desktop notices**: a small card slides in at the top right for a new reply, a delivery waiting for review, a rule proposal, a reminder or a new question; click it to open the card.
- **Docs**: a Chinese README (`README.zh-CN.md`), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates, and new pages in `docs/`: architecture, custom crew, phone and push, troubleshooting and FAQ.

### Changed
- **Default crew in neutral English**: Steward, Scout (Researcher), Quill (Writer), Lens (Planner), Brush (Designer), Signal (Coordinator), Smith (Tooling keeper), for any kind of personal work. Ids and avatars are unchanged. `roles/*.md`, `team.md`, `policy.md` and `manager.md` are rewritten in English for a new user. Roles with `"team": "general"` get neutral hard rules in their agent file.
- **One settings file**: `.claude/settings.json` ships with the repository (status line plus the steward's permissions) and `claude-settings.example.json` is gone, so no setup step copies over it. Personal additions go in the git-ignored `.claude/settings.local.json`.
- **Fresh install**: the first visit follows the browser language; the sample cards start "a few minutes ago" instead of weeks ago; the usage widget says "No tokens used yet today" when Claude Code has not run here yet; the avatar index no longer 404s before `tools/avatar_sizes.py` has run; a taken port prints one clear line instead of a traceback; `tools/new_role.py` works before the server has ever started.
- **ComfyUI is optional and neutral**: the status labels say "ComfyUI", and the ComfyUI line and its probe only appear when `config.json` has a `comfy` block. `config.example.json` has no default routine, platforms or ComfyUI settings.
- **Run-forever tooling on Linux**: `tools/keepalive.sh` runs under bash on macOS and Linux and pauses 15 s when the server dies right after starting. `tools/install_service.sh` is macOS only; on other systems it says so and points to `keepalive.sh`; `tools/ensure_server.py` falls back to `keepalive.sh` without launchd.
- **Home is widgets only**: the older app-style home and the top-bar usage orb are removed. Widget layout is stored on the server.
- Upload responses no longer include the absolute file path.
- **README**: the first screen now says what Underthread is, who it's for and that it uses your Claude plan's usage; the quickstart lists hard requirements and what you should see after each step; one set of crew names (Steward, Scout, Quill, Lens, Brush, Signal, Smith), with steward = `manager` in code.
- **SETUP-GUIDE**: brought up to date (no more pixel office; adds the Hiring market, Schedules, push, archive and usage brakes).

## 2026-11-09

### Added
- **Hiring market** (`web/market.js`): 24 job templates in `templates/roles/`, each with three personalities, its own patch avatar and a working animation. Hire straight from a card; `tools/new_role.py plan|apply|retire|rehire|update` does the same from the command line.
- **Role registry**: per-role tint, pipeline stage and art come from `roster.json` (`tint`, `pipe`) instead of id lists in the web code. Roster edits show up without a restart.
- **Transfer and retire** (`web/transfer.js`): change a teammate's job or retire them from Settings → Roster, with a before/after view and a 10-minute undo. The manager, HR and the tooling keeper cannot be retired.
- **HR interview** (optional): with a role whose id is `hr`, the market's Interview button opens a DM where HR asks five questions, one per turn, then drafts the new role for you to approve. `templates/hr/interview.json` holds the script.
- **One-sentence schedules** (`schedules.py`, `stateutil.py schedule add|list|...`): tell the steward in one sentence; the Schedules page (定时 in the Chinese interface) lists every schedule with in-place switches, run history and undo.
- **Team page and team widget** (`web/team.js`, `web/team.css`): who works on what and who handed what to whom; home widget in S, M and L.
- **Mailbox and usage meter in knit** (Underthread palette): a yarn-ball unread count and a knitted swatch for what is left of your usage.

### Changed
- Chat (phone and desktop): the avatar sits on a row above the bubble, and bubbles are wider.
- Phone home: the team rows get back their working timer, queue count and latest delivery.
- Category display names in the Chinese interface: 日常委托 is now 杂活 and 常驻活动 is now 每日 (Errands and Dailies in English).
- Motion: list rows rise in, only the first rows on screen animate, and tab switches are shorter.
- Numbered lists in cards keep their numbers when a blank line or a link splits them.
- Polish: timeline labels, card ids in DMs open the card on the phone, no flicker after sending a message, and smaller fixes.

## 2026-11-07

### Added
- **Underthread look, now the default**: a solid coffee and cream palette (`web/theme-ut.css`) with embroidered-patch avatars for every role (`avatars/ut/`), stitched card edges and spool-drawn empty states. Settings → Appearance → Palette switches back to Ink.
- **Textures**: Stitch and Sweater (knit), Leather and Saddle. These are procedurally generated images that sit on top of the palette.
- **Logo**: the Underthread wordmark in the header, plus new app icons and favicons.
- **Opening animation**: plays once per session; you can skip it or turn it off in Settings.
- **Power-saving switch** in Settings. Turn it off and looping animations keep playing when idle.
- **Browser-in-use badge**: the rail, home and widgets show which agent is driving a browser or the desktop, and for how long (`stateutil.py set-agent --tool chrome|computer|""`).
- **Quoted quick replies**: tapping a quick option in chat quotes the question it answers.
- **Archive**: done cards that have not moved for a while move to `archive.json`; search still finds them (`stateutil.py archive sweep|list|unarchive-all`).
- **Studio tab**: Pipeline, Board, Channels and Assets grouped under one tab in the left rail.
- **Save images on the phone** at full size from any card.
- **Waiting on you** also lists cards with replies you have not read (new-reply dot).
- **Phone search** also finds finished cards' drafts.
- **Self-hosted fonts**: Nunito and Cinzel Latin subsets in `web/fonts/` (SIL OFL 1.1, licence texts included). No Google Fonts request.
- **Small avatars**: `tools/avatar_sizes.py` writes small WebP copies to `avatars/_s/`.

### Changed
- **Performance**: content shows on first open from a snapshot, static files are cached for a year behind a `?v=` version, polls are slimmer, long polling replaces tight loops, HTTP/1.1 keep-alive, and the client renders less.
- **Phone tab bar** floats above the bottom edge: icons only, long press for the name, unread as a red dot.
- **Phone card detail**: the question sheet folds to one line, the accept button no longer overflows, the shipped-today avatar is no longer clipped; roomier team panel on the phone home.
- **Desktop**: larger rail menu font, trimmed top bar, dialogs and composer; the mailbox entry is back in the top bar; the composer starts one line tall.
- **Card detail**: your own messages are bubbles again; new messages no longer make the view jump.
- **Mission-complete scene** prefers a transparent cut-out (`web/art/cut/<id>.webp`), uses a theme colour for the halo, and plays without a portrait when there is no art.
- Standing cards in the routine category show as routines (pause switch, no finish button), whatever their id.
- Links in card text are clickable, also right after Chinese punctuation.
- One number per word: the usage card shows what is left, and "shipped in the last 7 days" means the same everywhere.
- Server log: dropped connections are counted and summarised once an hour instead of logged one by one.

### Removed
- The pixel office (`web/office.js`). Roles without an avatar file get a colour disc with an initial.
- The old title-card splash.
- The floating Unread button in the mailbox (the Unread filter stays).

### Fixed
- The question panel's fold arrow points the right way.
- No square focus ring on the phone composer.

## 2026-11-04

- **Dense desktop home** is the new default: today's timeline, waiting on you, today's goals, working now (with an ETA), small counters; tightened so all five sections fit a 900px-tall window.
- **Lean left rail**: plain text rows instead of a glass panel; each agent row shows a status word and one duty line; today's schedule hides on the dense home.
- **Settings page** with tabs (General, Roles, Docs, Logs, System) replaces the separate pages.
- **Usage by role**: tokens per role today (`/api/usage`, `usage_roll.py`) on the home, the phone card and the system panel.
- **Routines page** as a schedule with a 7-day run row; the server now keeps a dated run history (`meta.routines_log`).
- **Power saving**: idle animations pause after 20 s without input; lighter working rings; slower polling in a hidden tab.
- Glass card list (owner avatar first), draft table of contents with a sliding indicator, a motion pass so every button and tab has hover / press / switch feedback, click-to-zoom in the image viewer.
- Fixes: one unread count for desktop and phone, no stale "in review" line in the activity feed, a one-line phone home when nothing waits, readable phone tab pill, wider folded chat rail, no flowing edge rail on busy cards.
