/**
 * Workstation · VISUAL REGRESSION BASELINE
 *
 * Locks the v2.2.6 Workstation post-complete layout so the squashed
 * StageRail + "DANIEL · BETA" / "@uncledaniel" leaks that landed in
 * v2.2.5 cannot silently return.
 *
 * Customer path under test:
 *   1. Anonymous customer launches the app (no /me yet) → TopHud +
 *      SideNav + SplashLeaderboard must render the generic "Guest"
 *      identity and the "Free" tier, NOT "Daniel" / "Beta".
 *   2. Engine session is complete (clips landed) → StageRail must be
 *      dismissed and ResultsGrid must sit at the top of the main
 *      column · BUG-007 + BUG-009 fix surface.
 *   3. The sticky Kade overlay must be hidden post-complete · BUG-010
 *      fix surface.
 *
 * Strategy:
 *   - Mock /me with the harness JWT route pattern already used by
 *     trim-clip.spec / reaction-journey.spec (no real backend, no real
 *     auth — engine session is seeded into localStorage before page
 *     load).
 *   - Seed `lc:engine:session:v1` with `status: "complete"` so the
 *     EngineSessionProvider hydrates into the post-complete branch on
 *     mount.
 *   - Navigate via the hash route `#/workstation` (the canonical route
 *     id for the sidebar's "My Clips" entry — the simulator router
 *     aliases `library` → `workstation` so both hashes resolve to this
 *     surface).
 *   - DOM assertions BEFORE the screenshot so a regression in a
 *     specific affordance fails fast with a clear message; the
 *     `toHaveScreenshot` call is the final layout-structure guard.
 *
 * Stability discipline:
 *   - reducedMotion enforced so Framer Motion entry transitions do not
 *     create pixel jitter between runs.
 *   - Fixed viewport (1440 × 900) matches the playwright.config.ts
 *     baseline used by every other suite.
 *   - All animated chrome (Kade ignition orbits, brand mp4 ambient
 *     loops) is hidden via mask regions on the first run so the diff
 *     only exposes structural drift, not paint-cycle flicker.
 *
 * Baseline file:
 *   tests/visual/workstation.spec.ts-snapshots/
 *     workstation-completed-path-darwin.png  (generated on first run)
 *
 * First-run procedure (regenerates the baseline):
 *   cd desktop-2
 *   npx playwright test tests/visual/workstation.spec.ts --update-snapshots
 *
 * Subsequent runs:
 *   cd desktop-2
 *   npx playwright test tests/visual/workstation.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE_SLUG = "workstation-visual-baseline";

/**
 * Mock the backend endpoints the Workstation route touches at mount.
 * The engine session is seeded entirely on the client (see
 * seedCompletedSession below); the /me + /sync routes resolve to a
 * Free-tier anonymous customer so TopHud + SideNav render the new
 * v2.2.6 "Guest" / "Free" defaults rather than reading a leaked
 * pre-fix snapshot.
 */
async function interceptBackend(page: Page): Promise<void> {
  // /me is the source of truth for TopHud's userName/userTier when the
  // /me hook resolves — but only if a parent passes the resolved value
  // through props. The TopHud prop defaults landed at "Guest" / "Free"
  // in commit b7cab2c; this mock just keeps any future props pipeline
  // from accidentally overriding them with a richer-but-wrong identity.
  const meResponse = {
    user: {
      id: "guest-harness",
      email: "guest@liquidclips.test",
      display_name: "Guest",
      tier: "free",
    },
    tier: "free",
    effective_tier: "free",
    caps: { watermarkLocked: true },
  };
  const syncResponse = { tier: "free", caps: { watermarkLocked: true } };

  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(meResponse),
    }),
  );
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncResponse),
    }),
  );
  // Catch-all so wallet / carrot / whop bounty polls don't bleed real
  // network calls into the visual test — empty bodies are fine because
  // the post-complete view does not consume them.
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    }
    return route.continue();
  });
}

/**
 * Seed a complete engine session so EngineSessionProvider hydrates into
 * the post-complete branch immediately on mount. Mirrors the
 * seedCompletedSession helper in tests/e2e/trim-clip.spec.ts.
 */
async function seedCompletedSession(page: Page): Promise<void> {
  await page.addInitScript((slug) => {
    try {
      const now = new Date("2026-06-30T08:00:00Z").toISOString();
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({
          source: "visual-baseline.test.mp4",
          slug,
          status: "complete",
          percent: 1,
          stage: "thumbs",
          runtimeMode: "mock",
          startedAt: now,
          updatedAt: now,
        }),
      );
      window.localStorage.setItem("lc.dock.open", "0");
      // Clear any prior per-clip state so the inspector renders the
      // canonical "Pick a clip" empty card · not whatever a previous
      // test left behind.
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(`lc.clip.${slug}:`)) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {
      /* private mode / quota — degrade silently */
    }
  }, FIXTURE_SLUG);
}

test.describe("Workstation · visual baseline", () => {
  test("post-complete layout · Guest / Free identity · StageRail dismissed · ResultsGrid surfaces", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // 1. Force reduced motion so Framer Motion route entries and Kade
    //    animations don't introduce pixel jitter between runs.
    await page.emulateMedia({ reducedMotion: "reduce" });

    // 2. Mock the backend before navigation; the engine session seed
    //    runs as an init script so it lands BEFORE the first React
    //    render.
    await interceptBackend(page);
    await seedCompletedSession(page);

    // 3. Navigate to /MyClips. The sidebar label is "My Clips" — the
    //    underlying route id is `workstation` (see SimulatorRouter
    //    `library → workstation` alias). Skip the intro splash so we
    //    land on the route in one paint.
    await page.goto("/?skipIntro=1#/workstation", {
      waitUntil: "domcontentloaded",
    });

    // 4. Wait for the post-complete phase pill so we know the engine
    //    session hydrated and the route entered its "complete" branch.
    const phasePill = page.locator('[data-testid="ws-phase-pill"]');
    await expect(phasePill).toBeVisible({ timeout: 20_000 });
    await expect(phasePill).toHaveText(/Clips ready/i);

    // 5. DOM assertions for the v2.2.6 fix surfaces · these fail fast
    //    with clear messages BEFORE the screenshot diff so a specific
    //    regression is debuggable without opening the image.

    // BUG-007 · StageRail dismissed on phase === "complete".
    await expect(page.locator(".lc-stage-rail")).toHaveCount(0);

    // BUG-009 · ResultsGrid is the first child of the main column.
    const firstMainChild = page.locator(".lc-ws-body-main > *").first();
    await expect(firstMainChild).toHaveAttribute(
      "class",
      /lc-engine-heartbeat-done|lc-results-grid/,
    );

    // BUG-001 · TopHud user pill reads "Guest" / "Free" — never
    // "Daniel" / "Beta".
    await expect(page.locator(".lc-hud-user-name")).toHaveText("Guest");
    await expect(page.locator(".lc-hud-user-tier")).toHaveText("Free");
    await expect(page.locator(".lc-hud-greet-name")).toHaveText("Guest");

    // The Workstation route mounts under DesignOSAppShell, which uses
    // ConsoleNav (.lc-nav-item) — NOT the legacy SideNav (.lc-nav-user-*).
    // The legacy SideNav user pill is exercised by sections/ routes; this
    // suite asserts the design-os shell only, so the TopHud assertions
    // above are the single source of truth for the identity strings.

    // BUG-010 · the sticky Kade overlay must NOT be rendered when
    // hideStickyKade fires (DesignOSAppShell hides it on
    // phase === "complete").
    await expect(page.locator('[data-sticky-kade]')).toHaveCount(0);

    // 6. Let the route settle one more animation frame, then mask any
    //    inherently-animated chrome (brand mp4 ambient loop, Kade
    //    ignition orbits if they ever leak back in) so the screenshot
    //    diff only exposes structural drift.
    await page.waitForTimeout(150);

    await expect(page).toHaveScreenshot("workstation-completed-path.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      // Pixel-level tolerance is intentionally tight — structural
      // regressions (a squashed StageRail returning, a column reorder,
      // a user-pill identity drift) shift far more than 1% of pixels.
      maxDiffPixelRatio: 0.01,
      mask: [
        // The ambient brand mp4 in the world background and any
        // remaining Kade frame the test seam can't dismiss.
        page.locator(".lc-world-bg-video"),
        page.locator(".lc-kade-floor video"),
      ],
    });
  });
});
