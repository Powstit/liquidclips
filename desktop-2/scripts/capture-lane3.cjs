// Lane 3 — capture proof screenshots: PublishModal, ScheduleQueue,
// SubmitToWhopModal, EarnSection ledger. Uses vite preview on :4173 (no Tauri).
//
// Run order:
//   1) npm run build      (already done before this script)
//   2) npm run preview &  (or `vite preview --port 4173`)
//   3) node scripts/capture-lane3.cjs

const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.env.LC2_BASE_URL || "http://localhost:4173";
const OUT_DIR = path.join(__dirname, "..", "screenshots", "lane3");
const SHELL_PATH =
  "/Users/dipdip/.cache/puppeteer/chrome-headless-shell/mac-149.0.7827.22/chrome-headless-shell-mac-x64/chrome-headless-shell";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function preNav(page) {
  // Mark intro as seen so the 28.5s splash never plays.
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("lc:intro-seen:v1", "1");
    } catch (_) {}
  });
}

async function clickByText(page, text) {
  const handle = await page.evaluateHandle((needle) => {
    const all = Array.from(document.querySelectorAll("button"));
    return all.find((b) => (b.textContent || "").includes(needle)) || null;
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`button with text "${text}" not found`);
  await el.click();
}

async function gotoSection(page, hash) {
  await page.goto(`${BASE_URL}/${hash}`, { waitUntil: "domcontentloaded" });
  await wait(500);
  // Hit SKIP INTRO repeatedly — first click drops the 28.5 s video,
  // second tries to skip the 5 s loading game.
  for (let i = 0; i < 2; i++) {
    const clicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("button, a"));
      const skip = all.find((b) =>
        /^(skip\s*intro|skip\s*game)$/i.test((b.textContent || "").trim())
      );
      if (skip) {
        skip.click();
        return true;
      }
      return false;
    });
    if (!clicked) break;
    await wait(600);
  }
  // Loading game has LOADING_MIN_HOLD_MS = 5 s — let it complete.
  await wait(6500);
}

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
  await preNav(page);

  // 1) Engine + PublishModal open ---------------------------------------
  await gotoSection(page, "#/editor");
  await wait(800);
  try {
    await clickByText(page, "Publish via Ayrshare");
    await wait(700);
  } catch (e) {
    console.warn("could not click Publish via Ayrshare:", e.message);
  }
  await page.screenshot({
    path: path.join(OUT_DIR, "01-publish-modal-open.png"),
    fullPage: false,
  });
  // close modal
  try {
    await clickByText(page, "Cancel");
    await wait(400);
  } catch (_) {}

  // 2) Engine + SubmitToWhopModal open ---------------------------------
  try {
    await clickByText(page, "Submit to Whop rewards");
    await wait(700);
  } catch (e) {
    console.warn("could not click Submit to Whop rewards:", e.message);
  }
  await page.screenshot({
    path: path.join(OUT_DIR, "02-whop-submit-modal-open.png"),
    fullPage: false,
  });

  // 3) ScheduleQueue populated -----------------------------------------
  await gotoSection(page, "#/schedule");
  await wait(800);
  await page.screenshot({
    path: path.join(OUT_DIR, "03-schedule-queue.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: path.join(OUT_DIR, "03-schedule-queue-full.png"),
    fullPage: true,
  });

  // 4) EarnSection top of page ------------------------------------------
  await gotoSection(page, "#/earn");
  await wait(800);
  await page.screenshot({
    path: path.join(OUT_DIR, "04-earn-section.png"),
    fullPage: false,
  });

  // 4b) EarnSection scrolled — ledger + honesty footer visible ----------
  await page.evaluate(() => {
    const c = document.querySelector(".lc-canvas");
    if (c) c.scrollTop = c.scrollHeight;
  });
  await wait(500);
  await page.screenshot({
    path: path.join(OUT_DIR, "04b-earn-ledger.png"),
    fullPage: false,
  });

  console.log("Lane 3 screenshots saved to", OUT_DIR);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
