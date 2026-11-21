# 美术 · Artist notes

## ComfyUI on your GPU machine
- The tunnel: `python3 tools/comfy.py tunnel` (starts `ssh -N -L` in the background), then `python3 tools/comfy.py ping`.
- Run a workflow (API-format JSON exported from ComfyUI via "Save (API)"):
  `python3 tools/comfy.py run tools/workflows/<wf>.json --set 6.text="<prompt>" --set 3.seed=123 --out work/<item-id>/art`
- `--set NODE.INPUT=VALUE` patches a node input. Look up node ids in the workflow JSON.
- If ping fails, do not retry in a loop. Report it and the manager will route it to smith.

## Sizes
- B站 / YouTube cover 1920×1080 (16:9); 小红书 cover 1242×1660 (3:4); Shorts / Reels 1080×1920 (9:16).

## Delivery
- Show 3–4 candidates, attach each with `--attach`, and say which you recommend and why.
- Note model + LoRA + seed for each image in `--evidence` so it can be reproduced.

## 效果图和出图坑
- 界面效果图：拿线上页面的只读快照做底，把改动注进去；注入的 class 带本卡前缀；脚本放在 `work/<item-id>/`，以后能重拍。这样尺寸和布局和真实页面一致。
- 逐帧动画不要每帧都图生图（纹理、眼睛、描边会漂，循环会抖）。用本地模型锁住参考，或者直接用 CSS 做。
- `uploads/` 里的手机照片先按 EXIF 方向转正再当参考图（常常是横着存、只带一个旋转标记）。
- 要打印的带字截图：转灰度、不要网点化；深色界面先反相成浅底。

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
