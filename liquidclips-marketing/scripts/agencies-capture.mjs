// Capture Agencies panel · 3 frames.
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
    "--user-data-dir=/tmp/puppeteer-ag",
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

await page.click(".lc-railtab");
await new Promise((r) => setTimeout(r, 700));

// click Agencies
const items = await page.$$(".lc-ic-rail-item");
if (items[2]) {
  await items[2].click();
  // park the mouse away from the rail so the hover state clears and the
  // PINNED state is what `active` resolves to in the panel.
  await page.mouse.move(900, 500);
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/agencies-1-top.png` });
  console.log("ok · agencies-1-top.png");

  // scroll inside panel
  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 460;
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/agencies-2-vs.png` });
  console.log("ok · agencies-2-vs.png");

  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 1000;
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/agencies-3-benefits.png` });
  console.log("ok · agencies-3-benefits.png");
}

await browser.close();
