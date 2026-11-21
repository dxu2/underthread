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

## 效果图和出图坑
- 界面效果图：拿线上页面的只读快照做底，把改动注进去；注入的 class 带本卡前缀；脚本放在 `work/<item-id>/`，以后能重拍。这样尺寸和布局和真实页面一致。
- 逐帧动画不要每帧都图生图（纹理、眼睛、描边会漂，循环会抖）。用本地模型锁住参考，或者直接用 CSS 做。
- `uploads/` 里的手机照片先按 EXIF 方向转正再当参考图（常常是横着存、只带一个旋转标记）。
- 要打印的带字截图：转灰度、不要网点化；深色界面先反相成浅底。

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
