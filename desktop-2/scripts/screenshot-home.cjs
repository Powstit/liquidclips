const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const outDir = '/Users/dipdip/code/jnr/desktop-2/screenshots';

  // Default Home
  await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(outDir, 'home-batch2.png') });

  // Expanded Generate card
  const generateCard = await page.$('[data-card="generate"] button');
  if (generateCard) {
    await generateCard.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(outDir, 'home-batch2-generate-expanded.png') });
  }

  // Close generate, open Import drawer
  const importCard = await page.$('[data-card="import"]');
  if (importCard) {
    await importCard.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(outDir, 'home-batch2-import-drawer.png') });
  }

  await browser.close();
  console.log('Screenshots saved');
})();
