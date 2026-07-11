/**
 * SimulatorRouter · L2 + L3 nav destination contract tests.
 *
 * Source-file grep tests enforcing that:
 *   * L2 · `#/support` routes to Settings AND emits `settings:open-tab`
 *     with tab: "support" on arrival (so the user lands on the Support
 *     pane, not the default Account tab).
 *   * L3 · `#/schedule` resolves to the real ScheduleRoute (Phase 6J-A)
 *     — no longer aliased to `workstation`. The Schedule route already
 *     ships on disk; it just wasn't wired.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROUTER_SRC = readFileSync(resolve(__dirname, 'SimulatorRouter.tsx'), 'utf-8');
const EVENTS_SRC = readFileSync(
  resolve(__dirname, '..', 'bridge', 'events.ts'),
  'utf-8',
);

describe('L2 · Support nav lands on the Support tab of Settings', () => {
  it('SURFACE_ON_ARRIVE.support emits settings:open-tab with tab: "support"', () => {
    expect(ROUTER_SRC).toMatch(/support:\s*\(\)\s*=>\s*bus\.emit\(\s*["']settings:open-tab["']\s*,\s*\{\s*tab:\s*["']support["']/);
  });

  it('`support` is a primary surface (SURFACE_FOR entry), not just an alias', () => {
    // Guard the fact that support is in SURFACE_FOR so nav:click can
    // find it directly.
    expect(ROUTER_SRC).toMatch(/support:\s*\(\)\s*=>\s*<SettingsRoute\s*\/>/);
  });

  it('settings:open-tab type union accepts the "support" tab', () => {
    // L2 widened the union from agency-only to include the common tabs.
    // Extract just the settings:open-tab type block for a precise assert.
    expect(EVENTS_SRC).toMatch(/settings:open-tab["']\s*:\s*\{[\s\S]*?"support"[\s\S]*?\}/);
  });

  it('primary surface arrive hooks fire on nav:click AND hashchange', () => {
    // Both event handlers need to look up SURFACE_ON_ARRIVE[key] so
    // the customer can arrive via either sidebar click or #/support
    // deep-link.
    const arriveHookRefs = (ROUTER_SRC.match(/SURFACE_ON_ARRIVE\[/g) ?? []).length;
    expect(arriveHookRefs).toBeGreaterThanOrEqual(2);
  });
});

describe('L3 · Schedule nav lands on the real ScheduleRoute', () => {
  it('SURFACE_FOR.schedule renders <ScheduleRouteLazy />', () => {
    expect(ROUTER_SRC).toMatch(/schedule:\s*\(\)\s*=>\s*<ScheduleRouteLazy\s*\/>/);
  });

  it('schedule is NO LONGER aliased to workstation', () => {
    // Prior version: `schedule:  { to: "workstation" },` inside
    // ALIAS_FOR. Now `schedule:` lives in SURFACE_FOR only.
    expect(ROUTER_SRC).not.toMatch(/schedule:\s*\{\s*to:\s*["']workstation["']/);
  });

  it('lazy-imports the ScheduleRoute component from the real source file', () => {
    expect(ROUTER_SRC).toContain('import("../routes/Schedule")');
    expect(ROUTER_SRC).toContain('ScheduleRoute');
  });
});
