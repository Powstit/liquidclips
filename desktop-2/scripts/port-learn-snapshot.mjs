import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const RECEIPT = '/Users/dipdip/code/jnr/08_receipts/port-learn-tab-8a';
mkdirSync(RECEIPT, { recursive: true });
const MOCKUP = '/Users/dipdip/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/demo-video-placement.html';
const cands = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
let chromePath = null;
for (const c of cands) if (existsSync(c)) { chromePath = c; break; }
if (!chromePath) { console.error('no chrome'); process.exit(0); }
const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({ executablePath: chromePath, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(MOCKUP).toString(), { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: join(RECEIPT, 'mockup-learn-grid.png'), fullPage: false });
console.log('mockup captured');
await browser.close();
