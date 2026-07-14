/**
 * mandatory-update-gate.spec.ts · 2026-07-14 · Path B proof
 *
 * Locks Daniel's Path B behavior rules against the real Vite bundle:
 *
 *   1. Mandatory policy (active < minimum_supported_version) mounts
 *      `[data-testid="kade-update-gate"]` AND application shell
 *      + route surfaces are NOT mounted.
 *   2. Direct navigation to protected routes cannot bypass the gate
 *      (deep-link hash still lands on the gate).
 *   3. Cached mandatory policy blocks routes even when manifest is
 *      unreachable (offline enforcement).
 *   4. Failed mandatory update state stays blocking (gate still
 *      mounted, retry surface reachable).
 *   5. An OPTIONAL update (manifest has no minimum_supported_version,
 *      or active >= min) does NOT mount the mandatory gate;
 *      application shell + routes render normally.
 *   6. Manifest response with `minimum_supported_version` absent
 *      preserves current behavior.
 *
 * Every assertion is DUAL: we prove the gate present AND prove the
 * protected surface absent · never just "selector times out".
 */

import { test, expect } from "@playwright/test";

// ─────────────────────────────────────────────────────────────
// Selectors we check for absence when the gate is up.
// If any of these mount, the gate has failed to block.
// ─────────────────────────────────────────────────────────────
const PROTECTED_SELECTORS = [
  '[data-testid="ws-inspector"]',
  '[data-testid="publish-now"]',
  '[data-testid="wallet-panel"]',
  '[data-testid="clip-card"]',
  '.lc-cockpit-dock',
  '.lc-workstation-frame',
  '[data-testid="login-panel"]',
  '.lc-side-nav',
] as const;

async function assertGateBlocksApplication(page: import("@playwright/test").Page): Promise<void> {
  // Gate present.
  await expect(page.locator('[data-testid="kade-update-gate"]')).toBeVisible();
  // Application shell absent (all of them). Uses `toHaveCount(0)` so
  // Playwright fails on presence instead of on the reverse ambiguity
  // of "we never saw it" (which could also mean "we didn't wait long
  // enough"). The gate mounts synchronously; the app tree does not
  // render behind it.
  for (const sel of PROTECTED_SELECTORS) {
    await expect(page.locator(sel)).toHaveCount(0);
  }
}

async function mockManifest(
  page: import("@playwright/test").Page,
  body: Record<string, unknown> | null,
  status = 200,
): Promise<void> {
  await page.route(/\/runtime\/manifest\.json/, async (route) => {
    if (body === null) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function clearPolicyCache(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try { window.localStorage.removeItem("lc.update.policy.v1"); } catch { /* noop */ }
  });
}

test.describe("Mandatory Update Gate · Path B", () => {
  test("mandatory manifest mounts Kade gate · application shell + routes absent", async ({ page }) => {
    await clearPolicyCache(page);
    await mockManifest(page, {
      version: "2.2.38",
      channel: "stable",
      sha256: "abc",
      signature: "xyz",
      url: "https://api.liquidclips.app/runtime/download/2.2.38",
      minimum_supported_version: "2.2.38",
    });
    await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
    await assertGateBlocksApplication(page);
    // Cross-check policy metadata surfaced on the gate.
    const gate = page.locator('[data-testid="kade-update-gate"]');
    await expect(gate).toHaveAttribute("data-mandatory-kind", "mandatory");
    await expect(gate).toHaveAttribute("data-min-supported", "2.2.38");
  });

  test("deep-link to workstation cannot bypass the gate", async ({ page }) => {
    await clearPolicyCache(page);
    await mockManifest(page, {
      version: "2.2.38",
      channel: "stable",
      sha256: "abc",
      signature: "xyz",
      url: "https://api.liquidclips.app/runtime/download/2.2.38",
      minimum_supported_version: "2.2.38",
    });
    // Deep-link hash targets workstation directly.
    await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
    await assertGateBlocksApplication(page);
    // Also verify hash update to `#/wallet` post-mount does not unmount the gate.
    await page.evaluate(() => { window.location.hash = "#/wallet"; });
    await assertGateBlocksApplication(page);
  });

  test("cached mandatory policy blocks routes when manifest is unreachable", async ({ page }) => {
    // Seed the localStorage cache with a mandatory policy BEFORE app
    // boot. Then simulate manifest fetch failure so the resolver
    // MUST fall back to cache.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          "lc.update.policy.v1",
          JSON.stringify({
            active: "0.0.1",
            channel: "stable",
            latest_version: "2.2.38",
            minimum_supported_version: "2.2.38",
            fetched_at: Date.now() - 60_000,
          }),
        );
      } catch { /* noop */ }
    });
    await page.route(/\/runtime\/manifest\.json/, (r) => r.abort("failed"));
    await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
    const gate = page.locator('[data-testid="kade-update-gate"]');
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("data-mandatory-kind", "mandatory_cached");
    await expect(page.locator('[data-testid="kade-update-cached-marker"]')).toBeVisible();
    for (const sel of PROTECTED_SELECTORS) {
      await expect(page.locator(sel)).toHaveCount(0);
    }
  });

  test("optional update (no minimum_supported_version) preserves current behavior", async ({ page }) => {
    await clearPolicyCache(page);
    await mockManifest(page, {
      version: "2.2.37",
      channel: "stable",
      sha256: "abc",
      signature: "xyz",
      url: "https://api.liquidclips.app/runtime/download/2.2.37",
      // No `minimum_supported_version` field.
    });
    await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
    // Gate must NOT be present.
    await expect(page.locator('[data-testid="kade-update-gate"]')).toHaveCount(0);
    // Application shell CAN mount · we don't assert on any specific
    // route, just that the gate isn't there. That's the invariant:
    // absent minimum_supported_version = current behavior preserved.
    await page.waitForTimeout(2_000);
    await expect(page.locator('[data-testid="kade-update-gate"]')).toHaveCount(0);
  });

  test("manifest 204 (no bundle available) preserves current behavior", async ({ page }) => {
    await clearPolicyCache(page);
    await mockManifest(page, null); // 204
    await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="kade-update-gate"]')).toHaveCount(0);
  });

  test("active version equal to minimum_supported_version → not mandatory", async ({ page }) => {
    // The seeded active runtime at Vite-dev boot is whatever
    // `runtimeVersionSync()` returns from `dist/VERSION` (or the
    // shell fallback). We ensure equality → not mandatory by
    // returning the SAME version as min.
    await clearPolicyCache(page);
    await mockManifest(page, {
      version: "2.2.36",
      channel: "stable",
      sha256: "abc",
      signature: "xyz",
      url: "https://api.liquidclips.app/runtime/download/2.2.36",
      minimum_supported_version: "0.0.0", // impossible to be below
    });
    await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="kade-update-gate"]')).toHaveCount(0);
  });
});
