/**
 * workstation-resume-interrupted.spec.ts
 *
 * 2026-08-15 · fixes BUG-023's resume-hydration effect only firing for
 * `resume.status === "complete"`. A session persisted mid-run (app
 * closed/crashed while status was "running", or one that ended in
 * "error") got zero rehydration attempt — Workstation sat on
 * "Restoring your session…" for 4s then dead-ended on "this project may
 * not have come back" regardless of whether the project was actually
 * still readable from disk. See Workstation.tsx's resume `useEffect`.
 *
 * Reported live in production: a user whose run was interrupted landed
 * on the dead-end screen with clips that were, in fact, still on disk.
 */
import { test, expect, type Page } from "@playwright/test";

import { seedGuestShell } from "./_auth-harness";

const FIXTURE_SLUG = "workstation-visual-baseline";

async function interceptBackend(page: Page): Promise<void> {
  await page.route(/api\.liquidclips\.app\/(me|sync)(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tier: "free", effective_tier: "free", caps: { watermarkLocked: true } }),
    }),
  );
  await page.route(/api\.liquidclips\.app\//, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      : route.continue(),
  );
}

/** Seed a persisted session with a non-"complete" status — the exact
 *  shape a genuinely interrupted run leaves behind. */
async function seedInterruptedSession(page: Page, status: "running" | "error"): Promise<void> {
  await seedGuestShell(page);
  await page.addInitScript(
    ([slug, s]) => {
      try {
        const now = new Date("2026-06-30T08:00:00Z").toISOString();
        window.localStorage.setItem(
          "lc:engine:session:v1",
          JSON.stringify({
            source: "interrupted-run.test.mp4",
            slug,
            status: s,
            percent: 0.6,
            stage: "reframe",
            runtimeMode: "mock",
            startedAt: now,
            updatedAt: now,
          }),
        );
      } catch {
        /* private mode / quota — degrade silently */
      }
    },
    [FIXTURE_SLUG, status] as const,
  );
}

test("resume · status 'running' + project still readable → hydrates real clips, not a dead end", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await interceptBackend(page);
  await seedInterruptedSession(page, "running");

  await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });

  // Must resolve to the real clip grid, not sit stuck on "Restoring…".
  await expect(page.getByTestId("ws-split-workbench")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".lc-ws-restoring")).toHaveCount(0);

  // The stalled dead-end copy must never appear once hydration succeeds.
  await page.waitForTimeout(4_500);
  await expect(page.getByText("this project may not have come back")).toHaveCount(0);
});

test("resume · status 'running' + project unreadable → shows retryable error, not a permanent dead end", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await interceptBackend(page);
  await seedInterruptedSession(page, "running");
  await page.addInitScript(() => {
    (window as unknown as { __lcForceGetProjectError?: boolean }).__lcForceGetProjectError = true;
  });

  await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });

  // A real attempt was made and failed → customer-safe retryable error,
  // not the generic "may not have come back" 4s-timeout dead-end.
  await expect(page.getByText("We couldn't load clips from the last run.")).toBeVisible({ timeout: 10_000 });
});
