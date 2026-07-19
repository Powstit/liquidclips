/**
 * Composer · LIBRARY WALK · YouTube wall reachability check
 *
 * Answers "does the library actually load real results" without opening
 * the Tauri app. Walks:
 *
 *   1. Composer route mounts
 *   2. Fire "library" command → LibraryPanel opens
 *   3. Search input visible + accepts typing
 *   4. Debounced search resolves to ONE OF:
 *        - `state="idle"` with N results tiles (real hits from HQ upstream)
 *        - `state="empty"` (endpoint reachable, no matches — honest state)
 *        - `state="error"` (upstream 5xx / network / auth — honest state)
 *   5. Read the network log to prove `library/search` fired at least once.
 *
 * The test PASSES on any of the three resolved states — that's honest.
 * A raw crash / blank panel / infinite loading is a fail.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedAuthenticatedShell } from "../e2e/_auth-harness";

const VIEWPORT = { width: 1440, height: 900 };

async function seedFocusedClip(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const now = new Date("2026-07-19T12:00:00Z").toISOString();
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({
          source: "library-walk-fixture.mp4",
          slug: "library-walk-slug",
          status: "complete",
          percent: 1,
          stage: "thumbs",
          runtimeMode: "mock",
          startedAt: now,
          updatedAt: now,
        }),
      );
    } catch { /* private mode */ }
  });
}

async function interceptBackend(page: Page): Promise<void> {
  // Auth + tier mocks · we want to see the LIBRARY route's real traffic,
  // not everything else, so /me + /sync mock but /library/* passes through
  // to whatever backend the tests are pointed at.
  const meResponse = {
    backend_user_id: "watcher-user",
    email: "watcher@liquidclips.test",
    handle: "harness_e2e",
    tier: "autopilot",
    effective_tier: "autopilot",
    features: {},
    admin_override: true,
    founder: true,
  };
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(meResponse) }),
  );
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tier: "autopilot", caps: {} }) }),
  );
  // Catch-all for other backend routes · /library/* explicitly NOT
  // matched here so its real network activity is visible in the log.
  await page.route(/api\.liquidclips\.app\/(?!library)/, (r) => {
    if (r.request().method() === "GET") {
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return r.continue();
  });
}

test.describe("Composer · library walk · HQ YouTube wall reachability", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(VIEWPORT);
    await interceptBackend(page);
    await seedAuthenticatedShell(page, { tier: "autopilot" });
    await seedFocusedClip(page);
    await page.addInitScript(() => {
      try { window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1"); } catch { /* noop */ }
    });
  });

  test("library command opens LibraryPanel · resolves to idle/empty/error (never infinite loading)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    // Capture ALL /library/* network activity so we can prove the client
    // reached out AND read what came back.
    const libraryRequests: Array<{ url: string; status: number | null; method: string }> = [];
    page.on("response", async (resp) => {
      const url = resp.url();
      if (/\/library\//.test(url)) {
        libraryRequests.push({
          url: url.replace(/^https?:\/\/[^/]+/, ""),
          status: resp.status(),
          method: resp.request().method(),
        });
      }
    });

    await page.goto("/?skipIntro=1#/composer", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.lc-app[data-route="composer"] .lc-composer', { timeout: 30_000 });

    // Fire the canonical "library" command (verified match against
    // library.search capability in earlier billing scope).
    const input = page.getByTestId("composer-command-input");
    await input.fill("library");
    await input.press("Enter");

    // LibraryPanel mounts inside the flow-dock when activeFlow flips to
    // flowLibrary. Wait for the search input to appear.
    const searchInput = page.getByTestId("library-search-input");
    await expect(searchInput).toBeVisible({ timeout: 15_000 });

    // Type a real query · the debounce is 320ms so give it a beat.
    await searchInput.fill("uncle daniel");
    await page.waitForTimeout(600);

    // The panel must resolve to a KNOWN state · not spin forever.
    // `data-library-state` lives on `.param-grid`, one of: loading, idle,
    // empty, error.
    const grid = page.locator(".param-grid[data-library-state]");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Poll until the state leaves "loading" · max 30s so a hung upstream
    // fails fast rather than silently pushing this test's timeout.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".param-grid[data-library-state]");
        const state = el?.getAttribute("data-library-state") ?? "";
        return state === "idle" || state === "empty" || state === "error";
      },
      null,
      { timeout: 30_000 },
    );

    const finalState = await grid.getAttribute("data-library-state");
    expect(["idle", "empty", "error"]).toContain(finalState);

    // Read + attach the network log so the report shows exactly what
    // the client hit + what the backend returned.
    const libraryLog = libraryRequests.map(
      (r) => `${r.method} ${r.url} → ${r.status ?? "no-response"}`,
    ).join("\n");
    await testInfo.attach("library-network-log", {
      body: libraryLog || "(no /library/* requests captured)",
      contentType: "text/plain",
    });
    // Count tiles rendered if idle.
    let tileCount = 0;
    if (finalState === "idle") {
      tileCount = await page.locator('.param-tile[data-video-id]').count();
    }
    await testInfo.attach("library-verdict", {
      body: JSON.stringify({
        final_state: finalState,
        tile_count: tileCount,
        library_requests_seen: libraryRequests.length,
        first_request: libraryRequests[0] ?? null,
      }, null, 2),
      contentType: "application/json",
    });

    // Take the visible screenshot so we can eyeball the wall.
    await page.screenshot({
      path: testInfo.outputPath("composer-library-1440x900.png"),
      fullPage: false,
    });

    // Assert: at least ONE library/search request fired (proves the wire
    // reached out; the response body is the honest signal, not silence).
    expect(
      libraryRequests.length,
      "no /library/* request fired · either the wire broke or the panel never opened",
    ).toBeGreaterThan(0);
  });
});
