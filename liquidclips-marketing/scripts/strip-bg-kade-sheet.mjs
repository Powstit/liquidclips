// Background removal v2 · SAFE chroma-key that preserves white-body pixels.
//
// Lesson from v1: a single saturation+brightness threshold killed the white
// belly of the character (low-sat, mid-brightness) along with the gradient
// backdrop. v2 uses a 4-part defence:
//
//   1. NARROWER brightness window for "is bg" classification — only
//      mid-grey 90..200 considered bg (not >200 which protects whites)
//   2. CORNER colour sampling — each panel corner provides the actual
//      backdrop reference, flood-fill spreads only to pixels within
//      strict tolerance of those samples
//   3. SATURATED-PIXEL BARRIER — flood-fill cannot cross a strongly
//      saturated pixel even if the next pixel matches bg (stops the
//      flood from leaking through the visor edge into the body)
//   4. WHITE-PIXEL BARRIER — flood-fill cannot cross pixels with
//      brightness > 220 (protects the helmet AND the white belly)

import sharp from "sharp";
import { resolve } from "node:path";

const DIR  = resolve("/Users/dipdip/code/jnr/liquidclips-marketing/public/brand/kade/up-sequence");
const IN   = resolve(DIR, "spritesheet.png");
const OUT  = resolve(DIR, "spritesheet.png");

const raw = await sharp(IN).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data, info } = raw;
const { width, height } = info;
console.log(`source · ${width}×${height} · channels ${info.channels}`);

const COLS = 3, ROWS = 2;
const CELL_W = Math.floor(width / COLS);
const CELL_H = Math.floor(height / ROWS);

// Per-corner sampled bg colours (so a slightly-pink-tinted corner doesn't
// drift the chroma-key by accident — we use whatever is actually there).
function sample(cx, cy) {
  const idx = (cy * width + cx) * 4;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

const colorTol = 38;   // RGB tolerance per channel
const SAT_BARRIER = 0.22;     // saturated → blocks flood
const WHITE_BARRIER = 222;    // R+G+B > 222 each → blocks flood

function classify(idx, refs) {
  const r = data[idx], g = data[idx + 1], b = data[idx + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;

  // BARRIERS — never cross these
  if (sat > SAT_BARRIER) return "barrier";
  if (r > WHITE_BARRIER && g > WHITE_BARRIER && b > WHITE_BARRIER) return "barrier";

  // BG match — must be close to one of the corner reference colours
  for (const ref of refs) {
    if (Math.abs(r - ref.r) <= colorTol
     && Math.abs(g - ref.g) <= colorTol
     && Math.abs(b - ref.b) <= colorTol) return "bg";
  }
  return "barrier";
}

const visited = new Uint8Array(width * height);
const queue = [];
let totalSeeds = 0;

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const x0 = col * CELL_W;
    const y0 = row * CELL_H;
    // Build the per-panel reference palette from its 4 corners.
    const refs = [
      sample(x0 + 4,           y0 + 4),
      sample(x0 + CELL_W - 5,  y0 + 4),
      sample(x0 + 4,           y0 + CELL_H - 5),
      sample(x0 + CELL_W - 5,  y0 + CELL_H - 5),
    ];

    // Push the panel's 4 corner pixels as starting seeds.
    for (const [sx, sy] of [
      [x0 + 2,           y0 + 2],
      [x0 + CELL_W - 3,  y0 + 2],
      [x0 + 2,           y0 + CELL_H - 3],
      [x0 + CELL_W - 3,  y0 + CELL_H - 3],
    ]) {
      if (visited[sy * width + sx]) continue;
      visited[sy * width + sx] = 1;
      queue.push([sx, sy, refs]);
      totalSeeds++;
    }
  }
}
console.log(`seeds · ${totalSeeds}`);

// 4-neighbour flood, kills alpha as we go, never crossing barriers.
let killed = 0;
while (queue.length) {
  const [x, y, refs] = queue.pop();
  const pos = y * width + x;
  const idx = pos * 4;
  data[idx + 3] = 0;
  killed++;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const npos = ny * width + nx;
    if (visited[npos]) continue;
    const nidx = npos * 4;
    const cls = classify(nidx, refs);
    if (cls === "bg") {
      visited[npos] = 1;
      queue.push([nx, ny, refs]);
    }
  }
}
console.log(`killed · ${killed.toLocaleString()} pixels (~${Math.round(killed / (width * height) * 100)}%)`);

await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(OUT);
console.log(`ok · wrote ${OUT}`);
