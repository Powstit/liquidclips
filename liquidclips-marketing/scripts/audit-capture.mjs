// Full audit capture · every surface on the live prod URL.
import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "https://liquidclips-marketing.vercel.app";
const OUT = resolve("/Users/dipdip/code/jnr/liquidclips-marketing/docs/audit-screenshots");
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: VIEWPORT,
  args: [
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--user-data-dir=/tmp/puppeteer-audit",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("console", () => {});
page.on("pageerror", () => {});

await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2500));

// Section sweep
const SECTIONS = [
  { name: "01-hero", sel: ".lc-w1" },
  { name: "02-launch", sel: ".lc-launch" },
  { name: "03-kade-scans", sel: ".lc-w2" },
  { name: "04-vault", sel: ".lc-w3" },
  { name: "05-workbench", sel: ".lc-w4" },
  { name: "06-testimonials", sel: ".lc-test" },
  { name: "07-final", sel: ".lc-final" },
];
for (const s of SECTIONS) {
  const h = await page.$(s.sel);
  if (!h) { console.log(`(missing) ${s.sel}`); continue; }
  await h.scrollIntoView();
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log("ok ·", s.name);
}

// IC panel sweep
const PANELS = ["features", "rewards", "agencies", "billing", "testimonials", "affiliates", "demo"];
await page.click(".lc-railtab");
await new Promise((r) => setTimeout(r, 800));
const items = await page.$$(".lc-ic-rail-item");
for (let i = 0; i < PANELS.length; i++) {
  if (!items[i]) continue;
  await items[i].click();
  await page.mouse.move(900, 500);
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/ic-${i + 1}-${PANELS[i]}.png` });
  console.log("ok · ic-" + PANELS[i]);
}

await browser.close();
console.log("done · " + OUT);
