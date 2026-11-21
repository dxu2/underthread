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

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
