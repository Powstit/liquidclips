// Render CLI · Remotion composition → MP4 or WebM (alpha).
//
// USAGE:
//   Old HQ preview mode:
//     npx tsx scripts/render.ts <propsJsonPath> <outMp4Path>
//   New agency overlay mode (WebM VP9 with alpha):
//     npx tsx scripts/render.ts --composition=AgencyOverlay --format=webm-alpha \
//       <propsJsonPath> <outWebmPath>
//
// 2026-07-05 · CM lane addition · alpha-channel output path for the
// agency-watermark overlay. HQ's original preview render (full-frame
// MP4) preserved as the default when no --composition flag is passed.

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface ParsedArgs {
  composition: string;
  format: "mp4" | "webm-alpha";
  propsPath: string;
  outPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [k, v] = raw.slice(2).split("=");
      flags[k] = v ?? "true";
    } else {
      positional.push(raw);
    }
  }
  const composition = flags.composition ?? "Preview";
  const format = (flags.format ?? "mp4") as "mp4" | "webm-alpha";
  const [propsPath, outPath] = positional;
  if (!propsPath || !outPath) {
    console.error("Usage: tsx render.ts [--composition=<id>] [--format=mp4|webm-alpha] <props.json> <out>");
    process.exit(1);
  }
  return { composition, format, propsPath, outPath };
}

async function main() {
  const { composition, format, propsPath, outPath } = parseArgs(process.argv.slice(2));

  const inputProps = JSON.parse(await readFile(propsPath, "utf-8"));

  console.log(`Bundling Remotion project (composition="${composition}", format="${format}")...`);
  const bundleLocation = await bundle({
    entryPoint: path.resolve(process.cwd(), "src/index.ts"),
    onProgress: (p) => process.stdout.write(`\rbundle: ${p}%`),
  });
  console.log("");

  const comp = await selectComposition({
    serveUrl: bundleLocation,
    id: composition,
    inputProps,
  });

  console.log("Rendering to", outPath);
  if (format === "webm-alpha") {
    // ProRes 4444 MOV · industry-standard alpha container. Both VP8
    // and VP9 alpha silently dropped the alpha channel through the
    // Remotion-bundled ffmpeg (yuva420p fell back to yuv420p in both
    // cases). ProRes 4444 with yuva444p10le is universally supported
    // for transparent video and works cleanly with ffmpeg's overlay
    // filter at the desktop sidecar bake step. File is larger than
    // WebM but the desktop app compositing is local — bandwidth cost
    // is zero. Image format MUST be PNG for the source frames to
    // carry alpha into the encoder.
    await renderMedia({
      composition: comp,
      serveUrl: bundleLocation,
      codec: "prores",
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png",
      outputLocation: outPath,
      inputProps,
      onProgress: ({ progress }) => process.stdout.write(`\rrender: ${(progress * 100).toFixed(0)}%`),
    });
  } else {
    // HQ's original H264 MP4 path · preserved as the default.
    await renderMedia({
      composition: comp,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      onProgress: ({ progress }) => process.stdout.write(`\rrender: ${(progress * 100).toFixed(0)}%`),
    });
  }
  console.log("\ndone");
}

main().catch((e) => { console.error(e); process.exit(1); });
