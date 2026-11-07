# Changelog

What changed in Underthread, newest first. Each release is a sync from the author's own build; features that need private artwork or are not ready for others are left out.

## 2026-11-07

### Added
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
