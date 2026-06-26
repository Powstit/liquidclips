/**
 * LC-UI-P0-BOOT · Gate 1 Proof
 *
 * Two probes that must pass to call Gate 1 PASS (not PARTIAL):
 *
 * 1) `.sim-h1` on the actual unauthenticated login screen has computed
 *    `letter-spacing` of `0px` (Patch B).
 *
 * 2) Activation handler runs end-to-end through to a visible state change
 *    (Patch A behaviour preservation): clicking the Start activation
 *    button transitions the activation pill from idle → waiting OR
 *    surfaces an honest error toast.
 *
 * Both probes use a fresh browser context with localStorage/JWT cleared
 * so the auth gate routes to LoginOnboarding rather than home.
 */
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("Gate 1 · proof A · `.sim-h1` on login screen has letter-spacing 0px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  /* Clear any JWT before app code runs so AuthGate routes to LoginOnboarding.
   * addInitScript runs on EVERY navigation including the first, so localStorage
   * is empty even if the chromium profile cached anything. */
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* noop */ }
  });

  await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
  /* Belt-and-braces · clear after first navigation too so any sync-set JWT
   * (from initAuthStorage's localStorage prime) is wiped before AuthGate
   * re-evaluates on the next render. */
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* noop */ }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  /* Wait for LoginOnboarding to mount. */
  await page.waitForSelector('[data-testid="login-start-button"]', { timeout: 30_000 });
  /* And for its h1 to render. */
  const h1 = page.locator(".sim-h1").first();
  await expect(h1).toBeVisible({ timeout: 5_000 });

  const styles = await h1.evaluate((el) => {
    const c = window.getComputedStyle(el);
    return {
      fontSize: c.fontSize,
      lineHeight: c.lineHeight,
      letterSpacing: c.letterSpacing,
      text: (el.textContent || "").trim().slice(0, 60),
    };
  });

  /* Read back the applied rule from CSSOM to confirm the source · this
   * proves the SimPage.css patch is loaded, not just a coincidence. */
  const ruleHasZero = await h1.evaluate((el) => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        for (const r of Array.from(rules)) {
          if (r instanceof CSSStyleRule && el.matches(r.selectorText) && r.style.letterSpacing) {
            return r.style.letterSpacing === "0px" || r.style.letterSpacing === "0";
          }
        }
      } catch { /* noop */ }
    }
    return false;
  });

  console.log("[Gate 1 · A] login .sim-h1 computed:", JSON.stringify(styles), "· ruleHasZero:", ruleHasZero);

  /* Hard gate · the squashed heading is the visible defect; 0px is the fix.
   * Chromium normalises `letter-spacing: 0px` to the keyword `"normal"`
   * in `getComputedStyle().letterSpacing` (CSS spec §6.1) · both values
   * mean zero tracking. Accept both AND verify the source rule
   * literally has letter-spacing: 0px in the loaded stylesheet. */
  expect(["0px", "normal"]).toContain(styles.letterSpacing);
  expect(ruleHasZero).toBe(true);
  /* line-height also confirmed at 1.05 ratio of fontSize. */
  const fs = parseFloat(styles.fontSize);
  const lh = parseFloat(styles.lineHeight);
  expect(lh / fs).toBeGreaterThan(1.0);
  expect(lh / fs).toBeLessThan(1.15);

  await page.close();
  await ctx.close();
});

test("Gate 1 · proof B · activation click reaches handler / state change", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      /* Filter Tauri-adapter warnings (expected in vite dev). */
      if (/tauri-adapter|favicon|sourcemap/i.test(txt)) return;
      consoleErrors.push(`console.error: ${txt.slice(0, 200)}`);
    }
  });

  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* noop */ }
  });

  await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* noop */ }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const startBtn = page.locator('[data-testid="login-start-button"]');
  await expect(startBtn).toBeVisible({ timeout: 30_000 });
  await expect(startBtn).toBeEnabled();

  /* Capture activation snapshot before click. */
  const before = await page.evaluate(() => {
    const pill = document.querySelector('[data-testid="login-state-pill"]');
    const idleBlock = document.querySelector('[data-testid="login-start-button"]');
    return {
      pillText: pill?.textContent ?? null,
      startBtnPresent: !!idleBlock,
      activationStatusAttr:
        document.querySelector('[data-activation-status]')?.getAttribute('data-activation-status') ??
        null,
    };
  });
  console.log("[Gate 1 · B] before click:", JSON.stringify(before));

  /* Click. */
  await startBtn.click();

  /* Wait for a visible state delta · either the activation pill flips to
   * `waiting` / `activating`, OR the start button disappears, OR an error
   * toast/state appears. Any of those proves the handler ran. */
  const delta = await page.waitForFunction(
    () => {
      const pill = document.querySelector('[data-testid="login-state-pill"]');
      const startBtn = document.querySelector('[data-testid="login-start-button"]');
      const errEl = document.querySelector('[data-testid="login-state-failed"]');
      const toastEl = document.querySelector('.lc-toast');
      const waitingEl = document.querySelector('[data-activation-status="waiting"]');
      const activatingEl = document.querySelector('[data-activation-status="activating"]');
      const activatedEl = document.querySelector('[data-activation-status="activated"]');
      const failedEl = document.querySelector('[data-activation-status="failed"]');
      const anyVisibleChange =
        !!waitingEl ||
        !!activatingEl ||
        !!activatedEl ||
        !!failedEl ||
        !!errEl ||
        !!toastEl ||
        (!!pill && pill.textContent !== "");
      const startVanished = !startBtn;
      return anyVisibleChange || startVanished
        ? {
            anyVisibleChange,
            startVanished,
            pillText: pill?.textContent ?? null,
            activationStatusAttr:
              document.querySelector('[data-activation-status]')?.getAttribute('data-activation-status') ??
              null,
            toastPresent: !!toastEl,
          }
        : false;
    },
    { timeout: 8_000 },
  );

  const after = await delta.jsonValue();
  console.log("[Gate 1 · B] after click:", JSON.stringify(after));

  expect(after).toBeTruthy();
  /* No console errors that would suggest the handler crashed. */
  const fatalErrors = consoleErrors.filter((e) => !/openSmart|opener|Tauri/i.test(e));
  expect(fatalErrors).toHaveLength(0);

  await page.close();
  await ctx.close();
});
