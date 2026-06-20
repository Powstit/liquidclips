// Capture the PH modal flow · banner → modal → success state.
import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3043";
const OUT = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/docs/audit-screenshots",
);
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--user-data-dir=/tmp/puppeteer-phmodal",
    "--no-first-run",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("pageerror", () => {});

await page.goto(`${BASE}/?ref=K9pQrTm3`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/PH-1-landing.png` });
console.log("ok · PH-1-landing");

// Scroll the banner into view + click it
const launchEl = await page.$(".lc-launch-asset");
if (!launchEl) throw new Error(".lc-launch-asset not found");
await launchEl.scrollIntoView();
await new Promise((r) => setTimeout(r, 600));
await launchEl.click();
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: `${OUT}/PH-2-modal-open.png` });
console.log("ok · PH-2-modal-open");

// Fill the form
await page.click(".lc-ph-modal-input");
await page.type(".lc-ph-modal-input", "kade@liquidclips.app", { delay: 14 });
const inputs = await page.$$(".lc-ph-modal-input");
if (inputs[1]) {
  await inputs[1].click();
  await page.type(".lc-ph-modal-input:nth-child(2)", "uncledaniel", { delay: 14 });
}
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/PH-3-filled.png` });
console.log("ok · PH-3-filled");

// Submit → success state
await page.click(".lc-ph-modal-submit");
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/PH-4-success.png` });
console.log("ok · PH-4-success");

await browser.close();
console.log("done · " + OUT);
