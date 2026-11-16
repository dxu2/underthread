#!/usr/bin/env python3
"""t-hr-newrole (segment B of t-hr-registry): add, retire or re-hire a team role with one command.

    python3 tools/new_role.py plan   [spec.json] [flags]   # dry run: prints what apply would do, writes nothing
    python3 tools/new_role.py apply  [spec.json] [flags]   # create the role
    python3 tools/new_role.py retire <id> [--hard]          # soft retire (enabled:false); --hard archives the files
    python3 tools/new_role.py rehire <id>                   # undo a soft retire
    python3 tools/new_role.py plan|apply --from-item <card> [--json]
                                                            # t-hr-build: an HR interview card. Spec = work/<card>/role.json, template +
                                                            # personality from the card's "hire" field (set by the server, not by HR)
    (--retire <id> works as an alias of `retire <id>`)
    python3 tools/new_role.py update <id> --from-item <card> [--plan] [--json]
                                                            # t-ht-build: 调岗. Reads work/<card>/transfer.json "after" (roster whitelist +
                                                            # roles/<id>.md sections); Confirmed rules / Boundaries / 红线 / 批准 sections are locked
    python3 tools/new_role.py update --undo <card> [--json] # t-ht-build: 撤回调岗 (refused when the files changed since)
    python3 tools/new_role.py rehire <id> --from-archive archive/roles/<id>-<time>/   # t-ht-build: back from a hard retire (manifest.json)

Where the role comes from (later layers win):
    templates/roles/<job>/template.json  (--template <job>, plus --variant <key>)
    spec.json                            (HR's work/<item>/role.json: a roster entry + optional "files" and "role_md")
    spec "rules": a list of the user's own red lines; apply appends them to roles/<id>.md under ## Confirmed rules (t-hr-build)
    flags                                (--id --name --name-en --title --title-en --duty --duty-long --tint --color
                                          --seat x,y|none|auto --pipe a,b --address 称呼 --model --effort)

apply creates:
    roster.json entry (id, name, tint, seat, pipe ... appended at the end; atomic write)
    roles/<id>.md                 (template role.md, spec role_md, or a stub; never overwrites)
    .claude/agents/<agent>.md     (through make_agents.py, the way every role is built)
    avatars/<id>.png + avatars/ut/<id>.png
        default: the bundled templates/roles/_default/avatar.png recoloured to the role's tint (ffmpeg)
        --avatar gen: generate one with tools/image.py (the image backend: codex or ComfyUI; may cost quota)
        --avatar none: no file, the dashboard shows a letter circle
        a template variant's art/<key>/avatar.png or spec files.avatar is used as is when given
    then tools/avatar_sizes.py for the small copies.

Safety:
    - refuses an id that already exists with different fields, a reserved id, or a clash on agent_name / roles/<id>.md
    - idempotent: running apply again with the same input fills in whatever is missing and changes nothing else
    - make_agents.py rewrites every agent file, so apply/retire first checks that no OTHER role's agent file would change
      (someone hand-edited it?) and stops if one would
    - roster.json / manager.md / the agent file are copied first with core/backup.py, tag newrole-<id>-<time>
      (local/backups/bak/<file>.bak-newrole-<tag>; tools/bak.py list shows them)
    - --hard never deletes: files move to archive/roles/<id>-<time>/ with their relative paths
    - never edits state.json (the server syncs roster.json on its own; a no-op stateutil.mutate() only wakes the poll), other roles' roles/*.md, common.md, config.json
    - every apply / retire is logged to logs/new_role.jsonl
"""
import argparse, datetime as dt, filecmp, glob, json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.abspath(os.environ.get("UNDERTHREAD_LOCAL") or os.path.join(ROOT, "local"))   # core / local split (stateutil.LOCAL)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
from core import backup as BK   # noqa: E402  t-oss-struct S1: backups go to local/backups/bak/, not next to the file


def role_md(i):
    """The rule file this tool reads and writes for role i: local/roles/<i>.md when the local layer exists (core rule files stay as
    shipped), else roles/<i>.md. An existing core file with no local copy yet is still read from core (see role_md_read)."""
    return os.path.join(LOCAL, "roles", f"{i}.md") if os.path.isdir(LOCAL) else os.path.join(ROOT, "roles", f"{i}.md")


def role_md_read(i):
    lp = os.path.join(LOCAL, "roles", f"{i}.md")
    return lp if os.path.exists(lp) else os.path.join(ROOT, "roles", f"{i}.md")
ROSTER = os.path.join(ROOT, "roster.json")
TPL = os.path.join(ROOT, "templates", "roles")
BASE_AV = os.path.join(TPL, "_default", "avatar.png")
IMAGE = os.path.join(ROOT, "tools", "image.py")
LOG = os.path.join(ROOT, "logs", "new_role.jsonl")
RESERVED = {"me", "manager", "default", "user", "all", "_default", "_example"}
PIPES = ("topic", "script", "board", "edit", "pack")   # web/js/app.js PIPE columns a role can own ("shoot" is the user's)
ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,15}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ART = {  # role art the dashboard scans (server.py ART_DIRS + avatars); moved to the archive by --hard
    "avatars/{id}.*", "avatars/ut/{id}.*", "avatars/ut/{id}-work-*", "avatars/_s/{id}-*.webp", "avatars/ut/_s/{id}-*.webp",
    "web/art/{id}.jpg", "web/art/panels/{id}.webp", "web/art/cut/{id}.webp",
}


JSON_OUT = False   # t-hr-build: --json prints one JSON object on stdout (the HR draft's evidence, the server's 批准入职)
CORE = {"manager", "hr", "smith"}   # t-ht-build: never retire (main session / who rehires / who fixes the dashboard)
XFER_FIELDS = ("name", "name_en", "title", "title_en", "duty", "duty_en", "duty_long", "specialties", "voice", "address", "method",
               "model", "effort", "tools", "tint", "color", "pipe")   # t-ht-build: what a 调岗 may change in the roster entry
LOCK_RE = re.compile(r"Confirmed rules|Boundaries|Hard rules|红线|批准|不做的事|不许|禁止")   # t-ht-build: roles/<id>.md sections a 调岗 never touches (safety lists included)
FROM_ITEM_DENY = ("agent_name", "notebooks", "enabled", "team", "template", "variant", "memory", "disallowed_tools", "skills", "files")


def die(msg, code=2):
    if JSON_OUT:
        print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    print("✗ " + msg, file=sys.stderr)
    sys.exit(code)


def now_tag():
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def rel(p):
    return os.path.relpath(p, ROOT)


def load_roster():
    if not os.path.exists(ROSTER) and os.path.exists(ROSTER[:-5] + ".example.json"):
        shutil.copy(ROSTER[:-5] + ".example.json", ROSTER)   # fresh clone: same first-run copy server.py makes
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    from core import config as C   # t-oss-struct B1: migrated, no defaults filled in, so the write-back changes nothing else
    return C.roster_file(ROOT)


def write_json_atomic(path, data):
    tmp = path + ".tmp-newrole"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)   # roster.json is indent=2; a round trip leaves other entries byte-identical
        f.write("\n")
    os.replace(tmp, path)


def backup(path, tag, dry):
    """Copy path to local/backups/bak/<file>.bak-newrole-<tag> (core/backup.py); refuses to overwrite an existing backup
    (checked and copied in one step)."""
    try:
        return BK.save(path, f"newrole-{tag}", root=ROOT, dry=dry)
    except FileExistsError as e:
        die(f"backup {rel(str(e))} already exists; not overwriting it")


def bak_of(path, tag):
    """The newrole backup of path: the backups folder, or next to the file for backups made before 0.2."""
    return BK.find(path, f"newrole-{tag}", root=ROOT)


def pick_tag(i, op):
    """A backup tag that no existing .bak-newrole-* file uses yet (two runs in the same second would collide otherwise)."""
    base = f"{i}-{op}-{now_tag()}"
    for n in range(1, 100):
        tag = base if n == 1 else f"{base}-{n}"
        if not any(BK.exists(p, f"newrole-{tag}", root=ROOT) for p in (ROSTER, os.path.join(ROOT, "manager.md"))) and not glob.glob(
                os.path.join(ROOT, ".claude", "agents", f"*.bak-newrole-{tag}")) and not glob.glob(
                os.path.join(BK.root_dir(ROOT), "bak", ".claude", "agents", f"*.bak-newrole-{tag}")):
            return tag
    die("could not find a free backup tag")


def log(entry):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    entry = {"t": dt.datetime.now().astimezone().isoformat(timespec="seconds"), **entry}
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ---------- make_agents guard ----------
def make_agents_mod():
    sys.path.insert(0, ROOT)
    import make_agents   # noqa: E402  (same ROOT: make_agents.py sits in the project root)
    return make_agents


def agent_drift(roster, skip_id):
    """Other roles whose agent file on disk differs from what make_agents.py would write now."""
    M = make_agents_mod()
    out = []
    for r in roster.get("roles", []):
        if r["id"] in ("manager", skip_id) or not r.get("agent_name") or not r.get("enabled", True):
            continue
        p = os.path.join(ROOT, ".claude", "agents", f"{r['agent_name']}.md")
        if not os.path.exists(p) or open(p, encoding="utf-8").read() != M.agent_file(r):
            out.append(rel(p))
    return out


def run_make_agents():
    r = subprocess.run([sys.executable, os.path.join(ROOT, "make_agents.py")], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        die("make_agents.py failed:\n" + r.stderr[-800:])
    return r.stdout.strip()


def nudge():
    """Wake the dashboard's long poll. server.py re-reads roster.json (sync_roster) at the start of every /api/state request, but a
    poll that is already waiting only returns when meta.rev moves, so a bare roster edit could take up to 25 s to show. A no-op
    stateutil.mutate() bumps rev through the normal locked path (no field of state.json is touched by hand)."""
    try:
        sys.path.insert(0, ROOT)
        import stateutil
        with stateutil.mutate():
            pass
        return "dashboard poll nudged (meta.rev +1)"
    except Exception as ex:   # no state.json yet (fresh install): the next poll picks the roster up anyway
        return f"poll nudge skipped ({ex})"


def run_avatar_sizes():
    p = os.path.join(ROOT, "tools", "avatar_sizes.py")
    if os.path.exists(p):
        r = subprocess.run([sys.executable, p], cwd=ROOT, capture_output=True, text=True)
        return (r.stdout + r.stderr).strip()
    return "avatar_sizes.py not found, skipped"


# ---------- t-hr-build: an interview card ----------
def from_item(args):
    """--from-item <card>: the spec is work/<card>/role.json and the template + personality come from the card's hire field."""
    cid = args.from_item
    if not re.match(r"^[a-z0-9][a-z0-9-]{1,60}$", cid or ""):
        die(f"bad card id {cid!r}")
    if args.spec or args.template or args.variant:
        die("--from-item takes no spec path, --template or --variant (they come from the card)")
    sys.path.insert(0, ROOT)
    import stateutil   # noqa: E402
    st = stateutil.read()
    it = next((x for x in st.get("items", []) if x.get("id") == cid), None)
    if not it or not isinstance(it.get("hire"), dict):
        die(f"{cid} is not an interview card")
    h = it["hire"]
    spec = os.path.join(ROOT, "work", cid, "role.json")
    if not os.path.isfile(spec):
        die(f"{rel(spec)} is missing (HR writes it before the draft goes to review)")
    args.spec, args.template, args.variant = spec, h.get("job"), h.get("variant")


# ---------- building the entry ----------
def agent_prefix(roster):
    for r in roster.get("roles", []):
        n, i = r.get("agent_name") or "", r["id"]
        if n.endswith(i) and len(n) > len(i):
            return n[: -len(i)]   # "underthread-" by default
    return "underthread-"


def read_text(p):
    return open(p, encoding="utf-8").read() if os.path.exists(p) else None


def build(args, roster):
    """Merge template -> variant -> spec -> flags. Returns (entry, extras)."""
    e, extra = {}, {"role_md": None, "files": {}, "src": [], "starters": [], "rules": []}
    if getattr(args, "from_item", None):
        from_item(args)
    if args.template:
        d = os.path.join(TPL, args.template)
        t = os.path.join(d, "template.json")
        if not os.path.exists(t):
            die(f"no template {rel(t)}")
        tj = json.load(open(t, encoding="utf-8"))
        variants = tj.pop("variants", [])
        for k in ("_note", "job", "tags", "cat"):   # t-hm-build: cat = 招聘市场 category, not a roster field
            tj.pop(k, None)
        e["template"] = args.template   # t-hm-build: the market's 在岗 / 可返聘 badge reads this back from roster.json
        extra["starters"] = tj.pop("starters", None) or []   # t-template-format: shown by the HR interview, not a roster field
        tj.pop("starters_en", None)   # t-i18n-c: market display only, not a roster field
        tj.setdefault("team", "general")   # t-template-format: template roles get make_agents' neutral opening and hard rules
        e.update({k: v for k, v in tj.items() if v not in ("", None)})
        extra["src"].append(rel(t))
        extra["role_md"] = read_text(os.path.join(d, "role.md"))
        dl = read_text(os.path.join(d, "duty_long.md"))
        if dl:
            e["duty_long"] = dl.strip()
        sp = read_text(os.path.join(d, "specialties.md"))
        if sp:
            e["specialties"] = [l.lstrip("-* ").strip() for l in sp.splitlines() if l.strip()]
        if args.variant or variants:
            v = next((x for x in variants if x.get("key") == args.variant), None) if args.variant else variants[0]
            if not v:
                die(f"template {args.template} has no variant {args.variant!r} (has: {', '.join(x.get('key', '?') for x in variants)})")
            for k in ("tint", "voice", "color", "model", "effort", "method"):   # t-template-format: model / effort / method per variant
                if v.get(k):
                    e[k] = v[k]
            ad = os.path.join(d, "art", v.get("art") or v["key"])
            for k, fn in (("avatar", "avatar.png"), ("ut", "ut.png"), ("portrait", "portrait.jpg"), ("panel", "panel.webp"), ("cut", "cut.webp")):
                if os.path.exists(os.path.join(ad, fn)):
                    extra["files"][k] = os.path.join(ad, fn)
            if extra["files"].get("avatar") and os.path.exists(os.path.join(ad, "work-160.webp")):
                extra["work"] = ad   # t-hm-anim-wire: the 4-frame work strip drawn from THIS variant's avatar.png
            e["variant"] = v["key"]
            extra["src"].append(f"variant {v['key']}")
        if not extra["files"].get("avatar") and os.path.exists(os.path.join(d, "avatar.png")):
            extra["files"]["avatar"] = os.path.join(d, "avatar.png")   # t-hm-build: a per-job portrait (t-hm-avatars) beats the recoloured default
            if os.path.exists(os.path.join(d, "work-160.webp")):
                extra["work"] = d
    if args.spec:
        try:
            sj = json.load(open(args.spec, encoding="utf-8"))
        except ValueError as ex:
            die(f"{rel(os.path.abspath(args.spec))} is not valid JSON: {ex}")
        if not isinstance(sj, dict):
            die("the spec must be a JSON object")
        if getattr(args, "from_item", None):
            bad = sorted(k for k in sj if k in FROM_ITEM_DENY)
            if bad:
                die(f"an interview spec cannot set {', '.join(bad)} (template, personality and files come from the card)")
        rules = sj.pop("rules", None) or []
        if not (isinstance(rules, list) and all(isinstance(x, str) and x.strip() and "\n" not in x for x in rules)):
            die("rules must be a list of one-line strings")
        extra["rules"] = [x.strip() for x in rules]
        files = sj.pop("files", {}) or {}
        for k, p in files.items():
            ap = os.path.abspath(os.path.join(ROOT, p))
            if not ap.startswith(os.path.join(ROOT, "work") + os.sep):
                die(f"spec file {p}: source files must be under work/")
            extra["files"][k] = ap
            if k in ("avatar", "ut"):
                extra.pop("work", None)   # t-hm-anim-wire: a spec's own picture no longer matches the template's work strip
        if sj.get("role_md"):
            extra["role_md"] = sj.pop("role_md")
        sj.pop("role_md", None)
        e.update(sj)
        extra["src"].append(rel(os.path.abspath(args.spec)))
    flagmap = {"id": "id", "name": "name", "name_en": "name_en", "title": "title", "title_en": "title_en", "duty": "duty",
               "duty_long": "duty_long", "tint": "tint", "color": "color", "model": "model", "effort": "effort", "room": "room"}
    for a, k in flagmap.items():
        v = getattr(args, a)
        if v is not None:
            e[k] = v
    if args.seat is not None:
        if args.seat == "none":
            e["seat"] = None
        elif args.seat == "auto":
            e.pop("seat", None)
        else:
            try:
                e["seat"] = [round(float(x), 3) for x in args.seat.split(",")]
            except ValueError:
                die("--seat is x,y (0..1), none or auto")
    if args.pipe is not None:
        ps = [p for p in args.pipe.split(",") if p]
        e["pipe"] = ps[0] if len(ps) == 1 else ps
        if not ps:
            e.pop("pipe")
    if args.address:
        e["address"] = {"name": args.address, "alt": []}
    if args.flag_specialty:
        e["specialties"] = args.flag_specialty
    # defaults
    if "id" not in e:
        die("no id (--id or the spec's \"id\")")
    i = e["id"]
    e.setdefault("name", i)
    e.setdefault("name_en", e["name"] if re.match(r"^[\x00-\x7f]+$", e["name"]) else i.capitalize())
    e.setdefault("title", "新成员")
    e.setdefault("title_en", "New member")
    e.setdefault("duty", e["title"])
    e.setdefault("duty_long", e.get("duty_en") or e["duty"])
    e.setdefault("tint", "#6f7f8f")
    e.setdefault("color", e["tint"])
    e.setdefault("agent_name", agent_prefix(roster) + i)
    e.setdefault("specialties", [])
    e.setdefault("skills", [])
    e.setdefault("notebooks", ["roles/common.md", f"roles/{i}.md"])
    e.pop("enabled", None)
    # key order like the existing entries: identity first, registry fields last
    order = ["id", "name", "name_en", "title", "title_en", "duty", "duty_en", "color", "room", "agent_name", "specialties",
             "duty_long", "skills", "notebooks", "voice", "method", "address", "model", "effort", "tint", "seat", "pipe", "team", "template", "variant"]
    e = {k: e[k] for k in order if k in e} | {k: v for k, v in e.items() if k not in order}
    return e, extra


def validate(e, roster):
    i = e["id"]
    errs = []
    if not ID_RE.match(i):
        errs.append(f"id {i!r} must match {ID_RE.pattern}")
    if i in RESERVED:
        errs.append(f"id {i!r} is reserved")
    for k in ("tint", "color"):
        if not HEX_RE.match(str(e.get(k, ""))):
            errs.append(f"{k} {e.get(k)!r} must be #rrggbb")
    if "seat" in e and e["seat"] is not None:
        s = e["seat"]
        if not (isinstance(s, list) and len(s) == 2 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in s)):
            errs.append(f"seat {s!r} must be [x, y] in 0..1, null, or left out (auto)")
    for p in [] if "pipe" not in e else ([e["pipe"]] if isinstance(e["pipe"], str) else e["pipe"]):
        if p not in PIPES:
            errs.append(f"pipe {p!r} is not one of {', '.join(PIPES)}")
    if "method" in e and not (isinstance(e["method"], list) and all(isinstance(x, str) and x.strip() for x in e["method"])):
        errs.append("method must be a list of non-empty strings")   # t-template-format
    if e.get("team", "content") not in ("content", "general"):
        errs.append(f"team {e.get('team')!r} must be content or general")
    if e.get("model") and e["model"] not in ("opus", "sonnet", "haiku", "inherit") and not str(e["model"]).startswith("claude-"):
        errs.append(f"model {e['model']!r} is not opus / sonnet / haiku / inherit / a claude-* id")
    if e.get("effort") and e["effort"] not in ("low", "medium", "high", "xhigh", "max"):
        errs.append(f"effort {e['effort']!r} is not low / medium / high / xhigh / max")
    for r in roster.get("roles", []):
        if r["id"] != i and r.get("agent_name") == e["agent_name"]:
            errs.append(f"agent_name {e['agent_name']} is already used by {r['id']}")
    if errs:
        die("invalid role:\n  " + "\n  ".join(errs))


# ---------- avatar ----------
def recolour(tint, out):
    """Two-tone recolour of the grayscale base: black -> dark tint, white -> light tint."""
    h = tint.lstrip("#")
    c = [int(h[k:k + 2], 16) for k in (0, 2, 4)]
    dark = [round(x * .42) for x in c]
    light = [round(x + (255 - x) * .78) for x in c]
    expr = ":".join(f"{ch}='{d}+({l}-{d})*val/255'" for ch, d, l in zip("rgb", dark, light))
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", BASE_AV, "-vf", f"format=rgb24,lutrgb={expr}", "-frames:v", "1", out],
                       capture_output=True, text=True)
    if r.returncode or not os.path.exists(out):
        die("ffmpeg recolour failed: " + r.stderr[-300:])


def gen_avatar(e, out):
    prompt = (f"A square chibi avatar of an original character for a small studio dashboard: {e['name']} ({e.get('title_en') or e['title']}). "
              f"Plain flat background in {e['tint']}, head and shoulders, centred, no text, no logo, not based on any existing character.")
    tmpd = os.path.join(ROOT, "work", "_new_role", e["id"])
    os.makedirs(tmpd, exist_ok=True)
    r = subprocess.run([sys.executable, IMAGE, "gen", prompt, tmpd], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    p = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    if r.returncode or not os.path.exists(p):
        die(f"tools/image.py failed (exit {r.returncode}{', no image backend' if r.returncode == 6 else ''}); rerun without --avatar gen for the recolour\n{r.stderr[-300:]}")
    shutil.copyfile(p, out)


# ---------- commands ----------
def same_entry(a, b):
    return {k: v for k, v in a.items() if k != "enabled"} == {k: v for k, v in b.items() if k != "enabled"}


def cmd_apply(args, dry):
    roster = load_roster()
    e, extra = build(args, roster)
    validate(e, roster)
    i = e["id"]
    have = next((r for r in roster["roles"] if r["id"] == i), None)
    steps, made = [], []
    if have and not same_entry(have, e):
        diff = sorted(k for k in set(have) | set(e) if k != "enabled" and have.get(k) != e.get(k))
        die(f"id {i!r} already exists in roster.json with different fields ({', '.join(diff)}); pick another id or retire it first")
    if have and have.get("enabled") is False:
        die(f"{i} exists but is soft-retired; use `rehire {i}`")
    md = role_md(i)
    if not have and os.path.exists(md):
        die(f"{rel(md)} exists but {i} is not in roster.json (left over from an old role?); move it away first")
    drift = agent_drift(roster, i)
    if drift:
        die("these agent files differ from what make_agents.py would write (hand-edited?); make_agents would overwrite them:\n  "
            + "\n  ".join(drift))
    tag = pick_tag(i, "apply")
    # 1. roster
    if have:
        steps.append(f"roster.json: {i} already there, unchanged")
    else:
        steps.append(f"roster.json: append {i} ({e['name']} · {e['title']}), tint {e['tint']}, seat {e.get('seat', 'auto')}, pipe {e.get('pipe', '-')}")
        if not dry:
            backup(ROSTER, tag, dry)
            roster["roles"].append(e)
            write_json_atomic(ROSTER, roster)
            made.append("roster.json#" + i)
    # 2. roles/<id>.md
    if os.path.exists(md):
        steps.append(f"{rel(md)}: exists, left as is")
    else:
        body = extra["role_md"] or f"# {e['name']} · {e['title']}\n\n(role notes: how this role works for you)\n\n## Confirmed rules\n"
        addr = (e.get("address") or {}).get("name") or "你"
        for k, v in {"name": e["name"], "title": e["title"], "id": i, "address": addr}.items():
            body = body.replace("{{" + k + "}}", v)
        if "## Confirmed rules" not in body:
            body = body.rstrip() + "\n\n## Confirmed rules\n"
        if extra["rules"]:   # t-hr-build: the user's own words from the interview, so they go in as confirmed
            src = f"面试 {args.from_item}" if getattr(args, "from_item", None) else "入职时定"
            day = dt.date.today().isoformat()
            body = body.rstrip("\n") + "\n" + "".join(f"- {x} ({day}，{src})\n" for x in extra["rules"])
        steps.append(f"{rel(md)}: new" + (f", {len(extra['rules'])} confirmed rule(s)" if extra["rules"] else ""))
        if not dry:
            os.makedirs(os.path.dirname(md), exist_ok=True)
            with open(md, "w", encoding="utf-8") as f:
                f.write(body)
            made.append(rel(md))
    # 3. avatar (+ the 特典 copy: without avatars/ut/<id> the UT skin has nothing to show)
    av, ut = os.path.join(ROOT, "avatars", f"{i}.png"), os.path.join(ROOT, "avatars", "ut", f"{i}.png")
    mode = args.avatar
    av_how = "kept"   # t-hire-celebration: logged, so the welcome animation knows a placeholder ("recolour") is waiting for a picked avatar
    if os.path.exists(av):
        steps.append(f"{rel(av)}: exists, left as is")
    elif extra["files"].get("avatar"):
        av_how = "given"
        steps.append(f"{rel(av)}: copy of {rel(extra['files']['avatar'])}")
        if not dry:
            shutil.copyfile(extra["files"]["avatar"], av); made.append(rel(av))
    elif mode == "none":
        av_how = "none"
        steps.append("avatar: none (letter circle)")
    elif mode == "gen":
        av_how = "gen"
        steps.append(f"{rel(av)}: generate with tools/image.py")
        if not dry:
            gen_avatar(e, av); made.append(rel(av))
    else:
        av_how = "recolour"
        steps.append(f"{rel(av)}: bundled default recoloured to {e['tint']}")
        if os.access(os.path.join(ROOT, "tools", "gpt_image.sh"), os.X_OK):
            steps.append("  (tools/gpt_image.sh found: add --avatar gen to generate a portrait instead)")
        if not dry:
            recolour(e["tint"], av); made.append(rel(av))
    if os.path.exists(av) or (dry and mode != "none") or extra["files"].get("ut"):
        if os.path.exists(ut):
            steps.append(f"{rel(ut)}: exists, left as is")
        else:
            src = extra["files"].get("ut") or av
            if extra["files"].get("ut"):
                av_how = "given"
            steps.append(f"{rel(ut)}: copy of {rel(src)}")
            if not dry:
                os.makedirs(os.path.dirname(ut), exist_ok=True)
                shutil.copyfile(src, ut); made.append(rel(ut))
    # t-hm-anim-wire: the template's 4-frame work strip (frame 1 = its avatar.png) -> avatars/ut/_s/<id>-work-<160|320|512>.webp, the same files the
    # 8 founding roles have. server.py art_scan() sees <id>-work-160.webp as meta.art[id].sheet, and app.js wsheet() / theme-ut.css play it under
    # 特典 while the role is working (steps(4), 0.8 s, off under prefers-reduced-motion). Only when the 特典 avatar IS the template picture, so the
    # strip never jumps away from a different face.
    wd = extra.get("work")
    if wd and (not os.path.exists(ut) or filecmp.cmp(ut, extra["files"]["avatar"], shallow=False)):
        for s in (160, 320, 512):
            src, dst = os.path.join(wd, f"work-{s}.webp"), f"avatars/ut/_s/{i}-work-{s}.webp"
            p = os.path.join(ROOT, dst)
            if not os.path.exists(src):
                continue
            steps.append(f"{dst}: " + ("exists, left as is" if os.path.exists(p) else f"copy of {rel(src)}"))
            if not dry and not os.path.exists(p):
                os.makedirs(os.path.dirname(p), exist_ok=True)
                shutil.copyfile(src, p); made.append(dst)
    elif wd:
        steps.append(f"work animation: skipped ({rel(ut)} is not the template picture)")
    for k, dst in (("portrait", f"web/art/{i}.jpg"), ("panel", f"web/art/panels/{i}.webp"), ("cut", f"web/art/cut/{i}.webp")):
        if extra["files"].get(k):
            p = os.path.join(ROOT, dst)
            steps.append(f"{dst}: " + ("exists, left as is" if os.path.exists(p) else f"copy of {rel(extra['files'][k])}"))
            if not dry and not os.path.exists(p):
                os.makedirs(os.path.dirname(p), exist_ok=True)
                shutil.copyfile(extra["files"][k], p); made.append(dst)
    # 4. agent file via make_agents.py (also refreshes manager.md's dispatch table)
    ag = os.path.join(ROOT, ".claude", "agents", f"{e['agent_name']}.md")
    steps.append(f"{rel(ag)}: " + ("exists, regenerated" if os.path.exists(ag) else "new") + " via make_agents.py; manager.md dispatch table")
    out = {}
    if not dry:
        backup(os.path.join(ROOT, "manager.md"), tag, dry)
        out["make_agents"] = run_make_agents()
        if not os.path.exists(ag):
            die(f"make_agents.py ran but {rel(ag)} is missing")
        made.append(rel(ag))
        if any(m.startswith("avatars/") for m in made):
            out["avatar_sizes"] = run_avatar_sizes()
        out["nudge"] = nudge()
        log({"op": "apply", "id": i, "made": made, "from": extra["src"], "backup_tag": tag, "avatar": av_how})
    if JSON_OUT:
        print(json.dumps({"ok": True, "applied": not dry, "id": i, "name": e["name"], "title": e["title"], "agent": e["agent_name"],
                          "template": e.get("template"), "variant": e.get("variant"), "rules": extra["rules"], "steps": steps,
                          "from": extra["src"]}, ensure_ascii=False))
        return
    print(("PLAN (nothing written)" if dry else "APPLIED") + f" · {i}" + (f" · from {', '.join(extra['src'])}" if extra["src"] else ""))
    for s in steps:
        print("  - " + s)
    print(f"  · team {e.get('team', 'content')} · model {e.get('model', '-')} / effort {e.get('effort', '-')}" + (f" · working style {len(e['method'])} lines" if e.get("method") else ""))
    for x in extra.get("starters") or []:
        print("  · starter: " + x)   # t-template-format: the HR interview shows these as 「可以这样派活」
    for k, v in out.items():
        print(f"  [{k}] " + v.replace("\n", "\n    "))
    if not dry:
        print(f"next: python3 stateutil.py set-agent {i} --status idle   (the dashboard picks the roster up on the next poll, no restart)")
        print("      a running manager session only sees the new subagent type after it restarts")
        if have and made == [rel(ag)]:
            print("already applied: nothing was missing (agent file regenerated, identical)")


def find(roster, i):
    return next((r for r in roster["roles"] if r["id"] == i), None)


def content_left(roster, i):
    """t-ht-build: other enabled content roles (not general, not CORE) that stay on the team."""
    return [r["id"] for r in roster.get("roles", []) if r["id"] != i and r["id"] not in CORE and r.get("team", "content") != "general"
            and r.get("enabled", True) is not False]


def cmd_retire(args, dry):
    i = args.id
    if i in RESERVED or i in CORE:
        die(f"{i} cannot be retired (the manager, HR and the tooling keeper stay on the team)")
    roster = load_roster()
    r = find(roster, i)
    if args.hard and r and not r.get("template"):
        die(f"{i} is a founding member: soft retire only (custom art and voice), never --hard")
    if r and r.get("enabled", True) is not False and r.get("team", "content") != "general" and not content_left(roster, i):
        die(f"{i} is the last content role on the team; hire or rehire another one first")
    tag = pick_tag(i, "hard" if args.hard else "soft")
    if not args.hard:
        if not r:
            die(f"{i} is not in roster.json")
        if r.get("enabled") is False:
            print(f"{i} is already soft-retired; nothing to do")
            return
        drift = agent_drift(roster, i)
        if drift:
            die("agent files differ from make_agents.py output:\n  " + "\n  ".join(drift))
        if dry:
            print(f"PLAN · soft retire {i}: roster enabled:false, make_agents.py drops its agent file (backed up), manager.md marks it (disabled)")
            return
        backup(ROSTER, tag, dry)
        backup(os.path.join(ROOT, "manager.md"), tag, dry)
        backup(os.path.join(ROOT, ".claude", "agents", f"{r.get('agent_name')}.md"), tag, dry)
        r["enabled"] = False
        write_json_atomic(ROSTER, roster)
        out = run_make_agents() + "\n" + nudge()
        log({"op": "retire", "id": i, "hard": False, "backup_tag": tag})
        print(f"SOFT-RETIRED {i}: hidden on the dashboard after the next poll; cards, notes, memory and art kept. `rehire {i}` brings them back.")
        print("  [make_agents] " + out.replace("\n", "\n    "))
        return
    # hard: archive files, then drop the roster entry
    agent = (r or {}).get("agent_name") or agent_prefix(roster) + i
    pats = set(ART) | {"roles/{id}.md", "local/roles/{id}.md", ".claude/agents/{agent}.md", "work/{id}-handoff.md"}   # t-ht-build: + the handoff note
    files = sorted({f for p in pats for f in glob.glob(os.path.join(ROOT, p.format(id=i, agent=agent))) if os.path.isfile(f)})
    mem = os.path.join(ROOT, ".claude", "agent-memory", agent)
    if not r and not files and not os.path.isdir(mem):
        print(f"{i}: not in roster.json and no files left; nothing to do")
        return
    if r:
        drift = agent_drift(roster, i)
        if drift:
            die("agent files differ from make_agents.py output:\n  " + "\n  ".join(drift))
    arch = os.path.join(ROOT, "archive", "roles", f"{i}-{now_tag()}")
    k = 2
    while os.path.exists(arch):
        arch = os.path.join(ROOT, "archive", "roles", f"{i}-{now_tag()}-{k}"); k += 1
    print(("PLAN · " if dry else "") + f"hard retire {i} -> {rel(arch)}/")
    for f in files:
        print("  - move " + rel(f))
    if os.path.isdir(mem):
        print("  - move " + rel(mem) + "/")
    if r:
        print("  - roster.json: remove the entry (the server hands its open cards to the manager)")
    if dry:
        return
    if r:
        backup(ROSTER, tag, dry)
        backup(os.path.join(ROOT, "manager.md"), tag, dry)
    for f in files:
        dst = os.path.join(arch, rel(f))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(f, dst)
    if os.path.isdir(mem):
        shutil.move(mem, os.path.join(arch, rel(mem)))
    if r:
        roster["roles"] = [x for x in roster["roles"] if x["id"] != i]
        write_json_atomic(ROSTER, roster)
    os.makedirs(arch, exist_ok=True)   # t-ht-build: what rehire --from-archive puts back
    with open(os.path.join(arch, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"id": i, "t": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "entry": r, "agent": agent,
                   "moved": [rel(f) for f in files], "memory": rel(mem) if os.path.isdir(os.path.join(arch, rel(mem))) else None},
                  f, ensure_ascii=False, indent=2)
    out = run_make_agents() + "\n" + nudge()
    sizes = run_avatar_sizes() if any("avatars" in f for f in files) else ""
    log({"op": "retire", "id": i, "hard": True, "archive": rel(arch), "moved": [rel(f) for f in files], "backup_tag": tag})
    print(f"HARD-RETIRED {i}: files in {rel(arch)}/ (nothing deleted)")
    print("  [make_agents] " + out.replace("\n", "\n    "))
    if sizes:
        print("  [avatar_sizes] " + sizes.replace("\n", "\n    "))


def rehire_archive(args, dry):
    """t-ht-build: undo a hard retire from archive/roles/<id>-<time>/manifest.json (only when the id is free and no file is in the way)."""
    i, d = args.id, os.path.abspath(os.path.join(ROOT, args.from_archive))
    if not d.startswith(os.path.join(ROOT, "archive", "roles") + os.sep) or not os.path.isdir(d):
        die(f"{args.from_archive}: not a folder under archive/roles/")
    mp = os.path.join(d, "manifest.json")
    if not os.path.isfile(mp):
        die(f"{rel(mp)} is missing (archived before t-ht-build: put the files back by hand)")
    m = json.load(open(mp, encoding="utf-8"))
    if m.get("id") != i:
        die(f"{rel(d)} holds {m.get('id')}, not {i}")
    roster = load_roster()
    if find(roster, i):
        die(f"id {i} is taken in roster.json; retire that role first or rename this one")
    e = dict(m.get("entry") or {})
    if not e:
        die("the manifest has no roster entry")
    e.pop("enabled", None)
    moves = [(os.path.join(d, f), os.path.join(ROOT, f)) for f in m.get("moved") or []]
    if m.get("memory"):
        moves.append((os.path.join(d, m["memory"]), os.path.join(ROOT, m["memory"])))
    clash = [rel(b) for a, b in moves if os.path.exists(b)]
    if clash:
        die("these files are in the way:\n  " + "\n  ".join(clash))
    drift = agent_drift(roster, i)
    if drift:
        die("agent files differ from make_agents.py output:\n  " + "\n  ".join(drift))
    missing = [rel(a) for a, b in moves if not os.path.exists(a)]
    if dry:
        print(f"PLAN · rehire {i} from {rel(d)}: roster entry back, {len(moves) - len(missing)} file(s) back" + (f", missing {missing}" if missing else ""))
        return
    tag = pick_tag(i, "unarchive")
    backup(ROSTER, tag, dry)
    backup(os.path.join(ROOT, "manager.md"), tag, dry)
    for a, b in moves:
        if os.path.exists(a):
            os.makedirs(os.path.dirname(b), exist_ok=True)
            shutil.move(a, b)
    roster["roles"].append(e)
    write_json_atomic(ROSTER, roster)
    out = run_make_agents() + "\n" + run_avatar_sizes() + "\n" + nudge()
    os.replace(mp, os.path.join(d, "manifest.restored.json"))
    log({"op": "rehire", "id": i, "from_archive": rel(d), "backup_tag": tag})
    print(f"REHIRED {i} from {rel(d)}\n  " + out.replace("\n", "\n    "))


def cmd_rehire(args, dry):
    if getattr(args, "from_archive", None):
        return rehire_archive(args, dry)
    roster = load_roster()
    r = find(roster, args.id)
    if not r:
        die(f"{args.id} is not in roster.json (a hard-retired role comes back with --from-archive archive/roles/<id>-<time>/)")
    if r.get("enabled", True):
        print(f"{args.id} is already active; nothing to do")
        return
    if dry:
        print(f"PLAN · rehire {args.id}: enabled back on, make_agents.py rewrites its agent file")
        return
    tag = pick_tag(args.id, "rehire")
    backup(ROSTER, tag, dry)
    backup(os.path.join(ROOT, "manager.md"), tag, dry)
    r.pop("enabled", None)
    write_json_atomic(ROSTER, roster)
    out = run_make_agents() + "\n" + nudge()
    log({"op": "rehire", "id": args.id, "backup_tag": tag})
    print(f"REHIRED {args.id}\n  [make_agents] " + out.replace("\n", "\n    "))


# ---------- t-ht-build: 调岗 (update an existing role from an HR transfer card) ----------
def sha(text):
    import hashlib
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def md_sections(text):
    """[(title or None for the head, block text)] split on '## ' lines; joining the blocks gives the text back unchanged."""
    out, cur, buf = [], None, []
    for ln in (text or "").splitlines(keepends=True):
        if ln.startswith("## "):
            out.append((cur, "".join(buf)))
            cur, buf = ln[3:].strip(), [ln]
        else:
            buf.append(ln)
    out.append((cur, "".join(buf)))
    return out


def md_locked(secs):
    """Indexes of locked blocks: every section from ## Confirmed rules on, and any section titled Boundaries / 红线 / 批准."""
    cr = next((k for k, (t, _) in enumerate(secs) if t and t.startswith("Confirmed rules")), len(secs))
    return [k for k, (t, _) in enumerate(secs) if t and (k >= cr or LOCK_RE.search(t))]


def locked_sha(text):
    secs = md_sections(text)
    return sha("".join(secs[k][1] for k in md_locked(secs)))


def as_text(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return "\n".join("- " + as_text(x) for x in v)
    if isinstance(v, dict):
        return "\n".join(f"{k}: {as_text(x)}" if not isinstance(x, (list, dict)) else f"{k}:\n{as_text(x)}" for k, x in v.items())
    return json.dumps(v, ensure_ascii=False)


def xfer_card(cid, i):
    if not re.match(r"^[a-z0-9][a-z0-9-]{1,60}$", cid or ""):
        die(f"bad card id {cid!r}")
    sys.path.insert(0, ROOT)
    import stateutil   # noqa: E402
    it = next((x for x in stateutil.read().get("items", []) if x.get("id") == cid), None)
    h = (it or {}).get("hire")
    if not isinstance(h, dict) or h.get("mode") != "transfer":
        die(f"{cid} is not a transfer card")
    if i and h.get("target") != i:
        die(f"{cid} is a transfer of {h.get('target')}, not {i}")
    return it


def xfer_build(i, cid):
    """Read work/<card>/transfer.json and return (roster, entry, new_entry, md_path, md_old, md_new, changes, lessons)."""
    roster = load_roster()
    r = find(roster, i)
    if not r:
        die(f"{i} is not in roster.json")
    if i == "manager":
        die("the manager is never transferred (manager.md is hers; change it through a rule proposal)")
    if r.get("enabled") is False:
        die(f"{i} is soft-retired; rehire first")
    tp = os.path.join(ROOT, "work", cid, "transfer.json")
    if not os.path.isfile(tp):
        die(f"{rel(tp)} is missing")
    try:
        tj = json.load(open(tp, encoding="utf-8"))
    except ValueError as ex:
        die(f"{rel(tp)} is not valid JSON: {ex}")
    if tj.get("target") not in (None, i):
        die(f"{rel(tp)} is for {tj.get('target')}, not {i}")
    before, after = tj.get("before") or {}, tj.get("after") or {}
    md = role_md(i)
    old = read_text(role_md_read(i)) or ""
    if before.get("roster") is not None and before["roster"] != r:
        die("roster.json changed since the transfer started (someone edited this role); HR has to redo the draft from the current file")
    if before.get("md_sha") and before["md_sha"] != sha(old):
        die(f"{rel(md)} changed since the transfer started; HR has to redo the draft from the current file")
    ar = after.get("roster") or {}
    if not isinstance(ar, dict):
        die("after.roster must be an object")
    bad = sorted(k for k in ar if k not in XFER_FIELDS)
    if bad:
        die(f"a transfer cannot change {', '.join(bad)} (allowed: {', '.join(XFER_FIELDS)}); a new id means retire + hire")
    e = json.loads(json.dumps(r))
    changes = []
    for k, v in ar.items():
        nv = ({**(e.get("voice") or {}), **v} if k == "voice" and isinstance(v, dict) else v)
        if k == "voice" and not isinstance(v, dict):
            die("after.roster.voice must be an object (style / habits)")
        if nv != e.get(k):
            changes.append({"kind": "field", "file": "roster.json", "key": k, "before": as_text(e.get(k)), "after": as_text(nv)})
            e[k] = nv
    validate(e, roster)
    secs = md_sections(old)
    locked = md_locked(secs)
    titles = {t: k for k, (t, _) in enumerate(secs) if t}
    new_secs = list(secs)
    ms = after.get("md_sections") or {}
    if not isinstance(ms, dict):
        die("after.md_sections must be an object {section title: new text}")
    for t, body in ms.items():
        t = str(t).strip().lstrip("#").strip()
        if not t or "\n" in t or not isinstance(body, str):
            die(f"bad section {t!r}")
        k = titles.get(t)
        if LOCK_RE.search(t) or (k is not None and k in locked):
            die(f"section 「{t}」 is locked (Confirmed rules / Boundaries / 红线 / 不做的事); new rules go in after.lessons and you approve them on the review page")
        block = f"## {t}\n{body.strip()}\n\n"
        if k is not None:
            prev = new_secs[k][1]
            if prev.strip() != block.strip():
                changes.append({"kind": "section", "file": rel(md), "key": t, "before": prev.strip(), "after": block.strip()})
                new_secs[k] = (t, block if prev.endswith("\n\n") or k < len(new_secs) - 1 else block.rstrip("\n") + "\n")
        else:
            at = locked[0] if locked else len(new_secs)
            if at == len(new_secs) and new_secs and not new_secs[-1][1].endswith("\n\n"):
                new_secs[-1] = (new_secs[-1][0], new_secs[-1][1].rstrip("\n") + "\n\n")
            new_secs.insert(at, (t, block))
            changes.append({"kind": "section", "file": rel(md), "key": t, "before": "", "after": block.strip(), "new": True})
            locked = md_locked(new_secs)
            titles = {tt: kk for kk, (tt, _) in enumerate(new_secs) if tt}
    new = "".join(b for _, b in new_secs)
    if locked_sha(new) != locked_sha(old):
        die("the locked part of the role notes (Confirmed rules / Boundaries) would change; refused")
    lessons = after.get("lessons") or []
    if not (isinstance(lessons, list) and all(isinstance(x, str) and x.strip() and "\n" not in x for x in lessons)):
        die("after.lessons must be a list of one-line strings")
    return roster, r, e, md, old, new, changes, [x.strip() for x in lessons]


def cmd_update(args, dry):
    if args.undo:
        return update_undo(args)
    if not args.id or not args.from_item:
        die("usage: update <id> --from-item <card> [--plan] [--json]  |  update --undo <card>")
    i, cid = args.id, args.from_item
    xfer_card(cid, i)
    roster, r, e, md, old, new, changes, lessons = xfer_build(i, cid)
    M = make_agents_mod()
    ag = os.path.join(ROOT, ".claude", "agents", f"{r['agent_name']}.md")
    a_old, a_new = read_text(ag) or "", M.agent_file(e)
    import difflib
    a_lines = sum(1 for l in difflib.unified_diff(a_old.splitlines(), a_new.splitlines(), lineterm="", n=0)
                  if l[:1] in "+-" and not l.startswith(("+++", "---")))
    res = {"ok": True, "applied": False, "id": i, "item": cid, "name": e.get("name"), "changes": changes, "lessons": lessons,
           "agent": {"file": rel(ag), "changed_lines": a_lines}, "locked": "Confirmed rules：锁定，不变", "locked_sha": locked_sha(old)}
    if not changes and not lessons:
        die("the draft changes nothing (after is empty or the same as now)")
    if dry:
        return out_update(res)
    drift = agent_drift(roster, i)
    if drift:
        die("these agent files differ from what make_agents.py would write (hand-edited?):\n  " + "\n  ".join(drift))
    tag = pick_tag(i, "update")
    baks = [backup(p, tag, False) for p in (ROSTER, md, os.path.join(ROOT, "manager.md"), ag)]
    for k, x in enumerate(roster["roles"]):
        if x["id"] == i:
            roster["roles"][k] = e
    write_json_atomic(ROSTER, roster)
    if new != old:
        tmp = md + ".tmp-newrole"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new)
        os.replace(tmp, md)
    res["make_agents"] = run_make_agents()
    res["nudge"] = nudge()
    res.update(applied=True, backup_tag=tag, backups=[rel(b) for b in baks if b])
    log({"op": "update", "id": i, "item": cid, "fields": [c["key"] for c in changes if c["kind"] == "field"],
         "sections": [c["key"] for c in changes if c["kind"] == "section"], "backup_tag": tag,
         "sha": {rel(ROSTER): sha(read_text(ROSTER)), rel(md): sha(read_text(md))}})
    out_update(res)


def out_update(res):
    if JSON_OUT:
        print(json.dumps(res, ensure_ascii=False))
        return
    print(("APPLIED" if res.get("applied") else "PLAN (nothing written)") + f" · update {res['id']} from {res['item']}")
    for c in res["changes"]:
        print(f"  - {c['file']} · {c['key']}" + (" (new section)" if c.get("new") else ""))
        for l in c["before"].splitlines():
            print("      - " + l)
        for l in c["after"].splitlines():
            print("      + " + l)
    print(f"  - {res['agent']['file']}: follows, {res['agent']['changed_lines']} line(s)")
    print("  - " + res["locked"])
    for x in res["lessons"]:
        print("  · rule proposal (you approve it on the review page): " + x)
    if res.get("backup_tag"):
        print(f"  backups: tag newrole-{res['backup_tag']} (python3 tools/bak.py list)")


def update_undo(args):
    cid = args.undo
    entries = []
    try:
        for ln in open(LOG, encoding="utf-8"):
            try:
                entries.append(json.loads(ln))
            except ValueError:
                pass
    except OSError:
        pass
    ups = [x for x in entries if x.get("op") in ("update", "update_undo") and x.get("item") == cid]
    if not ups or ups[-1]["op"] != "update":
        die(f"no transfer of {cid} to undo" + (" (already undone)" if ups else ""))
    u = ups[-1]
    i, tag = u["id"], u["backup_tag"]
    if args.id and args.id != i:
        die(f"{cid} changed {i}, not {args.id}")
    for f, h in (u.get("sha") or {}).items():
        if sha(read_text(os.path.join(ROOT, f))) != h:
            die(f"{f} was changed again after the transfer; undo by hand: python3 tools/bak.py restore newrole-{tag} {f}")
    md = role_md(i)
    roster = load_roster()
    drift = agent_drift(roster, i)
    if drift:
        die("agent files differ from make_agents.py output:\n  " + "\n  ".join(drift))
    for p in (ROSTER, md):
        if not bak_of(p, tag):
            die(f"backup of {rel(p)} tagged newrole-{tag} is missing")
    t2 = pick_tag(i, "undo")
    for p in (ROSTER, md, os.path.join(ROOT, "manager.md")):
        backup(p, t2, False)
    for p in (ROSTER, md):
        shutil.copy2(bak_of(p, tag), p)
    out = run_make_agents() + "\n" + nudge()
    log({"op": "update_undo", "id": i, "item": cid, "restored_from": tag, "backup_tag": t2})
    if JSON_OUT:
        print(json.dumps({"ok": True, "id": i, "item": cid, "restored_from": tag}, ensure_ascii=False))
    else:
        print(f"UNDONE update of {i} ({cid}): roster.json + {rel(md)} back from backup newrole-{tag}\n  " + out.replace("\n", "\n    "))


def main(argv):
    if argv[:1] == ["--retire"]:
        argv = ["retire"] + argv[1:]
    ap = argparse.ArgumentParser(prog="new_role.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "apply"):
        s = sub.add_parser(name)
        s.add_argument("spec", nargs="?")
        s.add_argument("--template"); s.add_argument("--variant")
        for f in ("id", "name", "name-en", "title", "title-en", "duty", "duty-long", "tint", "color", "seat", "pipe",
                  "address", "model", "effort", "room"):
            s.add_argument("--" + f)
        s.add_argument("--specialty", action="append", dest="flag_specialty")
        s.add_argument("--avatar", choices=("recolour", "gen", "none"), default="recolour")
        s.add_argument("--from-item", dest="from_item")
        s.add_argument("--json", action="store_true")
    s = sub.add_parser("retire"); s.add_argument("id"); s.add_argument("--hard", action="store_true"); s.add_argument("--dry", action="store_true")
    s = sub.add_parser("rehire"); s.add_argument("id"); s.add_argument("--dry", action="store_true"); s.add_argument("--from-archive", dest="from_archive")
    s = sub.add_parser("update"); s.add_argument("id", nargs="?"); s.add_argument("--from-item", dest="from_item"); s.add_argument("--undo")
    s.add_argument("--plan", action="store_true"); s.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    global JSON_OUT
    JSON_OUT = bool(getattr(a, "json", False))
    if a.cmd in ("plan", "apply"):
        cmd_apply(a, a.cmd == "plan")
    elif a.cmd == "retire":
        cmd_retire(a, a.dry)
    elif a.cmd == "update":
        cmd_update(a, a.plan)
    else:
        cmd_rehire(a, a.dry)


if __name__ == "__main__":
    main(sys.argv[1:])
