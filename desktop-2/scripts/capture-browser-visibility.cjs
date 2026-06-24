// S0 blocker proof — captures two screenshots that prove the Browser
// feature is now clearly visible from Home and clearly opens an overlay:
//   browser-visible-home.png — Home with the "Open Browser ↗" CTA in the
//                              Connect+publish strip clearly in frame.
//   browser-overlay-open.png — Same surface with the overlay open.
//
// Run order:
//   1) npm run build
//   2) vite preview --port 4173 (background)
//   3) node scripts/capture-browser-visibility.cjs

const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.env.LC2_BASE_URL || "http://localhost:4173";
const OUT_DIR = path.join(__dirname, "..", "screenshots", "freeze");
const SHELL_PATH =
  "/Users/dipdip/.cache/puppeteer/chrome-headless-shell/mac-149.0.7827.22/chrome-headless-shell-mac-x64/chrome-headless-shell";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(SHELL_PATH)) {
    console.error("Chrome headless shell not found at", SHELL_PATH);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: SHELL_PATH,
    headless: true,
    defaultViewport: { width: 1440, height: 960 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  // Use the App.tsx escape hatch (?skipIntro=1) so the 28.5s splash is
  // bypassed and we land directly on the AppShell.
  await page.goto(`${BASE_URL}/?skipIntro=1#/home`, {
    waitUntil: "domcontentloaded",
  });
  await wait(2500);

  // Scroll the Connect+publish strip into clear view before the first shot.
  await page.evaluate(() => {
    const cta = document.querySelector('[data-home-cta="open-browser"]');
    if (cta) cta.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await wait(400);

  const ctaExists = await page.evaluate(
    () => Boolean(document.querySelector('[data-home-cta="open-browser"]')),
  );
  console.log(`[${ctaExists ? "PASS" : "FAIL"}] Open Browser CTA visible on Home`);

  await page.screenshot({
    path: path.join(OUT_DIR, "browser-visible-home.png"),
    fullPage: false,
  });

  // Click the CTA and confirm overlay + scrim.
  await page.evaluate(() => {
    const cta = document.querySelector('[data-home-cta="open-browser"]');
    if (cta) cta.click();
  });
  await wait(800);

  const overlayOpen = await page.$(".lc-browse-overlay");
  const scrim = await page.$(".lc-browse-scrim");
  const useInEngineHook = await page.$('[data-browse-overlay="use-in-engine"]');
  console.log(`[${overlayOpen ? "PASS" : "FAIL"}] Browser overlay mounted`);
  console.log(`[${scrim ? "PASS" : "FAIL"}] App dims behind overlay (scrim mounted)`);
  console.log(`[${useInEngineHook ? "PASS" : "FAIL"}] Use in Engine ↗ present`);

  await page.screenshot({
    path: path.join(OUT_DIR, "browser-overlay-open.png"),
    fullPage: false,
  });

  // Esc closes the overlay (acceptance criterion).
  await page.keyboard.press("Escape");
  await wait(400);
  const overlayAfterEsc = await page.$(".lc-browse-overlay");
  console.log(`[${overlayAfterEsc ? "FAIL" : "PASS"}] Esc closes the overlay`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
