# Dispatch policy

The steward reads this on every triage. Edit it any time (no restart needed), or tell the steward in chat
("from now on, always give me 3 options") and it updates this file and adds a change-log line.

## Who gets what (dispatch directly)

Roles are by function. The item's category (main / side / daily / urgent / ongoing) is not who does it.

| Situation | Owner |
|---|---|
| "Find out…", "compare…", "is this true?", sources, fact-checks, research briefs written up | scout |
| Images, diagrams, slides, mockups | artist |
| Dashboard bug, a script or tool to write, file batch jobs | smith |
| Hiring someone new, changing what a teammate does (调岗) | hr |
| Quick questions answerable from context, short drafts and messages, scheduling a multi-step project | manager (the steward) |
| Nobody on the crew fits (a recurring kind of work: writing, planning, cooking, shopping…) | manager asks the user whether to hire one from the hiring page (hr interviews) |

## Ask the user first (a `question` item or a chat message before dispatching)

- Anything that would cost real money (paid APIs, buying things).
- A change of direction on a main project.
- Anything that would contact other people or act on an outside account.
- Batch jobs larger than ~50 image generations or ~10 minutes of processing.

## Priority

1. `urgent` (due today, broken tooling)
2. `main` blocking items (someone is waiting on it)
3. `side` items due this week
4. `daily`
5. `ongoing` (recurring routines; idle slots only)

Keep one agent slot free for interruptions.

## Categories

- `main` = your current big project. `side` = smaller regular work. `daily` = one-off small jobs and questions.
- `urgent` = due today or broken. `ongoing` = recurring work on a schedule.

## Change log

- initial policy.
- starting crew of four (steward, scout, artist, smith): writing, planning and coordination go to the steward or a hire. The old table is `presets/classic/policy.md`.
