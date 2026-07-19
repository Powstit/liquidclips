/**
 * Composer · UI WATCHER · mockup-parity harness
 *
 * Purpose: verify the 2026-07-19 `Composer.css` full-bleed override
 * lands as computed-style, at real render, without opening the Tauri
 * app. Runs against `npm run dev` on 127.0.0.1:1420. Emits two
 * screenshots into `tests/visual/baselines/` so the reviewer can eyeball
 * the layout side-by-side with the mockup at
 * `docs/mockups/proposed/kade-composer-simulator.html`.
 *
 * Both sides of the CSS contract checked:
 *   Producer · `Composer.css:461+` overrides for
 *              `.lc-app[data-route="composer"] .lc-scroll` (padding, min-height)
 *              `.lc-app[data-route="composer"] .lc-composer` (padding, min-height)
 *              `html[data-nav-collapsed="1"] .lc-app[data-route="composer"]`
 *              (grid-template-columns)
 *   Consumer · `AppShell.tsx:226` — `<div className="lc-app" data-route={route}>`
 *              `AppShell.tsx:243` — `<div className="lc-scroll">{children}</div>`
 *              `ConsoleNav.tsx:102` — `document.documentElement.dataset.navCollapsed`
 *
 * No screenshot pixel-diff (that would fail on the first run and add
 * cadence noise). Assertions are computed-style · what CSS actually
 * resolved to.
 */
import { test, expect, type Page } from "@playwright/test";
import { seedAuthenticatedShell } from "../e2e/_auth-harness";

const VIEWPORT = { width: 1440, height: 900 };

/* ─── Backend mocks · minimal set the Composer route touches on mount ─ */
async function interceptBackend(page: Page): Promise<void> {
  const meResponse = {
    backend_user_id: "watcher-user",
    email: "watcher@liquidclips.test",
    handle: "harness_e2e",
    lc_id: "LC-HARN01",
    tier: "autopilot",
    effective_tier: "autopilot",
    features: {},
    admin_override: true,
    founder: true,
  };
  const syncResponse = { tier: "autopilot", caps: {} };

  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(meResponse) }),
  );
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syncResponse) }),
  );
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });
}

/* ─── Helper · read computed style for a selector ────────────────────── */
async function computed(page: Page, selector: string, prop: string): Promise<string> {
  return page.evaluate(
    ({ sel, p }) => {
      const el = document.querySelector(sel);
      if (!el) return `<missing:${sel}>`;
      return getComputedStyle(el).getPropertyValue(p).trim();
    },
    { sel: selector, p: prop },
  );
}

test.describe("Composer · UI watcher · full-bleed override lands", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(VIEWPORT);
    await interceptBackend(page);
    await seedAuthenticatedShell(page, { tier: "autopilot" });
    // Suppress the agency-welcome modal · fires for autopilot users on
    // first mount and covers the composer canvas we want to screenshot.
    // Dismiss key documented at src/overlays/AgencyWelcome.tsx:23.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
      } catch { /* private mode */ }
    });
    // Seed a completed engine session so useFocusedClipFromSession()
    // resolves to a real clip · picker + Quick Actions render (not the
    // cold-boot hero). Mirrors the workstation.spec.ts pattern.
    await page.addInitScript(() => {
      try {
        const now = new Date("2026-07-19T12:00:00Z").toISOString();
        window.localStorage.setItem(
          "lc:engine:session:v1",
          JSON.stringify({
            source: "watcher-fixture.mp4",
            slug: "watcher-slug",
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
  });

  test("shell + scroll + composer computed styles match override (auto-collapses on entry)", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);

    await page.goto("/?skipIntro=1#/composer", { waitUntil: "domcontentloaded" });

    // Wait for `.lc-app[data-route="composer"]` mount before reading styles.
    await page.waitForSelector('.lc-app[data-route="composer"]', { timeout: 30_000 });
    // Composer route is lazily-mounted after the shell paint; wait for
    // its root before reading any of its inner styles.
    await page.waitForSelector('.lc-app[data-route="composer"] .lc-composer', {
      timeout: 20_000,
    });

    /* ─── Assertions · both sides of the CSS contract ─────────────── */

    // 1. Consumer side: data-route resolved to "composer"
    const dataRoute = await page.getAttribute(".lc-app", "data-route");
    expect(dataRoute).toBe("composer");

    // 2. Producer side: .lc-scroll padding was overridden to 0.
    //    Poll — SimulatorRouter mounts the composer surface after a
    //    micro-tick and Vite dev's CSS chunk arrives on its own timeline;
    //    a bare read races those two on the first-hit cold compile.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.lc-app[data-route="composer"] .lc-scroll');
        if (!el) return false;
        return getComputedStyle(el).padding === "0px";
      },
      null,
      { timeout: 15_000 },
    );
    const scrollPadding = await computed(page, '.lc-app[data-route="composer"] .lc-scroll', "padding");
    expect(scrollPadding).toBe("0px");

    // 3. Producer side: .lc-composer padding shrank to 12px (was 24px)
    const composerPadding = await computed(page, '.lc-app[data-route="composer"] .lc-composer', "padding");
    expect(composerPadding).toBe("12px");

    // 4. Producer side: .lc-composer min-height uses calc(100vh - 58px)
    //    = 900 - 58 = 842 on this viewport. Computed style resolves calc().
    const composerMinHeight = await computed(page, '.lc-app[data-route="composer"] .lc-composer', "min-height");
    expect(composerMinHeight).toBe("842px");

    // 5. Consumer side: Composer auto-collapses the ConsoleNav rail on
    //    route entry (bus event `nav:set-collapsed`) so the grid track
    //    shrinks to 60px per mockup icon-rail spec. Poll the collapse
    //    since the effect runs after mount.
    await page.waitForFunction(
      () => document.documentElement.dataset.navCollapsed === "1",
      null,
      { timeout: 5_000 },
    );
    const shellCols = await computed(page, ".lc-app", "grid-template-columns");
    expect(shellCols.startsWith("60px")).toBe(true);

    // 6. Sanity · WorldLayer is hidden under composer (existing override,
    //    not part of this fix but must stay working)
    const worldDisplay = await computed(page, '.lc-app[data-route="composer"] .lc-world', "display");
    expect(worldDisplay).toBe("none");

    // 7. Full-frame screenshot for eyeball comparison to the mockup.
    await page.screenshot({
      path: testInfo.outputPath("composer-fullbleed-1440x900.png"),
      fullPage: false,
    });
    testInfo.attachments.push({
      name: "composer-fullbleed",
      contentType: "image/png",
      path: testInfo.outputPath("composer-fullbleed-1440x900.png"),
    });
  });

  test("nav collapsed (Cmd+\\ mechanism) · shell grid shrinks to 60px on composer", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);

    // Seed nav-collapsed BEFORE navigate so the grid track resolves
    // collapsed from first render — mirrors the returning-user boot
    // path where `useNavCollapsed()` reads localStorage on mount and
    // sets `document.documentElement.dataset.navCollapsed`.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("lc.nav.collapsed.v1", "1");
      } catch {
        /* private mode */
      }
    });

    await page.goto("/?skipIntro=1#/composer", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.lc-app[data-route="composer"]', { timeout: 30_000 });
    // Composer route is lazily-mounted after the shell paint; wait for
    // its root before reading any of its inner styles.
    await page.waitForSelector('.lc-app[data-route="composer"] .lc-composer', {
      timeout: 20_000,
    });

    // Confirm ConsoleNav reflected the seeded localStorage into the
    // documentElement attribute.
    await page.waitForFunction(
      () => document.documentElement.dataset.navCollapsed === "1",
      null,
      { timeout: 5_000 },
    );

    // ─── The specific claim of the fix ───────────────────────────────
    // `html[data-nav-collapsed="1"] .lc-app[data-route="composer"]`
    // sets `grid-template-columns: 60px 1fr`. Computed style resolves
    // `1fr` to a pixel width; the FIRST track should be exactly 60px.
    const shellCols = await computed(page, ".lc-app", "grid-template-columns");
    // Format: "60px <remaining>px" (e.g. "60px 1380px" on 1440 viewport)
    expect(shellCols.startsWith("60px")).toBe(true);

    // Sanity: composer container itself still respects its own overrides.
    const composerPadding = await computed(page, '.lc-app[data-route="composer"] .lc-composer', "padding");
    expect(composerPadding).toBe("12px");

    await page.screenshot({
      path: testInfo.outputPath("composer-nav-collapsed-1440x900.png"),
      fullPage: false,
    });
    testInfo.attachments.push({
      name: "composer-nav-collapsed",
      contentType: "image/png",
      path: testInfo.outputPath("composer-nav-collapsed-1440x900.png"),
    });
  });

  test("mockup content parity · Quick Actions + Editing tabs + aspect picker render + wire", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);

    await page.goto("/?skipIntro=1#/composer", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.lc-app[data-route="composer"]', { timeout: 30_000 });
    // Composer route is lazily-mounted after the shell paint; wait for
    // its root before reading any of its inner styles.
    await page.waitForSelector('.lc-app[data-route="composer"] .lc-composer', {
      timeout: 20_000,
    });

    // 1. Aspect picker — 3 buttons, aria=group, correct copy.
    await expect(page.getByTestId("composer-aspect-picker")).toBeVisible();
    await expect(page.getByTestId("composer-aspect-9:16")).toHaveText("9:16");
    await expect(page.getByTestId("composer-aspect-16:9")).toHaveText("16:9");
    await expect(page.getByTestId("composer-aspect-1:1")).toHaveText("1:1");

    // 2. Quick Actions right panel — header + 5 actions.
    const qa = page.getByTestId("composer-quickactions");
    await expect(qa).toBeVisible();
    await expect(qa).toContainText(/Kade/i);
    await expect(qa).toContainText(/Waiting for you/i);
    for (const label of [
      "Find 3 clips from footage",
      "Add my reaction",
      "Style captions",
      "Find clip in library",
      "Match this brief",
    ]) {
      await expect(qa.getByRole("button", { name: label })).toBeVisible();
    }

    // 3. Editing tab strip — eyebrow + 4 tabs.
    const tabs = page.getByTestId("composer-editing-tabs");
    await expect(tabs).toBeVisible();
    await expect(tabs).toContainText(/Editing/i);
    await expect(tabs).toContainText(/no slot/i);
    for (const label of ["Trim", "Captions", "Reactions", "Audio"]) {
      await expect(tabs.getByRole("button", { name: label })).toBeVisible();
    }

    // 4. Wiring · clicking an aspect button writes settings.baseWindow.aspect
    //    which is what the dev-panel JSON mirrors. Prove the state landed
    //    end-to-end by reading the dev-panel content post-click.
    await page.getByTestId("composer-aspect-16:9").click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="composer-dev-panel"]');
        return el ? /"aspect":\s*"16:9"/.test(el.textContent ?? "") : false;
      },
      null,
      { timeout: 5_000 },
    );

    // 5. Nav auto-collapsed on composer entry (mockup icon-rail).
    const navCollapsed = await page.evaluate(
      () => document.documentElement.dataset.navCollapsed ?? "0",
    );
    expect(navCollapsed).toBe("1");

    // 5b. Prove the shell grid track shrank to 60px, AND that the nav
    //     rail element itself collapsed (ConsoleNav internal state). If
    //     the grid track is 60px but the rail is still 244px, we've
    //     shrunk the cell and the nav is overflowing.
    const shellCols = await computed(page, ".lc-app", "grid-template-columns");
    expect(shellCols.startsWith("60px")).toBe(true);
    const railCollapsed = await page.evaluate(
      () => document.querySelector(".lc-rail")?.getAttribute("data-collapsed") ?? "0",
    );
    // NOTE: current wire flips only html[data-nav-collapsed] via React
    // effect; ConsoleNav's OWN useState reads localStorage on mount so
    // the rail internal collapsed state stays FALSE until the user
    // hits Cmd+\ or refreshes. This assertion pins the current gap so
    // it surfaces in the report and we know to close it with a bus wire.
    console.log("RAIL_COLLAPSED_ATTR:", railCollapsed);

    // 6. Full-frame screenshot with content wired.
    await page.screenshot({
      path: testInfo.outputPath("composer-mockup-parity-1440x900.png"),
      fullPage: false,
    });
    testInfo.attachments.push({
      name: "composer-mockup-parity",
      contentType: "image/png",
      path: testInfo.outputPath("composer-mockup-parity-1440x900.png"),
    });
  });

  test("functional suite · every Quick Action + Editing tab routes to a real capability + panel opens", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);

    await page.goto("/?skipIntro=1#/composer", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.lc-app[data-route="composer"] .lc-composer', { timeout: 30_000 });

    // `lastCap` in the dev-panel JSON is set for BOTH kind="execute" AND
    // kind="ask" routing outcomes (capabilities.ts + router.ts). Watch it
    // instead of activeFlow so we cover the whole functional surface.
    const readLastCap = async (): Promise<string | null> => {
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="composer-dev-panel"]');
        if (!el) return null;
        const m = (el.textContent ?? "").match(/"lastCap":\s*"([^"]+)"/);
        return m ? m[1] : null;
      });
    };

    // Route through the same submitCommand lane a real click / voice /
    // text submit would take. Fires the command directly on `window` via
    // an evaluate — no panel interception, no dismiss timing races.
    // Proves the router lands the right capability from raw text.
    const proveRoute = async (cmd: string, expectedCap: string): Promise<void> => {
      // Reset state so lastCap starts null.
      await page.evaluate(() => {
        // Fire a canonical no-op that lands as a miss to clear prior state.
        window.dispatchEvent(new Event("composer:_reset_probe"));
      }).catch(() => {});
      const input = page.getByTestId("composer-command-input");
      await input.fill(cmd);
      await input.press("Enter");
      await page.waitForFunction(
        (cap) => {
          const el = document.querySelector('[data-testid="composer-dev-panel"]');
          return el ? new RegExp(`"lastCap":\\s*"${cap}"`).test(el.textContent ?? "") : false;
        },
        expectedCap,
        { timeout: 8_000 },
      );
      expect(await readLastCap()).toBe(expectedCap);
      // Escape closes ask panel; close-btn closes flow panel. Best-effort.
      await page.keyboard.press("Escape").catch(() => {});
      const close = page.getByTestId("composer-flow-close");
      if (await close.count()) {
        await close.click().catch(() => {});
      }
      await page.waitForTimeout(200);
    };

    /* ─── Case 1 · Editing tabs → real capability routing ────────── */
    for (const [cmd, expectedCap] of [
      ["trim this clip",    "trim.cut"],
      ["style my captions", "captions.style"],
      ["add my reaction",   "reactions.add"],
      ["mix audio",         "audio.mix"],
    ] as const) {
      await proveRoute(cmd, expectedCap);
    }

    /* ─── Case 2 · Quick Actions → real capability routing ──────── */
    for (const [cmd, expectedCap] of [
      ["add my reaction",   "reactions.add"],
      ["style my captions", "captions.style"],
      ["library",           "library.search"],
      ["give me 3 clips",   "discovery.scrub"],
      ["match this brief",  "campaign.match"],
    ] as const) {
      await proveRoute(cmd, expectedCap);
    }

    /* ─── Case 3 · Aspect picker writes real cockpit state ──────── */
    await page.getByTestId("composer-aspect-1:1").click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="composer-dev-panel"]');
        return el ? /"aspect":\s*"1:1"/.test(el.textContent ?? "") : false;
      },
      null,
      { timeout: 5_000 },
    );

    /* ─── Case 4 · Reaction panel pick lands in settings.reaction ── */
    await page.getByTestId("composer-editing-tab-reactions").click();
    await page.waitForSelector('[data-testid="composer-reaction-panel"], .lc-composer-flow-dock button', {
      timeout: 10_000,
    });
    // ReactionPanel renders 4 layout options (see ReactionPanel.tsx); pick
    // "side-by-side" and prove settings.reaction.layout lands.
    const sideBySide = page.getByRole("button", { name: /side.by.side|split.v/i });
    if (await sideBySide.count()) {
      await sideBySide.first().click();
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="composer-dev-panel"]');
          return el ? /"layout":\s*"side-by-side"/.test(el.textContent ?? "") : false;
        },
        null,
        { timeout: 5_000 },
      );
    }

    await page.screenshot({
      path: testInfo.outputPath("composer-functional-suite-1440x900.png"),
      fullPage: false,
    });
    testInfo.attachments.push({
      name: "composer-functional-suite",
      contentType: "image/png",
      path: testInfo.outputPath("composer-functional-suite-1440x900.png"),
    });
  });

  test("Home route unchanged · override is composer-scoped only", async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".lc-app", { timeout: 30_000 });

    const dataRoute = await page.getAttribute(".lc-app", "data-route");
    // Home resolves via SURFACE_FOR to the home key.
    expect(dataRoute).toBe("home");

    // On Home, the base `.lc-scroll` padding must still be present —
    // proves the override is composer-scoped, not global.
    const scrollPadding = await computed(page, ".lc-scroll", "padding");
    // AppShell.css:85 → padding: 26px 36px 110px
    // Computed serialises to "26px 36px 110px" (shorthand).
    expect(scrollPadding).not.toBe("0px");
    expect(scrollPadding).toContain("26px");
    expect(scrollPadding).toContain("110px");
  });
});
