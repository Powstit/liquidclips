import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const RECEIPT = '/Users/dipdip/code/jnr/08_receipts/port-in-app-browser';
mkdirSync(RECEIPT, { recursive: true });
const MOCKUP = '/Users/dipdip/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/in-app-browser.html';
const cands = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
let chromePath = null;
for (const c of cands) if (existsSync(c)) { chromePath = c; break; }
if (!chromePath) { console.error('no chrome'); process.exit(0); }
const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({ executablePath: chromePath, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(MOCKUP).toString(), { waitUntil: 'networkidle0' });
const STATES = ['default','loading','whop-checkout','youtube-auth','engine-consumable','gmail-inbox','add-shortcut-open','maximized','error'];
for (const s of STATES) {
  await page.evaluate((state) => {
    const btn = document.querySelector(`.scrubber-btn[data-state="${state}"]`);
    btn?.click();
  }, s);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: join(RECEIPT, `mockup-${s}.png`), fullPage: false });
  console.log(`mockup ${s}`);
}
await browser.close();
console.log('done');
