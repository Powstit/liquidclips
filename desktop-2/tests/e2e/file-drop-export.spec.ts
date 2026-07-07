/**
 * P5 · File drop → MP4 exported · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Locks the drag-drop path via `source:drop` bus event · the
 * GlobalDropConsumer picks it up and drives the same run_stage chain
 * as URL import.
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_MP4 = path.resolve(__dirname, "../../public/demos/01-clipping.mp4");

const HARNESS_JWT = "harness-jwt-p5";

async function seedAuth(page: Page) {
  await page.addInitScript((jwt: string) => {
    try {
      // Canonical JWT key that getJwt()/hasJwt() read
      // (src/lib/authStorage.ts:27 LICENSE_JWT_STORAGE_KEY). When
      // this test un-fixme's after the Tauri invoke shim lands,
      // pre-seeding the canonical key prevents the loadMe-bail →
      // clipper-tier failure the P10 fix documents.
      window.localStorage.setItem("lc.license.jwt.v1", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", new Date().toISOString());
      window.localStorage.setItem("lc:welcome-acked", "1");
      window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
    } catch { /* non-fatal */ }
  }, HARNESS_JWT);
}

test.describe("File drop → MP4 export", () => {
  // Sprint-final split (Max · 2026-07-07) · testid contract fix landed
  // (`clip-card` matched against shipped semantic in ClipCard.tsx:122).
  // The remaining runtime visibility assertion requires a Tauri invoke
  // shim + sidecar project fixture to seed `session.project` · that
  // harness is out of scope for this split. Same follow-up as
  // url-clip-export.spec.ts: extend installBackendStubs.
  test.fixme("fire source:drop → GlobalDropConsumer → clips → export", async ({
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

    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    /* Fire the source:drop bus event with the fixture MP4 path.
     * GlobalDropConsumer subscribes via `useEvent("source:drop")`
     * and calls sidecar.startRun. */
    await page.evaluate((fixturePath) => {
      const w = window as unknown as {
        __lcBus?: { emit: (e: string, p: Record<string, unknown>) => void };
      };
      w.__lcBus?.emit("source:drop", { paths: [fixturePath] });
    }, FIXTURE_MP4);

    /* Simulate the sidecar's stage chain. */
    await page.evaluate(() => {
      const w = window as unknown as {
        __lcBus?: { emit: (e: string, p: Record<string, unknown>) => void };
      };
      const stages = ["ingest", "audio", "transcribe", "llm", "cut", "reframe", "thumbs"];
      for (const s of stages) {
        w.__lcBus?.emit("engine:progress", { stage: s, percent: 1.0 });
      }
      w.__lcBus?.emit("engine:complete", { kind: "pick", slug: "e2e-p5" });
    });

    /* Clips should render as ClipCard tiles. Shipped semantic:
     * `data-testid="clip-card"` at ClipCard.tsx:122. */
    const clipTile = page.getByTestId("clip-card").first();
    await expect(clipTile).toBeVisible();
  });
});
