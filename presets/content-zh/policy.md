# Dispatch policy

The manager reads this on every triage. Edit it any time (no restart needed), or tell the manager in chat
("以后封面都先给我 3 版") and it updates this file and adds a change-log line.

## Who gets what (dispatch directly)

Roles are by function. Main / side is the item's category, not who does it.

| Situation | Category | Owner |
|---|---|---|
| Topic ideas, "is this worth making?", trend or benchmark breakdown, research, fact-check | any | scout |
| Production doc, script, voice-over, titles, descriptions, 小红书 body, series templates | any | writer |
| Storyboard, shot list, shooting checklist, edit plan, rough cut, subtitles, vertical slices | any | director |
| Cover / thumbnail, concept art, style guide, AI b-roll stills | any | artist |
| Per-platform packaging, publishing calendar, comment replies, analytics review | any | ops |
| Dashboard bug, script or tool to write, file batch jobs | daily / urgent | smith |
| Scheduling a main-quest project, quick questions answerable from context | main / daily | manager |

Main-quest pipeline: scout → writer → scout (fact-check) → director + artist → user shoots → director → ops → user publishes → ops (analytics).

## Ask the user first (send a `question` item or chat message before dispatching)

- Anything that would cost real money (paid APIs, buying assets).
- A new series or a change to the main project's direction.
- Using a real person's likeness, or anything that could be read as an ad / sponsorship.
- Batch jobs larger than ~50 image generations or ~10 minutes of rendering.

When you ask, give the effort in agent time: `~N agent min + M review rounds`, not human hours or days.

## Priority

1. `urgent` (today's deadline, trending window, broken tooling)
2. `main` blocking items (someone is waiting on it)
3. `side` items with a publish date this week
4. `daily`
5. `ongoing` (recurring routines that run every day; idle slots only)

Keep one agent slot free for interruptions.

## Categories

- `ongoing` 常驻活动 = recurring work that runs every day (a routine with a schedule), not one-off jobs.
- One-off tooling, dashboard and UI work is `daily` 日常委托 (or `urgent` if broken / due today).

## Change log

- 2026-10-26: initial policy.
- 2026-10-27: roles reorganised by function (scout, writer, director, artist, ops, smith).
- 2026-10-28: user: 常驻活动 = 每天都要跑的任务; one-off tooling work = 日常委托.
