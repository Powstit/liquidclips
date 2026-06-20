// Capture ThresMore + InformationConsole (Features default + one swap).
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
    "--user-data-dir=/tmp/puppeteer-ic",
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

async function shoot(sel, file) {
  const h = await page.$(sel);
  if (!h) { console.log(`(missing) ${sel}`); return; }
  await h.scrollIntoView();
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`ok · ${file}`);
}

await shoot(".lc-more",                "page-8-thres-more.png");
await shoot("#information-console",    "page-9-console-features.png");

// Click "Clipping Rewards" then re-shoot.
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".lc-ic-rail-item"));
  const tgt = buttons.find((b) => /clipping rewards/i.test(b.textContent || ""));
  if (tgt) tgt.click();
});
await new Promise((r) => setTimeout(r, 600));
await shoot("#information-console",    "page-9b-console-stub.png");

await browser.close();
