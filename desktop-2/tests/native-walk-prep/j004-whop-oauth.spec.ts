/**
 * Native Walk Prep · j004-connect-whop
 *
 * Automates the pre-OAuth slice of the Whop connect flow · everything up to
 * the external browser handoff. The OS-browser round-trip + `liquidclips://`
 * deep-link + tier chip flip are documented as `test.skip` blocks with
 * explicit reasons pointing at the manual walk doc.
 *
 * Reuses the golden-path capture harness pattern (fs + screenshot + probe).
 * Backend expected on http://localhost:8000 · Vite dev on http://localhost:5173.
 *
 * Reference doc:
 *   lcos/reports/rc1-sprint/native-walk-prep/j004-whop-oauth.md
 */

import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const HERE = path.dirname(__filename);

const CAPTURE_ROOT = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "lcos",
  "reports",
  "golden-path",
  "capture",
  "j004-connect-whop",
);

const BACKEND = process.env.LC_BACKEND ?? "http://localhost:8000";
const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET ??
  "e3a7eccce5c37ce2192fd1efa294be76566fcd30f304ad432395966882e5fb24";

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

async function mintJwt(clerkUserId: string, email: string): Promise<string> {
  const res = await fetch(`${BACKEND}/desktop/connect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({
      clerk_user_id: clerkUserId,
      challenge: "ch_lcos_walk_j004",
      email,
      first_name: "LCOS",
    }),
  });
  if (!res.ok) {
    throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { license_jwt: string };
  return data.license_jwt;
}

async function capture(
  page: Page,
  step: string,
  assertions: Array<{ id: string; pass: boolean; detail?: string }>,
): Promise<void> {
  const dir = path.join(CAPTURE_ROOT, step);
  await ensureDir(dir);
  try {
    await page.screenshot({
      path: path.join(dir, "screenshot.png"),
      fullPage: true,
    });
  } catch (e) {
    await fs.promises.writeFile(path.join(dir, "screenshot.err.txt"), String(e), "utf8");
  }
  let canonicalState: Record<string, unknown> = { error: "probe unavailable" };
  try {
    canonicalState = await page.evaluate(() => {
      const w = window as unknown as {
        __LCOS_PROBE__?: { canonicalState(): Record<string, unknown> };
      };
      return w.__LCOS_PROBE__?.canonicalState() ?? { error: "no probe" };
    });
  } catch (e) {
    canonicalState = { error: String(e) };
  }
  let telemetry: unknown[] = [];
  try {
    telemetry = await page.evaluate(() => {
      const w = window as unknown as { __LCOS_TELEMETRY__?: unknown[] };
      return (w.__LCOS_TELEMETRY__ ?? []).slice(-50);
    });
  } catch (e) {
    telemetry = [{ error: String(e) }];
  }
  await fs.promises.writeFile(
    path.join(dir, "canonical-state.json"),
    JSON.stringify(canonicalState, null, 2),
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(dir, "telemetry.json"),
    JSON.stringify(telemetry, null, 2),
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(dir, "assertions.json"),
    JSON.stringify(assertions, null, 2),
    "utf8",
  );
}

async function clearState(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* noop */
    }
  });
}

async function seedJwt(page: Page, jwt: string): Promise<void> {
  await page.evaluate((token: string) => {
    window.localStorage.setItem("lc.license.jwt.v1", token);
  }, jwt);
}

test.describe("j004-connect-whop · pre-OAuth slice", () => {
  test("step 2 · boot fresh user with JWT · TopHud never renders Guest", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j004_${Date.now()}`;
    const email = `walk+j004+${Date.now()}@lcos.local`;
    const jwt = await mintJwt(clerkId, email);
    await seedJwt(page, jwt);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Skip splash if Continue button surfaces
    const continueBtn = page.locator("button", { hasText: /continue/i }).first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    const bodyText = await page.locator("body").innerText();
    const bodyMentionsGuest = /\bguest\b/i.test(bodyText);
    const identityKind = await page.evaluate(() => {
      const el = document.querySelector("[data-identity-kind]");
      return el?.getAttribute("data-identity-kind") ?? null;
    });

    const assertions = [
      { id: "jwt-persisted", pass: await page.evaluate(() => !!window.localStorage.getItem("lc.license.jwt.v1")) },
      { id: "body-not-guest", pass: !bodyMentionsGuest, detail: `bodyMentionsGuest=${bodyMentionsGuest}` },
      { id: "identity-kind-in-ladder", pass: identityKind === null || ["handle", "lc-id", "email-local", "signing-in", "complete-profile", "pending"].includes(identityKind), detail: `identityKind=${identityKind}` },
    ];
    await capture(page, "02-boot-jwt-seeded", assertions);

    expect(bodyMentionsGuest, "TopHud must never say 'Guest' with a valid JWT (INV-001)").toBeFalsy();
  });

  test("step 3 · Settings → Whop Sync tab · not-connected chip surfaces", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j004_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/#/settings", { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);

    // Click through to whop-sync tab.
    // The tab identifiers in Settings.tsx include { id: "whop-sync", label: "Whop Sync" }.
    // Try clicking by role or text.
    const whopTab = page.locator("button, [role='tab']", { hasText: /whop sync/i }).first();
    if (await whopTab.isVisible().catch(() => false)) {
      await whopTab.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    const bodyText = await page.locator("body").innerText();

    // Look for the not-connected copy or chip data attribute.
    const notConnectedCopy = /not connected|connect whop/i.test(bodyText);
    const chipState = await page.evaluate(() => {
      const el = document.querySelector("[data-whop-state]");
      return el?.getAttribute("data-whop-state") ?? null;
    });

    const assertions = [
      { id: "route-mounted-settings", pass: bodyText.length > 20 },
      { id: "whop-not-connected-surfaced", pass: notConnectedCopy || chipState === "not_connected", detail: `chipState=${chipState} · copy=${notConnectedCopy}` },
      { id: "no-fake-connected-state", pass: chipState !== "connected", detail: `chipState=${chipState}` },
    ];
    await capture(page, "03-settings-whop-not-connected", assertions);
  });

  test("step 4 · Connect Whop click · backend /auth/whop/start receives request", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j004_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/#/settings", { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);

    // Click Whop Sync tab.
    const whopTab = page.locator("button, [role='tab']", { hasText: /whop sync/i }).first();
    if (await whopTab.isVisible().catch(() => false)) {
      await whopTab.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    // Intercept the /auth/whop/start call by watching page requests.
    const startRequestPromise = page.waitForRequest(
      (req) => req.url().includes("/auth/whop/start"),
      { timeout: 10_000 },
    ).catch(() => null);

    const connectBtn = page.locator("button", { hasText: /connect whop/i }).first();
    const connectBtnVisible = await connectBtn.isVisible().catch(() => false);
    if (connectBtnVisible) {
      // Prevent the actual shell-open from crashing Playwright by not awaiting the click's downstream effects.
      await connectBtn.click().catch(() => {});
    }

    const startRequest = await startRequestPromise;
    const assertions = [
      { id: "connect-whop-button-visible", pass: connectBtnVisible },
      { id: "backend-auth-whop-start-called", pass: startRequest !== null, detail: startRequest ? startRequest.url() : "no request observed" },
    ];
    await capture(page, "04-connect-whop-click", assertions);
  });

  // ─── NATIVE / MANUAL steps below · documented as skips ────────────

  test.skip(
    "step 5 · complete Whop OAuth in OS browser · MANUAL · Whop authorize page requires real credentials + human · see j004-whop-oauth.md §Step 5",
    async () => {},
  );

  test.skip(
    "step 6 · liquidclips:// deep-link handoff · MANUAL · macOS URL scheme resolution to native shell · Playwright cannot drive macOS URL scheme handlers · see j004-whop-oauth.md §Step 6",
    async () => {},
  );

  test.skip(
    "step 6b · tier chip flips in-app without reload · PARTIAL · full assertion requires the deep-link fire from step 6 · dev-mode shortcut is bus.emit('auth:whop-linked') · not covered here · see j004-whop-oauth.md §Step 6",
    async () => {},
  );

  test.skip(
    "step 7 · disconnect + reconnect · MANUAL · reversibility check requires human · not RC1-blocking · see j004-whop-oauth.md §Step 7",
    async () => {},
  );
});
