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
    "--user-data-dir=/tmp/puppeteer-phc",
    "--no-first-run",
  ],
});

// 1 · standalone preview at 1920x1080
const page1 = await browser.newPage();
await page1.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page1.goto(`${BASE}/brand/launch/ph-campaign-banner.svg`, { waitUntil: "networkidle0", timeout: 30_000 });
await new Promise((r) => setTimeout(r, 1000));
await page1.screenshot({ path: `${OUT}/ph-campaign-standalone.png`, fullPage: false });
console.log("ok · ph-campaign-standalone.png");

// 2 · in-context inside LaunchRewardBanner on the landing page
const page2 = await browser.newPage();
await page2.setViewport(VIEWPORT);
page2.on("console", () => {});
page2.on("pageerror", () => {});
await page2.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2400));
const banner = await page2.$(".lc-launch");
if (banner) {
  await banner.scrollIntoView();
  await new Promise((r) => setTimeout(r, 900));
  await page2.screenshot({ path: `${OUT}/ph-campaign-in-context.png`, fullPage: false });
  console.log("ok · ph-campaign-in-context.png");
}

await browser.close();
