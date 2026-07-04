import { chromium } from 'playwright';

const MOCKUP = 'file:///Users/dipdip/Desktop/liquidclips-marketing-hq-v2/05_html-mockups/approved/demo-video-placement.html';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1320, height: 860 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(MOCKUP, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const vids = document.querySelectorAll('video');
  for (const v of vids) {
    v.muted = true;
    v.currentTime = 6; // frame from mid-video with real content
    await v.play().catch(() => {});
  }
});
await page.waitForTimeout(2000);

// Screenshot card 02 (Login & Activation) specifically at high res
const card02 = page.locator('.demo-card').nth(1);
await card02.scrollIntoViewIfNeeded();
await card02.screenshot({ path: '/tmp/demo-mockup-shots/04-card02-zoom.png' });

// Also card 03 (Money Moment)
const card03 = page.locator('.demo-card').nth(2);
await card03.screenshot({ path: '/tmp/demo-mockup-shots/05-card03-zoom.png' });

await browser.close();
console.log('✓ card zoom shots saved');
