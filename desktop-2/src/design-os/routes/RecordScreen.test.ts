/**
 * RecordScreen · IG-RECORD-SCREEN-DEDICATED regression guard
 *
 * Source-file assertion pattern per the PublishModule / Composer.mount
 * precedent — the route pulls Watchdog + EngineErrorBoundary +
 * useRecordingState + Zustand + Tauri IPC into its mount chain, which
 * is too heavy for a jsdom unit-mount. So we assert on the invariants
 * that MUST stay green forever: the sentinel, the shared-state reuse,
 * the ONE primary CTA testid, the four source-picker testids, the
 * absence of any Composer imports, and the router registration.
 *
 * Every assertion in this file corresponds to a guard in
 * `scripts/lint-record-screen-dedicated.sh` — the pre-commit gate
 * catches at commit time, this test catches in vitest. Belt +
 * suspenders per the 4-layer defense pattern.
 *
 * 2026-07-22 · Sprint A3
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROUTE_SRC = readFileSync(
  resolve(__dirname, "RecordScreen.tsx"),
  "utf-8",
);
const ROUTER_SRC = readFileSync(
  resolve(__dirname, "../routing/SimulatorRouter.tsx"),
  "utf-8",
);
const EVENTS_SRC = readFileSync(
  resolve(__dirname, "../bridge/events.ts"),
  "utf-8",
);
const REGISTRY_SRC = readFileSync(
  resolve(__dirname, "../routing/routeRegistry.ts"),
  "utf-8",
);

describe("IG-RECORD-SCREEN-DEDICATED · RecordScreen route contract", () => {
  it("carries the IG sentinel", () => {
    expect(ROUTE_SRC).toMatch(/IRON GATE IG-RECORD-SCREEN-DEDICATED/);
  });

  it("reuses useRecordingState — never invents a new state store", () => {
    expect(ROUTE_SRC).toMatch(/useRecordingState/);
    expect(ROUTE_SRC).toMatch(/from\s+["'][^"']*state\/useRecordingState["']/);
  });

  it("reuses recordingController — never invents a new IPC wire", () => {
    expect(ROUTE_SRC).toMatch(
      /from\s+["'][^"']*engine\/composer\/recordingController["']/,
    );
    // startRecording + stopRecording are the two ops the surface must call.
    expect(ROUTE_SRC).toMatch(/startRecording/);
    expect(ROUTE_SRC).toMatch(/stopRecording/);
  });

  it("does NOT import from any Composer file — surface owns record end-to-end", () => {
    // Allowlist the engine/composer/recordingController import (checked
    // by the previous test). Anything ELSE from a Composer file breaks
    // the isolation the whole route exists to provide.
    const composerImports = ROUTE_SRC.match(
      /from\s+"[^"]*Composer(Route|Suite|Kade|Body|Frame)?\.?[^"]*"/g,
    );
    expect(composerImports).toBeNull();
  });

  it("exposes exactly ONE primary CTA testid: record-screen-start", () => {
    const matches = ROUTE_SRC.match(
      /data-testid="record-screen-start"/g,
    ) ?? [];
    expect(matches.length).toBe(1);
  });

  it("declares the four source-picker testids", () => {
    expect(ROUTE_SRC).toMatch(/"record-source-display"/);
    expect(ROUTE_SRC).toMatch(/"record-source-window"/);
    expect(ROUTE_SRC).toMatch(/"record-source-mic"/);
    expect(ROUTE_SRC).toMatch(/"record-source-camera"/);
  });

  it("wraps the surface in Watchdog + EngineErrorBoundary", () => {
    expect(ROUTE_SRC).toMatch(/<Watchdog[\s\S]*?<EngineErrorBoundary/);
  });

  it("emits route:enter with route: \"record\" on mount", () => {
    expect(ROUTE_SRC).toMatch(
      /bus\.emit\(\s*["']route:enter["']\s*,\s*\{[\s\S]*?route:\s*["']record["']/,
    );
  });
});

describe("IG-RECORD-SCREEN-DEDICATED · SimulatorRouter registration", () => {
  it("registers \"record\" in SURFACE_FOR", () => {
    expect(ROUTER_SRC).toMatch(/\brecord:\s*\(\)\s*=>\s*<RecordScreenRoute/);
  });

  it("wires the F2 hotkey to nav:click { route: \"record\" }", () => {
    expect(ROUTER_SRC).toMatch(/"F2"/);
    expect(ROUTER_SRC).toMatch(/route:\s*"record"/);
  });

  it("wires the ⌘⇧R hotkey (Cmd/Ctrl+Shift+R)", () => {
    // Same handler covers both; assert on the shape.
    expect(ROUTER_SRC).toMatch(/e\.shiftKey/);
    expect(ROUTER_SRC).toMatch(/(metaKey|ctrlKey)/);
  });

  it("skips the hotkey when a text input is focused", () => {
    // Otherwise typing F2 in a caption field would jump you out.
    expect(ROUTER_SRC).toMatch(/isTypingTarget/);
    expect(ROUTER_SRC).toMatch(/INPUT|TEXTAREA/);
  });
});

describe("IG-RECORD-SCREEN-DEDICATED · type + registry wiring", () => {
  it("RouteId type accepts \"record\"", () => {
    expect(EVENTS_SRC).toMatch(/\|\s*"record"/);
  });

  it("routeRegistry has a \"record\" spec", () => {
    expect(REGISTRY_SRC).toMatch(/\brecord:\s*\{/);
  });
});
