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

## Confirmed rules
<!-- 你确认过的长期规则会由管家以 lesson 的形式追加在这里，每条一行，带日期。例：
- 前后对比只放一张并排图，标注 before / after。 (YYYY-MM-DD)
-->
