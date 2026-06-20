// Convert the 6 cropped PNG frames into small WebPs for Motion crossfading.
// Individual frames are loaded once each, Motion just animates opacity.
import sharp from "sharp";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const DIR = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/public/brand/kade/up-sequence",
);

let total = 0;
for (let i = 1; i <= 6; i++) {
  const png  = resolve(DIR, `kade-up-${i}.png`);
  const webp = resolve(DIR, `kade-up-${i}.webp`);
  await sharp(png).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(webp);
  const s = await stat(webp);
  total += s.size;
  console.log(`ok · kade-up-${i}.webp (${Math.round(s.size / 1024)} KB)`);
}
console.log(`total · ${Math.round(total / 1024)} KB across 6 frames`);
