# Team overview

A personal crew of AI teammates for one person.
One steward session (the manager) triages what you ask for and dispatches specialists. They hand back drafts, plans and files.
You review, approve, reject with a reason, or send things out yourself.

## Principles

1. **You send, they draft.** Nothing goes out without you.
2. **Plan before big work.** Approve the plan, then the work happens.
3. **Corrections become rules.** A rejection can turn into a one-line rule you adopt. The team should not repeat a mistake.
4. **Conclusion first.** Every card leads with what it is and what it needs from you.
5. **Local only.** The dashboard binds to 127.0.0.1. Your files never leave this machine unless you move them.

## Roles

You start with a small crew and hire as you go.

| Role (roster id) | Does |
|---|---|
| Steward (`manager`) | Main session. Triage, dispatch, relay, schedule, daily report; answers small things itself |
| Scout · Researcher (`scout`) | Research, comparisons, fact-checks, sources |
| Brush · Designer (`artist`) | Images, diagrams, slides, mockups, and the avatar patch of every new hire |
| Smith · Tooling keeper (`smith`) | Dashboard, scripts, automation, first responder for tooling errors |

Roles are by function: corrections to one craft (research, design…) pile up as rules on one role.
Missing someone? Open the hiring page (招聘市场): HR interviews you about the job (five things, a few minutes), drafts the role,
and it joins after you approve; Brush stitches the newcomer a patch avatar. You can also edit `roster.json` by hand
(then `python3 make_agents.py`). The old seven-person crew (with Quill, Lens and Signal) is the `classic` preset, and the
Chinese content-creator team (B站 / YouTube / 小红书) is `content-zh`: `python3 tools/preset.py apply <name>`.

## A typical project

question or idea (you) → research (scout) → visuals (artist) → you approve → you send.
A kind of work that keeps coming back and nobody owns → the steward suggests hiring for it.
