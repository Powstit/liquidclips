// Generate the 6-frame Kade looking-up + eye-laser fire sequence
// using OpenAI gpt-image-1 with kade-shooter.png as character reference.
//
// Output: /public/brand/kade/up-sequence/kade-up-{name}.png
//
// Each frame holds the same brand kit (cyan rim, fuchsia visor, white
// body, jet thruster, transparent background) and the same character
// pose family — looking straight up — only the eye state + recoil
// changes per frame. The system instruction emphasises consistency.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error("OPENAI_API_KEY missing"); process.exit(1); }

const REF = "/tmp/kade-gen/kade-shooter.png";
const OUT_DIR = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/public/brand/kade/up-sequence",
);

const COMMON = `Same chibi 3D mascot character as the reference image. KEEP the brand kit identical: glossy white spherical helmet with a wide visor, cyan rim light around the visor edge, fuchsia-glowing eyes, black ball-joint limbs, single antenna with a small cyan tip ball, jet/thruster trail under the body, transparent background, soft Pixar-style lighting from upper-left. CAMERA: same three-quarter front angle as the reference. Pose change: the character is now LOOKING STRAIGHT UP at the sky. Tilt only the head upward — body stays grounded. No text, no UI, no badges.`;

const FRAMES = [
  {
    name: "1-idle",
    delta: `Eyes are soft fuchsia (#ff2bb0) glow at low intensity. Neutral, calm. No beams. Just looking up at something.`,
  },
  {
    name: "2-charge",
    delta: `Eyes are brighter fuchsia. Tiny seed of brighter white-pink energy forming just above each pupil — pre-charge. Subtle electrical sparks circling around the head. Visor brighter.`,
  },
  {
    name: "3-fire-start",
    delta: `Eyes are now WHITE-HOT cores with fuchsia outer halo. Two THIN faint pink-white vertical streaks just beginning to emerge from each eye and rise upward out of the top of the frame. Visor brightest. The moment of ignition.`,
  },
  {
    name: "4-fire-peak",
    delta: `Eyes pure pearl-white with sharp white centers. TWO STRONG WHITE-HOT LASER BEAMS shoot vertically straight up from each eye into the sky, leaving the top of the frame. The beams have a white-hot inner core with fuchsia outer glow. Whole visor blazes. Body still solid. Peak firing moment. The beams MUST come visually OUT of the eyes — not from above the head.`,
  },
  {
    name: "5-recoil",
    delta: `Head tilted slightly further back from the kickback of the beams. Eyes still glowing white but beams are thinner now and tapering. Faint wisps of pink-white smoke curling near the visor. Mid-recoil from a powerful shot.`,
  },
  {
    name: "6-cool",
    delta: `Eyes have cooled back to a calm fuchsia glow, slightly dimmer than the idle frame. No beams. Faint pink after-glow halo above the visor where the beams just were. Head still looking up.`,
  },
];

async function generateFrame(frame) {
  const refBytes = await readFile(REF);
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image", new Blob([refBytes], { type: "image/png" }), "kade-shooter.png");
  form.append("prompt", `${COMMON} ${frame.delta}`);
  form.append("size", "1024x1024");
  form.append("background", "transparent");
  form.append("quality", "medium");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} on ${frame.name}: ${text.slice(0, 600)}`);
  }
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no b64 returned for ${frame.name}: ${JSON.stringify(json).slice(0, 400)}`);
  const outPath = resolve(OUT_DIR, `kade-up-${frame.name}.png`);
  await writeFile(outPath, Buffer.from(b64, "base64"));
  console.log(`ok · ${frame.name} → ${outPath}`);
}

for (const frame of FRAMES) {
  process.stdout.write(`gen · ${frame.name} …`);
  await generateFrame(frame);
}
console.log("done · 6 frames");
