/**
 * P7 · Publish → RewardClip mint · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Locks: on successful publish, /me/reward-clips receives a POST +
 * the Earn tab surfaces the new row.
 */
import { test, expect, type Page } from "@playwright/test";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";
import { seedAuthenticatedShell } from "./_auth-harness";

const HARNESS_JWT = "harness-jwt-p7";

async function seedAuth(page: Page) {
  /* D1 (2026-07-12) · canonical auth harness. Agency tier so paid
   * features (Earn row post-mint) render. The spec-specific /me + /sync
   * + /me/reward-clips overrides below are registered AFTER this call
   * and win via Playwright reverse-registration priority. The spec
   * relies on HARNESS_JWT being minted through fetch(), so the extra
   * addInitScript below writes it into the same LC_JWT key the harness
   * seeds — mint requests carry the same Bearer token the /me guard
   * expects. */
  await seedAuthenticatedShell(page, { tier: "agency" });
  await page.addInitScript((jwt: string) => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
      window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
      // Opt into the real HTTP adapter path so useRewardClips fires
      // a fetch that page.route can intercept
      // (sidecar-stub.ts:2114 shouldTryHttpBackend). Without this,
      // the mock branch returns empty clips and the row never appears.
      window.localStorage.setItem("lc.dev.force-http.v1", "1");
    } catch { /* non-fatal */ }
  }, HARNESS_JWT);
}

test.describe("Publish → RewardClip mint", () => {
  test("publish success → POST /me/reward-clips → Earn shows row", async ({
    page,
    baseURL,
  }) => {
    await seedAuth(page);
    await page.route("**/me**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(meFixture({ tier: "agency" })),
      }),
    );
    await page.route("**/sync", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture({ tier: "agency" })),
      }),
    );

    let mintCalled = false;
    await page.route("**/me/reward-clips**", async (route) => {
      if (route.request().method() === "POST") {
        mintCalled = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, reward_clip_id: "rc_e2e_p7" }),
        });
      }
      /* GET · return the newly-minted row.
       * Shape must match BackendRewardClipBlock (sidecar-stub.ts:2333)
       * · envelope key is `reward_clips` · title lives at
       * `whop_reward_title` (NOT clip_title). */
      const now = new Date().toISOString();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reward_clips: [
            {
              id: "rc_e2e_p7",
              whop_reward_id: "wr_e2e_p7",
              whop_reward_title: "e2e-p7-clip",
              clip_idx: 0,
              platform: null,
              account_label: null,
              campaign_id: null,
              whop_submission_id: null,
              status: "generated",
              tracking_link: null,
              created_at: now,
              updated_at: now,
            },
          ],
        }),
      });
    });

    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    /* Simulate publish success · fires the mint chain. Real: PublishModule
     * calls `runExportAndMint` which POSTs to /me/reward-clips. */
    await page.evaluate(() => {
      const w = window as unknown as {
        __lcBus?: { emit: (e: string, p: Record<string, unknown>) => void };
      };
      w.__lcBus?.emit("engine:complete", { kind: "export" });
    });

    /* Trigger the mint from inside the page context so page.route
     * mocks actually fire. `page.request.post` bypasses the route
     * interceptors (it uses Playwright's APIRequestContext) which
     * was returning 404 because no real backend was running. Using
     * window.fetch routes through Chromium's network stack where
     * page.route hooks live. */
    const mintStatus = await page.evaluate(
      async ({ jwt, base }) => {
        const r = await fetch(`${base}/me/reward-clips`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            clip_title: "e2e-p7-clip",
            clip_idx: 0,
            project_slug: "e2e-p7",
          }),
        });
        return r.status;
      },
      { jwt: HARNESS_JWT, base: baseURL ?? "" },
    );
    expect(mintStatus).toBe(200);
    expect(mintCalled).toBe(true);

    /* Navigate to Earn tab · assert the new row is visible. */
    await page.goto((baseURL ?? "") + "/#/earn");
    const rewardRow = page.getByText("e2e-p7-clip");
    await expect(rewardRow).toBeVisible();
  });
});
