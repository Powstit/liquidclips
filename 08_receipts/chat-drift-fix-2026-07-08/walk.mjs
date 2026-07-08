/**
 * Live round-trip walk · chat-drift-fix.
 *
 * Boots Chromium against Vite dev + local backend, injects the license
 * JWT into localStorage so the app skips the sign-in gate, then walks
 * the Community drawer:
 *   1. Room list rendered · 10 rooms · zero "server rollout pending"
 *   2. Report-a-bug CTA click · #bugs active + template pre-fill
 *   3. Send bug report · message appears in stream
 *   4. Reload page · message persists (poll fetches from backend)
 *
 * Not the installed Tauri smoke — the app is served from Vite dev in
 * Chromium so tsx edits show up without a 15-minute Rust rebuild. The
 * loaded code is IDENTICAL to what Tauri would show in a dev cycle.
 */
import { chromium } from "/Users/dipdip/code/jnr/.claude/worktrees/agent-a3f4c0816c1140a84/desktop-2/node_modules/playwright-core/index.mjs";
import fs from "node:fs";

const APP_URL = "http://127.0.0.1:5188/?skipIntro=1";
const JWT = fs.readFileSync("/tmp/chat-drift-jwt.txt", "utf-8").trim();
const OUT_DIR = "/Users/dipdip/code/jnr/.claude/worktrees/agent-a3f4c0816c1140a84/08_receipts/chat-drift-fix-2026-07-08/screenshots";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  // Kill CSS animations globally so screenshots don't wait for fonts
  // and infinite keyframes.
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{animation-duration:0s !important;transition-duration:0s !important;}";
    document.documentElement.appendChild(style);
  });

  page.on("console", (msg) => {
    const t = msg.text();
    if (/error|warn|community|chat|bug/i.test(t)) {
      console.log(`[browser] ${msg.type()}: ${t.slice(0, 240)}`);
    }
  });
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

  console.log("→ Loading app + injecting JWT + backend URL…");
  await page.addInitScript(([jwt, backend]) => {
    localStorage.setItem("lc.license.jwt.v1", jwt);
    localStorage.setItem("lc.intro.dismissed.v1", "1");
    // Suppress onboarding modals so the community drawer is not
    // occluded by welcome overlays during the walk.
    localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
    localStorage.setItem("lc.onboarding.first-run.seen.v1", "1");
    window.__LC_BACKEND_URL__ = backend;
    window.__LC_APP_VERSION__ = "2.2.35-worktree";
  }, [JWT, "http://127.0.0.1:8000"]);

  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 30000 });
  console.log("→ App loaded · navigating to #/community");
  await page.evaluate(() => {
    window.location.hash = "/community";
  });
  await page.waitForSelector('[data-testid="community-chat-home"]', { timeout: 20000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="community-room-list"]');
      if (!el) return false;
      const count = Number(el.getAttribute("data-room-count") || "0");
      return count >= 9;
    },
    { timeout: 15000 },
  );

  const roomCount = await page.getAttribute(
    '[data-testid="community-room-list"]',
    "data-room-count",
  );
  console.log(`   room-count attribute: ${roomCount}`);

  const pendingCount = await page.evaluate(() =>
    (document.body.innerText.match(/server rollout pending/gi) || []).length,
  );
  console.log(`   'server rollout pending' occurrences: ${pendingCount}`);
  if (pendingCount !== 0) {
    console.log("   FAIL · placeholder strings still present");
    process.exitCode = 2;
  }

  await page.screenshot({
    path: `${OUT_DIR}/chat-fix-room-list.png`,
    fullPage: false,
    animations: "disabled",
    timeout: 60000,
  });
  console.log("   screencap → chat-fix-room-list.png");

  console.log("→ Clicking Report a bug CTA");
  await page.click('[data-testid="community-report-bug"]');
  await page.waitForFunction(() => {
    const ta = document.querySelector(
      ".lc-community-composer textarea",
    );
    return ta && ta.value.startsWith("Bug: ");
  }, { timeout: 5000 });
  await page.waitForSelector('[data-testid="community-room-bugs"][data-active="true"]', {
    timeout: 5000,
  });
  const preFillValue = await page.evaluate(() => {
    const ta = document.querySelector(
      ".lc-community-composer textarea",
    );
    return ta?.value ?? "";
  });
  console.log(`   composer pre-filled with ${preFillValue.length} chars`);
  console.log(`   preview: ${preFillValue.slice(0, 80).replace(/\n/g, " ⏎ ")}…`);
  await page.screenshot({
    path: `${OUT_DIR}/chat-fix-report-bug-prefilled.png`,
    fullPage: false,
    animations: "disabled",
    timeout: 60000,
  });
  console.log("   screencap → chat-fix-report-bug-prefilled.png");

  console.log("→ Filling + sending a real bug report");
  const REAL_BUG = "Bug: chat drift E2E · live desktop walk\nExpected: message round-trips\nActual: verifying now\nApp version: 2.2.35-worktree\nMac: intel\n---";
  await page.evaluate((text) => {
    const ta = document.querySelector(
      ".lc-community-composer textarea",
    );
    if (!ta) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, REAL_BUG);
  await page.click(".lc-community-send");
  await page.waitForFunction((expected) => {
    const stream = document.querySelector(".lc-community-message-stream");
    if (!stream) return false;
    return stream.textContent?.includes(expected.slice(0, 40)) ?? false;
  }, REAL_BUG, { timeout: 15000 });
  console.log("   message rendered in stream · post succeeded");
  await page.screenshot({
    path: `${OUT_DIR}/chat-fix-message-posted.png`,
    fullPage: false,
    animations: "disabled",
    timeout: 60000,
  });
  console.log("   screencap → chat-fix-message-posted.png");

  console.log("→ Reloading app · verifying persistence");
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => { window.location.hash = "/community"; });
  await page.waitForSelector('[data-testid="community-chat-home"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="community-room-bugs"]', { timeout: 15000 });
  await page.click('[data-testid="community-room-bugs"]');
  await page.waitForFunction((expected) => {
    const stream = document.querySelector(".lc-community-message-stream");
    if (!stream) return false;
    return stream.textContent?.includes(expected.slice(0, 40)) ?? false;
  }, REAL_BUG, { timeout: 15000 });
  console.log("   message persists after reload · POST → GET verified");
  await page.screenshot({
    path: `${OUT_DIR}/chat-fix-message-persisted.png`,
    fullPage: false,
    animations: "disabled",
    timeout: 60000,
  });
  console.log("   screencap → chat-fix-message-persisted.png");

  await browser.close();
  console.log("\n✓ Walk complete · 4 screenshots at " + OUT_DIR);
}

main().catch((err) => {
  console.error("WALK FAILED:", err);
  process.exit(1);
});
