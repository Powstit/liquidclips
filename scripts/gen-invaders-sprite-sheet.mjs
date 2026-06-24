// One-shot sprite-sheet generation for the Liquid Clips SplashGame.
// Uses /v1/images/edits with kade-base.png as character anchor to prevent
// character drift across regenerations (Daniel: "try and edit the original
// prompt so images dont drift" — 2026-06-23).
//
// 12-cell grid (4×3) on 1536×1024, visible white gridlines.
// First 3 cells = Kade-ship variants (anchored character).
// Remaining 9 cells = pixel-art bug enemies (NOT the anchored character).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("OPENAI_API_KEY missing"); process.exit(1); }

const REF = "/Users/dipdip/code/jnr/desktop-2/public/brand/kade/kade-base.png";
const OUT_DIR = resolve(
  "/Users/dipdip/code/jnr/desktop-2/public/brand/invaders/v2",
);
await mkdir(OUT_DIR, { recursive: true });
const OUT = resolve(OUT_DIR, "spritesheet.png");

const PROMPT = `A 12-cell sprite-sheet reference card for a Space Invaders arcade game, 4 columns × 3 rows, with THIN WHITE GRIDLINES drawn between every cell so cropping is precise. Each cell is EXACTLY the same size and contains EXACTLY ONE pixel-art sprite centered in its cell, scaled to fill ~70% of the cell width.

CRITICAL — GRID DISCIPLINE:
- Render visible thin 2-pixel WHITE gridlines forming the 4×3 grid (3 vertical lines, 2 horizontal lines).
- Each of the 12 cells is exactly the same size: cellWidth = sheetWidth / 4, cellHeight = sheetHeight / 3.
- One sprite per cell. Centered. ~70% cell-fill. No sprite crosses a gridline.
- Cells are numbered top-left to bottom-right, row-major: 1,2,3,4 / 5,6,7,8 / 9,10,11,12.

CRITICAL — BACKGROUND RULES:
- The area INSIDE each cell (but outside the sprite) is 100% pure transparent alpha.
- The gridlines themselves are visible thin white pixels — those crop out cleanly with an inner-margin crop.
- NO ground shadows, NO atmospheric haze, NO gradients behind sprites.
- Each sprite floats on pure transparent alpha like a PNG sticker for Unity/Godot import.

CRITICAL — REGISTER:
- PIXEL ART. CHUNKY 1-bit-style pixels. Clean hard edges. NO anti-aliasing inside the sprite.
- 8-bit / 16-bit arcade aesthetic in the spirit of Galaga, Phoenix, classic Space Invaders.
- The pixel grid should be visibly chunky — each sprite reads as roughly 24-32 pixels on its largest side, even though the cell is bigger.
- NO 3D rendering, NO Pixar/CGI shading, NO soft gradients, NO illustrated character art.

LOCKED PALETTE — only these colors appear in any sprite:
- White       #FFFFFF
- Fuchsia     #FF1A8C
- Fuchsia hi  #FF66B8 (light pink for highlights)
- Cyan        #00E5FF
- Shadow      #0B0B10 (dark ink for outlines)

THE PLAYER SPRITE (Kade-the-ship) — IDENTITY ANCHORED TO THE REFERENCE IMAGE:
The reference image is the canonical Kade-the-robot: glossy white helmet, cyan-rimmed visor, two fuchsia-glowing eyes, cyan antenna tip, white-paneled body. Translate THIS SPECIFIC CHARACTER into pixel-art form, then put him as the pilot of a small pixel fighter ship.

Pixel-art Kade-ship spec:
- White pixel hull with fuchsia trim, seen from behind/3rd person above (top-down with slight forward tilt — player POV in Space Invaders).
- COCKPIT WINDOW at the top-center of the hull: a tiny pixel rendering of the reference Kade's face peeking out — the SAME helmet shape, SAME two fuchsia eye pixels, SAME cyan antenna pixel-tip. Recognisably the reference character, just pixelated.
- Small angular wings either side, fuchsia jet-flame pixels at base.
- NO LASERS COMING FROM THE EYES. The reference character's eyes GLOW but they do NOT shoot beams. Kade sits INSIDE the cockpit, behind a glass dome. The ship's guns are pixel-art barrels at the FRONT of the hull, NOT on his face.

THE ENEMY SPRITES — DO NOT use the reference character for these cells:
The reference image ONLY anchors the player ship (cells 1-3). For cells 4-12, generate ORIGINAL pixel-art Space Invaders enemies (chunky alien-bug pixel forms), NOT the white-and-fuchsia Kade character. The enemies are matte-black bugs with cyan eyes and fuchsia outlines — clearly NOT the reference character.

CELL CONTENTS — exactly these 12 sprites, one per cell, centered in cell:

Cell 1 · KADE-SHIP IDLE: small pixel fighter ship seen from rear, white hull, fuchsia trim, tiny Kade-robot face (two fuchsia eye-pixels, cyan antenna tip) peeking from cockpit window at top, small wings, fuchsia jet-flame at base. NO eye lasers.

Cell 2 · KADE-SHIP FIRE: same ship, calm eyes still in cockpit, white-fuchsia muzzle flash from front gun barrels of ship hull pointing UP. NO eye lasers.

Cell 3 · KADE-SHIP HIT: same ship damaged, body flashed white-fuchsia from impact, one wing chipped pixel-art-style.

Cell 4 · BUG-GRUNT-A: chunky pixel beetle, matte-black body, fuchsia outline, two cyan eye-pixels, legs in stride-A.

Cell 5 · BUG-GRUNT-B: same beetle, legs in stride-B (mirror).

Cell 6 · BUG-SPIDER-A: pixel spider, black with fuchsia outline, eight legs in radial-A position, two cyan eye-pixels.

Cell 7 · BUG-SPIDER-B: same spider, legs in radial-B position.

Cell 8 · BUG-GLITCH-A: ant-shaped pixel pest, black-and-fuchsia, white electric-spark pixels rising from back, cyan eyes, sparks in position A.

Cell 9 · BUG-GLITCH-B: same glitch bug, sparks in position B.

Cell 10 · BUG-MOTHBUG-A: winged pixel moth, black body, fuchsia outline, wide cyan-edged wings UP, two cyan eye-pixels. Wider than other bugs (occupies more of its cell width).

Cell 11 · BUG-MOTHBUG-B: same moth, wings DOWN.

Cell 12 · BUG-RULEBREAK: chunky larger pixel enemy, red-fuchsia body tint (more red than other bugs — the rule-breaker class), small fuchsia outline, two cyan eye-pixels.

NO text anywhere. NO numbers. NO UI badges. NO labels. ONLY the thin white gridlines + 12 centered sprites. No other non-transparent pixels.`;

console.log("gen · invaders sprite sheet via EDITS endpoint (1 call · 1536×1024 · medium · anchored to kade-base.png) …");

const refBytes = await readFile(REF);
const form = new FormData();
form.append("model", "gpt-image-1");
form.append("image", new Blob([refBytes], { type: "image/png" }), "kade-base.png");
form.append("prompt", PROMPT);
form.append("size", "1536x1024");
form.append("background", "transparent");
form.append("quality", "medium");

const res = await fetch("https://api.openai.com/v1/images/edits", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}` },
  body: form,
});

if (!res.ok) {
  const text = await res.text();
  console.error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  process.exit(1);
}

const json = await res.json();
const b64 = json.data?.[0]?.b64_json;
if (!b64) {
  console.error("no b64 returned:", JSON.stringify(json).slice(0, 400));
  process.exit(1);
}

await writeFile(OUT, Buffer.from(b64, "base64"));
const stats = await import("node:fs").then((m) => m.promises.stat(OUT));
console.log(`ok · ${OUT} (${Math.round(stats.size / 1024)} KB)`);
