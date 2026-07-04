import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const RECEIPT = '/Users/dipdip/code/jnr/08_receipts/port-wallet-detail';
mkdirSync(RECEIPT, { recursive: true });
const MOCKUP = '/Users/dipdip/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/wallet-detail.html';
const chromePathCandidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
let chromePath = null;
for (const c of chromePathCandidates) if (existsSync(c)) { chromePath = c; break; }
if (!chromePath) { console.error('no chrome'); process.exit(0); }
const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({ executablePath: chromePath, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(MOCKUP).toString(), { waitUntil: 'networkidle0' });

const scenes = [
  { key: 'fresh-install', state: 'fresh-install', hover: null },
  { key: 'populated',     state: 'populated',     hover: null },
  { key: 'hover-marques', state: 'populated',     hover: 'marques' },
  { key: 'hover-ali',     state: 'populated',     hover: 'ali' },
  { key: 'hover-airrack', state: 'populated',     hover: 'airrack' },
  { key: 'hover-johnny',  state: 'populated',     hover: 'johnny' },
];

for (const sc of scenes) {
  // Find the scrubber button matching state+hover
  await page.evaluate((state, hover) => {
    const sel = hover
      ? `.scrubber-btn[data-state="${state}"][data-hover="${hover}"]`
      : `.scrubber-btn[data-state="${state}"]:not([data-hover])`;
    const btn = document.querySelector(sel);
    btn?.click();
  }, sc.state, sc.hover);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: join(RECEIPT, `mockup-${sc.key}.png`), fullPage: false });
  console.log(`mockup ${sc.key}`);
}
await browser.close();
console.log('done');
