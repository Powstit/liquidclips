// Funnel screenshot capture · landing → generate → reveal → claim room
import puppeteer from "puppeteer-core";
import { mkdir } from "fs/promises";
import { resolve } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.LC_FUNNEL_BASE ?? "http://localhost:3000";
const OUT = resolve("/Users/dipdip/code/jnr/liquidclips-marketing/docs/funnel-screenshots");
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: VIEWPORT,
  args: ["--no-sandbox", `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  page.on("console", () => {});
  page.on("pageerror", () => {});

  // 1 · landing
  process.stdout.write("→ landing  ");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: false });
  process.stdout.write("ok\n");

  // Submit URL → land on /generate/<id> via POST
  process.stdout.write("→ submitting URL  ");
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    });
    return await r.json();
  });
  const id = res.id;
  process.stdout.write(`ok · id=${id}\n`);

  // 2 · generate · capture two frames (early + late)
  process.stdout.write("→ generate-early  ");
  await page.goto(`${BASE}/generate/${id}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 4_000));
  await page.screenshot({ path: `${OUT}/02-generate-early.png`, fullPage: false });
  process.stdout.write("ok\n");

  process.stdout.write("→ generate-mid  ");
  await new Promise((r) => setTimeout(r, 16_000)); // ~22s elapsed → "Listening" mid-drip
  await page.screenshot({ path: `${OUT}/03-generate-mid.png`, fullPage: false });
  process.stdout.write("ok\n");

  process.stdout.write("→ generate-late  ");
  await new Promise((r) => setTimeout(r, 14_000)); // ~36s → "Scoring"
  await page.screenshot({ path: `${OUT}/04-generate-late.png`, fullPage: false });
  process.stdout.write("ok\n");

  // 3 · reveal · navigate directly (so we don't have to wait the full 45s loop)
  process.stdout.write("→ reveal  ");
  await page.goto(`${BASE}/clips/${id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 1_500));
  await page.screenshot({ path: `${OUT}/05-reveal.png`, fullPage: false });
  process.stdout.write("ok\n");

  // 3b · reveal scrolled
  process.stdout.write("→ reveal-scrolled  ");
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/06-reveal-scrolled.png`, fullPage: false });
  process.stdout.write("ok\n");

  // 4 · download / claim room
  process.stdout.write("→ claim-room  ");
  await page.goto(`${BASE}/download?session=${id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 1_500));
  await page.screenshot({ path: `${OUT}/07-claim-room.png`, fullPage: false });
  process.stdout.write("ok\n");
} finally {
  await browser.close();
}
console.log(`saved to ${OUT}`);
