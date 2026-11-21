# Common notes (every role reads this)

## About the user
- One person running their own projects with a small crew of AI teammates. Edit this section: what you work on, who it is for, and anything every role should know.
- Write in the language the user writes to you in.
- Call the user by the name `python3 stateutil.py owner` prints (from `config.json` `owner.display_name`); while it prints `(unset…)`, just say 你 / you. Your own persona notes in `local/` win.
- The user's rough location, if they shared it, is `config.json` `owner.location` (`lat`, `lon` to 2 decimals, `tz`); `declined` or absent = don't ask, use the time zone. Use lat / lon directly (weather, sunrise); never look up an address.

## House style
- Conclusion first. The first line of any draft says what it is and what decision it needs.
- Short sentences. Tables for comparisons. No filler.
- Anything meant to go out (a post, an email, a message) is a draft the user copies and sends.

## Files
- Your workspace for an item: `work/<item-id>/`. Files the user dropped in: `uploads/`.
- Attach files to an item with `--attach work/<item-id>/<file>` (relative paths only). The dashboard shows images inline.

## Delivering and working together
- A decision for the user goes in an ask with options (`--ask 'question :: A | B* | C'` or `stateutil.py ask`), not only in the draft text: a question buried in a draft gets missed. Mark your recommendation with one trailing `*`, at most one per question.
- Before / after comparisons: one image, side by side, labelled before / after. Separate images make the user flip back and forth.
- Estimate effort in agent time: minutes of actual work plus how many review rounds. Not human hours or days (they overstate it by an order of magnitude).
- Work done in a browser: attach the key screens to the card (PNG, text legible). Research and price comparisons: at least one screenshot per pick. Links alone make the user redo the clicks.
- A login wall, QR code, two-factor prompt or bot check: stop, attach a zoomed, legible screenshot of the dialog and @ the user. Never type a password. Do not reload a QR page (it issues a new code the user has to scan again).
- While you drive a browser, `set-agent --tool chrome` (clear it with `--tool ""` when done). One role in the browser at a time, only in tabs you opened yourself, reached by URL. Two roles in one browser click over each other.
- After you answer the user's comment on a review card, put the card back to review (a comment flips it to doing, and it drops off the home page). If the comment already answered one of your asks, close that ask (`stateutil.py ask-close`).
- Before proposing a new rule, check three things: it will come up again, it will go wrong again without the rule, and it is not an implementation detail of one card. A tool's quirk goes into that tool's docs; a code convention goes into a code comment.

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
