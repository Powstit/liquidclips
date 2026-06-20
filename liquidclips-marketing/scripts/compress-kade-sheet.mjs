// Compress the sprite sheet to WebP for serve-time efficiency.
// The full-resolution PNG is what gets used in CSS via background-image,
// so we WebP it without changing dimensions. Saves ~60-70%.
import sharp from "sharp";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const DIR = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/public/brand/kade/up-sequence",
);
const SHEET_PNG = resolve(DIR, "spritesheet.png");
const SHEET_WEBP = resolve(DIR, "spritesheet.webp");

await sharp(SHEET_PNG)
  .webp({ quality: 88, alphaQuality: 90, effort: 6 })
  .toFile(SHEET_WEBP);

const a = await stat(SHEET_PNG);
const b = await stat(SHEET_WEBP);
console.log(`PNG  ${Math.round(a.size / 1024)} KB → WebP ${Math.round(b.size / 1024)} KB (${Math.round((1 - b.size / a.size) * 100)}% smaller)`);
