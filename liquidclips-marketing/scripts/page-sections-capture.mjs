// Capture each section of the landing page individually.
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
    "--user-data-dir=/tmp/puppeteer-sec",
    "--no-first-run",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("console", () => {});
page.on("pageerror", () => {});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2200));

const SECTIONS = [
  { name: "page-1-hero",       sel: ".lc-w1" },
  { name: "page-2-launch",     sel: ".lc-launch" },
  { name: "page-3-kade-scans", sel: ".lc-w2" },
  { name: "page-4-vault",      sel: ".lc-w3" },
  { name: "page-5-workbench",  sel: ".lc-w4" },
  { name: "page-6-testimonials", sel: ".lc-test" },
  { name: "page-7-final-cta",  sel: ".lc-final" },
];

for (const s of SECTIONS) {
  process.stdout.write(`→ ${s.name.padEnd(20)}  `);
  try {
    const handle = await page.$(s.sel);
    if (!handle) { process.stdout.write("(missing)\n"); continue; }
    await handle.scrollIntoView();
    await new Promise((r) => setTimeout(r, 1100));
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    process.stdout.write("ok\n");
  } catch (e) {
    process.stdout.write(`error: ${e.message}\n`);
  }
}

await browser.close();
console.log(`saved to ${OUT}`);
