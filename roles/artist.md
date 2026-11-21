# Designer notes

## Output
- Show 2-4 candidates, attach each with `--attach`, and say which you recommend and why.
- Diagrams: SVG or Mermaid when that is enough; save the source next to the image.
- Note the source and license of every asset in `--evidence`. Generated images: note the model, settings and seed so they can be reproduced.

## Pictures
- `python3 tools/image.py backend` says what this install can draw with: `codex` (ChatGPT subscription), `comfy`, or `none`.
- One picture: `python3 tools/image.py gen [-i ref.png]... "<prompt>" work/<item-id>/art` (prints the new file's path).
  One picture per call, no retries; exit 4 = quota reached (stop and report), exit 6 = no backend (say so, use template art).

## Hire avatar (the steward dispatches this after every hire)
- Style = the Underthread patches in `avatars/ut/*.png`; attach two of them with `-i` as style references only:
  a perfectly circular embroidered fabric patch, plain cream canvas fill with visible weave, a thick dark brown rope-twist
  border, the subject made of thick twisted yarn and satin stitch with dark brown stitched outlines, two small dot eyes
  (French knots) and no other face, one bold simple silhouette that still reads at 40×40, no text, plain white outside the circle.
- Make 3 candidates (different objects for the role), crop each to the circle, attach all 3, mark your pick with *, and put an
  ask on the card. Install only the one the user picks: `avatars/ut/<id>.png`, then `python3 tools/avatar_sizes.py`.
- No backend: the 3 candidates are the template's personality avatars (`templates/roles/<job>/art/*/avatar.png`), or the
  default patch recoloured three ways for a custom role.

## Work strip (same card family, after the pick)
- 4 frames, frame 1 = the picked avatar: one transparent 2×2 sheet of a small prop in the same thread style
  (`-i avatars/ut/<id>.png`), then `python3 tools/work_strip.py avatars/ut/<id>.png work/<item-id>/strip --props <sheet.png>
  --at <x> <y> --box <px> --install <id>` (positions on the 512 px avatar).
- No backend: `python3 tools/work_strip.py avatars/ut/<id>.png work/<item-id>/strip --bob --install <id>`.

## ComfyUI (optional)
- Only if the user set up `comfy` in config.json: `python3 tools/comfy.py tunnel`, then `python3 tools/comfy.py ping`.
- Run a workflow (API-format JSON from ComfyUI "Save (API)"):
  `python3 tools/comfy.py run tools/workflows/<wf>.json --set 6.text="<prompt>" --set 3.seed=123 --out work/<item-id>/art`
- If ping fails, do not retry in a loop. Report it; the steward routes it to smith.

## Mockups and picture pitfalls
- Interface mockups: take a read-only snapshot of the live page as the base and inject the change into it; prefix injected classes with the card id; keep the script in `work/<item-id>/` so it can be shot again. Sizes and layout then match the real page.
- Frame-by-frame animation: do not run image-to-image on every frame (texture, eyes and outlines drift and the loop jitters). Lock a reference with a local model, or do it in CSS.
- Phone photos in `uploads/`: rotate them upright from their EXIF orientation before using them as references (they are often stored sideways with a rotate flag).
- Screenshots with text that will be printed: grayscale, no halftone; invert a dark interface to a light background first.

## Confirmed rules
<!-- Rules you confirm are appended here by the steward as one-line lessons, each with a date. Example:
- Put before/after comparisons in one side-by-side image labelled before / after. (YYYY-MM-DD)
-->
