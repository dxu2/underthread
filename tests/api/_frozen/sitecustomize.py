"""Fixed clock + seeded ids for the golden API tests (tests/api/test_golden.py). Python imports this file at start-up when
this folder is on PYTHONPATH; it does nothing unless RT_FROZEN_NOW is set, so it is safe anywhere.

    RT_FROZEN_NOW=2026-01-20T10:00:00+00:00   datetime.now() / today() / date.today() always return this moment
    RT_FROZEN_SEQ=<file>                      uuid4() comes from a generator seeded per process: <file> counts processes
                                              (under a lock), so the server and every stateutil call it or the test starts
                                              get their own fixed sequence, in start order

time.time() / monotonic() stay real: timeouts, long polls and caches keep working; nothing derived from them is snapshotted.
"""
import os

_NOW = os.environ.get("RT_FROZEN_NOW")
if _NOW:
    import datetime as _dtm
    import random as _random
    import uuid as _uuid

    _T = _dtm.datetime.fromisoformat(_NOW)

    class _FrozenDT(_dtm.datetime):
        @classmethod
        def now(cls, tz=None):
            t = cls.fromisoformat(_NOW)
            return t.astimezone(tz) if tz else t.astimezone().replace(tzinfo=None)

        @classmethod
        def today(cls):
            return cls.now()

        @classmethod
        def utcnow(cls):
            return cls.now(_dtm.timezone.utc).replace(tzinfo=None)

    class _FrozenDate(_dtm.date):
        @classmethod
        def today(cls):
            return _T.astimezone().date()

    _dtm.datetime, _dtm.date = _FrozenDT, _FrozenDate

    _n = 0
    _seq = os.environ.get("RT_FROZEN_SEQ")
    if _seq:
        import fcntl
        with open(_seq, "a+") as _f:
            fcntl.flock(_f, fcntl.LOCK_EX)
            _f.seek(0)
            _n = len(_f.read())
            _f.write(".")
    _rnd = _random.Random(20260120 * 1000 + _n)
    _uuid.uuid4 = lambda: _uuid.UUID(int=_rnd.getrandbits(128), version=4)
