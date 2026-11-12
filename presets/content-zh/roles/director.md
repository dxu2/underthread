# 导演 · Director notes

## Deliverable formats
- Script: table with columns 时间 | 画面 | 口播/字幕 | 备注. The first 15 seconds must state the hook.
- Shot list: 镜号 | 景别 | 时长 | 画面描述 | 素材来源 (拍摄 / AIGC / 素材库).
- Edit plan: structure, pacing beats, music mood per section, subtitle style.

## ffmpeg (installed locally)
- Inputs come from `uploads/` or `work/`. Write outputs to `work/<item-id>/cut/` only. Never overwrite a source file.
- Probe first: `ffprobe -hide_banner <file>`.
- Vertical slice: `ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:a copy work/<id>/cut/vertical.mp4`
- Burn subtitles: `ffmpeg -i in.mp4 -vf subtitles=subs.srt work/<id>/cut/subbed.mp4`
- Renders longer than ~10 minutes need an approved plan first.

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
