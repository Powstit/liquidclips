/**
 * IG-COMPOSER-B regression guard · locks the Base Window dev-panel
 * contract so the panel keeps reading LIVE CockpitContext state and
 * can never regress into a mock JSON demo again.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A6.
 *
 * Root failure this guard prevents: on 2026-07-18 an earlier Composer
 * draft shipped a demo dev-panel that displayed a static JSON blob.
 * The dev-panel is a pedagogical surface — it MUST reflect real state
 * so users learn the Base Window primitive by watching their commands
 * mutate it.
 *
 * Runs under vitest (`npm run test:invariant` picks it up).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSER_SRC = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");

describe("IG-COMPOSER-B · Base Window dev-panel regression guard", () => {
  it("Composer.tsx contains the IG-COMPOSER-B iron gate sentinel", () => {
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-COMPOSER-B/);
  });

  it("dev-panel exposes the master-plan testid composer-dev-panel", () => {
    expect(COMPOSER_SRC).toMatch(/data-testid="composer-dev-panel"/);
  });

  it("dev-panel renders JSON.stringify of the live settings payload", () => {
    // The `JSON.stringify(...)` call MUST live inside the aside marked
    // with the dev-panel testid so a refactor that swaps it for a
    // module-scope constant or a truncated placeholder trips the guard.
    const testidIdx = COMPOSER_SRC.indexOf('data-testid="composer-dev-panel"');
    expect(testidIdx).toBeGreaterThan(-1);
    // Find the </aside> close for this specific dev-panel.
    const asideClose = COMPOSER_SRC.indexOf("</aside>", testidIdx);
    expect(asideClose).toBeGreaterThan(testidIdx);
    const inner = COMPOSER_SRC.slice(testidIdx, asideClose);
    expect(inner).toMatch(/JSON\.stringify\(/);
    // Pretty-print indent MUST be 2 · a `0` or missing indent flags the
    // debug-strip refactor that the sentinel forbids. Trailing comma
    // allowed (idiomatic Prettier output).
    expect(inner).toMatch(/JSON\.stringify\([\s\S]*?,\s*null,\s*2\s*,?\s*\)/);
  });

  it("dev-panel payload references LIVE `settings.*` fields (never a fixture)", () => {
    // Grep the dev-panel's aside block for the specific settings paths.
    // Removing any of these means the panel silently under-reports
    // state · pretending it works while lying to the user.
    const testidIdx = COMPOSER_SRC.indexOf('data-testid="composer-dev-panel"');
    const asideClose = COMPOSER_SRC.indexOf("</aside>", testidIdx);
    const inner = COMPOSER_SRC.slice(testidIdx, asideClose);
    expect(inner).toMatch(/settings\.reaction/);
    expect(inner).toMatch(/settings\.caption/);
    expect(inner).toMatch(/settings\.trim/);
    expect(inner).toMatch(/settings\.style/);
    expect(inner).toMatch(/settings\.baseWindow/);
  });

  it("dev-panel payload includes runtime.resolvedParams + runtime.activeFlow", () => {
    // The pedagogical value of the panel is watching the router
    // resolution + flow dispatch. Both must be exposed.
    const testidIdx = COMPOSER_SRC.indexOf('data-testid="composer-dev-panel"');
    const asideClose = COMPOSER_SRC.indexOf("</aside>", testidIdx);
    const inner = COMPOSER_SRC.slice(testidIdx, asideClose);
    expect(inner).toMatch(/runtime\.resolvedParams/);
    expect(inner).toMatch(/runtime\.activeFlow/);
  });

  it("dev-panel is enclosed in an <aside> with the labelled aria-label", () => {
    // Screen-reader users need the region announced. The label must be
    // stable so a11y snapshots don't drift.
    expect(COMPOSER_SRC).toMatch(
      /<aside[\s\S]*?aria-label="Base window · dev preview"[\s\S]*?data-testid="composer-dev-panel"/,
    );
  });

  it("dev-panel does NOT read the deleted `composer-basewindow` testid", () => {
    // Anti-regression: the old testid is retired · nothing in Composer.tsx
    // may reference it. If a future refactor re-introduces it, this guard
    // catches the drift before it lands.
    expect(COMPOSER_SRC).not.toMatch(/data-testid="composer-basewindow"/);
  });

  it("dev-panel `settings` binding comes from useCockpit (never a fixture)", () => {
    // The `settings` name inside the JSON.stringify must originate from
    // `const cockpit = useCockpit(); const { ..., settings } = cockpit;`
    // or an equivalent shape. Multi-line destructures are common; the
    // regex accepts either `settings = cockpit.settings` (dot-access)
    // OR any multi-line destructure that lists `settings` before a
    // closing `} = cockpit` within the same statement.
    expect(COMPOSER_SRC).toMatch(/const\s+cockpit\s*=\s*useCockpit\(\)/);
    expect(COMPOSER_SRC).toMatch(
      /settings\s*=\s*cockpit\.settings|settings\s*[,}][\s\S]{0,300}?}\s*=\s*cockpit/,
    );
  });
});
