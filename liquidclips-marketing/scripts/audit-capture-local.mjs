// Local audit capture · IC panels + landing button states · uses local prod server.
import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.LC_BASE ?? "http://localhost:3043";
const OUT = resolve(
  "/Users/dipdip/code/jnr/liquidclips-marketing/docs/audit-screenshots"
);
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: VIEWPORT,
  args: [
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--user-data-dir=/tmp/puppeteer-audit-local",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("pageerror", () => {});

await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 1800));

// Landing button shots · capture full hero + workbench bottom CTA
await page.screenshot({ path: `${OUT}/AFTER-00-hero-cta.png` });
console.log("ok · AFTER-00-hero-cta");

const w4 = await page.$(".lc-w4");
if (w4) {
  await w4.scrollIntoView();
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/AFTER-05-workbench-cta.png` });
  console.log("ok · AFTER-05-workbench-cta");
}

// Open the InformationConsole and walk through every panel
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await new Promise((r) => setTimeout(r, 400));
await page.click(".lc-railtab");
await new Promise((r) => setTimeout(r, 1000));

const PANELS = [
  "features",
  "rewards",
  "agencies",
  "billing",
  "testimonials",
  "affiliates",
  "demo",
];
const items = await page.$$(".lc-ic-rail-item");
for (let i = 0; i < PANELS.length; i++) {
  if (!items[i]) continue;
  await items[i].click();
  await page.mouse.move(900, 500);
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `${OUT}/AFTER-ic-${i + 1}-${PANELS[i]}.png` });
  console.log("ok · AFTER-ic-" + PANELS[i]);
}

await browser.close();
console.log("done · " + OUT);
