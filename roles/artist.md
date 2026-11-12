# Designer notes

## Output
- Show 2-4 candidates, attach each with `--attach`, and say which you recommend and why.
- Diagrams: SVG or Mermaid when that is enough; save the source next to the image.
- Note the source and license of every asset in `--evidence`. Generated images: note the model, settings and seed so they can be reproduced.

## ComfyUI (optional)
- Only if the user set up `comfy` in config.json: `python3 tools/comfy.py tunnel`, then `python3 tools/comfy.py ping`.
- Run a workflow (API-format JSON from ComfyUI "Save (API)"):
  `python3 tools/comfy.py run tools/workflows/<wf>.json --set 6.text="<prompt>" --set 3.seed=123 --out work/<item-id>/art`
- If ping fails, do not retry in a loop. Report it; the steward routes it to smith.

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
