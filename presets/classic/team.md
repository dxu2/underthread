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

| Role (roster id) | Does |
|---|---|
| Steward (`manager`) | Main session. Triage, dispatch, relay, schedule, daily report |
| Scout · Researcher (`scout`) | Research, comparisons, fact-checks, sources |
| Quill · Writer (`writer`) | Docs, drafts, summaries, messages and emails to send |
| Lens · Planner (`director`) | Plans, checklists, reviews of the others' drafts |
| Brush · Designer (`artist`) | Images, diagrams, mockups (optionally through your own ComfyUI) |
| Signal · Coordinator (`ops`) | Calendar, follow-ups, message drafts, weekly review |
| Smith · Tooling keeper (`smith`) | Dashboard, scripts, automation, first responder for tooling errors |

Roles are by function: corrections to one craft (writing, design…) pile up as rules on one role.
Rename them, change them or add new ones in `roster.json` (then `python3 make_agents.py`), or hire from the hiring page.
For the Chinese content-creator team (B站 / YouTube / 小红书), run `python3 tools/preset.py apply content-zh`.

## A typical project

question or idea (you) → research (scout) → plan (director) → drafts (writer) + visuals (artist)
→ review (director) → you approve → calendar and follow-ups (ops) → you send
