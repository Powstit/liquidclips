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
    "--user-data-dir=/tmp/puppeteer-ts",
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

const items = await page.$$(".lc-ic-rail-item");
if (items[4]) {
  await items[4].click();
  await page.mouse.move(900, 500);
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: `${OUT}/testimonials-1-outcomes.png` });
  console.log("ok · testimonials-1-outcomes.png");

  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 360;
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/testimonials-2-artifacts.png` });
  console.log("ok · testimonials-2-artifacts.png");
}

await browser.close();
