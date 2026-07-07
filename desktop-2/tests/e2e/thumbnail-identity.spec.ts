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
      // Canonical JWT key that getJwt() / hasJwt() read
      // (src/lib/authStorage.ts:27 LICENSE_JWT_STORAGE_KEY).
      window.localStorage.setItem("lc.license.jwt.v1", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", new Date().toISOString());
      window.localStorage.setItem("lc:welcome-acked", "1");
      window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
    } catch { /* non-fatal */ }
  }, HARNESS_JWT);
}

test.describe("Thumbnail Studio · identity → generate", () => {
  // Sprint-final split (Max · 2026-07-07) · setInputFiles path fixed
  // (drawer now opens via toolbar "Identity ·" click so the hidden
  // input mounts before setInputFiles fires). The remaining assertion
  // cannot verify the upload actually landed:
  //   ThumbnailIdentityUpload.onAddFiles awaits `invoke("stash_upload")`
  //   from `@tauri-apps/api/core`. In Playwright browser mode there is
  //   no Tauri runtime · invoke throws · the catch block sets `error`
  //   and pending stays at its initialImages seed. A `References · N`
  //   assertion falsely passes because the drawer's initialImages prop
  //   already seeds 3 references (Uncle Daniel demo identity) before
  //   the upload runs. Delta-checking pre/post count requires a Tauri
  //   invoke shim + fixture — same harness gap as P4/P5.
  // Follow-up: extend fixtures with a __TAURI_INTERNALS__ mock that
  // routes `stash_upload` to a fake path echo, then delta-check
  // References count OR asset on the uploaded file name.
  test.fixme("upload photo → identity saved → thumbnails render", async ({
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

    await page.goto((baseURL ?? "") + "/#/thumbnail");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    /* Open the ThumbnailIdentityUpload drawer first · the input +
     * drop-zone only exist in the DOM once the drawer mounts (see
     * ThumbnailStudio.tsx:418-424 · identityOpen state). Toolbar
     * button label is "Identity · N" where N is the current image
     * count (ThumbnailStudio.tsx:340). */
    await page.getByRole("button", { name: /identity ·/i }).click();

    /* Playwright's setInputFiles works on hidden inputs (it uploads
     * via the DOM property, not a visible click) so we don't need
     * to trigger the visible drop-zone button first. Style:display:none
     * at ThumbnailIdentityUpload.tsx:210. */
    const fileInput = page.locator('input[type="file"][data-testid="thumbnail-identity-file"]');
    await fileInput.setInputFiles(FIXTURE_JPG);

    /* Assert the file was accepted at the drawer boundary — the
     * "References · N" strip label reflects the pending state
     * (ThumbnailIdentityUpload.tsx:220). Downstream sidecar chain
     * (stash_upload → thumbnail_generate → ThumbnailVariantGallery)
     * runs on the Rust side and can't be exercised without a Tauri
     * runtime · the variant-tile assertion in the original spec
     * required either a live packaged app or a full Tauri invoke
     * harness. This assertion locks the browser-testable half of
     * the flow: the file-input onChange fired + the drawer state
     * advanced. Full integration coverage belongs to the packaged
     * Tauri smoke suite (see docs/CLAUDE_DESKTOP2_RELEASE_MASTER.md
     * §pre-ship walk). */
    await expect(
      page.getByText(/References · [1-9]/i)
    ).toBeVisible();
  });
});
