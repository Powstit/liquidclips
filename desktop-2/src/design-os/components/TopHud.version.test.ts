/**
 * TopHud version pill · RC1 state-drift trifecta · P1-C · 2026-07-11
 *
 * Acceptance criterion 6: the version display reads the ACTIVE runtime
 * bundle version, not only the shell build-time constant.
 *
 * Two contract layers:
 *   1. Source-file grep — the pill JSX reads `useRuntimeVersion()`, NOT
 *      the raw `__APP_VERSION__` build-time constant.
 *   2. Behaviour — `useRuntimeVersion()` in a jsdom / non-Tauri env
 *      returns the shell fallback synchronously (no flash of empty
 *      text), and stays that way because no Tauri IPC exists.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { useRuntimeVersion } from "../../lib/useRuntimeVersion";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HUD_SRC = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");
const HOOK_SRC = readFileSync(
  resolve(__dirname, "..", "..", "lib", "useRuntimeVersion.ts"),
  "utf-8",
);

// Silence diag flushes.
vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

describe("TopHud version pill · source contract (RC1 P1-C)", () => {
  it("imports useRuntimeVersion from lib/useRuntimeVersion", () => {
    expect(HUD_SRC).toMatch(
      /import\s*\{\s*useRuntimeVersion\s*\}\s*from\s*["']\.\.\/\.\.\/lib\/useRuntimeVersion["']/,
    );
  });

  it("pill JSX reads runtimeVersion.version, not __APP_VERSION__", () => {
    // The pill render must consume the hook result — a plain
    // __APP_VERSION__ reference would fall back to the build-time
    // constant even in a Tauri runtime with a staged bundle.
    expect(HUD_SRC).toMatch(/data-testid="hud-version-pill"[\s\S]*?v\{runtimeVersion\.version\}/);
    // The removed pattern must be gone from the pill scope. We tolerate
    // the string in comments (the code documentation references the
    // deleted constant) — but not as a JSX expression fed to the pill.
    expect(HUD_SRC).not.toMatch(/hud-version-pill[\s\S]*?\{typeof\s+__APP_VERSION__/);
  });

  it("the declare-const __APP_VERSION__ is removed from TopHud (unused)", () => {
    // `declare const __APP_VERSION__` at module scope became dead after
    // the hook migration; tsconfig's `noUnusedLocals` would flag it if
    // it lingered.
    expect(HUD_SRC).not.toMatch(/^declare\s+const\s+__APP_VERSION__/m);
  });
});

describe("useRuntimeVersion · behaviour", () => {
  it("returns the shell fallback synchronously in a non-Tauri env", () => {
    // jsdom has no `__TAURI_INTERNALS__`, so the hook's useEffect
    // early-returns and the initial `useState()` value drives the
    // render. The shell fallback resolves at compile time via a
    // typeof guard that jsdom's undeclared __APP_VERSION__ short-
    // circuits to "dev".
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
      // Fallback tag is honest — this environment can't give us the
      // runtime bundle version.
      expect(sink.source).toBe("shell-fallback");
      // Version is a non-empty string · "dev" is fine, but must never
      // be blank (blank = flash of empty text in the pill).
      expect(sink.version.length).toBeGreaterThan(0);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});

describe("useRuntimeVersion · source contract", () => {
  it("hook file references runtime_info (matches UpdateBeacon + Settings)", () => {
    // No new Tauri commands were added — the hook must reuse the
    // existing `runtime_info` command that ships in the runtime lane.
    expect(HOOK_SRC).toContain("runtime_info");
  });

  it("hook file gates Tauri invoke behind isTauriRuntime()", () => {
    // Browser preview must not throw invoke errors on mount.
    expect(HOOK_SRC).toContain("__TAURI_INTERNALS__");
  });

  it("hook exposes a `source` discriminator for consumers", () => {
    // Consumers that want to render a tooltip "runtime bundle" vs
    // "shell build" can branch on this.
    expect(HOOK_SRC).toMatch(/source:\s*"runtime-active"\s*\|\s*"shell-fallback"/);
  });
});
