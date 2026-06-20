// Persistent UI capture · top of page with rail tab + fab + console overlay.
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
    "--user-data-dir=/tmp/puppeteer-persist",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("console", () => {});
page.on("pageerror", () => {});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2500));

// 1. top of page · hero with right rail tab visible + fab
await page.screenshot({ path: `${OUT}/persist-1-top.png` });
console.log("ok · persist-1-top.png");

// 2. probe the rail tab
const tab = await page.$(".lc-railtab");
if (tab) {
  await tab.click();
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/persist-2-console-open.png` });
  console.log("ok · persist-2-console-open.png");

  // hover features inside the overlay
  const items = await page.$$(".lc-ic-rail-item");
  if (items[0]) {
    await items[0].hover();
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/persist-3-features-revealed.png` });
    console.log("ok · persist-3-features-revealed.png");
  }
}

// 4. probe for any leftover Clerk widget
const clerkSel = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('[class*="cl-"], [data-clerk-dev-tools], [data-clerk-host]'));
  return all.slice(0, 10).map((el) => ({
    tag: el.tagName,
    cls: el.className,
    id: el.id,
    text: (el.textContent || "").slice(0, 80),
  }));
});
console.log("CLERK ELEMENTS REMAINING:", JSON.stringify(clerkSel, null, 2));

await browser.close();
