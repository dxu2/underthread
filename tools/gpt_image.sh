#!/bin/bash
# gpt_image.sh — generates ONE image with codex (the one bundled in ChatGPT.app, or codex on PATH), on the ChatGPT subscription.
# Usually called through tools/image.py (image.backend = codex or auto); the artist and tools/new_role.py --avatar gen use that.
#
#   tools/gpt_image.sh [-i <ref.png>]... "<prompt>" <out_dir> [timeout_seconds=240]
#   REFIMG=<ref.png>[:<ref2.png>...] tools/gpt_image.sh "<prompt>" <out_dir>      (same thing via env, ':'-separated)
#   Reference images are attached to the codex prompt with `codex exec --image`;
#   -i and REFIMG can be combined and repeated. Say in the prompt what to take from them ("same character as the reference").
#   stdout: the absolute path of the new PNG (one line). Everything else goes to stderr.
#
# Exit codes: 0 ok · 2 usage · 3 not logged in with ChatGPT (refuses to run on an API key) · 4 quota / rate limit hit
#             5 codex finished but no image was produced · 124 timeout · other = codex's own exit code
#
# Rules this script keeps:
#   - never falls back to the API: OPENAI_API_KEY / CODEX_API_KEY are removed from codex's environment, and it stops unless
#     `codex login status` says ChatGPT;
#   - never reads or prints ~/.codex/auth.json;
#   - one image per call, no retries (each call costs subscription quota; image turns cost 3-5x a normal turn);
#   - the image is copied out by this script from ~/.codex/generated_images/<thread id>/, the agent gets a read-only sandbox.
set -euo pipefail

# ChatGPT.app keeps codex in Resources/codex-cli/bin/ (older builds: Resources/). Use CODEX_BIN if set, else the first that exists.
CODEX_TRIED="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex /Applications/ChatGPT.app/Contents/Resources/codex"
if [ -n "${CODEX_BIN:-}" ]; then CODEX="$CODEX_BIN"
else
  CODEX=""
  for c in $CODEX_TRIED; do [ -x "$c" ] && { CODEX="$c"; break; }; done
  [ -z "$CODEX" ] && CODEX="$(command -v codex 2>/dev/null || true)"
fi
GEN="${CODEX_HOME:-$HOME/.codex}/generated_images"

usage() { echo "usage: [REFIMG=a.png[:b.png]] $0 [-i <ref_image>]... \"<prompt>\" <out_dir> [timeout_seconds]" >&2; exit 2; }

# reference images: REFIMG (':'-separated) + any number of -i <path> before the prompt
refs=()
if [ -n "${REFIMG:-}" ]; then
  IFS=':' read -r -a _r <<< "$REFIMG"
  for r in "${_r[@]}"; do [ -n "$r" ] && refs+=("$r"); done
fi
while [ $# -gt 0 ]; do
  case "$1" in
    -i|--image) [ $# -ge 2 ] || usage; refs+=("$2"); shift 2 ;;
    --image=*)  refs+=("${1#--image=}"); shift ;;
    -h|--help)  usage ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [ $# -lt 2 ] || [ -z "$1" ]; then usage; fi
prompt="$1"; out="$2"; limit="${3:-240}"
[ -n "$CODEX" ] && [ -x "$CODEX" ] || { echo "error: codex not found (CODEX_BIN=${CODEX_BIN:-unset}; tried: $CODEX_TRIED; and codex on PATH). Set CODEX_BIN to the codex inside ChatGPT.app." >&2; exit 2; }
imgargs=()
for r in ${refs[@]+"${refs[@]}"}; do
  [ -f "$r" ] && [ -r "$r" ] || { echo "error: reference image not found: $r" >&2; exit 2; }
  imgargs+=("--image=$(cd "$(dirname "$r")" && pwd)/$(basename "$r")")
done
mkdir -p "$out"; out="$(cd "$out" && pwd)"

# subscription login only
if ! "$CODEX" login status 2>&1 | grep -q "ChatGPT"; then
  echo "error: codex is not logged in with ChatGPT; refusing to run (no API key fallback)" >&2; exit 3
fi

refnote=""
[ ${#imgargs[@]} -gt 0 ] && refnote="（已附 ${#imgargs[@]} 张参考图，按下面的要求参考它们。）"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
ev="$tmp/events.jsonl"
t0=$(date +%s)
set +e
env -u OPENAI_API_KEY -u CODEX_API_KEY perl -e 'alarm shift; exec @ARGV' "$limit" \
  "$CODEX" exec --skip-git-repo-check -s read-only -C "$tmp" --json ${imgargs[@]+"${imgargs[@]}"} -- \
  "${refnote}用你内置的生图功能（\$imagegen）生成一张图：${prompt}。只生成这一张，不要运行任何命令，生成后直接结束。" \
  < /dev/null > "$ev" 2> "$tmp/stderr.txt"
rc=$?
set -e
secs=$(( $(date +%s) - t0 ))

# perl's alarm kills codex with SIGALRM (exit 142)
if [ "$rc" -eq 142 ]; then echo "error: timed out after ${limit}s" >&2; exit 124; fi
# quota / rate limit: look at error text only (the turn.completed line carries token counts, which could contain "429")
lim='usage limit|rate.?limit|quota|too many requests|\b429\b|insufficient|out of credits'
if grep -v '"turn.completed"' "$ev" | cat - "$tmp/stderr.txt" | grep -qiE "$lim"; then
  echo "error: ChatGPT quota / rate limit reached; not retrying, not switching to the API" >&2
  grep -v '"turn.completed"' "$ev" | cat - "$tmp/stderr.txt" | grep -iE "$lim" | head -3 >&2
  exit 4
fi
if [ "$rc" -ne 0 ]; then echo "error: codex exited $rc" >&2; tail -5 "$tmp/stderr.txt" >&2; exit "$rc"; fi

tid="$(python3 -c 'import json,sys
for l in open(sys.argv[1]):
    e=json.loads(l)
    if e.get("type")=="thread.started": print(e.get("thread_id","")); break' "$ev")"
img="$(ls -t "$GEN/$tid"/*.png 2>/dev/null | head -1 || true)"
if [ -z "$tid" ] || [ -z "$img" ]; then echo "error: no image produced (thread ${tid:-?})" >&2; exit 5; fi

dest="$out/gpt-$(date +%Y%m%d-%H%M%S)-$(basename "$img")"
cp "$img" "$dest"
echo "ok: ${secs}s, thread $tid, ${#imgargs[@]} ref image(s)" >&2
echo "$dest"
