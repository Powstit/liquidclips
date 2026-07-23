/**
 * CommandRoom · IG-HOME-REDESIGN · 2026-07-22
 *
 * Locks the 4-tile Home cockpit contract from
 * `desktop-2/docs/HEURISTIC_EVAL_2026-07-22.md`:
 *
 *   L1 · VSCode Workbench shell — Home renders inside the Editor Group.
 *        Activity Bar / sidebars / status bar are shell-owned.
 *   L2 · Fluent 2 base + content — one background acrylic blur (blur(24px)).
 *   L4 · Cursor Kade pattern      — Kade is REMOVED from Home. Summonable
 *        via ⌘K only.
 *   L7 · One primary action per view — each tile has ONE primary CTA.
 *
 * Regression matrix:
 *   - 4 semantic tile testids exist (make / library / earn / community).
 *   - No Kade panels mounted in CommandRoom (KadeSpeechBubble, StickyKade).
 *   - No QUICK_ACTIONS reference.
 *   - ⌘K listener wired via `window.addEventListener("keydown", ...)`.
 *   - Sentinel `IG-HOME-REDESIGN` present.
 *   - Legacy numeric testids (home-tile-1..4) preserved so existing
 *     Playwright suites (activation-flow, home-dashboard,
 *     brand-consistency, etc.) still find the tiles.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOM_SRC = readFileSync(
  resolve(__dirname, "CommandRoom.tsx"),
  "utf-8",
);

describe("CommandRoom · IG-HOME-REDESIGN 4-tile contract", () => {
  it("carries the IG-HOME-REDESIGN sentinel comment", () => {
    expect(ROOM_SRC).toMatch(/IG-HOME-REDESIGN/);
  });

  it("mounts the four semantic tiles (make · library · earn · community)", () => {
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-make"/);
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-library"/);
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-earn"/);
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-community"/);
  });

  it("preserves legacy numeric testids (home-tile-1..4) for existing Playwright suites", () => {
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-1"/);
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-2"/);
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-3"/);
    expect(ROOM_SRC).toMatch(/data-testid="home-tile-4"/);
  });

  it("does NOT mount Kade avatar / speech bubble on Home (L4 Cursor pattern)", () => {
    expect(ROOM_SRC).not.toMatch(/<KadeSpeechBubble/);
    expect(ROOM_SRC).not.toMatch(/<StickyKade/);
    // The AppShell mount must pass `hideStickyKade` so the persistent
    // shell suppresses the avatar on this route.
    expect(ROOM_SRC).toMatch(/hideStickyKade/);
  });

  it("does NOT reference QUICK_ACTIONS (Kade-driven quick actions retired)", () => {
    expect(ROOM_SRC).not.toMatch(/QUICK_ACTIONS/);
  });

  it("wires a ⌘K / Ctrl+K keydown listener to summon Kade (Composer route)", () => {
    // Bound at window level so any focus state on Home surfaces the summon.
    expect(ROOM_SRC).toMatch(/window\.addEventListener\(\s*"keydown"/);
    // Accept either meta+k or ctrl+k (cross-platform).
    expect(ROOM_SRC).toMatch(/e\.metaKey|e\.ctrlKey/);
    expect(ROOM_SRC).toMatch(/e\.key\.toLowerCase\(\)\s*===\s*"k"/);
    // Summon routes to Composer where the Kade avatar lives.
    expect(ROOM_SRC).toMatch(/route:\s*"composer"/);
  });

  it("has exactly ONE primary CTA per tile · no secondary buttons inside tiles", () => {
    // Each tile renders a single CockpitTile component. Grep the tile
    // count and assert it matches the 4-tile grid contract. Any
    // additional <button> inside a tile would break L7.
    const cockpitTiles = (ROOM_SRC.match(/<CockpitTile\b/g) ?? []).length;
    expect(cockpitTiles).toBe(4);
    // A raw <button> inside the tile grid would break L7. Only
    // CockpitTile emits buttons in this route.
    expect(ROOM_SRC).not.toMatch(/<button\b/);
  });

  it("wires each tile's onClick to the correct route (Make → composer, Library → library, Earn → campaigns, Community → community)", () => {
    expect(ROOM_SRC).toMatch(/goComposer\s*=\s*\(\)\s*=>\s*bus\.emit\("nav:click",\s*\{\s*route:\s*"composer"/);
    expect(ROOM_SRC).toMatch(/goLibrary\s*=\s*\(\)\s*=>\s*bus\.emit\("nav:click",\s*\{\s*route:\s*"library"/);
    expect(ROOM_SRC).toMatch(/goCampaigns\s*=\s*\(\)\s*=>\s*bus\.emit\("nav:click",\s*\{\s*route:\s*"campaigns"/);
    expect(ROOM_SRC).toMatch(/goCommunity\s*=\s*\(\)\s*=>\s*bus\.emit\("nav:click",\s*\{\s*route:\s*"community"/);
  });

  it("keeps the home-command-composer testId so IG-COMPOSER-HH lint stays green", () => {
    // `scripts/lint-session-reset-guard.sh` requires the string
    // "home-command-composer" to remain in CommandRoom.tsx (Composer
    // tile re-mount from 2026-07-18). The Make tile carries it.
    expect(ROOM_SRC).toMatch(/home-command-composer/);
  });

  it("mounts a small status bar under the tiles (L1 · Editor Group content only)", () => {
    expect(ROOM_SRC).toMatch(/data-testid="home-statusbar"/);
    expect(ROOM_SRC).toMatch(/⌘K/);
  });
});
