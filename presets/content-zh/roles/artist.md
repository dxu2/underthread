# 美术 · Artist notes

## Pictures
- `python3 tools/image.py backend` says what this install can draw with: `codex` (ChatGPT subscription) or `none`.
- One picture: `python3 tools/image.py gen [-i ref.png]... "<prompt>" work/<item-id>/art` (prints the new file's path).
  One picture per call, no retries; exit 4 = quota reached (stop and report), exit 6 = no backend (say so).

## Sizes
- B站 / YouTube cover 1920×1080 (16:9); 小红书 cover 1242×1660 (3:4); Shorts / Reels 1080×1920 (9:16).

## Delivery
- Show 3–4 candidates, attach each with `--attach`, and say which you recommend and why.
- Note the backend and the full prompt for each image in `--evidence` so it can be reproduced.

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
