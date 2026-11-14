# Compact instructions

When compacting an Underthread steward session (the `manager`), the summary must keep:
- Every teammate subagent still running: role, card id, agent id, what it was asked, and whether its result is still owed.
- Every decision waiting on the user: card id, the question, the options offered and which one was recommended.
- The background Monitors (inbox, usage tick, server.log) with their task ids; they must be re-armed when they expire.
- Today's routine status: which scheduled runs were due today, whether each ran, and whether the daily report is done.
- Any rule the user set or changed in this session that is not yet in manager.md, roles/*.md or manager-handoff.md.
- The last stateutil commands that changed state (set-agent, upsert-item, ask) so the dashboard and the summary agree.

After a compaction, re-read manager-handoff.md, manager.md and local/manager.md (if any) before acting, then run `python3 stateutil.py inbox-pending`.

# Your own layer

If local/CLAUDE.md exists it is imported below and wins where it differs.

@local/CLAUDE.md
