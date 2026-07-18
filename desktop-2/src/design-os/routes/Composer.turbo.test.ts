// @vitest-environment jsdom
/**
 * IG-COMPOSER-D regression guard · locks the Turbo mode toggle
 * contract so animation-collapse behavior can't silently regress.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A9.
 *
 * Runs under vitest with jsdom so we can exercise localStorage.
 */

import { beforeEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, useEffect } from "react";
import { useTurboMode } from "./Composer";

// Minimal renderHook shim · matches the pattern in TopHud.version.test.ts
// so we don't add @testing-library/react as a new dependency.
function renderTurboHook(): {
  current: [boolean, () => void];
  rerender: () => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  const root: Root = createRoot(container);
  const capture: { current: [boolean, () => void] } = {
    current: [false, () => undefined],
  };
  let rerenderFn = () => undefined as void;
  function Probe(): null {
    const value = useTurboMode();
    capture.current = value;
    useEffect(() => {
      rerenderFn = () => root.render(createElement(Probe));
    });
    return null;
  }
  act(() => { root.render(createElement(Probe)); });
  return {
    current: capture.current,
    rerender: () => rerenderFn(),
    unmount: () => act(() => { root.unmount(); }),
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSER_SRC = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");
const COMPOSER_CSS = readFileSync(resolve(__dirname, "Composer.css"), "utf-8");
const STORAGE_KEY = "lc.composer.turbo.v1";

describe("IG-COMPOSER-D · Turbo mode · source contract", () => {
  it("Composer.tsx contains the IG-COMPOSER-D iron gate sentinel", () => {
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-COMPOSER-D/);
  });

  it("defines COMPOSER_TURBO_STORAGE_KEY constant · versioned", () => {
    expect(COMPOSER_SRC).toMatch(
      /const\s+COMPOSER_TURBO_STORAGE_KEY\s*=\s*"lc\.composer\.turbo\.v1"/,
    );
  });

  it("useTurboMode is exported and returns [boolean, () => void]", () => {
    expect(COMPOSER_SRC).toMatch(
      /export function useTurboMode\(\):\s*\[boolean,\s*\(\)\s*=>\s*void\]/,
    );
  });

  it("ComposerCanvas applies data-turbo attribute on outer wrapper", () => {
    // The attribute MUST live on `.lc-composer` so the CSS descendant
    // rules (`.lc-composer[data-turbo="true"] *`) can override every
    // child's animation duration.
    expect(COMPOSER_SRC).toMatch(
      /className="lc-composer"[\s\S]{0,500}?data-turbo=\{turbo/,
    );
  });

  it("CSS collapses transition-duration + animation-duration when turbo=true", () => {
    // Both properties MUST be overridden · users can flip a toggle
    // that only affects one and the mixed motion tears the theatre.
    expect(COMPOSER_CSS).toMatch(
      /\.lc-composer\[data-turbo="true"\][\s\S]{0,300}?transition-duration:\s*40ms/,
    );
    expect(COMPOSER_CSS).toMatch(
      /\.lc-composer\[data-turbo="true"\][\s\S]{0,300}?animation-duration:\s*40ms/,
    );
  });

  it("CSS respects prefers-reduced-motion even in turbo mode", () => {
    // Accessibility · reduced-motion users get NO motion, even if
    // they somehow flipped turbo on (defensive against a stale
    // localStorage flag surviving OS settings changes).
    expect(COMPOSER_CSS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.lc-composer\[data-turbo="true"\]/,
    );
  });

  it("Turbo toggle button exposes testid composer-turbo-toggle", () => {
    expect(COMPOSER_SRC).toMatch(/data-testid="composer-turbo-toggle"/);
  });
});

describe("IG-COMPOSER-D · Turbo mode · runtime behaviour", () => {
  beforeEach(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  });

  it("useTurboMode defaults to false when storage empty", () => {
    const handle = renderTurboHook();
    try {
      expect(handle.current[0]).toBe(false);
    } finally {
      handle.unmount();
    }
  });

  it("toggling twice returns to false + writes to localStorage in step", () => {
    const handle = renderTurboHook();
    try {
      expect(handle.current[0]).toBe(false);
      act(() => { handle.current[1](); });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
      act(() => { handle.current[1](); });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
    } finally {
      handle.unmount();
    }
  });

  it("useTurboMode reads the stored flag on mount (survives reload)", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    const handle = renderTurboHook();
    try {
      expect(handle.current[0]).toBe(true);
    } finally {
      handle.unmount();
    }
  });
});
