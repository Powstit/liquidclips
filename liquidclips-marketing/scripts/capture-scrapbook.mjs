// Capture the scrapbook scene at every phase of the 6s laser cycle.
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
    "--user-data-dir=/tmp/puppeteer-scrapbook",
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
      .lc-sb-hero,
      .lc-sb-beam,
      .lc-sb-target {
        animation-delay: -${animationDelayMs}ms !important;
        animation-play-state: paused !important;
      }
    `,
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/SCRAPBOOK-${label}.png` });
  console.log("ok · SCRAPBOOK-" + label);
}

// 6s cycle. Sample at every phase boundary:
//   0s     · rest
//   1.1s   · charge ramp
//   1.6s   · fire ignition
//   2.0s   · beam at full, just before impact
//   2.2s   · IMPACT (invader white-hot flash + scale)
//   2.6s   · invader gone, beam at full
//   4.5s   · fade
//   5.6s   · respawn pop
await capturePhase("1-rest",       0);
await capturePhase("2-charge",  1100);
await capturePhase("3-fire",    1600);
await capturePhase("4-impact",  1900);
await capturePhase("5-explode", 2200);
await capturePhase("6-hold",    3500);
await capturePhase("7-fade",    4700);
await capturePhase("8-respawn", 5500);

// Reduced-motion sanity
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/SCRAPBOOK-9-reduced-motion.png` });
console.log("ok · SCRAPBOOK-9-reduced-motion");

// Form readability + clickability check
const interact = await page.evaluate(() => {
  const el = document.querySelector(".lc-fc-email-input");
  if (!el) return { exists: false };
  el.focus();
  return {
    exists: true,
    focused: document.activeElement === el,
  };
});
console.log("\nform email focusable:", interact);

// Load speed
const perf = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return {
    dcl:  n ? Math.round(n.domContentLoadedEventEnd - n.startTime) : null,
    load: n ? Math.round(n.loadEventEnd - n.startTime) : null,
  };
});
console.log(`load · DOMContentLoaded ${perf.dcl}ms · load ${perf.load}ms`);

await browser.close();
console.log("done · " + OUT);
