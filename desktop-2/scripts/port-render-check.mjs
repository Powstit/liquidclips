import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const chromePathCandidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
let chromePath = null;
for (const c of chromePathCandidates) if (existsSync(c)) { chromePath = c; break; }
const puppeteer = await import('puppeteer-core');
const browser = await puppeteer.default.launch({ executablePath: chromePath, headless: 'new' });
const page = await browser.newPage();

// Real Tauri app dimensions
await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 2 });

// Build a minimal Vite-independent host that inlines the CSS + a mock
// of the port's structure so the screenshot proves the sizing.
const cssText = (await import('node:fs')).readFileSync('/Users/dipdip/code/jnr/desktop-2/src/routes/login-activation/LoginActivation.css', 'utf-8');
const brandTokens = (await import('node:fs')).readFileSync('/Users/dipdip/code/jnr/desktop-2/src/brand/brandTheme.css', 'utf-8')
  .replace(/@theme\s*{/, ':root {');
const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  ${brandTokens}
  ${cssText}
</style></head><body>
<div class="la-root">
  <div class="la-scrubber">
    <span class="la-scrubber-label">STATE</span>
    <button class="la-scrubber-btn" data-active="true">idle</button>
    <button class="la-scrubber-btn">waiting</button>
    <button class="la-scrubber-btn">activating</button>
    <button class="la-scrubber-btn">activated</button>
    <span class="la-scrubber-note">640 · app-native · 1280x820 window</span>
  </div>
  <div class="la-stage">
    <div class="la-card" data-state="idle">
      <div class="la-whop-pill">Powered by <span style="color:#fff;">Whop</span></div>
      <span class="la-hud-tr"></span>
      <span class="la-hud-br"></span>
      <div class="la-scanlines"></div>
      <div class="la-node-header">
        <div class="la-node-title"><span class="la-node-glyph"></span>Liquid Clips</div>
        <div class="la-node-ident">activation · <b>idle</b></div>
      </div>
      <div class="la-boot-eyebrow">Boot sequence</div>
      <h1 class="la-boot-h1">Activate Liquid Clips</h1>
      <p class="la-boot-sub">Sign in once. Return to the app automatically.</p>
      <div class="la-state-body">
        <ol class="la-steps-list">
          <li><strong>1</strong><span>Click <em style="color:var(--color-ink)">Sign in with Whop</em> — no browser bounce.</span></li>
          <li><strong>2</strong><span>Sign in inside the app panel that opens above.</span></li>
          <li><strong>3</strong><span>You're in. Your license lands automatically.</span></li>
        </ol>
        <button class="la-cta la-cta-primary"><span class="la-cta-icon"></span>Sign in with Whop</button>
        <div class="la-cta-row">
          <button class="la-cta la-cta-secondary">Use system browser</button>
          <button class="la-cta la-cta-quiet">Paste activation code</button>
        </div>
      </div>
      <div class="la-footer">Sign-in stays inside the app · <b>100% integrated</b> · no browser switching · no popup blocker risk</div>
    </div>
  </div>
</div>
</body></html>`;

writeFileSync('/tmp/port-render-check.html', html, 'utf-8');
await page.goto(pathToFileURL('/tmp/port-render-check.html').toString());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({
  path: '/Users/dipdip/code/jnr/08_receipts/port-login-activation/port-at-app-viewport.png',
  fullPage: false,
});
console.log('captured at 1280x820');
await browser.close();
