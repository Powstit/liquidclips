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
    "--user-data-dir=/tmp/puppeteer-phb",
    "--no-first-run",
  ],
});

// 1 · standalone banner asset preview
const page1 = await browser.newPage();
await page1.setViewport({ width: 1600, height: 600, deviceScaleFactor: 2 });
await page1.goto(`${BASE}/brand/launch/ph-launch-banner.svg`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 700));
await page1.screenshot({ path: `${OUT}/ph-banner-standalone.png`, fullPage: false });
console.log("ok · ph-banner-standalone.png");

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
  await new Promise((r) => setTimeout(r, 700));
  await page2.screenshot({ path: `${OUT}/ph-banner-in-context.png`, fullPage: false });
  console.log("ok · ph-banner-in-context.png");
}

await browser.close();
