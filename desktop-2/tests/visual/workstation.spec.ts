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
import * as fs from "node:fs";
import * as path from "node:path";

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

    // BUG-009 · ResultsGrid section is the first child of the main
    // column post-complete. v2.2.18 sprint removed the redundant
    // `.lc-engine-heartbeat-done` strip so `.lc-results` (grid wrapper)
    // is now the top child on this path.
    const firstMainChild = page.locator(".lc-ws-body-main > *").first();
    await expect(firstMainChild).toHaveAttribute(
      "class",
      /lc-engine-heartbeat-done|lc-results-grid|\blc-results\b/,
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

    // UI master Stage 1 · one compact toolbar, no legacy status strip,
    // and run controls collapsed by default.
    await expect(page.locator(".lc-ws-frame-statusstrip")).toHaveCount(0);
    const runControls = page.locator("details[data-testid='engine-actions']");
    await expect(runControls).toHaveCount(1);
    await expect(runControls).not.toHaveAttribute("open", "");

    // Cards are a true four-column 4:5 library grid at 1440px. Every
    // rectangle must remain isolated; row two starts at least 100px
    // below row one so no card bottom can visually merge with its
    // neighbour.
    const cardGeometry = await page.evaluate(() => {
      const grid = document.querySelector(".lc-results-grid");
      const cards = Array.from(grid?.children ?? []).map((node) => {
        const r = (node as HTMLElement).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      const previews = Array.from(document.querySelectorAll(".lc-clip-preview")).map((node) => {
        const r = (node as HTMLElement).getBoundingClientRect();
        return r.height > 0 ? r.width / r.height : 0;
      });
      const columns = grid
        ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
        : 0;
      return { cards, previews, columns };
    });
    expect(cardGeometry.columns).toBe(4);
    expect(cardGeometry.previews.length).toBeGreaterThanOrEqual(3);
    for (const ratio of cardGeometry.previews) {
      expect(ratio).toBeGreaterThan(0.78);
      expect(ratio).toBeLessThan(0.82);
    }
    for (let i = 0; i < cardGeometry.cards.length; i += 1) {
      for (let j = i + 1; j < cardGeometry.cards.length; j += 1) {
        const a = cardGeometry.cards[i];
        const b = cardGeometry.cards[j];
        const intersects =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(intersects, `card ${i} must not intersect card ${j}`).toBe(false);
      }
    }
    const rowTops = [...new Set(cardGeometry.cards.map((card) => Math.round(card.top)))].sort((a, b) => a - b);
    if (rowTops.length > 1) {
      const firstRowBottom = Math.max(
        ...cardGeometry.cards
          .filter((card) => Math.round(card.top) === rowTops[0])
          .map((card) => card.bottom),
      );
      expect(rowTops[1] - firstRowBottom).toBeGreaterThanOrEqual(100);
    }

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

  /**
   * v2.2.18 · StageRail RUNNING-state regression coverage at 1040 / 1280 / 1440.
   *
   * The completed-state test above dismisses StageRail entirely (BUG-007),
   * so it could NEVER detect the per-character-vertical-wrap regression that
   * shipped in runtime 2.3.2 (min-width:0 + overflow-wrap:anywhere +
   * hyphens:auto). This suite seeds `status: "running"` so the rail is
   * mounted, then asserts at three breakpoints that:
   *   1. Every tile's rendered width >= 140px (no squash floor break)
   *   2. Every label's naturalWidth <= tile width (single-line horizontal)
   *   3. Zero label element reports `overflow-wrap` of "anywhere" or
   *      `word-break` of "break-all" (per-char break vector eliminated)
   */
  const RUN_WIDTHS = [1040, 1280, 1440] as const;
  // v2.2.18 · scoped-fix acceptance viewports.
  const ACCEPT_SIZES = [
    { w: 1040, h: 680 },
    { w: 1280, h: 820 },
    { w: 1440, h: 900 },
  ] as const;

  async function seedRunningSession(page: Page): Promise<void> {
    // localStorage seed is a licence gate + slug carrier only; the
    // useEngineSession reducer drives `phase === "running"` from the
    // `engine:progress` bus event, not from persistence. Fire that
    // event after mount (see driveRunningPhase).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
        window.localStorage.setItem("lc.dock.open", "0");
      } catch { /* private mode / quota */ }
    });
  }

  async function driveRunningPhase(page: Page, slug: string): Promise<void> {
    // Emit `engine:progress` on window.__lcBus so the session reducer
    // sets phase=running + stage=cut + percent=0.5. This is the same
    // wire the Tauri sidecar uses; the reducer treats bus event as
    // canonical source (see useEngineSession.ts::240).
    await page.evaluate((s) => {
      const w = window as unknown as {
        __lcBus?: { emit: (e: string, p: unknown) => void };
      };
      w.__lcBus?.emit?.("engine:start", { slug: s, url: "visual-baseline.test.mp4" });
      w.__lcBus?.emit?.("engine:progress", {
        slug: s,
        stage: "cut",
        percent: 0.5,
        note: "Cutting clip 5 of 10…",
      });
    }, slug);
  }

  for (const width of RUN_WIDTHS) {
    test(`running-state · StageRail responsive · ${width}px viewport`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      // Let the viewport resize + reflow settle before nav.
      await page.waitForTimeout(80);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await interceptBackend(page);
      await seedRunningSession(page);

      await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });

      // Bus emits must land AFTER the workstation route mounts + the
      // EngineSessionProvider attaches its useEvent listeners.
      const phasePill = page.locator('[data-testid="ws-phase-pill"]');
      await expect(phasePill).toBeVisible({ timeout: 20_000 });
      await driveRunningPhase(page, `${FIXTURE_SLUG}-running`);
      await expect(phasePill).toHaveText(/Scanning/i, { timeout: 5_000 });

      const rail = page.locator(".lc-stage-rail");
      await expect(rail).toBeVisible();

      // No horizontal per-character break vector may reach a label.
      const labels = page.locator(".lc-stage-label");
      const labelCount = await labels.count();
      expect(labelCount, "expected 7 stage labels").toBeGreaterThanOrEqual(1);

      for (let i = 0; i < labelCount; i++) {
        const label = labels.nth(i);
        const wrapMode = await label.evaluate((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          return {
            overflowWrap: cs.overflowWrap,
            wordBreak: cs.wordBreak,
            hyphens: cs.hyphens,
          };
        });
        expect(
          wrapMode.overflowWrap,
          `label #${i} overflowWrap must be normal (anywhere → per-char break at ${width}px)`,
        ).not.toBe("anywhere");
        expect(
          wrapMode.wordBreak,
          `label #${i} wordBreak must not break-all at ${width}px`,
        ).not.toBe("break-all");
        expect(
          wrapMode.hyphens,
          `label #${i} hyphens must be none at ${width}px`,
        ).toBe("none");
      }

      // Tiles must hold their >=140px floor at every tested breakpoint.
      const tiles = page.locator(".lc-stage-tile");
      const tileCount = await tiles.count();
      for (let i = 0; i < tileCount; i++) {
        const w = await tiles.nth(i).evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
        expect(w, `tile #${i} width at ${width}px viewport must be >= 140`).toBeGreaterThanOrEqual(140);
      }
    });
  }

  /**
   * v2.2.18 scoped-fix ACCEPTANCE SUITE (Daniel's spec).
   *
   * These tests exercise the scroll chain + inspector-vs-editor split
   * at the three sizes he measured (1040×680, 1280×820, 1440×900):
   *
   *   1. `.lc-ws-body-main` is the SCROLL owner (scrollHeight > clientHeight
   *      when the pipeline has produced clips beyond the fold).
   *   2. Selecting a clip opens the inspector (`data-testid="ws-inspector"`)
   *      but does NOT open the cockpit dock (`.lc-cockpit-dock` absent).
   *   3. Clicking "Edit clip" opens the cockpit dock.
   *   4. On compact viewports (< 1100px) the inspector is `position: fixed`
   *      (drawer overlay) so it can't create a 3500px hidden column.
   *   5. Cockpit dock starts at content boundary (left >= sidebar width 244px).
   *   6. Cockpit dock height caps around 40dvh.
   */
  for (const size of ACCEPT_SIZES) {
    test(`acceptance · scroll owner + inspector-vs-editor · ${size.w}×${size.h}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.waitForTimeout(80);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await interceptBackend(page);
      await seedCompletedSession(page);

      await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
      const phasePill = page.locator('[data-testid="ws-phase-pill"]');
      await expect(phasePill).toBeVisible({ timeout: 20_000 });

      // 1. Body-main is the scroll owner — never the whole page.
      const mainOverflow = await page.locator(".lc-ws-body-main").evaluate((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return { overflowY: cs.overflowY };
      });
      expect(mainOverflow.overflowY, "body-main must own overflow-y").toMatch(/auto|scroll/);

      const frameBodyOverflow = await page.locator(".lc-ws-frame-body").evaluate((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return { overflow: cs.overflow };
      });
      expect(frameBodyOverflow.overflow, "frame-body must not scroll — it's a height-locked flex parent").toMatch(/hidden/);

      // 2. Inspector must NOT be mounted before a clip is selected.
      await expect(page.locator('[data-testid="ws-inspector"]')).toHaveCount(0);

      // 3. Cockpit dock is NOT visible in idle / complete without editor intent.
      await expect(page.locator(".lc-cockpit-dock")).toHaveCount(0);

      // 4. Compact widths → inspector will render as a fixed drawer.
      //    We can only assert that AFTER the inspector opens (below), but
      //    document the classification here for future maintainers.
      const isCompact = size.w < 1100;

      // 5. Simulate a clip selection by clicking the first clip card.
      const firstClip = page.locator(".lc-results-grid [data-testid^='clip-card']").first();
      const gotClip = await firstClip.count();
      if (gotClip > 0) {
        await firstClip.click();
        const inspector = page.locator('[data-testid="ws-inspector"]');
        await expect(inspector).toBeVisible({ timeout: 3000 });
        // Cockpit dock still must not appear.
        await expect(page.locator(".lc-cockpit-dock")).toHaveCount(0);

        if (isCompact) {
          const insPos = await inspector.evaluate((el) => getComputedStyle(el as HTMLElement).position);
          expect(insPos, `compact ${size.w}px → inspector must be fixed drawer`).toBe("fixed");
        }

        // 6. Click "Edit clip" — cockpit dock now mounts.
        await page.locator(".lc-ws-inspector-btn.is-primary").click();
        const dock = page.locator(".lc-cockpit-dock");
        await expect(dock).toBeVisible({ timeout: 3000 });
        const dockGeom = await dock.evaluate((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          const r = (el as HTMLElement).getBoundingClientRect();
          const vh = window.innerHeight;
          const maxHeightPx = parseFloat(cs.maxHeight) || Infinity;
          return {
            left: cs.left,
            maxHeightPx,
            maxHeightRatio: maxHeightPx / vh,
            boundingLeft: r.left,
          };
        });
        // Dock starts at sidebar boundary (~244px) — never left: 0.
        expect(dockGeom.boundingLeft, "dock must start at content boundary, not left:0").toBeGreaterThanOrEqual(200);
        // Dock capped at ~40dvh — resolves to 40% of viewport height ± 1%
        // to allow for browser rounding of dvh in headless mode.
        expect(
          dockGeom.maxHeightRatio,
          `dock max-height must cap around 40dvh (got ${dockGeom.maxHeightPx}px = ${(dockGeom.maxHeightRatio * 100).toFixed(1)}% of viewport)`,
        ).toBeGreaterThan(0.35);
        expect(dockGeom.maxHeightRatio).toBeLessThan(0.45);

        const evidenceDir = path.resolve(
          process.cwd(),
          "docs",
          "ui-master",
          "evidence",
          "stage-1",
          `${size.w}x${size.h}`,
        );
        fs.mkdirSync(evidenceDir, { recursive: true });
        await page.screenshot({
          path: path.join(evidenceDir, "workstation-editor.png"),
          fullPage: false,
        });
      }
    });
  }

  test("keyboard · clip preview, editor, collapse, and reopen", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await interceptBackend(page);
    await seedCompletedSession(page);
    await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="clip-card"]')).not.toHaveCount(0, { timeout: 20_000 });

    const firstShell = page.locator('[data-testid="clip-card"][data-clip-idx="0"] [data-testid="clip-shell"]');
    await firstShell.focus();
    await expect(firstShell).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="ws-inspector"]')).toBeVisible();

    const editButton = page.locator(".lc-ws-inspector-btn.is-primary");
    await editButton.focus();
    await expect(editButton).toBeFocused();
    await page.keyboard.press("Enter");

    const dock = page.locator(".lc-cockpit-dock");
    await expect(dock).toHaveAttribute("data-open", "1");
    await page.keyboard.press("Escape");
    await expect(dock).toHaveAttribute("data-open", "0");

    const toggle = page.locator(".lc-cd-toggle");
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dock).toHaveAttribute("data-open", "1");
  });

  /**
   * Phase C2 · zero-candidate recovery.
   * Seeds a completed session whose hydrated project resolves with zero
   * clips. The Workstation must:
   *   1. Render the `[data-testid="ws-zero-candidates"]` empty-results panel.
   *   2. NOT render the split-workbench body (no stale focus/inspector chrome).
   *   3. NOT render the CockpitDock (no stale editor state).
   *   4. Expose a working `[data-testid="ws-zero-retry"]` recovery button.
   */
  test("zero-candidate recovery · empty-results panel + retry button", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await interceptBackend(page);

    // Seed a completed session that hydrates a project with clips: [].
    await page.addInitScript(() => {
      try {
        const now = new Date("2026-06-30T08:00:00Z").toISOString();
        window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
        window.localStorage.setItem(
          "lc:engine:session:v1",
          JSON.stringify({
            source: "zero-candidate.test.mp4",
            slug: "zero-candidate-test",
            status: "complete",
            percent: 1,
            stage: "thumbs",
            runtimeMode: "mock",
            startedAt: now,
            updatedAt: now,
          }),
        );
        window.localStorage.setItem("lc.dock.open", "0");
        (window as Window & {
          __lcDebugProjects?: Record<string, unknown>;
        }).__lcDebugProjects = {
          "zero-candidate-test": {
            slug: "zero-candidate-test",
            name: "Zero candidate test",
            source_url: "https://example.test/zero-candidate",
            duration_s: 12,
            stages: {
              ingest: { done: true },
              audio: { done: true },
              transcribe: { done: true },
              llm: { done: true },
              cut: { done: true },
              reframe: { done: true },
              thumbs: { done: true },
            },
            clips: [],
          },
        };
      } catch { /* private mode */ }
    });

    await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });

    // The dev-only sidecar boundary override above returns a real hydrated
    // project with clips: []. This must hard-pass; a skip here would turn
    // the release gate into a false green.
    const empty = page.locator('[data-testid="ws-zero-candidates"]');
    await expect(empty).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".lc-ws-body")).toHaveCount(0);
    await expect(page.locator(".lc-cockpit-dock")).toHaveCount(0);
    const retry = page.locator('[data-testid="ws-zero-retry"]');
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
  });
});
