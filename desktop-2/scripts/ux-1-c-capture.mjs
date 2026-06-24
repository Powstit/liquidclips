// UX-1-a · whole-app screenshot capture (audit-only · no app changes).
// Usage:  node scripts/ux-1-a-capture.mjs
// Prereqs: vite dev server on http://localhost:1420

import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:1420";
const OUT = resolve(
  "/Users/dipdip/code/jnr/desktop-2/docs/ux-1-c-screenshots",
);

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

// Routes the user enumerated. Each entry is [slug, hash, label, hold-ms].
const ROUTES = [
  ["intro",      "?skipIntro=0",                 "Intro splash (no skip)",                  3500],
  ["login",      "?skipIntro=1#/login",          "LoginOnboarding (no JWT)",                3000],
  ["home",       "?skipIntro=1&seedJwt=1#/home", "Home / Command Room",                     2500],
  ["create",     "?skipIntro=1&seedJwt=1#/create",    "Create",                            2500],
  ["engine",     "?skipIntro=1&seedJwt=1#/engine",    "Clipping Engine",                   2500],
  ["studio",     "?skipIntro=1&seedJwt=1#/studio",    "Timeline Studio",                   2500],
  ["thumbnail",  "?skipIntro=1&seedJwt=1#/thumbnail", "Thumbnail Studio",                  2500],
  ["export",     "?skipIntro=1&seedJwt=1#/export",    "Export",                            2500],
  ["channels",   "?skipIntro=1&seedJwt=1#/channels",  "Channels",                          2500],
  ["schedule",   "?skipIntro=1&seedJwt=1#/schedule",  "Schedule",                          2500],
  ["community",  "?skipIntro=1&seedJwt=1#/community", "Community",                         2500],
  ["earn",       "?skipIntro=1&seedJwt=1#/earn",      "Earn",                              2500],
  ["library",    "?skipIntro=1&seedJwt=1#/library",   "Library",                           2500],
  ["clipper",    "?skipIntro=1&seedJwt=1#/clipper",   "Clipper journey",                   2500],
  ["campaigns",  "?skipIntro=1&seedJwt=1#/campaigns", "Campaigns",                         2500],
  ["settings",   "?skipIntro=1&seedJwt=1#/settings",  "Settings",                          2500],
  ["stop-pages", "?skipIntro=1&seedJwt=1#/stop-pages","Stop pages (admin)",                2500],
];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: VIEWPORT,
  args: [
    "--no-sandbox",
    "--disable-gpu-shader-disk-cache",
    "--disable-dev-shm-usage",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // Seed localStorage so AuthGate sees a JWT and falls through to AppShell.
  await page.evaluateOnNewDocument(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("seedJwt") === "1") {
      try {
        localStorage.setItem("lc.license.jwt.v1", "ux-1-a-fake-jwt-not-validated");
      } catch {}
    }
  });

  // Silence console noise from the test JWT (it won't parse).
  page.on("console", () => {});
  page.on("pageerror", () => {});

  for (const [slug, q, label, hold] of ROUTES) {
    const url = `${BASE}/${q}`;
    process.stdout.write(`→ ${slug.padEnd(11)}  ${label}  …  `);
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 });
    } catch (e) {
      process.stdout.write(`nav-fail: ${e.message}\n`);
      continue;
    }
    // Let cinematic intros / world transitions settle.
    await new Promise((r) => setTimeout(r, hold));
    const file = `${OUT}/${String(ROUTES.indexOf([slug, q, label, hold]) + 1).padStart(2, "0")}-${slug}.png`;
    try {
      await page.screenshot({ path: file, fullPage: false });
      process.stdout.write(`ok\n`);
    } catch (e) {
      process.stdout.write(`shot-fail: ${e.message}\n`);
    }
  }

  // Capture Campaigns + agency creation drawer.
  try {
    process.stdout.write(`→ campaigns-create-drawer …  `);
    await page.goto(`${BASE}/?skipIntro=1&seedJwt=1#/campaigns`, { waitUntil: "networkidle2", timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 2500));
    // Try clicking the floating create CTA. Many CSS class variants exist;
    // fall back to text match.
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button"));
      const btn = candidates.find((b) => /create/i.test(b.textContent || "") && /campaign/i.test(b.textContent || ""))
        ?? candidates.find((b) => b.className.includes("create-cta"))
        ?? candidates.find((b) => b.getAttribute("aria-label")?.toLowerCase().includes("create"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (clicked) {
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({ path: `${OUT}/18-campaigns-agency-create-drawer.png`, fullPage: false });
      process.stdout.write(`ok\n`);
    } else {
      process.stdout.write(`no create CTA found (likely tier-gated · expected for fake JWT)\n`);
    }
  } catch (e) {
    process.stdout.write(`drawer-fail: ${e.message}\n`);
  }

  // Capture Campaigns + campaign detail drawer (first card).
  try {
    process.stdout.write(`→ campaign-detail-drawer …  `);
    await page.goto(`${BASE}/?skipIntro=1&seedJwt=1#/campaigns`, { waitUntil: "networkidle2", timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 2500));
    const opened = await page.evaluate(() => {
      const card = document.querySelector(
        ".lc-campaign-card, [data-campaign-card], .campaign-card, button[data-campaign]",
      );
      if (!card) return false;
      card.click();
      return true;
    });
    if (opened) {
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({ path: `${OUT}/19-campaign-detail-drawer.png`, fullPage: false });
      process.stdout.write(`ok\n`);
    } else {
      process.stdout.write(`no campaign card found\n`);
    }
  } catch (e) {
    process.stdout.write(`detail-fail: ${e.message}\n`);
  }

  // Top-of-page capture for Settings world wrap.
  try {
    process.stdout.write(`→ settings-scrolled-down …  `);
    await page.goto(`${BASE}/?skipIntro=1&seedJwt=1#/settings`, { waitUntil: "networkidle2", timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => {
      const scroller = document.querySelector(".lc-scroll, .design-os-scroll, main, [data-scroll]");
      (scroller || window).scrollTo({ top: 1200, behavior: "instant" });
    });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${OUT}/20-settings-mid.png`, fullPage: false });
    process.stdout.write(`ok\n`);
  } catch (e) {
    process.stdout.write(`scroll-fail: ${e.message}\n`);
  }

  // Boot intro frame: no skip, capture very early.
  try {
    process.stdout.write(`→ intro-early …  `);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${OUT}/21-intro-early.png`, fullPage: false });
    process.stdout.write(`ok\n`);
  } catch (e) {
    process.stdout.write(`intro-early-fail: ${e.message}\n`);
  }
} finally {
  await browser.close();
}
console.log("done.");
