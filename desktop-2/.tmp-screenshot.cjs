const puppeteer = require('puppeteer-core');
(async () => {
  const [out, action = ''] = process.argv.slice(2);
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 2 },
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:1420/?skipIntro=1#/home', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1400));

  // Navigate to Channels for most shots
  if (action !== 'export-chips') {
    await page.evaluate(() => {
      for (const r of document.querySelectorAll('.lc-nav-item'))
        if (r.getAttribute('data-route') === 'channels') (r).click();
    });
    await new Promise(r => setTimeout(r, 1200));
  }

  if (action === 'channels-grid') {
    // Just the grid (no drawer)
  }
  if (action === 'detail-drawer') {
    // Click the first ChannelTile (uncle.daniel)
    await page.evaluate(() => {
      const tiles = document.querySelectorAll('.lc-cht .lc-acs-shell');
      if (tiles[0]) (tiles[0]).click();
    });
    await new Promise(r => setTimeout(r, 700));
  }
  if (action === 'disconnect-step1') {
    // Open detail drawer + click Disconnect to enter step 1
    await page.evaluate(() => {
      const tiles = document.querySelectorAll('.lc-cht .lc-acs-shell');
      if (tiles[0]) (tiles[0]).click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.lc-cdd-btn-danger');
      if (btns[0]) (btns[0]).click();
    });
    await new Promise(r => setTimeout(r, 400));
  }
  if (action === 'disconnect-step2') {
    await page.evaluate(() => {
      const tiles = document.querySelectorAll('.lc-cht .lc-acs-shell');
      if (tiles[0]) (tiles[0]).click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.lc-cdd-btn-danger');
      if (btns[0]) (btns[0]).click();
    });
    await new Promise(r => setTimeout(r, 400));
    // Click "Continue" in step 1 of disconnect drawer
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.lc-cdc-btn-danger');
      if (btns[0]) (btns[0]).click();
    });
    await new Promise(r => setTimeout(r, 500));
    // Type the handle in the input
    await page.evaluate(() => {
      const input = document.querySelector('.lc-cdc-input');
      if (input) {
        (input).value = '@uncle.daniel';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 300));
  }
  if (action === 'after-disconnect') {
    // Open detail drawer + complete disconnect
    await page.evaluate(() => {
      const tiles = document.querySelectorAll('.lc-cht .lc-acs-shell');
      if (tiles[0]) (tiles[0]).click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.lc-cdd-btn-danger');
      if (btns[0]) (btns[0]).click();
    });
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.lc-cdc-btn-danger');
      if (btns[0]) (btns[0]).click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const input = document.querySelector('.lc-cdc-input');
      if (input) {
        (input).value = '@uncle.daniel';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.lc-cdc-btn-danger');
      if (btns[1]) (btns[1]).click();  // the second one is "Disconnect"
    });
    await new Promise(r => setTimeout(r, 900));
  }
  if (action === 'export-chips') {
    await page.evaluate(() => {
      const s = { source: 'youtu.be/x', url: 'https://youtu.be/x',
        status: 'complete', runtimeMode: 'mock',
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        percent: 1, selectedClipIdx: 0 };
      localStorage.setItem('lc:engine:session:v1', JSON.stringify(s));
      for (const r of document.querySelectorAll('.lc-nav-item'))
        if (r.getAttribute('data-route') === 'export') (r).click();
    });
    await new Promise(r => setTimeout(r, 1200));
  }

  await page.screenshot({ path: out, fullPage: false });
  await browser.close();
  console.log('SAVED', out);
})().catch(e => { console.error(e.message); process.exit(1); });
