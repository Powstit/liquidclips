#!/usr/bin/env node
/**
 * mirror-demos.mjs · pre-build step for the marketing site.
 *
 * Copies desktop-2/public/demos/*.mp4 into liquidclips-marketing/
 * public/demos/ and emits a manifest.json listing slug + duration +
 * size + pricing_baseline for HQ's command center to consume at
 * https://liquidclips.app/demos/manifest.json.
 *
 * Runs from the marketing package.json build script as
 * `node scripts/mirror-demos.mjs`. Idempotent — safe to re-run.
 *
 * If the desktop-2 demos folder is missing (fresh clone · CI without
 * a co-located working tree), the script logs a warning and exits 0
 * so the marketing build never breaks on a missing sibling.
 */

import { mkdir, copyFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = resolve(__dirname, "../../desktop-2/public/demos");
const DEST_DIR = resolve(__dirname, "../public/demos");
const MANIFEST_PATH = join(DEST_DIR, "manifest.json");

async function ffprobeDuration(mp4Path) {
  // Best-effort — ffprobe may not be on PATH in every build environment.
  // A missing duration renders as null in the manifest.
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      mp4Path,
    ]);
    const secs = parseFloat(stdout.trim());
    return Number.isFinite(secs) ? Math.round(secs * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.warn(`[mirror-demos] source dir missing · ${SRC_DIR} · skipping (build stays green)`);
    process.exit(0);
  }

  await mkdir(DEST_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".mp4"));
  if (files.length === 0) {
    console.warn(`[mirror-demos] no *.mp4 files found in ${SRC_DIR}`);
    // Still emit an empty manifest so HQ's poll returns a valid JSON shape.
    await writeFile(
      MANIFEST_PATH,
      JSON.stringify({ demos: [], generated_at: new Date().toISOString() }, null, 2),
    );
    process.exit(0);
  }

  const entries = [];
  for (const filename of files.sort()) {
    const srcPath = join(SRC_DIR, filename);
    const destPath = join(DEST_DIR, filename);
    await copyFile(srcPath, destPath);
    const st = await stat(destPath);
    const duration_s = await ffprobeDuration(destPath);
    const slug = filename.replace(/\.mp4$/i, "");
    entries.push({
      slug,
      filename,
      url: `/demos/${filename}`,
      duration_s,
      size_bytes: st.size,
      pricing_baseline: "usd_99_99",
    });
    console.log(
      `[mirror-demos] ${filename} · ${(st.size / 1024 / 1024).toFixed(2)}MB · ${duration_s ?? "?"}s`,
    );
  }

  const manifest = {
    demos: entries,
    generated_at: new Date().toISOString(),
    source_repo: "desktop-2/public/demos",
    pricing_baseline_default: "usd_99_99",
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`[mirror-demos] wrote ${MANIFEST_PATH} · ${entries.length} demos`);
}

main().catch((err) => {
  console.error("[mirror-demos] failed:", err);
  // Don't fail the build — the marketing site can ship without demos.
  process.exit(0);
});
