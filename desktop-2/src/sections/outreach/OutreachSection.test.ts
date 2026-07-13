/**
 * OutreachSection · Phase 8 Mount #2 wire tests
 *
 * Verifies the SyncMailMoneyDrop → `#/outreach` router entry:
 *   1. SECTION_OUTREACH is in the SECTION_IDS map + not in the
 *      DEPRECATED_SECTION_IDS list (so the BUG-047 harness won't flag).
 *   2. `getSectionByRoute("outreach")` returns the OutreachSection entry.
 *   3. `getSectionById(SECTION_OUTREACH)` returns the same entry.
 *   4. The 9 existing sections (Home · Browse · Editor · Projects ·
 *      Campaigns · Account · Diagnostics · HQ Bridge · Learn) still
 *      resolve — Mount #2 is additive only.
 *   5. The OutreachSection wrapper renders SyncMailMoneyDrop (source-file
 *      contract check so a silent revert on the wrapper is caught).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SECTION_IDS, DEPRECATED_SECTION_IDS } from '../../shell/sectionIds';
import {
  SECTION_REGISTRY,
  getSectionById,
  getSectionByRoute,
} from '../../shell/sectionRegistry';
import { OutreachSection } from './OutreachSection';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('OutreachSection · Phase 8 Mount #2', () => {
  it('registers SECTION_OUTREACH in SECTION_IDS', () => {
    expect(SECTION_IDS.SECTION_OUTREACH).toBe('SECTION_OUTREACH');
  });

  it('does NOT list SECTION_OUTREACH in DEPRECATED_SECTION_IDS (BUG-047 safe)', () => {
    expect(DEPRECATED_SECTION_IDS).not.toContain('SECTION_OUTREACH');
  });

  it('getSectionByRoute("outreach") returns the OutreachSection entry', () => {
    const entry = getSectionByRoute('outreach');
    expect(entry).not.toBeNull();
    expect(entry?.component).toBe(OutreachSection);
    expect(entry?.id).toBe(SECTION_IDS.SECTION_OUTREACH);
    expect(entry?.label).toBe('Outreach');
    // Not surfaced in nav yet — Home CTA copy pending.
    expect(entry?.navVisible).toBe(false);
  });

  it('getSectionById(SECTION_OUTREACH) returns the same entry as by route', () => {
    const byId = getSectionById(SECTION_IDS.SECTION_OUTREACH);
    const byRoute = getSectionByRoute('outreach');
    expect(byId).toBe(byRoute);
  });

  it('preserves the pre-Mount-#2 sections (nothing displaced)', () => {
    // Baseline plus OutreachSection.
    // Guards against a section entry being accidentally overwritten
    // by the Mount #2 addition.
    // Block 3 · 2026-07-11 · 'learn' migrated to Design-OS pipeline
    // (SimulatorRouter SURFACE_FOR.learn) so it can appear in ConsoleNav
    // between My Journey and Wallet. Removed from expected list.
    const routes = SECTION_REGISTRY.map((s) => s.route);
    for (const r of [
      'home',
      'browse',
      'editor',
      'projects',
      'campaign',
      'account',
      'diagnostics',
      'hq',
      'outreach',
    ]) {
      expect(routes).toContain(r);
    }
  });

  it('OutreachSection wrapper renders SyncMailMoneyDrop with onSendComplete', () => {
    // Source-file contract — the wrapper is a 5-line delegation that
    // mustn't drift into a copy of SyncMailMoneyDrop or lose the
    // `#/home` return navigation.
    const src = readFileSync(
      resolve(__dirname, 'OutreachSection.tsx'),
      'utf-8',
    );
    expect(src).toContain('SyncMailMoneyDrop');
    expect(src).toContain('onSendComplete');
    expect(src).toContain("window.location.hash = '#/home'");
  });
});
