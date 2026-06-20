// One-shot sprite-sheet generation · 3×2 grid of Kade firing eye lasers.
// Single API call to gpt-image-1 with kade-shooter.png as character ref.
// All 6 frames painted in one context → guaranteed style consistency.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("OPENAI_API_KEY missing"); process.exit(1); }

const REF = "/tmp/kade-gen/kade-shooter.png";
const OUT_DIR = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/public/brand/kade/up-sequence",
);
await mkdir(OUT_DIR, { recursive: true });
const OUT = resolve(OUT_DIR, "spritesheet.png");

const PROMPT = `A 6-panel sprite sheet for a video game asset, 3 columns × 2 rows.

CRITICAL — BACKGROUND RULES:
- EVERY panel has a 100% pure transparent background (alpha = 0).
- NO dark backdrop, NO gradient shading, NO ground shadow, NO atmospheric haze, NO color wash behind the character.
- The character must float on pure transparent alpha like a PNG sticker.
- No grid borders, no panel frames, no boxes drawn around each panel — just pure space between panels.
- Treat this like generating sprite-sheet assets for Unity / Godot — the character is the ONLY non-transparent pixel in each panel.

THE CHARACTER — identical in every panel:
A chibi 3D mascot matching the reference: glossy white spherical helmet, wide visor with cyan rim, fuchsia-glowing eyes, black ball-joint limbs, single antenna with a small cyan tip ball. Same three-quarter front camera angle in every panel. Soft Pixar-style lighting baked into the character itself (no shadow on the background — only on the character).

Character is LOOKING STRAIGHT UP in every panel — head tilted up toward the sky. Only the eye state and head tilt change per panel:

Panel 1 (top-left): calm fuchsia eyes, idle.
Panel 2 (top-center): brighter fuchsia eyes, tiny pre-charge spark forming just above each pupil.
Panel 3 (top-right): eyes igniting white-hot with fuchsia outer halo, faint pink vertical streaks beginning to emerge from each pupil and rise upward out of the top of the cell.
Panel 4 (bottom-left): TWO STRONG WHITE-HOT VERTICAL LASER BEAMS shooting straight up from each eye, beams exit the top of the cell. Beams have white-hot inner core and fuchsia outer glow. Eyes pure white. Whole visor blazes. The beams MUST visually emerge from the EYES, not from the top of the head. Peak firing moment.
Panel 5 (bottom-center): head tilted slightly further back from beam kickback, beams thinner and tapering, faint pink-white smoke wisps curling near the visor.
Panel 6 (bottom-right): eyes cooled back to calm fuchsia glow, no beams, faint pink afterglow halo above the visor where the beams just were.

NO text, NO UI badges, NO numbers visible in the panels. NO ground, NO floor, NO shadow on the background. PURE TRANSPARENT BACKGROUND on every panel — no exceptions.`;

console.log("gen · sprite-sheet (1 call · 1536×1024 · medium quality) …");
const refBytes = await readFile(REF);
const form = new FormData();
form.append("model", "gpt-image-1");
form.append("image", new Blob([refBytes], { type: "image/png" }), "kade-shooter.png");
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
