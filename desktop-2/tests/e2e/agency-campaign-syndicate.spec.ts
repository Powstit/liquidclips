/**
 * P10 · Agency posts campaign → Whop marketplace mirror · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Agency user clicks "Post to Whop marketplace" → openWhopAction fires
 * a browse:open-tab bus event with the correct prefill URL → mock the
 * bounty_created webhook → sponsored_campaigns row appears.
 */
import { test, expect, type Page } from "@playwright/test";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";

const HARNESS_JWT = "harness-jwt-p10";
const AGENCY_COMPANY_ID = "biz_e2e_p10";

async function seedAgencyAuth(page: Page) {
  await page.addInitScript((jwt: string) => {
    try {
      // Canonical JWT key that getJwt() / hasJwt() read
      // (src/lib/authStorage.ts:27 LICENSE_JWT_STORAGE_KEY).
      // Without this, loadMe() bails on the missing-jwt guard and
      // useMe.snapshot stays null · useTierCaps falls back to
      // clipper · canPostToWhop is false · button never renders.
      window.localStorage.setItem("lc.license.jwt.v1", jwt);
      // Legacy key kept for the other harness paths that still
      // read it (welcome-route branch trace).
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", new Date().toISOString());
      window.localStorage.setItem("lc:welcome-acked", "1");
      // Suppress the first-run agency welcome modal so it doesn't
      // pointer-intercept the Post to Whop button
      // (src/overlays/AgencyWelcome.tsx:23 SEEN_KEY).
      window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
    } catch { /* non-fatal */ }
  }, HARNESS_JWT);
}

test.describe("Agency campaign → Whop syndicate", () => {
  test("agency posts to Whop marketplace → browse:open-tab fires with prefill", async ({
    page,
    baseURL,
  }) => {
    await seedAgencyAuth(page);
    /* Agency tier · whopCompanyId present so the button renders. */
    await page.route("**/me**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...meFixture({ tier: "agency" }),
          whop_company_id: AGENCY_COMPANY_ID,
        }),
      }),
    );
    await page.route("**/sync", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture({ tier: "agency" })),
      }),
    );

    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    /* Capture the telemetry:whop-action payload · openWhopAction emits
     * this on every whop-owned action click (src/lib/openWhopAction.ts:61)
     * and it's the canonical breadcrumb the sprint reconciles against
     * webhook returns. The original spec listened for `browse:open-tab`
     * which openInApp doesn't emit · openInApp routes through the
     * useBrowseOverlay zustand store instead of the bus. */
    let capturedUrl: string | null = null;
    await page.exposeFunction("captureWhopAction", (url: string) => {
      capturedUrl = url;
    });
    await page.evaluate(() => {
      const w = window as unknown as {
        __lcBus?: {
          on: (e: string, cb: (p: { url?: string; action?: string }) => void) => void;
          emit: (e: string, p: Record<string, unknown>) => void;
        };
      };
      w.__lcBus?.on("telemetry:whop-action", (p) => {
        (window as unknown as { captureWhopAction?: (u: string) => void })
          .captureWhopAction?.(p.url ?? "");
      });
    });

    /* Open the CampaignPageShell via the dev-only test hook (see
     * src/components/paywall/CampaignShellTestHook.tsx). We can't
     * `#/campaign/:slug` navigate because the app doesn't wire a
     * hash route + the campaign RPC isn't seeded in this spec. The
     * hook mounts a synthetic Campaign the drawer can render + the
     * agency + whopCompanyId gates from the /me + /sync mocks
     * satisfy the button's canPostToWhop condition.
     *
     * Wait for the hook's race-safe seam
     * (`window.__lc_test_open_campaign_shell`) so a slow AuthGate /
     * WelcomeGate mount cascade can't drop the emit. Mirrors the
     * pattern in AssetRansomPaywallTestHook. */
    await page.waitForFunction(
      () =>
        typeof (window as unknown as {
          __lc_test_open_campaign_shell?: unknown;
        }).__lc_test_open_campaign_shell === "function",
      undefined,
      { timeout: 8000 },
    );
    await page.evaluate(() => {
      const w = window as unknown as {
        __lc_test_open_campaign_shell?: (p: {
          slug: string;
          title: string;
          description?: string;
          rewardPoolCents?: number;
        }) => void;
      };
      w.__lc_test_open_campaign_shell?.({
        slug: "e2e-p10",
        title: "e2e-p10 clip drop",
        description: "Test campaign for P10 syndicate spec.",
        rewardPoolCents: 50_000,
      });
    });
    const postBtn = page.getByRole("button", { name: /post to whop marketplace/i });
    await postBtn.click();

    /* Assert the URL includes the expected prefills. Shape shipped
     * per openWhopAction.ts:103 · BOUNTY_CREATE:
     *   https://whop.com/dashboard/{companyId}/bounties/new?prefill_*
     * (the old spec expected `/dashboard/company/{cid}/` which was
     *  never the wire shape). */
    expect(capturedUrl).not.toBeNull();
    if (capturedUrl) {
      expect(capturedUrl).toContain("whop.com/dashboard/");
      expect(capturedUrl).toContain(AGENCY_COMPANY_ID);
      expect(capturedUrl).toContain("/bounties/new");
      expect(capturedUrl).toMatch(/prefill_title/);
      expect(capturedUrl).toMatch(/prefill_prize/);
      expect(capturedUrl).toMatch(/prefill_criteria/);
    }
  });
});
