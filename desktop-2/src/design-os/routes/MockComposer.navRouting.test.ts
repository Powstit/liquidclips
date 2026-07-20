// @vitest-environment jsdom
/**
 * S1 (2026-07-19) · Composer wire-through · nav routing regression guard.
 *
 * S4 (2026-07-19) · Composer wire-through · UPDATED after the mockup
 * iframe was killed and the DOM was ported to native React JSX.
 *
 * Architecture BEFORE S4:
 *   - MockComposer.tsx hosted a real <iframe> and a postMessage bridge.
 *   - `navLabelToRoute` + `bus.emit("nav:click", { route })` lived in
 *     MockComposer.tsx (fired inside the postMessage receiver).
 *
 * Architecture AFTER S4:
 *   - MockComposerBody.tsx owns the ported JSX + `navLabelToRoute`.
 *   - Composer.tsx wires `<MockComposer onNavClick={(route) =>
 *     bus.emit("nav:click", { route })} … />` directly.
 *   - MockComposer.tsx is now a thin typed pass-through.
 *
 * This test still locks the same S1 contract at the source level so
 * a future edit can't silently drop a route or re-introduce the
 * `as any` cast that hid the S0 bug — the checks just point at the
 * post-port files.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MOCK_SRC = readFileSync(
  resolve(__dirname, "MockComposerBody.tsx"),
  "utf-8",
);
const COMPOSER_SRC = readFileSync(
  resolve(__dirname, "Composer.tsx"),
  "utf-8",
);
const EVENTS_SRC = readFileSync(
  resolve(__dirname, "../bridge/events.ts"),
  "utf-8",
);
const ROUTER_SRC = readFileSync(
  resolve(__dirname, "../routing/SimulatorRouter.tsx"),
  "utf-8",
);

/** Labels the mockup emits and the RouteIds they must resolve to. */
const NAV_MAP: ReadonlyArray<{ label: string; route: string }> = [
  { label: "home",      route: "home" },
  { label: "create",    route: "composer" },
  { label: "clips",     route: "workstation" },
  { label: "campaigns", route: "campaigns" },
  { label: "earn",      route: "earn" },
  { label: "schedule",  route: "schedule" },
  { label: "settings",  route: "settings" },
];

describe("S1 · MockComposer · navLabelToRoute contract", () => {
  it("imports RouteId from the bridge so the return type is enforced", () => {
    // S4: `navLabelToRoute` lives in MockComposerBody.tsx which now
    // imports `RouteId` for its own signature.
    expect(MOCK_SRC).toMatch(
      /import\s+type\s*\{\s*RouteId\s*\}\s*from\s*"\.\.\/bridge"/,
    );
  });

  it("navLabelToRoute return type is RouteId | null (not bare string)", () => {
    expect(MOCK_SRC).toMatch(
      /function\s+navLabelToRoute\s*\([^)]*\):\s*RouteId\s*\|\s*null/,
    );
  });

  it("bus.emit does NOT cast route through `as any` anymore", () => {
    // The S0 bug: `bus.emit("nav:click", { route: route as any })`
    // hid an unchecked string from the compiler. If a refactor ever
    // re-introduces this cast, the regression test flags it.
    //
    // S4: the emit call moved from MockComposer.tsx into Composer.tsx's
    // `onNavClick` prop wiring. Guard both files.
    expect(MOCK_SRC).not.toMatch(/route\s+as\s+any/);
    expect(COMPOSER_SRC).not.toMatch(/route\s+as\s+any/);
    expect(COMPOSER_SRC).toMatch(
      /bus\.emit\("nav:click",\s*\{\s*route\s*\}\s*\)/,
    );
  });

  for (const { label, route } of NAV_MAP) {
    it(`maps nav label "${label}" -> route "${route}"`, () => {
      // Locks the exact switch-case row so a re-map has to update the
      // test at the same time.
      const rowRe = new RegExp(
        `case\\s+"${label}":\\s*return\\s+"${route}"`,
      );
      expect(MOCK_SRC).toMatch(rowRe);
    });
  }
});

describe("S1 · bridge · nav:click carries RouteId (not bare string)", () => {
  it("RouteId union exists in events.ts", () => {
    expect(EVENTS_SRC).toMatch(/export type RouteId\s*=/);
  });

  it("nav:click event schema is typed with RouteId", () => {
    // Contract from events.ts:
    //   "nav:click": { route: RouteId };
    expect(EVENTS_SRC).toMatch(/"nav:click":\s*\{\s*route:\s*RouteId\s*\}/);
  });

  for (const { route } of NAV_MAP) {
    it(`RouteId union includes "${route}"`, () => {
      // Match ` route` as a bare token OR quoted in a Record key.
      // Using a word-boundary regex on the identifier.
      const re = new RegExp(`\\b${route}\\b`);
      expect(EVENTS_SRC).toMatch(re);
    });
  }
});

describe("S1 · SimulatorRouter · every mockup label resolves to a mounted surface", () => {
  it("SURFACE_FOR is the primary route map subscribed to nav:click", () => {
    expect(ROUTER_SRC).toMatch(/const SURFACE_FOR:\s*Record<string,\s*\(\)\s*=>\s*ReactElement>/);
    expect(ROUTER_SRC).toMatch(/useEvent\("nav:click"/);
  });

  for (const { route } of NAV_MAP) {
    it(`route "${route}" is registered in SURFACE_FOR (primary surface, not alias)`, () => {
      // Only primary surfaces render directly · aliases go through
      // ALIAS_FOR → SURFACE_FOR anyway, but we want every mockup
      // click to hit a real registered React component with zero
      // indirection so a click never no-ops silently.
      const keyRe = new RegExp(
        `SURFACE_FOR[\\s\\S]*?\\b${route}\\b:\\s*\\(\\)\\s*=>`,
      );
      expect(ROUTER_SRC).toMatch(keyRe);
    });
  }
});
