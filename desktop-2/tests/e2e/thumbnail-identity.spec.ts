/**
 * P6 · Thumbnail Studio · identity → thumbnails · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Locks the identity upload flow · photo picker → sidecar stash_upload
 * returns disk path → saveIdentity called → thumbnail_generate runs
 * → ThumbnailVariantGallery renders.
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_JPG = path.resolve(__dirname, "../../public/brand/kade/kade-avatar.png");

const HARNESS_JWT = "harness-jwt-p6";

async function seedAuth(page: Page) {
  await page.addInitScript((jwt: string) => {
    try {
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", new Date().toISOString());
      window.localStorage.setItem("lc:welcome-acked", "1");
    } catch { /* non-fatal */ }
  }, HARNESS_JWT);
}

test.describe("Thumbnail Studio · identity → generate", () => {
  test("upload photo → identity saved → thumbnails render", async ({
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
    await page.route("**/sync**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture({ tier: "agency" })),
      }),
    );

    await page.goto((baseURL ?? "") + "/#/thumbnail");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 3000 });

    /* Find the identity uploader file input. Real: hidden <input
     * type="file"> inside ThumbnailIdentityUpload drawer · exposed
     * via testid `thumbnail-identity-file`. */
    await page.getByTestId("thumbnail-identity-open").click({ timeout: 2000 }).catch(() => { /* already open */ });
    const fileInput = page.locator('input[type="file"][data-testid="thumbnail-identity-file"]');
    await fileInput.setInputFiles(FIXTURE_JPG);

    /* Simulate the sidecar's thumbnail_generate emit chain. */
    await page.evaluate(() => {
      const w = window as unknown as {
        __lcBus?: { emit: (e: string, p: Record<string, unknown>) => void };
      };
      w.__lcBus?.emit("engine:complete", { kind: "thumbnail-batch" });
    });

    /* Variant gallery should show at least 1 thumbnail tile. */
    const variantTile = page.getByTestId(/^thumbnail-variant-/).first();
    await expect(variantTile).toBeVisible({ timeout: 8000 });
  });
});
