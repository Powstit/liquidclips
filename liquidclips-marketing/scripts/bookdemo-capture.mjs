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
    "--user-data-dir=/tmp/puppeteer-bd",
    "--no-first-run",
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
if (items[6]) {
  await items[6].click();
  await page.mouse.move(900, 500);
  // give Calendly a chance to load
  await new Promise((r) => setTimeout(r, 5000));
  await page.screenshot({ path: `${OUT}/bookdemo-1-top.png` });
  console.log("ok · bookdemo-1-top.png");

  await page.evaluate(() => {
    const p = document.querySelector(".lc-ic-panel");
    if (p) p.scrollTop = 360;
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/bookdemo-2-calendar.png` });
  console.log("ok · bookdemo-2-calendar.png");
}

await browser.close();
