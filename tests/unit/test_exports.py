"""stateutil.py is a re-export of core/ (t-oss-struct B1). Scripts outside core import it as `S` and use its names, so none
of them may disappear. Runs on a throwaway copy (see _core.py)."""
import unittest

from tests.unit._core import Core

# Names used from outside stateutil.py, with who uses them (grep of `S.x` / `stateutil.x` on 2026-11-14: server.py, tools/,
# tests/, and the private layer of the maintainer's install: local/ext/voice, local/ext/live, voicecall.py, voicemeet.py,
# tools/live_hook.py). A name here is a promise to extensions; remove one only in a major version.
EXTERNAL = {
    "ARCHIVE": "server", "CLI_EXT": "local ext (live), smoke", "EXT": "server", "INBOX": "server", "LOCAL": "server, new_role",
    "ROOT": "server, local ext (live), voicecall", "SET_AGENT_HOOKS": "local ext (live)", "STAGES": "server", "STATE": "server",
    "UPSERT_HOOKS": "local ext (voice)", "_append_rule": "smoke", "_cap": "voicecall, voicemeet",
    "_chat_entry": "server, fixtures, voicecall, voicemeet", "add_log": "server, voicemeet",
    "add_thread": "server, local ext (voice), voicemeet", "answer_ask": "server", "archive_family": "server",
    "archive_find": "server", "archive_load": "server", "claim_transcripts": "server", "decide_lesson": "server",
    "find_item": "server", "find_msg": "server", "inbox_all": "server",
    "inbox_append": "server, transcribe, local ext (voice), voicemeet", "is_audio_path": "server, transcribe",
    "load_ext": "server", "local_path": "server", "main": "fixtures", "memo_followup": "transcribe",
    "mutate": "server, fixtures, live_hook, new_role, statusline, transcribe, voicecall, voicemeet", "new_id": "server, voicemeet",
    "note_hand": "server", "now": "server, statusline, transcribe, voicecall, voicemeet", "open_asks": "server",
    "open_interview": "server", "push_mail": "server", "read": "server, local ext (live), live_hook, new_role, statusline, voicecall, voicemeet",
    "reply_fields": "server", "role_md": "server", "schedule_emit": "server", "schedule_find": "server", "schedule_pause": "server",
    "schedules_due": "server", "schedules_import_routines": "server", "schedules_needs_tick": "server",
    "set_agent": "server, local ext (live), live_hook", "set_media": "transcribe", "upsert_item": "server, voicemeet",
}

# Every top-level name stateutil.py defined before the split (v0.1.0), helpers and imported modules included.
BEFORE = """ARCHIVE ARCHIVE_DAYS ARCHIVE_EVERY AUDIO_EXT CAPS CATEGORIES CLI_EXT EXT HIRE_SLOTS HO_LAST_MAX INBOX INBOX_LOCK KINDS LOCAL
MG PLATFORMS ROLES_DIR ROOT SC SCHED_PURGE_DAYS SET_AGENT_HOOKS STAGES STATE STATE_LOCK UPSERT_HOOKS _ISO _NeedsMigration
_add_ask_parsers _add_schedule_parsers _append_rule _ask_snapshot _autoclose_asks _aware_now _cap _chat_entry _end_arg _fresh_times
_ho_seed _load _need_rule _parent_id _read_file _restore _rule_arg _save _sched_cmd _sched_line _sched_mut _sched_preview _shape
_text_arg _ts _tx_text add_ask add_lesson add_log add_thread answer_ask archive_candidates archive_family archive_find archive_load
archive_sweep archive_write argparse blank_state claim_transcripts cmd_archive cmd_ask cmd_ask_close cmd_config_show cmd_dm
cmd_handoff cmd_handoffs cmd_inbox_ack cmd_inbox_pending cmd_interview cmd_items cmd_lesson cmd_log cmd_notice cmd_reply cmd_report
cmd_say_mgr cmd_schedule_add cmd_schedule_edit cmd_schedule_fire cmd_schedule_list cmd_schedule_pause cmd_schedule_resume
cmd_schedule_rm cmd_schedule_show cmd_schema cmd_set_agent cmd_set_stamina cmd_set_usage cmd_show cmd_sleep cmd_transcript
cmd_upsert contextlib decide_lesson dt ext_dirs fcntl find_item find_msg has_local ho_touch inbox_all inbox_append is_audio_path
item_transcripts json load_ext local_path main memo_followup memo_name mutate new_id norm_attach norm_who note_hand now open_asks
open_interview os parse_ask plain_text push_mail quote_of re read reply_fields role_md schedule_emit schedule_find schedule_new
schedule_pause schedules_due schedules_import_routines schedules_needs_tick set_agent set_media shutil split_rec sys upsert_item
uuid""".split()


class Exports(unittest.TestCase):
    def test_every_external_name_is_exported(self):
        with Core() as c:
            missing = [n for n in EXTERNAL if not hasattr(c.stateutil, n)]
        self.assertEqual(missing, [], "stateutil lost names other scripts use")

    def test_every_old_name_is_still_there(self):
        with Core() as c:
            missing = [n for n in BEFORE if not hasattr(c.stateutil, n)]
        self.assertEqual(missing, [])

    def test_reexports_are_the_core_objects(self):
        """Same objects, not copies: a hook appended through S reaches the code that runs it, and S.mutate is the one lock."""
        with Core() as c:
            import core.ext as E
            import core.paths as P
            import core.schedules as CS
            import core.store as ST
            S = c.stateutil
            self.assertIs(S.SET_AGENT_HOOKS, E.SET_AGENT_HOOKS)
            self.assertIs(S.UPSERT_HOOKS, E.UPSERT_HOOKS)
            self.assertIs(S.CLI_EXT, E.CLI_EXT)
            self.assertIs(S.EXT, E.EXT)
            self.assertIs(S.mutate, ST.mutate)
            self.assertIs(S.CAPS, ST.CAPS)
            self.assertEqual((S.ROOT, S.STATE, S.LOCAL), (P.ROOT, P.STATE, P.LOCAL))
            self.assertIs(c.schedules, CS)
            self.assertIs(S.SC.RuleError, CS.RuleError)

    def test_root_is_the_install_folder(self):
        import os
        with Core() as c:
            self.assertEqual(os.path.realpath(c.stateutil.ROOT), os.path.realpath(c.dir))
            self.assertEqual(os.path.realpath(c.stateutil.STATE), os.path.realpath(os.path.join(c.dir, "state.json")))

    def test_a_set_agent_hook_added_through_stateutil_fires(self):
        with Core() as c:
            S, seen = c.stateutil, []
            S.SET_AGENT_HOOKS.append(lambda st, aid, a, auto, tool: seen.append((aid, a.get("status"), auto, tool)))
            try:
                with S.mutate() as st:
                    S.set_agent(st, "writer", auto=True, status="working", tool="chrome")
            finally:
                S.SET_AGENT_HOOKS.pop()
        self.assertEqual(seen, [("writer", "working", True, "chrome")])


if __name__ == "__main__":
    unittest.main()
