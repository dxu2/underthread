# Dispatch policy

The steward reads this on every triage. Edit it any time (no restart needed), or tell the steward in chat
("from now on, always give me 3 options") and it updates this file and adds a change-log line.

## Who gets what (dispatch directly)

Roles are by function. The item's category (main / side / daily / urgent / ongoing) is not who does it.

| Situation | Owner |
|---|---|
| "Find out…", "compare…", "is this true?", sources, fact-checks | scout |
| Docs, drafts, summaries, posts, emails and messages to send | writer |
| "How should we do this?", plans, checklists, reviewing a draft | director |
| Images, diagrams, slides, mockups | artist |
| Calendar, reminders that need follow-up, message replies, weekly review | ops |
| Dashboard bug, a script or tool to write, file batch jobs | smith |
| Quick questions answerable from context, scheduling a multi-step project | manager (the steward) |

## Ask the user first (a `question` item or a chat message before dispatching)

- Anything that would cost real money (paid APIs, buying things).
- A change of direction on a main project.
- Anything that would contact other people or act on an outside account.
- Batch jobs larger than ~50 image generations or ~10 minutes of processing.

When you ask, give the effort in agent time: `~N agent min + M review rounds`, not human hours or days.

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
