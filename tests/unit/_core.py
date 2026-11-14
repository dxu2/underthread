"""Import core modules from a throwaway copy, so a test never reads or writes the checkout's state.json or loads local/ extensions."""
import importlib
import os
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORE = ("stateutil.py", "schedules.py")
MODS = ("stateutil", "schedules", "core", "core.migrate", "core.config")   # core/ is copied too: the copy must import its own


class Core:
    """with Core() as c: c.stateutil, c.schedules, c.dir (the copy; state.json there is yours to write)."""

    def __enter__(self):
        self.dir = tempfile.mkdtemp(prefix="rt-unit-")
        for f in CORE:
            shutil.copy(os.path.join(ROOT, f), self.dir)
        shutil.copytree(os.path.join(ROOT, "core"), os.path.join(self.dir, "core"), ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy(os.path.join(ROOT, "roster.example.json"), os.path.join(self.dir, "roster.json"))
        self._saved = {m: sys.modules.pop(m) for m in MODS if m in sys.modules}
        sys.path.insert(0, self.dir)
        self.stateutil = importlib.import_module("stateutil")
        self.schedules = importlib.import_module("schedules")
        return self

    def __exit__(self, *exc):
        sys.path.remove(self.dir)
        for m in MODS:
            sys.modules.pop(m, None)
        sys.modules.update(self._saved)
        shutil.rmtree(self.dir, ignore_errors=True)
