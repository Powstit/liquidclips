// Lane 2 screenshot capture.
// Skips intro via localStorage seed, hits Engine + Engine overlay + Home drag.
const puppeteer = require('puppeteer-core');
const path = require('path');

const OUT_DIR = '/Users/dipdip/code/jnr/desktop-2/screenshots/lane2';
const BASE = 'http://localhost:1420';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=PrefersReducedMotion'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // Seed BEFORE any document loads on the dev origin so IntroSplash skips on
  // first mount (its hasSeenIntro() read runs immediately).
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('lc:intro-seen:v1', '1');
    } catch {}
  });

  const skipIntro = async () => {
    for (let i = 0; i < 6; i++) {
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const skip = btns.find(b => b.textContent && /SKIP INTRO/i.test(b.textContent));
        if (skip) { skip.click(); return true; }
        return false;
      });
      await wait(600);
      const stillIntro = await page.evaluate(() => {
        return Boolean(document.querySelector('.lc-intro-splash, .lc-intro-loader, [data-intro-stage]'));
      });
      if (!stillIntro) return;
      if (!clicked && !stillIntro) return;
    }
  };

  // First: land on Home, dismiss the intro splash once. Subsequent navigations
  // happen with the intro already gone.
  await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2', timeout: 25000 });
  await wait(2000);
  await skipIntro();
  await wait(1200);

  // 1. Engine — selected 9:16 preview + rail with CampaignContextStrip.
  await page.goto(BASE + '/#/editor', { waitUntil: 'networkidle2', timeout: 25000 });
  await wait(2200);
  await skipIntro();
  await wait(800);
  // Click first clip card to select it.
  await page.evaluate(() => {
    const card = document.querySelector('.lc2-engine-card');
    if (card) card.click();
  });
  await wait(900);
  await page.evaluate(() => {
    const wrap = document.querySelector('.lc2-engine-timeline-wrap');
    if (wrap) wrap.scrollIntoView({ block: 'center' });
  });
  await wait(400);
  await page.screenshot({ path: path.join(OUT_DIR, '01-engine-selected-preview-rail.png'), fullPage: false });
  console.log('  saved 01-engine-selected-preview-rail.png');

  // 2. Engine right rail with CampaignContextStrip — scroll to top to anchor strip.
  await page.evaluate(() => {
    const rail = document.querySelector('.lc2-engine-rail');
    if (rail && rail.parentElement) rail.parentElement.scrollTop = 0;
  });
  await wait(300);
  await page.screenshot({
    path: path.join(OUT_DIR, '02-engine-rail-context-strip.png'),
    fullPage: false,
  });
  console.log('  saved 02-engine-rail-context-strip.png');

  // 3. Engine editor overlay — split layout (force layout=split via the rail).
  // Open the overlay by clicking "Open full editor →"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const openBtn = btns.find(b => b.textContent && b.textContent.includes('Open full editor'));
    if (openBtn) openBtn.click();
  });
  await wait(900);
  // Switch layout to "split" by clicking the Layout tab + Split option.
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.lc2-engine-rail-tab'));
    const layoutTab = tabs.find(b => b.textContent && b.textContent.trim() === 'Layout');
    if (layoutTab) layoutTab.click();
  });
  await wait(500);
  await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('.lc2-engine-lopt'));
    const split = opts.find(b => b.textContent && b.textContent.includes('Split'));
    if (split) split.click();
  });
  await wait(700);
  await page.screenshot({ path: path.join(OUT_DIR, '03-engine-overlay-split.png'), fullPage: false });
  console.log('  saved 03-engine-overlay-split.png');

  // Close overlay.
  await page.evaluate(() => {
    const back = document.querySelector('.lc2-engine-ed-back');
    if (back) back.click();
  });
  await wait(500);

  // 4. Home drag-over DropZone — fire dragenter manually with a Files dataTransfer.
  await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2', timeout: 25000 });
  await wait(1800);
  await skipIntro();
  await wait(1000);
  await page.evaluate(() => {
    const root = document.querySelector('.lc-home');
    if (!root) return;
    const dt = new DataTransfer();
    try {
      const f = new File(['x'], 'video.mp4', { type: 'video/mp4' });
      dt.items.add(f);
    } catch {}
    const ev = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt });
    root.dispatchEvent(ev);
  });
  await wait(500);
  await page.screenshot({ path: path.join(OUT_DIR, '04-home-dropzone.png'), fullPage: false });
  console.log('  saved 04-home-dropzone.png');

  await browser.close();
  console.log('Done.');
})().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
