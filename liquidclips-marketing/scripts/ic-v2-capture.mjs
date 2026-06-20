// InformationConsole v2 · idle + hover reveal + pinned states.
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
    "--user-data-dir=/tmp/puppeteer-ic2",
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

const console_ = await page.$("#information-console");
if (!console_) { console.log("missing console"); process.exit(1); }
await console_.scrollIntoView();
await new Promise((r) => setTimeout(r, 900));

// 1. idle · room + Kade only
await page.screenshot({ path: `${OUT}/ic-v2-1-idle.png` });
console.log("ok · ic-v2-1-idle.png");

// 2. hover over Features
const items = await page.$$(".lc-ic-rail-item");
if (items[0]) {
  await items[0].hover();
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/ic-v2-2-hover-features.png` });
  console.log("ok · ic-v2-2-hover-features.png");
}

// 3. click Clipping Rewards to PIN
if (items[1]) {
  await items[1].click();
  await new Promise((r) => setTimeout(r, 600));
  // move mouse off so we see the pinned state without hover
  await page.mouse.move(800, 200);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/ic-v2-3-pinned-rewards.png` });
  console.log("ok · ic-v2-3-pinned-rewards.png");
}

await browser.close();
