// Console open + Clipping Rewards capture.
import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3000";
const OUT = resolve("/Users/dipdip/code/jnr/liquidclips-marketing/docs/funnel-screenshots");
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: VIEWPORT,
  args: [
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--user-data-dir=/tmp/puppeteer-rewards",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("console", () => {});
page.on("pageerror", () => {});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2200));

// open console via the right-edge tab
await page.click(".lc-railtab");
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `${OUT}/lock-1-console-idle-kade.png` });
console.log("ok · lock-1-console-idle-kade.png");

// click Clipping Rewards
const items = await page.$$(".lc-ic-rail-item");
if (items[1]) {
  await items[1].click();
  await new Promise((r) => setTimeout(r, 1800)); // counters
  await page.screenshot({ path: `${OUT}/lock-2-rewards-top.png` });
  console.log("ok · lock-2-rewards-top.png");

  // scroll inside panel to see RPM + campaign
  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 380;
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/lock-3-rewards-flow.png` });
  console.log("ok · lock-3-rewards-flow.png");

  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 820;
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/lock-4-rewards-rpm-campaign.png` });
  console.log("ok · lock-4-rewards-rpm-campaign.png");

  // open proof modal
  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 0;
  });
  await new Promise((r) => setTimeout(r, 400));
  const proofBtn = await page.$(".lc-cr-proof-btn");
  if (proofBtn) {
    await proofBtn.click();
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/lock-5-rewards-proof-modal.png` });
    console.log("ok · lock-5-rewards-proof-modal.png");
  }
}

await browser.close();
