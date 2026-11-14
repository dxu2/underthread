#!/usr/bin/env python3
"""One entry point for every test. Stdlib only; the browser tests also need Node 18+ and npm.

    python3 tests/run.py quick      leak scan, fixture check, unit tests                 (seconds)
    python3 tests/run.py unit       tests/unit (stdlib unittest)
    python3 tests/run.py api        tests/api: HTTP contract on a fixture server        (seconds)
    python3 tests/run.py e2e        tests/e2e/journeys in a real browser on a fixture server
    python3 tests/run.py upgrade    tests/upgrade (skipped until tools/update.py exists)
    python3 tests/run.py all        scan + smoke + unit + api + e2e + upgrade

Options:
    -k NAME             only journeys / test modules whose file name contains NAME
    --engines LIST      e2e browsers, default chromium (CI also runs webkit)
    --views LIST        e2e views, default each journey's own (desk,phone)
    --port N            e2e server port (default 8796; never 8765)
    --no-install        e2e: do not run npm ci / playwright install when Playwright is missing (fail instead)

e2e details: every journey gets a fresh server copy (tests/e2e/scratch.sh with VERIFY_DATA=fixtures), so journeys do not
see each other's data. Evidence lands in tests/e2e/out/<engine>/<journey>/ (log.txt, results.json, screenshots).
Playwright comes from tests/e2e/node_modules (npm ci) or from $PW. Exit code 1 if anything failed.
"""
import glob
import os
import shutil
import subprocess
import sys
import time

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TESTS)
E2E = os.path.join(TESTS, "e2e")
PY = sys.executable


def opt(name, default=None):
    a = sys.argv
    return a[a.index(name) + 1] if name in a[:-1] else default


ONLY = opt("-k", "")
ENGINES = opt("--engines", os.environ.get("E2E_ENGINES", "chromium"))
VIEWS = opt("--views")
PORT = opt("--port", os.environ.get("E2E_PORT", "8796"))


def sh(cmd, **kw):
    print("$", " ".join(cmd), flush=True)
    return subprocess.run(cmd, **kw).returncode


def unittest_dir(name):
    d = os.path.join(TESTS, name)
    pattern = f"test_*{ONLY}*.py" if ONLY else "test_*.py"
    return sh([PY, "-m", "unittest", "discover", "-s", d, "-t", ROOT, "-p", pattern], cwd=ROOT)


def scan():
    return sh([PY, os.path.join(TESTS, "scan.py")], cwd=ROOT)


def smoke():
    return sh([PY, os.path.join(TESTS, "smoke.py")], cwd=ROOT)


def fixtures_check():
    return sh([PY, os.path.join(E2E, "fixtures", "build.py"), "--check"], cwd=ROOT)


def playwright_ready():
    if os.environ.get("PW"):
        return True
    if os.path.isdir(os.path.join(E2E, "node_modules", "playwright")):
        return True
    if "--no-install" in sys.argv or not shutil.which("npm"):
        print("Playwright is missing: cd tests/e2e && npm ci && npx playwright install chromium webkit (or set PW)")
        return False
    if sh(["npm", "ci", "--no-audit", "--no-fund"], cwd=E2E):
        return False
    return sh(["npx", "playwright", "install", *ENGINES.split(",")], cwd=E2E) == 0


def e2e():
    if PORT == "8765":
        print("refuse: 8765 is the live dashboard")
        return 2
    if not playwright_ready():
        return 1
    journeys = sorted(j for j in glob.glob(os.path.join(E2E, "journeys", "*.js")) if ONLY in os.path.basename(j))
    scratch = f"/tmp/rt-e2e-{PORT}"
    env = dict(os.environ, VERIFY_PORT=PORT, VERIFY_SCRATCH=scratch, VERIFY_DATA="fixtures")
    rows, bad = [], 0
    for engine in ENGINES.split(","):
        for j in journeys:
            name = os.path.basename(j)[:-3]
            out = os.path.join(E2E, "out", engine, name)
            shutil.rmtree(out, ignore_errors=True)
            t0 = time.time()
            rc = subprocess.run(["bash", os.path.join(E2E, "scratch.sh"), "up"], env=env, cwd=ROOT).returncode
            if rc == 0:
                cmd = ["node", os.path.join(E2E, "drive.js"), "run", j, "--out", out, "--engines", engine]
                if VIEWS:
                    cmd += ["--views", VIEWS]
                rc = subprocess.run(cmd, env=env, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).returncode
            subprocess.run(["bash", os.path.join(E2E, "scratch.sh"), "down"], env=env, cwd=ROOT, stdout=subprocess.DEVNULL)
            last = ""
            try:
                with open(os.path.join(out, "log.txt"), encoding="utf-8") as f:
                    last = f.read().strip().splitlines()[-1].split(" ", 1)[1]
            except (OSError, IndexError):
                pass
            rows.append((engine, name, "ok" if rc == 0 else "FAIL", f"{time.time() - t0:.0f}s", last))
            print(f"  {engine:8} {name:14} {'ok' if rc == 0 else 'FAIL':4} {time.time() - t0:5.0f}s  {last}", flush=True)
            bad += rc != 0
    subprocess.run(["bash", os.path.join(E2E, "scratch.sh"), "wipe"], env=env, cwd=ROOT, stdout=subprocess.DEVNULL)
    print(f"e2e: {len(rows) - bad}/{len(rows)} journeys passed; evidence in tests/e2e/out/")
    return 1 if bad else 0


SUITES = {
    "quick": [("scan", scan), ("fixtures", fixtures_check), ("unit", lambda: unittest_dir("unit"))],
    "unit": [("unit", lambda: unittest_dir("unit"))],
    "api": [("api", lambda: unittest_dir("api"))],
    "e2e": [("e2e", e2e)],
    "upgrade": [("upgrade", lambda: unittest_dir("upgrade"))],
    "all": [("scan", scan), ("smoke", smoke), ("fixtures", fixtures_check), ("unit", lambda: unittest_dir("unit")),
            ("api", lambda: unittest_dir("api")), ("e2e", e2e), ("upgrade", lambda: unittest_dir("upgrade"))],
}


def main():
    which = next((a for a in sys.argv[1:] if a in SUITES), None)
    if not which:
        print(__doc__)
        return 2
    res = []
    for name, fn in SUITES[which]:
        print(f"\n== {name} ==", flush=True)
        t0 = time.time()
        rc = fn()
        res.append((name, rc, time.time() - t0))
    print("\n== summary ==")
    for name, rc, sec in res:
        print(f"  {name:9} {'ok' if rc == 0 else 'FAIL'}  {sec:.0f}s")
    return 1 if any(rc for _, rc, _ in res) else 0


if __name__ == "__main__":
    sys.exit(main())
