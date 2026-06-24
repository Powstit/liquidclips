// Proof of the right-edge Browse pull-tab. Captures three shots:
//   browser-rail-tab-home.png     — tab visible on Home
//   browser-rail-tab-engine.png   — same tab visible on Engine (persistence)
//   browser-rail-tab-overlay.png  — tab hidden while overlay open
//
// Run order:
//   1) npm run build
//   2) vite preview --port 4173 (background)
//   3) node scripts/capture-browse-rail-tab.cjs

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

  // 1) Home — rail tab visible.
  await page.goto(`${BASE_URL}/?skipIntro=1#/home`, {
    waitUntil: "domcontentloaded",
  });
  await wait(2500);

  const tabOnHome = await page.$('[data-browse-rail-tab="root"]');
  console.log(`[${tabOnHome ? "PASS" : "FAIL"}] Rail tab visible on Home`);
  await page.screenshot({
    path: path.join(OUT_DIR, "browser-rail-tab-home.png"),
    fullPage: false,
  });

  // Tight crop on the right edge so the pull-tab is unmistakable at any
  // viewer zoom level.
  if (tabOnHome) {
    const tabBox = await tabOnHome.boundingBox();
    if (tabBox) {
      await page.screenshot({
        path: path.join(OUT_DIR, "browser-rail-tab-closeup.png"),
        clip: {
          x: Math.max(0, tabBox.x - 60),
          y: Math.max(0, tabBox.y - 60),
          width: Math.min(160, 1440 - (tabBox.x - 60)),
          height: tabBox.height + 120,
        },
      });
    }
  }

  // 2) Engine — same tab persists.
  await page.goto(`${BASE_URL}/?skipIntro=1#/editor`, {
    waitUntil: "domcontentloaded",
  });
  await wait(1800);
  const tabOnEngine = await page.$('[data-browse-rail-tab="root"]');
  console.log(`[${tabOnEngine ? "PASS" : "FAIL"}] Rail tab visible on Engine`);
  await page.screenshot({
    path: path.join(OUT_DIR, "browser-rail-tab-engine.png"),
    fullPage: false,
  });

  // 3) Click tab → overlay opens, tab hides.
  await page.evaluate(() => {
    const t = document.querySelector('[data-browse-rail-tab="root"]');
    if (t) t.click();
  });
  await wait(900);

  const overlayOpen = await page.$(".lc-browse-overlay");
  const scrim = await page.$(".lc-browse-scrim");
  const tabHidden = !(await page.$('[data-browse-rail-tab="root"]'));
  console.log(`[${overlayOpen ? "PASS" : "FAIL"}] Overlay opened from rail tab`);
  console.log(`[${scrim ? "PASS" : "FAIL"}] Scrim dims app behind overlay`);
  console.log(`[${tabHidden ? "PASS" : "FAIL"}] Rail tab hides while overlay open`);
  await page.screenshot({
    path: path.join(OUT_DIR, "browser-rail-tab-overlay.png"),
    fullPage: false,
  });

  // Esc should close + rail tab should return.
  await page.keyboard.press("Escape");
  await wait(400);
  const tabBack = await page.$('[data-browse-rail-tab="root"]');
  console.log(`[${tabBack ? "PASS" : "FAIL"}] Rail tab returns after Esc`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
