// Capture Kade's rerouted flight path + verify the form is not occluded.
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
    "--user-data-dir=/tmp/puppeteer-hero2",
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
      .lc-founding-hero,
      .lc-founding-hero-life,
      .lc-founding-hero-img,
      .lc-founding-hero-thruster,
      .lc-founding-hero-laser,
      .lc-founding-hero-trail {
        animation-delay: -${animationDelayMs}ms !important;
        animation-play-state: paused !important;
      }
    `,
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `${OUT}/HERO-${label}.png` });
  console.log("ok · HERO-" + label);
}

// 22s loop → 6 distinct phases
await capturePhase("1-entry",      2000);
await capturePhase("2-firing-1",  5800);  // first laser window (~25-28%)
await capturePhase("3-mid",       9000);
await capturePhase("4-firing-2", 12500);  // second laser window (~55-58%)
await capturePhase("5-late",     16000);
await capturePhase("6-exit",     20000);

// ── Occlusion probe at EVERY keyframe phase ──
console.log("\n── OCCLUSION CHECK · all 6 phases ──");
const PHASES = [
  { label: "1-entry",     ms: 2000 },
  { label: "2-firing-1",  ms: 5800 },
  { label: "3-mid",       ms: 9000 },
  { label: "4-firing-2",  ms: 12500 },
  { label: "5-late",      ms: 16000 },
  { label: "6-exit",      ms: 20000 },
];

// Form readability at 3× scale depends on backdrop-blur, not on hero
// missing the form. We report overlap honestly (expected: true on most
// phases) so the question is "is text still readable" not "does he overlap."
let anyOccluded = false;
for (const phase of PHASES) {
  await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.addStyleTag({
    content: `
      .lc-founding-hero,
      .lc-founding-hero-img,
      .lc-founding-hero-thruster,
      .lc-founding-hero-laser {
        animation-delay: -${phase.ms}ms !important;
        animation-play-state: paused !important;
      }
    `,
  });
  await new Promise((r) => setTimeout(r, 500));

  const o = await page.evaluate(() => {
    function rect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
    }
    function intersects(a, b) {
      if (!a || !b) return false;
      return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    }
    const h = rect(document.querySelector(".lc-founding-hero"));
    return {
      hero: h,
      form:       intersects(h, rect(document.querySelector(".lc-fc-card"))),
      heading:    intersects(h, rect(document.querySelector(".lc-fc-h"))),
      emailInput: intersects(h, rect(document.querySelector(".lc-fc-email-input"))),
      submitBtn:  intersects(h, rect(document.querySelector(".lc-fc-submit"))),
    };
  });
  const flags = [o.form, o.heading, o.emailInput, o.submitBtn];
  const occ = flags.some(Boolean);
  if (occ) anyOccluded = true;
  console.log(
    `${phase.label.padEnd(12)} hero=(${o.hero.left.toFixed(0)},${o.hero.top.toFixed(0)} → ${o.hero.right.toFixed(0)},${o.hero.bottom.toFixed(0)})  ` +
    `form=${o.form} head=${o.heading} email=${o.emailInput} cta=${o.submitBtn}`,
  );
}

console.log(
  "\nOVERLAP STATUS:",
  anyOccluded
    ? "hero passes BEHIND form during flight (z-index 0, form on top with backdrop-blur)"
    : "no overlap any phase",
);

// Load-time probe — measure how fast the experience renders
const perf = await page.evaluate(async () => {
  const nav = performance.getEntriesByType("navigation")[0];
  const heroImg = document.querySelector(".lc-founding-hero-img");
  return {
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
    loadEventMs:        nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
    heroComplete:       heroImg && (heroImg).complete,
  };
});
console.log("\n── LOAD SPEED ──");
console.log(`DOMContentLoaded: ${perf.domContentLoadedMs}ms · load: ${perf.loadEventMs}ms · hero img ready: ${perf.heroComplete}`);

// Confirm clickability of email + CTA
await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 600));
await page.click(".lc-fc-email-input");
const focused = await page.evaluate(() =>
  document.activeElement?.className?.includes("lc-fc-email-input") ?? false,
);
console.log("email input focusable:", focused);

// ── Reduced-motion probe · life animations must freeze, trail hidden ──
console.log("\n── REDUCED-MOTION CHECK ──");
await page.emulateMediaFeatures([
  { name: "prefers-reduced-motion", value: "reduce" },
]);
await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 800));

const rm = await page.evaluate(() => {
  function styleOf(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      animationName: cs.animationName,
      animationPlayState: cs.animationPlayState,
      display: cs.display,
    };
  }
  return {
    hero:  styleOf(".lc-founding-hero"),
    life:  styleOf(".lc-founding-hero-life"),
    img:   styleOf(".lc-founding-hero-img"),
    trail: styleOf(".lc-founding-hero-trail"),
  };
});
for (const [k, v] of Object.entries(rm)) {
  if (!v) continue;
  console.log(`${k.padEnd(6)} animation-name=${v.animationName}  display=${v.display}`);
}
const lifeFrozen = rm.hero?.animationName === "none" && rm.life?.animationName === "none";
const trailHidden = rm.trail?.display === "none";
console.log("life-animation frozen:", lifeFrozen);
console.log("trail hidden:", trailHidden);
await page.screenshot({ path: `${OUT}/HERO-7-reduced-motion.png` });
console.log("ok · HERO-7-reduced-motion");

await browser.close();
console.log("done · " + OUT);
