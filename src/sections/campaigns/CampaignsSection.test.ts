/**
 * CampaignsSection · Phase 8 Mount #4 wire tests
 *
 * Verifies the CatalogCarousel swap:
 *   1. Section imports CatalogCarousel from the ported route.
 *   2. Section renders <CatalogCarousel /> in place of the legacy
 *      lc-hud-card grid (source-file contract).
 *   3. Section registry still resolves `#/campaign` → CampaignsSection.
 *   4. Create + Watermark modal flow scaffolding preserved (guard
 *      against Mount #4 accidentally removing them alongside the
 *      grid swap).
 *   5. Guard rail 6 · CatalogCarousel copy has no `bounty` occurrences
 *      and preserves §13a-compliant vocabulary.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { CampaignsSection } from './CampaignsSection';
import { SECTION_IDS } from '../../shell/sectionIds';
import { getSectionByRoute } from '../../shell/sectionRegistry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CAMPAIGNS_SRC = readFileSync(
  resolve(__dirname, 'CampaignsSection.tsx'),
  'utf-8',
);
const CATALOG_SRC = readFileSync(
  resolve(__dirname, '../../routes/catalog/CatalogCarousel.tsx'),
  'utf-8',
);

describe('CampaignsSection · Phase 8 Mount #4', () => {
  it('imports CatalogCarousel from the ported route', () => {
    expect(CAMPAIGNS_SRC).toMatch(
      /import\s*{\s*CatalogCarousel\s*}\s*from\s*['"]\.\.\/\.\.\/routes\/catalog\/CatalogCarousel['"]/,
    );
  });

  it('renders <CatalogCarousel /> in place of the legacy grid', () => {
    // Positive: mount hit.
    expect(CAMPAIGNS_SRC).toContain('<CatalogCarousel />');
    // Negative: the legacy `All campaigns` heading + `lc-grid-3` block
    // should be gone. If a future edit reintroduces them, the mount is
    // silently regressing.
    expect(CAMPAIGNS_SRC).not.toContain('All campaigns');
    expect(CAMPAIGNS_SRC).not.toContain('lc-grid lc-grid-3');
  });

  it('section registry still resolves #/campaign → CampaignsSection', () => {
    const entry = getSectionByRoute('campaign');
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe(SECTION_IDS.SECTION_CAMPAIGNS);
    expect(entry?.component).toBe(CampaignsSection);
  });

  it('preserves the Create + Watermark modal scaffolding', () => {
    // Guard against Mount #4 accidentally removing the campaign
    // create / watermark composer flow alongside the grid swap.
    expect(CAMPAIGNS_SRC).toContain('CreateCampaignModal');
    expect(CAMPAIGNS_SRC).toContain('WatermarkComposerModal');
    // The active campaign header + `Set watermark →` CTA also stays.
    expect(CAMPAIGNS_SRC).toContain('active campaign');
    expect(CAMPAIGNS_SRC).toContain('Set watermark');
  });

  it('CatalogCarousel copy has zero `bounty` occurrences (guard rail 6)', () => {
    // Route file's docstring explicitly notes the ban ("no `bounty` ·
    // use skill/clip job/paid post"). That reference is in a comment;
    // the RENDERED strings must not contain the word. Check that
    // occurrences outside comment lines are zero.
    const nonCommentLines = CATALOG_SRC
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*'))
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(nonCommentLines.toLowerCase()).not.toContain('bounty');
  });
});
