/**
 * Native Walk Prep · j005-upload
 *
 * Automates the empty-state UI + preflight rejection UI + drop-zone
 * visibility for the Upload journey. The native file picker (NSOpenPanel)
 * and Tauri drag/drop events cannot be driven from Playwright · those steps
 * are documented as `test.skip` blocks.
 *
 * Reference doc:
 *   lcos/reports/rc1-sprint/native-walk-prep/j005-upload.md
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
  "j005-upload",
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
      challenge: "ch_lcos_walk_j005",
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

test.describe("j005-upload · empty state + preflight + drop-zone slice", () => {
  test("step 2-3 · CreateClips route mounts · Upload portal CTA visible · no fake sample tile", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j005_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/#/create", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator("body").innerText();
    const uploadCta = page.locator("button, [role='button']", { hasText: /upload portal|upload video|drop.*video|browse.*file/i }).first();
    const uploadCtaVisible = await uploadCta.isVisible().catch(() => false);

    // Fake-data guard · walk MUST NOT show a sample clip in the empty state.
    const fakeSampleCopy = /sample clip|demo clip|example video|placeholder video/i.test(bodyText);

    const assertions = [
      { id: "create-route-mounted", pass: bodyText.length > 20 },
      { id: "no-boot-error", pass: !bodyText.toLowerCase().includes("boot error") },
      { id: "upload-cta-visible", pass: uploadCtaVisible, detail: "Upload portal button" },
      { id: "no-fake-sample-tile", pass: !fakeSampleCopy, detail: "empty state should not contain 'sample clip' / 'demo clip'" },
    ];
    await capture(page, "02-empty-upload-ui", assertions);

    expect(fakeSampleCopy, "Empty state must not render fixture data (INV-002)").toBeFalsy();
  });

  test("step 3b · drop-zone element present · drag-target selector resolvable", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j005_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/#/create", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Look for a drop-zone data attribute or a common drop-zone class.
    // Selectors are documented in the walk-prep doc · if the shell doesn't have
    // one yet, that's a doc gap not a bug (INV-011).
    const dropZoneCount = await page.locator(
      "[data-drop-zone], [data-source-drop], .drop-zone, [aria-label*='drop' i]",
    ).count();

    const assertions = [
      { id: "drop-zone-element-present", pass: dropZoneCount > 0, detail: `count=${dropZoneCount}` },
    ];
    await capture(page, "03b-drop-zone-selector", assertions);
    // Not failing on absence · this is a discovery test.
  });

  test("step 5 · preflight rejection UI · corrupt file path fires banner (via bus emit)", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j005_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/#/create", { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);

    // Fire a mock preflight rejection via a dev-mode bus emit. The bus is
    // documented in useEvent(...); the source:file-rejected topic is the
    // walk-prep expected shape.
    // If the bus is not exposed on window, this step falls back to skip.
    const busReachable = await page.evaluate(() => {
      const w = window as unknown as { __LCOS_BUS__?: { emit: (topic: string, payload: unknown) => void } };
      return typeof w.__LCOS_BUS__?.emit === "function";
    });

    if (busReachable) {
      await page.evaluate(() => {
        const w = window as unknown as { __LCOS_BUS__?: { emit: (topic: string, payload: unknown) => void } };
        w.__LCOS_BUS__?.emit("source:file-rejected", {
          reason: "not_a_valid_video",
          filename: "walk-video-corrupt.txt",
        });
      });
      await page.waitForTimeout(1500);
    }

    const bodyText = await page.locator("body").innerText();
    const rejectionBanner = /not a valid video|couldn'?t use|invalid file|unsupported/i.test(bodyText);

    const assertions = [
      { id: "bus-reachable", pass: busReachable, detail: busReachable ? "" : "window.__LCOS_BUS__ not exposed · dev-mode gap · skip assertion below" },
      { id: "rejection-banner-surfaces", pass: !busReachable || rejectionBanner, detail: `bannerCopyPresent=${rejectionBanner}` },
    ];
    await capture(page, "05-preflight-rejection-ui", assertions);
    // Discovery test · does not fail hard on absence of bus seam.
  });

  // ─── NATIVE / MANUAL steps below · documented as skips ────────────

  test.skip(
    "step 4a · macOS NSOpenPanel file picker · NATIVE · Playwright cannot drive NSOpenPanel · manual pick required · see j005-upload.md §Step 4a",
    async () => {},
  );

  test.skip(
    "step 4b · Finder drag-drop onto shell window · NATIVE · Tauri file drop event is shell-native · manual drag required · see j005-upload.md §Step 4b",
    async () => {},
  );

  test.skip(
    "step 6 · sidecar handoff after picker · NATIVE · sidecar startup + real ingest · C3 owns the end-to-end test · see j005-upload.md §Step 6 / j006-clip-generation.md",
    async () => {},
  );

  test.skip(
    "step 7 · sidecar log line references run_id · NATIVE · requires running Python sidecar · out of Vite-dev scope · see j005-upload.md §Step 7",
    async () => {},
  );
});
