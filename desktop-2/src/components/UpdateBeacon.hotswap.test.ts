/**
 * IG-RUNTIME-HOTSWAP · Layer 3 · vitest audit that UpdateBeacon.tsx
 * carries the boot-window hot-swap wire so users get the newest
 * runtime bundle on FIRST relaunch, not the second. LOCKED 2026-07-20.
 *
 * The regression this locks: prior boot flow served the previously-
 * staged bundle even after the current session's background task
 * finished downloading a newer one. The webview loaded index.html
 * BEFORE the Rust side flipped current.json → no reload = no promotion
 * until the user quit and relaunched AGAIN. Two relaunches per ship.
 *
 * Fix: when `lc:runtime-staged` reports a new active_version within
 * HOTSWAP_BOOT_WINDOW_MS of beacon mount, trigger window.location.
 * reload(). The URI scheme handler (src-tauri/src/runtime.rs:507)
 * reads from a live RwLock that already got refreshed by the Rust
 * side, so the reload immediately re-fetches from the new bundle.
 *
 * The boot-window guard preserves BUG-012 (no mid-session cache
 * swaps that would wipe user work).
 *
 * Sister to scripts/lint-runtime-hotswap.sh · same invariants, belt-
 * and-braces on every `vitest` invocation so a hostile commit that
 * skips pre-commit still fails CI.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BEACON_SRC = readFileSync(
  resolve(__dirname, "UpdateBeacon.tsx"),
  "utf-8",
);

describe("IG-RUNTIME-HOTSWAP · UpdateBeacon boot-window reload wire", () => {
  it("carries the IG-RUNTIME-HOTSWAP sentinel comment (Layer 1)", () => {
    expect(BEACON_SRC).toContain("IG-RUNTIME-HOTSWAP");
  });

  it("declares HOTSWAP_BOOT_WINDOW_MS constant", () => {
    expect(BEACON_SRC).toMatch(/const\s+HOTSWAP_BOOT_WINDOW_MS\s*=/);
  });

  it("captures mount timestamp via useRef(Date.now())", () => {
    // mountedAtRef is the anchor for the boot-window guard.
    expect(BEACON_SRC).toMatch(/mountedAtRef\s*=\s*useRef<number>\s*\(\s*Date\.now\(\)\s*\)/);
  });

  it("has a withinBootWindow gate computed from mountedAtRef + HOTSWAP_BOOT_WINDOW_MS", () => {
    expect(BEACON_SRC).toMatch(
      /withinBootWindow\s*=\s*Date\.now\(\)\s*-\s*mountedAtRef\.current\s*<\s*HOTSWAP_BOOT_WINDOW_MS/,
    );
  });

  it("calls window.location.reload() from the hotswap path", () => {
    expect(BEACON_SRC).toMatch(/window\.location\.reload\s*\(\s*\)/);
  });

  it("emits runtime_hotswap_reload lcDiag telemetry with booted + staged versions", () => {
    expect(BEACON_SRC).toMatch(/lcDiag\s*\(\s*["']runtime_hotswap_reload["']/);
    // The payload must carry both versions so HQ can measure the funnel.
    expect(BEACON_SRC).toMatch(/booted_version/);
    expect(BEACON_SRC).toMatch(/staged_version/);
  });

  it("delays the reload so telemetry can flush (setTimeout wrapper)", () => {
    // A synchronous reload would drop the lcDiag POST. The wrapper
    // gives sendBeacon a chance.
    expect(BEACON_SRC).toMatch(
      /setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,200}?window\.location\.reload/,
    );
  });

  it("guards the reload behind the boot window (no mid-session swap)", () => {
    // Guard MUST be a conditional block, not an unconditional reload.
    // The pattern captures: `if (withinBootWindow …) { … reload }`.
    expect(BEACON_SRC).toMatch(
      /if\s*\(\s*withinBootWindow[\s\S]{0,900}?window\.location\.reload/,
    );
  });
});
