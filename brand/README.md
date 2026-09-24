# Brand assets

- **`mark.svg`** / **`logo.svg`** — the actual logo, hand-drawn as flat SVG. The mark is an
  accountant's reconciliation tick (asymmetric: short stroke in, long stroke out — not a symmetric
  Unicode checkmark), paired with a double-rule underline that's the same motif the product uses
  elsewhere to mark a Settled invoice. This is the real logo everywhere in the UI (nav, favicon).
- **`favicon-512.png`** / **`og-image.png`** — rendered with Blender (`render_final.py`) for the PNG
  favicon fallback (iOS home-screen icons need a raster format) and the social link-preview image.
  These are supplementary; the SVG mark above is the canonical logo.

## Rendering

```bash
"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python render_final.py
```

Regenerates both PNGs from the same brand hex values as the SVG and the site's Tailwind config
(`apps/web/tailwind.config.ts`) — keep all three in sync if the palette ever changes.

**One thing worth knowing if you touch this script:** Blender's color inputs (Emission Color, Base
Color, a world Background node) expect *linear* color, not sRGB. Passing a hex color's naive
`/255` float straight in looks reasonable in the script but renders visibly wrong — lighter and more
saturated than the real hex, because Blender re-gamma-encodes an already-sRGB value. `hex_to_linear_rgba()`
in `render_final.py` does the correct sRGB→linear conversion; don't skip it for a "quick" color tweak.
