// Capture the sprite-sheet flipbook at every frame slot.
import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3043";
const OUT = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/docs/audit-screenshots",
);
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: VIEWPORT,
  args: [
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--user-data-dir=/tmp/puppeteer-flipbook",
    "--no-first-run",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("pageerror", () => {});

async function capturePhase(label, animationDelayMs) {
  await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.addStyleTag({
    content: `
      .lc-sb-hero--flipbook,
      .lc-sb-target {
        animation-delay: -${animationDelayMs}ms !important;
        animation-play-state: paused !important;
      }
    `,
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/FLIPBOOK-${label}.png` });
  console.log("ok · FLIPBOOK-" + label);
}

// 6s cycle, 6 frames at ~1s each
await capturePhase("1-idle",       500);
await capturePhase("2-charge",    1500);
await capturePhase("3-brighter",  2500);
await capturePhase("4-peak-fire", 3500);   // explosion frame
await capturePhase("5-recoil",    4500);
await capturePhase("6-cool",      5500);

// Reduced-motion freeze
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/FLIPBOOK-7-reduced-motion.png` });
console.log("ok · FLIPBOOK-7-reduced-motion");

// Form clickability + load probe
const interact = await page.evaluate(() => {
  const el = document.querySelector(".lc-fc-email-input");
  if (!el) return { exists: false };
  el.focus();
  return { exists: true, focused: document.activeElement === el };
});
const perf = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return {
    dcl:  n ? Math.round(n.domContentLoadedEventEnd - n.startTime) : null,
    load: n ? Math.round(n.loadEventEnd - n.startTime) : null,
  };
});
console.log("\nemail focusable:", interact);
console.log(`load · DOMContentLoaded ${perf.dcl}ms · load ${perf.load}ms`);

await browser.close();
console.log("done · " + OUT);
