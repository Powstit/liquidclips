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

  // 1. Splash loading stage with larger logo (mark intro as seen)
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.setItem('lc:intro-seen:v1', '1');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(outDir, 'audit-splash-logo.png') });

  // 2. Home default
  await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(outDir, 'audit-home.png') });

  // 3. Expanded Generate card with action pills
  const generateCard = await page.$('[data-card="generate"] button');
  if (generateCard) {
    await generateCard.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(outDir, 'audit-generate-pills.png') });
  }

  // 4. Unlock 100 clips modal (plan defaults to free = locked)
  const pill100Locked = await page.evaluateHandle(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans.find((s) => s.textContent.includes('Generate 100 clips'))?.closest('button') || null;
  });
  if (pill100Locked && pill100Locked.asElement && pill100Locked.asElement()) {
    await pill100Locked.click();
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(outDir, 'audit-unlock-100-modal.png') });
  }

  // 5. Simulator success modal — click Start trial in the unlock modal
  const startTrialBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent.includes('Start trial')) || null;
  });
  if (startTrialBtn && startTrialBtn.asElement && startTrialBtn.asElement()) {
    await startTrialBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(outDir, 'audit-success-100-modal.png') });
  }

  // 6. Agency mode expanded Generate card
  await page.evaluate(() => {
    localStorage.removeItem('lc:user-plan:v1');
    localStorage.setItem('lc:user-mode:v1', JSON.stringify({ state: { mode: 'agency' }, version: 0 }));
  });
  await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  const genBtnAgency = await page.$('[data-card="generate"] button');
  if (genBtnAgency) {
    await genBtnAgency.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(outDir, 'audit-generate-pills-agency.png') });
  }

  await browser.close();
  console.log('Audit screenshots saved');
})();
