// Capture the Founding Clippers signup experience — empty / mid-animation / success.
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
  defaultViewport: VIEWPORT,
  args: [
    "--no-sandbox",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--user-data-dir=/tmp/puppeteer-founding2",
    "--no-first-run",
  ],
});

const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on("pageerror", () => {});

await page.setRequestInterception(true);
page.on("request", (req) => {
  if (req.url().endsWith("/api/waitlist")) {
    req.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        alreadyJoined: false,
        referralCode: "K9pQrTm3",
      }),
    });
    return;
  }
  req.continue();
});

await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });

// give invaders a moment to drift into frame
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/FOUNDING-1-empty.png` });
console.log("ok · FOUNDING-1-empty");

// fill the form
await page.click(".lc-fc-role:nth-child(2)");
await page.type(".lc-fc-email-input", "kade@liquidclips.app", { delay: 22 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/FOUNDING-2-filled.png` });
console.log("ok · FOUNDING-2-filled");

// success
await page.click(".lc-fc-submit");
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/FOUNDING-3-success.png` });
console.log("ok · FOUNDING-3-success");

// a second empty shot at a different animation phase so we can see drift
await page.goto(`${BASE}/founding`, { waitUntil: "networkidle2", timeout: 60_000 });
await new Promise((r) => setTimeout(r, 6000));
await page.screenshot({ path: `${OUT}/FOUNDING-4-swarm-later.png` });
console.log("ok · FOUNDING-4-swarm-later");

await browser.close();
console.log("done · " + OUT);
