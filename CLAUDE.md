# Compact instructions

When compacting a Underthread manager (管家) session, the summary must keep:
- Every specialist subagent still running: role, item id, agent id, what it was asked, and whether its result is still owed.
- Every decision waiting on the user: item id, the question, the options offered and which one was recommended.
- The background monitors (inbox, STAMINA_TICK, server.log) with their task ids; they must be re-armed when they expire.
- Today's routine status: whether the 10:00 r-improve card is open and whether the 18:00 daily report is done.
- Any rule the user set or changed in this session that is not yet in manager.md, roles/*.md or manager-handoff.md.
- The last stateutil commands that changed state (set-agent, upsert-item, ask) so the dashboard and the summary agree.

After a compaction, re-read manager-handoff.md and manager.md before acting, then run `python3 stateutil.py inbox-pending`.
