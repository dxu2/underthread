#!/usr/bin/env python3
"""Voice memo pipeline (t-voice-memo), all local and offline.

    python3 tools/transcribe.py uploads/<file>.m4a [--force]

1. ffprobe: a .webm with a real video stream is a video, not a memo (recorded as kind=video, nothing else).
2. ffmpeg -> 16 kHz mono wav (temp file), duration + 48 waveform peaks written to state.media[path] right away.
3. whisper.cpp (whisper-cli, Metal) with large-v3-turbo q5. Language is auto-detected first (a short -dl pass, no
   prompt, so the Chinese prompt cannot bias it); only Chinese then gets the prompt with team names + simplified/punctuation.
4. Result into state.media[path].tx; if the message carrying the file was already sent, an inbox entry
   shaped like that message (manager / dm / comment) tells the manager the transcript is ready.
One transcription at a time (flock on .transcribe.lock); others wait as "queued". Log: logs/transcribe.log.
"""
import array
import datetime as dt
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import stateutil as S  # noqa: E402

MODEL = os.environ.get("WHISPER_MODEL") or os.path.join(HERE, "models", "ggml-large-v3-turbo-q5_0.bin")
MODEL_TAG = "large-v3-turbo-q5_0"
LOCK = os.path.join(ROOT, ".transcribe.lock")
LOG = os.path.join(ROOT, "logs", "transcribe.log")
PEAKS = 48
GLOSSARY = ["工作流", "B站", "小红书", "YouTube", "看板", "延时摄影", "分镜", "口播", "封面"]


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def tool(name):   # launchd's PATH may not include Homebrew
    return shutil.which(name) or next((p for p in (f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}") if os.path.exists(p)), name)


def has_video(path):
    out = subprocess.run([tool("ffprobe"), "-v", "error", "-select_streams", "v", "-show_entries",
                          "stream=codec_type:stream_disposition=attached_pic", "-of", "json", path],
                         capture_output=True, text=True, timeout=30).stdout
    streams = (json.loads(out or "{}").get("streams") or [])
    return any(not (s.get("disposition") or {}).get("attached_pic") for s in streams)


def peaks_of(wav_path):
    with wave.open(wav_path) as w:
        n, rate = w.getnframes(), w.getframerate()
        pcm = array.array("h", w.readframes(n))
    dur = n / float(rate or 16000)
    if not pcm:
        return dur, [0.08] * PEAKS
    step = max(1, len(pcm) // PEAKS)
    rms = []
    for i in range(PEAKS):
        seg = pcm[i * step:(i + 1) * step:4] or array.array("h", [0])   # every 4th sample is plenty for a bar
        rms.append((sum(v * v for v in seg) / len(seg)) ** 0.5)
    top = max(rms) or 1.0
    return dur, [round(max(0.08, (r / top) ** 0.7), 2) for r in rms]


def prompt():
    names = []
    try:
        from core import config as C   # t-oss-struct B1
        ro = C.roster(ROOT, strict=True)
        for r in (ro if isinstance(ro, list) else ro.get("roles") or ro.get("agents") or []):
            n = r.get("name") or r.get("display_name")
            if n:
                names.append(n)
    except Exception:
        pass
    return "以下是普通话的句子，使用简体中文和标点。常用词：" + "、".join(names + GLOSSARY) + "。"


CJK = r"[㐀-鿿＀-￯]"
FULL = {",": "，", "?": "？", "!": "！", ":": "：", ";": "；"}


def tidy(text):
    text = " ".join(line.strip() for line in text.splitlines() if line.strip())
    text = re.sub(r"(?<=" + CJK + r")\s+(?=" + CJK + r")", "", text)
    for a, b in FULL.items():
        text = re.sub(r"(?<=" + CJK + r")\s*" + re.escape(a) + r"\s*", b, text)
        text = re.sub(r"\s*" + re.escape(a) + r"\s*(?=" + CJK + r")", b, text)
    return text.strip()


def detect_lang(wav):
    r = subprocess.run([tool("whisper-cli"), "-m", MODEL, "-l", "auto", "-dl", "-f", wav], capture_output=True, text=True, timeout=120)
    m = re.search(r"auto-detected language: ([a-z]{2,3})", (r.stdout or "") + (r.stderr or ""))
    return m.group(1) if m else "auto"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if len(args) != 1:
        raise SystemExit(__doc__)
    rel = args[0]
    src = os.path.realpath(os.path.join(ROOT, rel))
    if not (rel.startswith(("uploads/", "work/")) and src.startswith(ROOT + os.sep) and os.path.isfile(src) and S.is_audio_path(rel)):
        raise SystemExit(f"not an audio file under uploads/ or work/: {rel}")
    if rel.lower().endswith(".webm") and has_video(src):
        with S.mutate() as st:
            S.set_media(st, rel, kind="video")
        log(f"{rel}: webm with video, left as video")
        return
    with S.mutate() as st:
        m = (st.get("media") or {}).get(rel) or {}
        if (m.get("tx") or {}).get("status") in ("done", "working") and not force:
            log(f"{rel}: already {(m.get('tx') or {}).get('status')}, skipped")
            return
        S.set_media(st, rel, kind="audio", tx={"status": "queued", "error": None, "notified": None, "queued": S.now()})
    with open(LOCK, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)   # one at a time; the rest wait here as "queued"
        try:
            run(rel, src)
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def run(rel, src):
    t0 = time.time()
    with S.mutate() as st:
        S.set_media(st, rel, tx={"status": "working", "started": S.now()})
    fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="underthread-vm-")
    os.close(fd)
    try:
        subprocess.run([tool("ffmpeg"), "-nostdin", "-v", "error", "-y", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", tmp],
                       check=True, capture_output=True, timeout=600)
        dur, peaks = peaks_of(tmp)
        with S.mutate() as st:   # the waveform shows up before the transcript is done
            S.set_media(st, rel, dur=round(dur, 2), peaks=peaks)
        if not os.path.exists(MODEL):
            raise RuntimeError(f"model missing: {MODEL}")
        lang = detect_lang(tmp)
        cmd = [tool("whisper-cli"), "-m", MODEL, "-l", lang, "-nt", "-np", "-f", tmp]
        if lang == "zh":
            cmd[5:5] = ["--prompt", prompt()]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=max(180, int(dur * 3)))
        if r.returncode != 0:
            raise RuntimeError((r.stderr or "whisper-cli failed").strip().splitlines()[-1][:200])
        text = tidy(r.stdout)
        secs = round(time.time() - t0, 1)
        with S.mutate() as st:
            S.set_media(st, rel, tx={"status": "done", "text": text, "lang": lang, "model": MODEL_TAG, "secs": secs, "done": S.now()})
            follow = S.memo_followup(st, rel)
        if follow:
            S.inbox_append(follow)
        log(f"{rel}: done in {secs}s for {dur:.1f}s audio, lang {lang}, {len(text)} chars" + (", inbox follow-up" if follow else ""))
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:200] or e.__class__.__name__
        with S.mutate() as st:
            S.set_media(st, rel, tx={"status": "failed", "error": msg})
        log(f"{rel}: FAILED {msg}")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


if __name__ == "__main__":
    main()
