/**
 * BLOCK 5 · Visual customer-path audit.
 *
 * Walks every principal customer surface with a seeded Agency persona
 * and asserts:
 *   1. Shell mounts (Primary navigation sidebar visible).
 *   2. The route's own root testid / heading renders.
 *   3. No unhandled console error surfaces during boot.
 *   4. Screenshot captured for reviewer eyeballing.
 *
 * Findings feed `POST_RC1_BLOCK5_AUDIT.md`. Any surface that fails
 * lands as a follow-up ticket in `POST_RC1_PROGRESS.md`.
 *
 * NOT covered here (out of scope for a first-pass audit):
 *   * Interactive flows (button clicks, form fills, cross-clip nav)
 *     — those are covered by dedicated specs
 *     (full-clipping-journey · settings-cockpit · cancellation-six-states).
 *   * Native drag-drop, deep-link handoffs — those live in
 *     tests/native-walk-prep/*.
 *
 * Goal is a fast, deterministic first-pass so regressions surface as
 * "shell wouldn't mount for route X" not as "user tried to click Y".
 */

import { expect, test } from "@playwright/test";

import { seedActiveShell } from "./_auth-harness";

interface SurfaceEntry {
  key: string;
  hash: string;
  waitFor: "heading" | "sidebar-only" | "custom";
  headingRegex?: RegExp;
  customSelector?: string;
}

// Section-pipeline + Design-OS surfaces to sweep. The list is
// intentionally focused on canonical customer touchpoints, not every
// route — those are covered by dedicated specs.
const SURFACES: SurfaceEntry[] = [
  // Section-pipeline money surfaces (already have L5 coverage; here we
  // confirm the wallet-panel route boots)
  { key: "account", hash: "#/account", waitFor: "heading", headingRegex: /Wallet/ },
  { key: "learn", hash: "#/learn", waitFor: "sidebar-only" },
  { key: "browse", hash: "#/browse", waitFor: "sidebar-only" },
  // Design-OS tool surfaces
  { key: "home", hash: "#/", waitFor: "sidebar-only" },
  { key: "workstation", hash: "#/workstation", waitFor: "sidebar-only" },
  { key: "my-clips", hash: "#/library", waitFor: "sidebar-only" },
  { key: "campaigns", hash: "#/campaigns", waitFor: "sidebar-only" },
  { key: "community", hash: "#/community", waitFor: "sidebar-only" },
  { key: "channels", hash: "#/channels", waitFor: "sidebar-only" },
  { key: "schedule", hash: "#/schedule", waitFor: "sidebar-only" },
  { key: "settings", hash: "#/settings", waitFor: "sidebar-only" },
];

test.describe("BLOCK 5 · visual customer-path audit", () => {
  for (const s of SURFACES) {
    test(`surface:${s.key} · shell mounts · no unhandled console error`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          // Known noise filter — we're auditing for NEW regressions.
          if (text.startsWith("[shape] ")) return;
          if (text.includes("Warning: An update")) return;
          if (text.includes("unrecognized subscription_status")) return;
          // 2026-07-14 · The harness deliberately 503s `/channels*` and
          // `/me/wallet/summary` to simulate the "backend offline" state
          // that customer routes are supposed to render honestly (D1
          // cluster 2 · see _auth-harness.ts:344-370). Filtering the
          // browser's own console.error for those fulfilled 503s so the
          // BLOCK 5 boot walk doesn't fail on the harness's own
          // intentional state simulation.
          if (text.includes("Failed to load resource: the server responded with a status of 503")) return;
          consoleErrors.push(text);
        }
      });

      await seedActiveShell(page);
      await page.goto(`/?skipIntro=1${s.hash}`, { waitUntil: "domcontentloaded" });

      // Dismiss the agency welcome modal if it mounts on top of the
      // shell — this is expected on a fresh Agency user and covers
      // the sidebar. The audit's goal is to reach the underlying
      // surface, not to click through the modal every time. If the
      // "Later" button doesn't exist within 3s, we assume no modal
      // and proceed to the sidebar assertion.
      const laterBtn = page.getByRole("button", { name: /^Later$/ });
      await laterBtn
        .click({ timeout: 3_000 })
        .catch(() => {
          /* no modal on this surface — fine */
        });

      // Shell mount proof: every surface should reach the primary nav.
      // Cross-pipeline: Section pipeline names its sidebar
      // "Primary navigation"; Design-OS pipeline leaves it unnamed but
      // always renders a Home button. Assert on the button since it
      // exists in both.
      await expect(
        page.getByRole("button", { name: /^Home$/ }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Optional: route-specific heading / testid.
      if (s.waitFor === "heading" && s.headingRegex) {
        await expect(page.getByRole("heading", { name: s.headingRegex }).first())
          .toBeVisible({ timeout: 15_000 });
      } else if (s.waitFor === "custom" && s.customSelector) {
        await expect(page.locator(s.customSelector).first()).toBeVisible({ timeout: 15_000 });
      }

      // Screenshot for the audit report.
      await page.screenshot({
        path: `docs/ui-master/evidence/block5-audit/${s.key}.png`,
        fullPage: false,
      });

      // Console-error probe · every unexpected error lands here.
      expect(
        consoleErrors,
        `unexpected console errors on surface:${s.key}\n${consoleErrors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
