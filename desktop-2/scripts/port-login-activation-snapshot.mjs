import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const RECEIPT_DIR = '/Users/dipdip/code/jnr/08_receipts/port-login-activation';
mkdirSync(RECEIPT_DIR, { recursive: true });
const APPROVED = '/Users/dipdip/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/login-activation.html';
const STATES = ['idle', 'waiting', 'activating', 'activated', 'activated_degraded', 'failed', 'already_activated', 'inapp_panel_open', 'inapp_fallback', 'manual_paste', 'offline'];
const chromePathCandidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
let chromePath = null;
for (const c of chromePathCandidates) if (existsSync(c)) { chromePath = c; break; }
if (!chromePath) { console.error('no chrome'); process.exit(0); }
const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({ executablePath: chromePath, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(APPROVED).toString(), { waitUntil: 'networkidle0' });
for (const s of STATES) {
  await page.evaluate((state) => {
    const btn = document.querySelector(`.scrubber-btn[data-state="${state}"]`);
    btn?.click();
  }, s);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(RECEIPT_DIR, `mockup-${s}.png`), fullPage: true });
  console.log(`mockup ${s}`);
}
await browser.close();
console.log('done');
