#!/usr/bin/env node
/**
 * gen-carousel-posters · P0 first-run sprint · 2026-07-08
 *
 * Extracts a poster frame from each carousel-NN.mp4 so the WelcomeRoute
 * marquee can render `poster="/brand/home/carousel/carousel-NN.jpg"`
 * against `preload="none"` videos — poster paints instantly, mp4 fetch
 * defers until requestIdleCallback.
 *
 * Run once locally per new carousel clip; jpg outputs get checked in.
 *   node scripts/gen-carousel-posters.mjs
 *
 * Idempotent · overwrites existing jpgs · skips missing mp4s cleanly.
 * ffmpeg must be on PATH.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAROUSEL_DIR = path.resolve(__dirname, "..", "public", "brand", "home", "carousel");

// Frame timestamp — sample slightly INTO the clip (300ms) rather than
// frame-zero which is often black on TikTok-style intro fades. Good
// balance between "looks like the clip" and "avoids first-frame blank".
const POSTER_TS = "00:00:00.300";
// JPEG quality 3 = ~85% (ffmpeg mjpeg -q:v scale). Small enough to load
// instantly (~15-30 KB per tile at 246×432); crisp enough to look real.
const JPEG_Q = "3";

async function main() {
  let entries;
  try {
    entries = await readdir(CAROUSEL_DIR);
  } catch (err) {
    console.error(`[gen-posters] carousel dir missing · ${CAROUSEL_DIR}`);
    process.exit(1);
  }

  const mp4s = entries.filter((f) => /^carousel-\d+\.mp4$/i.test(f)).sort();
  if (mp4s.length === 0) {
    console.log(`[gen-posters] no carousel-NN.mp4 files in ${CAROUSEL_DIR}`);
    return;
  }

  console.log(`[gen-posters] generating ${mp4s.length} posters...`);
  let ok = 0;
  let fail = 0;

  await Promise.all(
    mp4s.map(async (mp4) => {
      const src = path.join(CAROUSEL_DIR, mp4);
      const dst = path.join(CAROUSEL_DIR, mp4.replace(/\.mp4$/i, ".jpg"));
      try {
        await exec("ffmpeg", [
          "-y",
          "-ss", POSTER_TS,
          "-i", src,
          "-frames:v", "1",
          "-q:v", JPEG_Q,
          dst,
        ]);
        const s = await stat(dst);
        console.log(`  ✓ ${mp4.replace(/\.mp4$/, ".jpg")} · ${(s.size / 1024).toFixed(1)}KB`);
        ok += 1;
      } catch (err) {
        console.error(`  ✗ ${mp4} · ${err.message?.slice(0, 200) ?? err}`);
        fail += 1;
      }
    }),
  );

  console.log(`[gen-posters] done · ${ok} generated · ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
