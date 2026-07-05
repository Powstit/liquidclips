// Fetches YouTube storyboard sprite sheets for a given videoId and slices
// out N frames as individual JPEGs. Feeds Preview.tsx's `frameUrls` prop.
//
// USAGE:
//   npx tsx scripts/fetch-storyboard.ts <videoId> <outDir> [--count 8]
//
// STORYBOARD URL SHAPE (public, no API key):
//   https://i.ytimg.com/sb/<videoId>/storyboard3_L2/M0.jpg
//   Multiple sprite sheets exist: M0.jpg, M1.jpg, M2.jpg, ...
//   Each is a 10-wide grid of scrub-thumbnails.
//
// KNOWN LIMITS:
//   - Videos < ~30s may not have storyboards. Fallback to maxresdefault.jpg.
//   - YT sometimes rotates the storyboard version (L1 / L2 / L3). Try all.

import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SPRITE_LEVELS = ["storyboard3_L2", "storyboard3_L1", "storyboard3_L0"];
const SPRITE_INDEX_MAX = 6;

async function fetchSprite(videoId: string): Promise<Buffer | null> {
  for (const level of SPRITE_LEVELS) {
    for (let m = 0; m < SPRITE_INDEX_MAX; m++) {
      const url = `https://i.ytimg.com/sb/${videoId}/${level}/M${m}.jpg`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 5000) return buf;
        }
      } catch {}
    }
  }
  return null;
}

async function fallbackThumb(videoId: string): Promise<Buffer | null> {
  const url = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  try {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  } catch {}
  return null;
}

async function main() {
  const [videoId, outDir, ...rest] = process.argv.slice(2);
  if (!videoId || !outDir) {
    console.error("Usage: tsx fetch-storyboard.ts <videoId> <outDir> [--count 8]");
    process.exit(1);
  }
  const countArg = rest.indexOf("--count");
  const count = countArg >= 0 ? Number(rest[countArg + 1]) : 8;

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spriteBuf = await fetchSprite(videoId);
  if (spriteBuf) {
    const meta = await sharp(spriteBuf).metadata();
    const w = meta.width ?? 1600;
    const h = meta.height ?? 900;
    const cols = 10;
    const rows = Math.max(1, Math.floor((h / w) * cols));
    const tileW = Math.floor(w / cols);
    const tileH = Math.floor(h / rows);
    const total = cols * rows;
    const step = Math.max(1, Math.floor(total / count));

    for (let i = 0; i < count; i++) {
      const idx = Math.min(total - 1, i * step);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const outPath = path.join(outDir, `frame-${String(i).padStart(2, "0")}.jpg`);
      await sharp(spriteBuf)
        .extract({ left: col * tileW, top: row * tileH, width: tileW, height: tileH })
        .resize(640, 360, { fit: "cover" })
        .jpeg({ quality: 85 })
        .toFile(outPath);
      console.log("wrote", outPath);
    }
    return;
  }

  const thumb = await fallbackThumb(videoId);
  if (!thumb) {
    console.error("No storyboard AND no thumbnail available for", videoId);
    process.exit(2);
  }
  console.warn("Storyboard unavailable, using maxresdefault fallback for all frames");
  for (let i = 0; i < count; i++) {
    const outPath = path.join(outDir, `frame-${String(i).padStart(2, "0")}.jpg`);
    await writeFile(outPath, thumb);
    console.log("wrote (fallback)", outPath);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
