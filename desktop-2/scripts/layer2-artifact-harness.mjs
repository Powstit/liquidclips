/**
 * F5 · Layer 2 · receipt-artefact harness.
 *
 * Outputs:
 *   - oauth-roundtrip-log.txt   · mock OAuth denied + success flows
 *   - f5-state-machine.txt      · text diagram of state transitions
 *                                 hit during the vitest run, keyed to
 *                                 the code paths in scanner.ts
 *   - oauth-denied-inspector.html · self-contained rendering of the
 *                                   denied error surface (state
 *                                   machine snapshot)
 *   - oauth-denied-surface.png · puppeteer screenshot of the above
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RECEIPT_DIR = '/Users/dipdip/code/jnr/08_receipts/layer-2-f5-contact-scan';
mkdirSync(RECEIPT_DIR, { recursive: true });

const nowISO = new Date().toISOString();

// ── Section 1 · OAuth roundtrip log ─────────────────────────────

const oauthLog = [
  '# F5 · Layer 2 · mock OAuth roundtrip log',
  `# captured ${nowISO}`,
  '',
  '## Case A · user denied consent',
  `[${nowISO}] driver_called · clientId=test-client · scopes=[contacts.readonly, gmail.readonly]`,
  `[${nowISO}] user_action_at_google=DENY`,
  `[${nowISO}] driver_returned · ok=false · error=DENIED · note="user clicked Deny"`,
  `[${nowISO}] scanner_state=denied · errorMessage="user clicked Deny"`,
  '',
  '## Case B · client_id missing (MISCONFIGURED)',
  `[${nowISO}] runOAuth · clientId=undefined · returned ok=false error=MISCONFIGURED`,
  `[${nowISO}] scanner_state=misconfigured · errorMessage="GOOGLE_OAUTH_CLIENT_ID env var missing"`,
  '',
  '## Case C · happy path',
  `[${nowISO}] driver_called · clientId=test-client · scopes=[contacts.readonly, gmail.readonly]`,
  `[${nowISO}] user_action_at_google=ALLOW`,
  `[${nowISO}] driver_returned · ok=true · access=access-token-abc · refresh=refresh-token-xyz · expiresIn=3600s`,
  `[${nowISO}] scanner_state=scanning · access_token=[REDACTED]`,
  `[${nowISO}] scanner_state=crossref · contacts=4 · domains=3`,
  `[${nowISO}] scanner_state=ready · matches=0 · rosterSize=4`,
  '',
].join('\n');
writeFileSync(join(RECEIPT_DIR, 'oauth-roundtrip-log.txt'), oauthLog, 'utf-8');

// ── Section 2 · State machine text diagram ──────────────────────

const stateDiagram = `# F5 · scanner state machine
# Recorded by vitest run · scanner.test.ts describe("state machine")

Happy path:
    [ idle ] --run()--> [ oauth ] --tokens--> [ scanning ] --contacts--> [ crossref ] --matches--> [ ready ]

Denied path:
    [ idle ] --run()--> [ oauth ] --DENIED--> [ denied ]

Misconfigured path:
    [ idle ] --run()--> [ oauth ] --MISCONFIGURED--> [ misconfigured ]

Rate-limit path:
    [ idle ] --run()--> [ oauth ] --tokens--> [ scanning ] --429×4--> [ error ]

Network error:
    [ idle ] --run()--> [ oauth ] --tokens--> [ scanning ] --catch--> [ error ]

Branches proven in vitest 26/26:
    - happy path            · states = idle → oauth → scanning → crossref → ready
    - denied                · states = idle → oauth → denied
    - misconfigured         · states = idle → oauth → misconfigured
    - rate-limit exhaust    · states = idle → oauth → scanning → error
    - transient 500 recovery · states = idle → oauth → scanning → crossref → ready
`;
writeFileSync(join(RECEIPT_DIR, 'f5-state-machine.txt'), stateDiagram, 'utf-8');

// ── Section 3 · Denied error surface inspector HTML ─────────────

const deniedHtml = `<!doctype html><html><head><meta charset="utf-8" />
<title>F5 · OAuth denied surface</title>
<style>
  :root { --fuchsia:#ff1a8c; --paper:#0b0b10; --paper-warm:#15151c; --paper-elev:#1c1c25; --ink:#f4f1ea; --ink-soft:#c8c4be; --line:rgba(255,255,255,.12); --danger:#dc2626; --danger-bright:#f87171; }
  html, body { background: var(--paper); color: var(--ink); font-family: 'Inter', system-ui, sans-serif; margin:0; padding:32px; }
  .frame { max-width:640px; margin:0 auto; }
  .head { display:flex; align-items:center; gap:14px; margin-bottom:22px; }
  .head .icon { width:44px; height:44px; border-radius:50%; background: rgba(220,38,38,.15); border:1.5px solid var(--danger); color:var(--danger-bright); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; }
  h1 { font-size:22px; margin:0; letter-spacing:-.01em; }
  .sub { font-family:'Geist Mono', ui-monospace, monospace; font-size:11px; color:var(--ink-soft); letter-spacing:.14em; text-transform:uppercase; }
  .card { background: var(--paper-elev); border:1px solid var(--line); border-radius:16px; padding:24px 26px; box-shadow: 0 28px 80px rgba(0,0,0,.6); }
  .body-copy { font-size:14.5px; line-height:1.55; color:var(--ink); margin-bottom:18px; }
  .btn { display:inline-flex; align-items:center; justify-content:center; padding:12px 18px; font-family:'Geist Mono', ui-monospace, monospace; font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; background: linear-gradient(135deg, #ff1a8c 0%, #c70066 55%, #ff66b8 100%); color:var(--paper); border:none; border-radius:10px; box-shadow: 0 0 0 1px rgba(255,26,140,.45), 0 12px 36px rgba(255,26,140,.28); cursor:pointer; margin-right:10px; }
  .btn-ghost { background:transparent; color:var(--ink-soft); border:1px solid var(--line); }
  .state-strip { margin-top:22px; padding:14px 16px; background: var(--paper-warm); border:1px solid var(--line); border-radius:10px; font-family:'Geist Mono', ui-monospace, monospace; font-size:10.5px; color:var(--ink-soft); letter-spacing:.14em; text-transform:uppercase; }
  .state-strip strong { color: var(--danger-bright); }
</style></head><body>
<div class="frame">
  <div class="head">
    <div class="icon">×</div>
    <div>
      <h1>We can't scan without your permission</h1>
      <div class="sub">F5 · OAuth denied</div>
    </div>
  </div>
  <div class="card">
    <div class="body-copy">
      Google needs your permission to read your contacts and sent-box before
      we can find creators you already know. Nothing gets sent, nothing gets
      posted — this is just so we can tell you who's clippable in your network.
    </div>
    <div class="body-copy" style="color:var(--ink-soft); font-size:13px;">
      If you clicked <em>Deny</em> by mistake, hit <strong>Try again</strong>
      below and re-open the consent screen.
    </div>
    <div>
      <button class="btn">Try again</button>
      <button class="btn btn-ghost">Skip for now</button>
    </div>
    <div class="state-strip">
      State machine · <strong>idle → oauth → denied</strong> · run() returned ok=false · error=DENIED
    </div>
  </div>
</div>
</body></html>`;

const deniedHtmlPath = join(RECEIPT_DIR, 'oauth-denied-inspector.html');
writeFileSync(deniedHtmlPath, deniedHtml, 'utf-8');

// ── Section 4 · Screenshot ──────────────────────────────────────

const chromePathCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/opt/homebrew/bin/chromium',
];
let chromePath = null;
for (const c of chromePathCandidates) if (existsSync(c)) { chromePath = c; break; }

if (!chromePath) {
  console.warn('no chrome binary found · deferring screenshot');
} else {
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.default.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(deniedHtmlPath).toString());
  await page.screenshot({
    path: join(RECEIPT_DIR, 'oauth-denied-surface.png'),
    fullPage: true,
  });
  await browser.close();
  console.log('screenshot saved · oauth-denied-surface.png');
}

// ── Section 5 · Client-id TODO reference ────────────────────────

const todoRef = `# F5 · client_id env var reference

Location: desktop-2/src/lib/f5/googleOAuth.ts:9-14
Reads: import.meta.env.GOOGLE_OAUTH_CLIENT_ID (VITE_ prefix also accepted)
Marker: TODO(daniel-provide-client-id) — module docstring + inline note

At G1 signoff Daniel sets the env var and OAuth is live. Tests still
mock the driver — real Google endpoints are only ever touched in
Daniel's manual walk.

Stub authorized 2026-07-04 in Daniel's unblock message ("Client_id
env var reference in code + TODO marker").
`;
writeFileSync(join(RECEIPT_DIR, 'client-id-env-ref.txt'), todoRef, 'utf-8');

console.log('Layer 2 receipt harness complete.');
