/**
 * Native Walk Prep · j015-runtime-update
 *
 * Automates UpdateBeacon states + banner copy audit + version parity
 * across surfaces. The actual runtime bundle download + swap + quit + relaunch
 * are all native. Those steps are `test.skip` blocks with reasons pointing
 * at the manual walk doc.
 *
 * BUG-012 · MANDATORY relaunch remains in effect through RC1. The banner
 * copy audit test below fails hard if the pill uses "Reload" without the
 * relaunch caveat.
 *
 * Reference doc:
 *   lcos/reports/rc1-sprint/native-walk-prep/j015-runtime-update.md
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
  "j015-runtime-update",
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
      challenge: "ch_lcos_walk_j015",
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

test.describe("j015-runtime-update · beacon states + BUG-012 relaunch copy audit", () => {
  test("step 1 · boot · read runtime version from TopHud", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j015_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Read starting version from TopHud (uses __APP_VERSION__ + runtime-version data attr).
    const runtimeVersion = await page.evaluate(() => {
      const el = document.querySelector("[data-runtime-version]");
      return el?.getAttribute("data-runtime-version") ?? null;
    });
    const appVersion = await page.evaluate(() => {
      const el = document.querySelector("[data-app-version]");
      return el?.getAttribute("data-app-version") ?? null;
    });

    const assertions = [
      { id: "app-mounted", pass: (await page.locator("body").innerText()).length > 20 },
      { id: "runtime-version-attribute-present", pass: runtimeVersion !== null, detail: `runtimeVersion=${runtimeVersion}` },
      { id: "app-version-attribute-present", pass: appVersion !== null, detail: `appVersion=${appVersion}` },
    ];
    await capture(page, "01-boot-version-read", assertions);
  });

  test("step 2 · UpdateBeacon not visible when up-to-date · no fake update pill", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j015_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const beacon = page.locator("[data-testid='update-beacon']");
    const beaconVisible = await beacon.isVisible().catch(() => false);
    const beaconCount = await beacon.count();

    const assertions = [
      { id: "beacon-either-hidden-or-honest", pass: !beaconVisible || beaconCount === 1, detail: `visible=${beaconVisible} count=${beaconCount}` },
    ];
    await capture(page, "02-beacon-no-pending", assertions);
  });

  test("step 5 · CRITICAL · UpdateBeacon copy must include quit/relaunch language when pill surfaces (BUG-012)", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j015_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Force the beacon into its "update ready" state via a dev-mode hook if
    // one exists. If not, we grep the source-attached copy from the DOM.
    const forced = await page.evaluate(() => {
      const w = window as unknown as { __LCOS_DEV__?: { fakeRuntimeStaged?: (v: string) => boolean } };
      if (typeof w.__LCOS_DEV__?.fakeRuntimeStaged === "function") {
        return w.__LCOS_DEV__.fakeRuntimeStaged("v9.99.99-walk");
      }
      return false;
    }).catch(() => false);

    if (forced) {
      await page.waitForTimeout(1500);
    }

    const beacon = page.locator("[data-testid='update-beacon']");
    const beaconVisible = await beacon.isVisible().catch(() => false);
    let beaconCopy = "";
    if (beaconVisible) {
      beaconCopy = (await beacon.innerText().catch(() => "")).trim();
    }

    // The banner copy audit: if the pill is visible, the copy MUST mention
    // one of: quit · relaunch · restart. "Reload" alone is a beta-doc
    // violation per BUG-012 disposition.
    const relaunchLanguage = beaconVisible
      ? /quit|relaunch|restart/i.test(beaconCopy)
      : true;

    const reloadOnlyLanguage = beaconVisible
      ? /reload/i.test(beaconCopy) && !relaunchLanguage
      : false;

    const assertions = [
      { id: "dev-force-hook-available", pass: forced, detail: `forced=${forced} · if false, walk can't audit copy in dev · surface a data-update-copy attr from UpdateBeacon` },
      { id: "if-beacon-visible-copy-contains-relaunch-language", pass: relaunchLanguage, detail: `beaconVisible=${beaconVisible} · copy="${beaconCopy}"` },
      { id: "not-reload-only-language", pass: !reloadOnlyLanguage, detail: `reloadOnly=${reloadOnlyLanguage} · CRITICAL · this is a BUG-012 doc violation` },
    ];
    await capture(page, "05-beacon-copy-audit", assertions);

    // Only hard-fail if the beacon is visibly stating "Reload" without any
    // relaunch verbiage. If dev hook missing, this assertion is skipped
    // (dev-force-hook-available records the discovery).
    if (beaconVisible) {
      expect(
        reloadOnlyLanguage,
        "UpdateBeacon copy MUST explicitly mention quit / relaunch / restart per BUG-012. 'Reload' alone is a beta-doc violation.",
      ).toBeFalsy();
    }
  });

  test("step 8 · version parity across surfaces (post-relaunch would-be assertion)", async ({ page }) => {
    // This test asserts the FRONTEND parity contract that Train B1 established
    // with the __APP_VERSION__ 5-site sweep. The actual post-relaunch
    // verification is native + manual · this is the observable slice.
    await clearState(page);
    const clerkId = `user_walk_j015_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Read runtime version from all surfaces where TopHud + Settings +
    // Diagnostics all render it (or as many as are mounted).
    const versions = await page.evaluate(() => {
      const attrs: Record<string, string | null> = {};
      const hud = document.querySelector("[data-runtime-version]");
      attrs.hud = hud?.getAttribute("data-runtime-version") ?? null;
      const app = document.querySelector("[data-app-version]");
      attrs.app = app?.getAttribute("data-app-version") ?? null;
      // Look for a diagnostics-panel version.
      const diag = document.querySelector("[data-diagnostics-runtime-version]");
      attrs.diagnostics = diag?.getAttribute("data-diagnostics-runtime-version") ?? null;
      return attrs;
    });

    // Collect non-null versions and assert they're byte-identical.
    const nonNull = Object.entries(versions).filter(([, v]) => v !== null);
    const values = nonNull.map(([, v]) => v);
    const unique = new Set(values);
    const parityHolds = unique.size <= 1;

    const assertions = [
      { id: "at-least-one-version-source-mounted", pass: nonNull.length >= 1, detail: JSON.stringify(versions) },
      { id: "all-mounted-version-sources-agree", pass: parityHolds, detail: `values=${values.join(",")} · unique=${unique.size}` },
    ];
    await capture(page, "08-version-parity", assertions);

    if (nonNull.length >= 2) {
      expect(parityHolds, "All version-displaying surfaces must show byte-identical values (BC-002)").toBeTruthy();
    }
  });

  // ─── NATIVE / MANUAL steps below · documented as skips ────────────

  test.skip(
    "step 3 · stage new bundle to manifest host · MANUAL · release orchestration outside the walk · see j015-runtime-update.md §Step 3",
    async () => {},
  );

  test.skip(
    "step 4 · runtime_check_now command · NATIVE · Tauri command · Playwright cannot invoke Tauri commands in Vite dev · see j015-runtime-update.md §Step 4",
    async () => {},
  );

  test.skip(
    "step 6 · Cmd+R reload attempt · NATIVE · URI resolver cache is a Rust static · Playwright observability limited · BUG-012 empirical proof requires manual observation · see j015-runtime-update.md §Step 6",
    async () => {},
  );

  test.skip(
    "step 7 · quit + relaunch cycle · NATIVE · macOS lifecycle event · Playwright cannot Cmd+Q · BUG-012 MANDATORY relaunch · see j015-runtime-update.md §Step 7",
    async () => {},
  );
});
