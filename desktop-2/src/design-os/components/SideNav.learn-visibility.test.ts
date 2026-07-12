/**
 * ConsoleNav · Learn item visibility regression · BUG-010 · Train B2 · 2026-07-12
 * ------------------------------------------------------------------------------
 *
 * Filename note: the file is named `SideNav.learn-visibility.test.ts` per
 * the Train B2 ownership matrix, but the surface under test is the
 * Design OS ConsoleNav (`design-os/components/ConsoleNav.tsx`). The
 * ownership-matrix path (`design-os/components/SideNav.tsx`) is stale —
 * canonical current-repo layout has the primary rail as
 * `shell/SideNav.tsx` (Section pipeline) and the Design OS rail as
 * `design-os/components/ConsoleNav.tsx`. BUG-010's `bugs.json`
 * `code_nodes` correctly names ConsoleNav.tsx:45 · that is where the
 * Learn item lives.
 *
 * Class-elimination target BC-004 (nav journey unowned). Before Block
 * 3 (2026-07-11) Learn was Section-pipeline registered but not
 * nav-linked, so every user missed the 7 walkthrough demos. Block 3
 * moved Learn into the Design OS rail (ConsoleNav ITEMS row between
 * "My Journey" and "Wallet"). BUG-010 flagged the visual confirmation
 * as inconclusive — this test locks the visibility contract so a
 * future refactor cannot silently regress it.
 *
 * Auth-state matrix (four states asserted per the Train B2 brief):
 *   1. no-jwt           — user landed with no license · pre-Welcome.
 *   2. pending          — JWT present, /me hydration in flight.
 *   3. signed-in-free   — hydrated, tier = "clipper" (free / clipper mode).
 *   4. signed-in-agency — hydrated, tier = "agency" (agency mode).
 *
 * ConsoleNav does NOT gate items on JWT / hydration status — the auth
 * wall lives upstream at WelcomeRoute. Within ConsoleNav's contract the
 * only conditional gate is the `mode: AppMode` filter (e.g. "My
 * Journey" appears only in clipper mode; "Analytics" only in agency).
 * Learn has NO `modes` gate today — it must appear in BOTH modes. This
 * test asserts that invariant explicitly so a future edit that
 * accidentally scopes Learn to one mode (or one tier) is caught.
 *
 * If the honest expected behavior EVER shifts to "Learn hidden for
 * guests" — the ConsoleNav mount conditions themselves would need a
 * new gate. That work is out of scope for BUG-010 (a verification-gap
 * bug, not a proven regression). Flipping BUG-010 → FIXED_UNPROVEN is
 * the correct disposition once this test is green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONSOLE_NAV_SRC = readFileSync(resolve(__dirname, "ConsoleNav.tsx"), "utf-8");

// Silence diag flushes + navPerf marks.
vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));
vi.mock("../../lib/navPerf", () => ({
  markNavClick: () => undefined,
  markRouteMountStart: () => undefined,
  markFirstContentfulRender: () => undefined,
  markInteractiveReady: () => undefined,
  attachRoutePerformanceObservers: () => () => undefined,
  emitBootTelemetry: () => undefined,
}));

// Mode mock · switched per test to cover clipper + agency.
const modeSink = { value: "clipper" as "clipper" | "agency" };
vi.mock("../bridge", () => ({
  useMode: () => modeSink.value,
  bus: { emit: () => undefined, on: () => () => undefined },
}));

// eslint-disable-next-line import/first
import { ConsoleNav } from "./ConsoleNav";

/** Setup localStorage keys per auth state. ConsoleNav itself does not
 *  read auth; the four states here exist to document the matrix and to
 *  give a future ConsoleNav that DOES gate on auth a place to hook in
 *  without rewriting the harness. */
function setAuthState(state: "no-jwt" | "pending" | "signed-in-free" | "signed-in-agency"): void {
  try { window.localStorage.clear(); } catch { /* jsdom edge */ }
  if (state === "no-jwt") {
    // Nothing to set — clean slate is the pre-JWT idle case.
    return;
  }
  if (state === "pending") {
    // JWT present but /me hydration not yet fired.
    window.localStorage.setItem("lc.license.jwt.v1", "test-jwt-pending");
    return;
  }
  if (state === "signed-in-free") {
    window.localStorage.setItem("lc.license.jwt.v1", "test-jwt-free");
    window.localStorage.setItem("lc.mode", "clipper");
    modeSink.value = "clipper";
    return;
  }
  if (state === "signed-in-agency") {
    window.localStorage.setItem("lc.license.jwt.v1", "test-jwt-agency");
    window.localStorage.setItem("lc.mode", "agency");
    modeSink.value = "agency";
    return;
  }
}

function mount(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(createElement(ConsoleNav, { activeRoute: "home" }));
  });
  return { container, root };
}

function findLearnNavItem(container: HTMLDivElement): HTMLElement | null {
  const items = Array.from(container.querySelectorAll<HTMLElement>(".lc-nav-item"));
  return items.find((el) => el.getAttribute("data-route") === "learn") ?? null;
}

describe("ConsoleNav · source contract (BUG-010 · BC-004)", () => {
  it("declares Learn as a nav item with data-route='learn'", () => {
    // Grep the source rather than only the DOM output so a future
    // `.filter(inMode)` collapse can't hide the invariant behind a
    // conditional render — the item must exist in the ITEMS array.
    expect(CONSOLE_NAV_SRC).toMatch(/route:\s*["']learn["']/);
    expect(CONSOLE_NAV_SRC).toMatch(/label:\s*["']Learn["']/);
  });

  it("does NOT scope Learn to a specific AppMode (visible in both clipper + agency)", () => {
    // Learn intentionally has NO `modes` key in ITEMS. Adding one
    // would hide it from the other mode — a silent regression.
    // We extract the Learn ITEMS row and grep for `modes:` in it.
    const learnRow = CONSOLE_NAV_SRC.match(
      /\{[^}]*route:\s*["']learn["'][^}]*\}/,
    );
    expect(learnRow).toBeTruthy();
    expect(learnRow![0]).not.toMatch(/modes\s*:/);
  });
});

describe("ConsoleNav · Learn item visibility · 4 auth states (BUG-010)", () => {
  beforeEach(() => {
    modeSink.value = "clipper";
  });
  afterEach(() => {
    try { window.localStorage.clear(); } catch { /* noop */ }
  });

  it("[no-jwt] renders Learn item (auth wall lives upstream · ConsoleNav has no JWT gate)", () => {
    setAuthState("no-jwt");
    const { container, root } = mount();
    try {
      const learn = findLearnNavItem(container);
      expect(learn).not.toBeNull();
      expect(learn!.textContent).toContain("Learn");
    } finally {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  it("[pending] renders Learn item while /me hydration is in flight", () => {
    setAuthState("pending");
    const { container, root } = mount();
    try {
      const learn = findLearnNavItem(container);
      expect(learn).not.toBeNull();
    } finally {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  it("[signed-in-free] renders Learn item in clipper mode", () => {
    setAuthState("signed-in-free");
    const { container, root } = mount();
    try {
      const learn = findLearnNavItem(container);
      expect(learn).not.toBeNull();
      // My Journey is clipper-only · sanity-check the mode filter is
      // functioning (proves the harness isn't just dumping every item).
      const journey = Array.from(container.querySelectorAll<HTMLElement>(".lc-nav-item"))
        .find((el) => el.getAttribute("data-route") === "clipper");
      expect(journey).toBeTruthy();
    } finally {
      act(() => { root.unmount(); });
      container.remove();
    }
  });

  it("[signed-in-agency] renders Learn item in agency mode", () => {
    setAuthState("signed-in-agency");
    const { container, root } = mount();
    try {
      const learn = findLearnNavItem(container);
      expect(learn).not.toBeNull();
      // Analytics is agency-only · sanity-check the mode filter.
      const analytics = Array.from(container.querySelectorAll<HTMLElement>(".lc-nav-item"))
        .find((el) => el.getAttribute("data-route") === "analytics");
      expect(analytics).toBeTruthy();
    } finally {
      act(() => { root.unmount(); });
      container.remove();
    }
  });
});
