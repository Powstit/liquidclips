// Crop the 1536×1024 sprite-sheet into 6 individual 512×512 PNGs.
// Inner margin avoids any model-drawn gridline bleed.
import sharp from "sharp";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const DIR = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/public/brand/kade/up-sequence",
);
const SHEET = resolve(DIR, "spritesheet.png");

const meta = await sharp(SHEET).metadata();
console.log(`sheet · ${meta.width}×${meta.height} · ${meta.format} · ${meta.hasAlpha ? "alpha" : "no alpha"}`);

const CELL_W = Math.floor(meta.width / 3);   // 512
const CELL_H = Math.floor(meta.height / 2);  // 512
const MARGIN = 8;                            // shave gridline

for (let i = 0; i < 6; i++) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const out = resolve(DIR, `kade-up-${i + 1}.png`);
  await sharp(SHEET)
    .extract({
      left:   col * CELL_W + MARGIN,
      top:    row * CELL_H + MARGIN,
      width:  CELL_W - MARGIN * 2,
      height: CELL_H - MARGIN * 2,
    })
    .toFile(out);
  const s = await stat(out);
  console.log(`ok · kade-up-${i + 1}.png (${Math.round(s.size / 1024)} KB · ${CELL_W - MARGIN * 2}×${CELL_H - MARGIN * 2})`);
}
console.log("done · 6 frames cropped");
