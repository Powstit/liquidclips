/**
 * useRuntimeVersion · Wave B1 · RC1 (2026-07-12)
 *
 * BC-002 elimination proof for BUG-006 + BUG-007.
 *
 * Contract layers:
 *   1. Behaviour — the hook and `runtimeVersionSync()` return honest
 *      shell fallbacks in a non-Tauri env (browser preview) so no
 *      consumer ever renders a blank version.
 *   2. Source discriminator — the snapshot carries `source: "shell-
 *      fallback"` in jsdom so consumers can annotate UI + telemetry
 *      when needed.
 *   3. Grep guard — the bug-flagged surfaces (BUG-007 sites) no
 *      longer reference `__APP_VERSION__` directly. The only reader
 *      left in `src/**` is `useRuntimeVersion.ts` (canonical).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { useRuntimeVersion, runtimeVersionSync } from "./useRuntimeVersion";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Silence diag flushes.
vi.mock("./diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

const SRC_ROOT = resolve(__dirname, "..");
function readSrc(rel: string): string {
  return readFileSync(resolve(SRC_ROOT, rel), "utf-8");
}

describe("useRuntimeVersion · non-Tauri fallback (browser preview)", () => {
  it("returns the shell fallback synchronously with source=shell-fallback", () => {
    // jsdom has no `__TAURI_INTERNALS__`, so the hook's useEffect
    // early-returns and the initial `useState()` value drives the
    // render. That value must be non-empty (no flash of blank
    // version pill) and tagged as the shell fallback.
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    const sink: { version: string; source: string } = { version: "", source: "" };
    function Probe() {
      const rv = useRuntimeVersion();
      sink.version = rv.version;
      sink.source = rv.source;
      return null;
    }
    act(() => { root.render(createElement(Probe)); });
    try {
      expect(sink.source).toBe("shell-fallback");
      expect(sink.version.length).toBeGreaterThan(0);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});

describe("runtimeVersionSync · non-React callers", () => {
  it("returns a non-empty string (never blank)", () => {
    const v = runtimeVersionSync();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });
  it("agrees with the hook fallback in the same env", () => {
    // The hook uses `shellFallback()` internally at first render;
    // the sync form exposes the SAME logic to non-React callers so
    // `App.tsx` boot telemetry + `telemetry/bootstrap.ts` see the
    // same string the pill will show a beat later.
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    const sink: { version: string } = { version: "" };
    function Probe() {
      sink.version = useRuntimeVersion().version;
      return null;
    }
    act(() => { root.render(createElement(Probe)); });
    try {
      expect(runtimeVersionSync()).toBe(sink.version);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});

describe("useRuntimeVersion · source contract", () => {
  const HOOK_SRC = readSrc("lib/useRuntimeVersion.ts");

  it("hook file references runtime_info (reuses existing Tauri command)", () => {
    // No new Tauri commands were added — the hook must reuse the
    // existing `runtime_info` command that ships in the runtime lane.
    expect(HOOK_SRC).toContain("runtime_info");
  });

  it("hook file gates Tauri invoke behind isTauriRuntime()", () => {
    // Browser preview must not throw invoke errors on mount.
    expect(HOOK_SRC).toContain("__TAURI_INTERNALS__");
  });

  it("hook exposes a `source` discriminator for consumers", () => {
    expect(HOOK_SRC).toMatch(/source:\s*"runtime-active"\s*\|\s*"shell-fallback"/);
  });

  it("hook subscribes to lc:runtime-staged for mid-session promotion", () => {
    // Wave B1 (2026-07-12) — a bundle staged mid-session must flip
    // every consumer without a route remount. The pill snaps to the
    // new version even before Cmd+R.
    expect(HOOK_SRC).toContain("lc:runtime-staged");
  });

  it("exports runtimeVersionSync for non-React callers", () => {
    // App.tsx boot flowTrace + telemetry/bootstrap.ts run before the
    // React tree mounts, so they can't call the hook. `runtimeVersionSync`
    // gives them the same shell-fallback string the hook renders first.
    expect(HOOK_SRC).toMatch(/export\s+function\s+runtimeVersionSync\s*\(/);
  });
});

describe("BUG-007 grep guard · flagged render sites drop __APP_VERSION__", () => {
  // The ledger names these three surfaces explicitly + we also swept
  // App.tsx + telemetry/bootstrap.ts. `useRuntimeVersion.ts` is the
  // single canonical reader in `src/**`.
  const SWEEP_TARGETS = [
    "App.tsx",
    "sections/diagnostics/DiagnosticsSection.tsx",
    "overlays/IntroSplash.tsx",
    "design-os/routes/Settings.tsx",
    "lib/telemetry/bootstrap.ts",
  ];

  for (const rel of SWEEP_TARGETS) {
    it(`${rel} does not read __APP_VERSION__ at runtime`, () => {
      const src = readSrc(rel);
      // Comments + JSDoc may still reference the constant by name to
      // document the change history; a "declare const" or a bare
      // `__APP_VERSION__` identifier expression is what the guard
      // must forbid. Strip line comments + block comments before
      // testing so wording in commentary doesn't false-fail the
      // guard.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
        .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments
      // The declare form must be gone (dead identifier).
      expect(stripped).not.toMatch(/^\s*declare\s+const\s+__APP_VERSION__/m);
      // No live JSX / expression reads.
      expect(stripped).not.toMatch(/\b__APP_VERSION__\b/);
    });
  }

  it("useRuntimeVersion.ts is the canonical reader in lib/", () => {
    // Sanity: the hook file DOES reference the identifier (that's
    // the whole point — it's the fallback source).
    expect(readSrc("lib/useRuntimeVersion.ts")).toMatch(/\b__APP_VERSION__\b/);
  });
});
