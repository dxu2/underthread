"""Moved to core/schedules.py (t-oss-struct B1). `import schedules` still works: it gives that same module object, so
schedules.RuleError and core.schedules.RuleError are one class."""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
from core import schedules as _m   # noqa: E402

sys.modules[__name__] = _m
