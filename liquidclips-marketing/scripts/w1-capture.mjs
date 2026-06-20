// Window 1 capture · idle + wake states.
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
    "--autoplay-policy=no-user-gesture-required",
    "--user-data-dir=/tmp/puppeteer-w1",
    "--no-first-run",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("console", () => {});
page.on("pageerror", () => {});

process.stdout.write("→ window1 / idle    ");
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2200));
await page.screenshot({ path: `${OUT}/w1-01-idle.png` });
process.stdout.write("ok\n");

process.stdout.write("→ window1 / wake    ");
await page.evaluate(() => {
  const i = document.querySelector(".lc-w1-input");
  if (i) i.focus();
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `${OUT}/w1-02-wake.png` });
process.stdout.write("ok\n");

process.stdout.write("→ window1 / typed    ");
await page.type(".lc-w1-input", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: `${OUT}/w1-03-typed.png` });
process.stdout.write("ok\n");

await browser.close();
console.log(`done · ${OUT}`);
