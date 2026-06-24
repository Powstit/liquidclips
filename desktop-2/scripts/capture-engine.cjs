const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:1420/#/editor', { waitUntil: 'networkidle2', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const canvas = document.querySelector('.lc-canvas');
    if (canvas) canvas.scrollTop = canvas.scrollHeight;
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: '/Users/dipdip/code/jnr/desktop-2/screenshots/engine-workstation.png', fullPage: false });
  console.log('Screenshot saved to /Users/dipdip/code/jnr/desktop-2/screenshots/engine-workstation.png');
  await browser.close();
})();
