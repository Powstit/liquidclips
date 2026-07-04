import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = '/tmp/demo-mockup-shots';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const MOCKUP = 'file:///Users/dipdip/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/demo-video-placement.html';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1320, height: 860 },
});
const page = await context.newPage();

console.log(`→ loading mockup`);
await page.goto(MOCKUP, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

console.log(`→ forcing all videos to play`);
await page.evaluate(async () => {
  const vids = Array.from(document.querySelectorAll('video'));
  await Promise.all(
    vids.map(async (v) => {
      try {
        v.muted = true;
        v.currentTime = 1.2; // pick a frame past intro title
        await v.play().catch(() => {});
      } catch (e) {}
    })
  );
});
await page.waitForTimeout(2000);

console.log(`→ shot 1: Learn tab grid`);
await page.screenshot({
  path: `${OUT}/01-learn-tab-grid.png`,
  fullPage: true,
});

console.log(`→ switching to In-context view`);
await page.click('button[data-target="contextual"]');
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const vids = Array.from(document.querySelectorAll('video'));
  await Promise.all(vids.map((v) => v.play().catch(() => {})));
});
await page.waitForTimeout(1500);

console.log(`→ shot 2: In-context placements (full page scroll)`);
await page.screenshot({
  path: `${OUT}/02-contextual-placements.png`,
  fullPage: true,
});

console.log(`→ shot 3: In-context above-the-fold (viewport only)`);
await page.evaluate(() => window.scrollTo({ top: 0 }));
await page.waitForTimeout(300);
await page.screenshot({
  path: `${OUT}/03-contextual-viewport.png`,
  fullPage: false,
});

await browser.close();
console.log(`\n✓ 3 screenshots saved to ${OUT}/`);
