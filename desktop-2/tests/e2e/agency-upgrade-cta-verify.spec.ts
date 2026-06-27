/**
 * Targeted verification · agency-preview-upgrade-cta click handler runs.
 *
 * After the openSmart → opener-plugin fix + the async-handler/toast
 * change, the upgrade CTA must:
 *   1) Be visible and enabled in Agency mode for non-Agency tier
 *   2) When clicked, the async handler runs through startCheckout
 *   3) In the test dev env (no Tauri), opener-plugin throws, the handler
 *      catches it and EMITS A TOAST via `bus.emit("toast", ...)`
 *
 * Observing the toast event is the deterministic signal — the transient
 * `disabled`/`aria-busy` window is too short (~ms) for waitForFunction to
 * reliably observe across machines. The toast emit is a hard contract.
 */
import { test, expect } from "@playwright/test";
import { installBackendStubs } from "./fixtures/backendFixtures";

test("agency-preview-upgrade-cta · click handler runs · toast emits on failure path", async ({ page }) => {
  /* Gate 9 hardening (2026-06-27) — stub /me + /sync so the AuthGate
   * doesn't kick to LoginOnboarding mid-mount under cold-vite chunk
   * load. Same shape as Gate 5 / Gate 9 audit harness. */
  await installBackendStubs(page, { tier: "pro" });
  /* Install a toast listener BEFORE the app boots so we don't miss the
   * emit. `__lcBus` is exposed on window by events.ts module init, and
   * the bus's `on` is a sync subscribe. */
  await page.addInitScript(() => {
    const w = window as unknown as {
      __lcToastCapture?: Array<unknown>;
      __lcBus?: { on: (e: string, h: (p: unknown) => void) => () => void };
    };
    w.__lcToastCapture = [];
    /* Bus might not be wired at addInitScript time. Defer the subscribe. */
    const tryWire = () => {
      const b = w.__lcBus;
      if (b && typeof b.on === "function") {
        b.on("toast", (p) => { w.__lcToastCapture!.push(p); });
      } else {
        setTimeout(tryWire, 50);
      }
    };
    tryWire();
  });

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem("lc.mode", "agency");
    } catch { /* noop */ }
  });
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  /* Gate 7 lazy-loaded SimulatorRouter routes can take longer than 15s
   * to land on a cold-vite first boot. 30s gives the chunk a real
   * window without retry masking. */
  await page.waitForSelector(".lc-app", { timeout: 30_000 });

  /* Confirm bus wiring before we click. */
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lcBus?: unknown };
      return !!w.__lcBus;
    },
    { timeout: 5_000 },
  );

  /* Flip to agency so AgencyPreviewBanner mounts. */
  await page.evaluate(() => {
    try { window.localStorage.setItem("lc.mode", "agency"); } catch { /* noop */ }
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("mode:change", { mode: "agency" });
  });
  await page.waitForTimeout(400);

  const cta = page.locator('[data-testid="agency-preview-upgrade-cta"]');
  await expect(cta).toBeVisible({ timeout: 5_000 });
  await expect(cta).toBeEnabled();

  /* Capture the label · proves the button is the real preview banner,
   * not a stale mount. */
  const baseText = (await cta.textContent()) ?? "";
  expect(baseText).toContain("Upgrade to Agency");
  expect(baseText).toContain("/mo");

  /* Exercise the same pointer path as a customer. */
  await cta.click();

  /* LC-UI-P0-001 (2026-06-26) — the prior version of this assertion
   * had an `else` branch that asserted `1 === 1` whenever no toast
   * fired. That made the spec a fake pass: the broken silent-success
   * path (Mock returning {ok:true} without an opener) sailed through
   * with no observable signal.
   *
   * After the adapter fix, the Agency CTA in an authenticated path
   * MUST either:
   *   (a) succeed at opening the real account-app checkout · in the
   *       Playwright dev env there is no Tauri opener, so the real
   *       adapter's openSmart throws → handler catches → bus emits a
   *       toast tagged "checkout".
   *   (b) fall through to the explicit failure toast.
   * Either way, a toast event MUST land within 4s. No toast = real bug.
   */
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lcToastCapture?: Array<unknown> };
      return (w.__lcToastCapture?.length ?? 0) > 0;
    },
    { timeout: 4_000 },
  );

  const toasts = await page.evaluate(() => {
    const w = window as unknown as { __lcToastCapture?: Array<unknown> };
    return w.__lcToastCapture ?? [];
  });

  const t = toasts[0] as { kind?: string; title?: string };
  expect(t.kind).toBe("error");
  expect((t.title ?? "").toLowerCase()).toContain("checkout");
  await expect(cta).toHaveAttribute("data-checkout-failed", "1");
  await expect(cta).toContainText("Retry Agency checkout");
});

/* LC-UI-P0-001 regression test — Agency upgrade CTA must EITHER open
 * an external checkout URL OR surface a visible failure toast. Mock
 * returning {ok:true} without an opener is forbidden in authenticated
 * paths. This is the gate that proves the adapter selection fix and
 * the call-site await fix hold together. */
test("LC-UI-P0-001 · Agency upgrade CTA · authenticated click opens checkout OR shows fallback toast · NEVER silent success", async ({ page }) => {
  await installBackendStubs(page, { tier: "pro" });
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  /* Capture toasts + capture every navigation/open attempt the page makes. */
  await page.addInitScript(() => {
    const w = window as unknown as {
      __lcToastCapture?: Array<unknown>;
      __lcOpenAttempts?: Array<string>;
      __lcBus?: { on: (e: string, h: (p: unknown) => void) => () => void };
    };
    w.__lcToastCapture = [];
    w.__lcOpenAttempts = [];

    /* Monkey-patch window.open to record (the real adapter's openSmart
     * falls back to window.open in browser preview). */
    const realOpen = window.open;
    window.open = ((...args: Parameters<typeof window.open>) => {
      try {
        const url = String(args[0] ?? "");
        if (url) w.__lcOpenAttempts!.push(url);
      } catch { /* noop */ }
      return realOpen.apply(window, args);
    }) as typeof window.open;

    const tryWire = () => {
      const b = w.__lcBus;
      if (b && typeof b.on === "function") {
        b.on("toast", (p) => { w.__lcToastCapture!.push(p); });
      } else {
        setTimeout(tryWire, 50);
      }
    };
    tryWire();
  });

  /* Authenticated path · JWT present · the adapter MUST be the real one. */
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem("lc.mode", "agency");
    } catch { /* noop */ }
  });
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lc-app", { timeout: 30_000 });

  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lcBus?: unknown };
      return !!w.__lcBus;
    },
    { timeout: 5_000 },
  );
  await page.evaluate(() => {
    try { window.localStorage.setItem("lc.mode", "agency"); } catch { /* noop */ }
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("mode:change", { mode: "agency" });
  });
  await page.waitForTimeout(400);

  const cta = page.locator('[data-testid="agency-preview-upgrade-cta"]');
  await expect(cta).toBeVisible({ timeout: 5_000 });
  await expect(cta).toBeEnabled();
  await cta.click();

  /* Wait up to 4s for EITHER an open attempt OR a toast. */
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __lcOpenAttempts?: Array<string>;
        __lcToastCapture?: Array<unknown>;
      };
      const opens = w.__lcOpenAttempts?.length ?? 0;
      const toasts = w.__lcToastCapture?.length ?? 0;
      return opens > 0 || toasts > 0;
    },
    { timeout: 4_000 },
  );

  const { opens, toasts } = await page.evaluate(() => {
    const w = window as unknown as {
      __lcOpenAttempts?: Array<string>;
      __lcToastCapture?: Array<unknown>;
    };
    return { opens: w.__lcOpenAttempts ?? [], toasts: w.__lcToastCapture ?? [] };
  });

  /* At least one of A or B must be true. */
  const openedCheckout = opens.some((u) => /account\.liquidclips\.app/.test(u) || /dashboard#plans/.test(u));
  const toastedFailure = toasts.some((t) => {
    const tt = t as { kind?: string; title?: string };
    return tt.kind === "error" && /checkout/i.test(tt.title ?? "");
  });
  expect(openedCheckout || toastedFailure).toBe(true);

  /* Belt + braces: clicking the live handler must NOT crash. */
  expect(consoleErrors.filter((e) => !/tauri-adapter|favicon|sourcemap/i.test(e))).toEqual([]);
});
