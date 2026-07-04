/**
 * CampaignsSection · Phase 8 Mount #6 wire tests
 *
 * Verifies the EmbedPreviewCard nesting:
 *   1. Section imports EmbedPreviewCard from the ported route.
 *   2. Section renders <EmbedPreviewCard /> inside the campaign
 *      builder view (source-file contract).
 *   3. Mount #4 CatalogCarousel is still rendered (Mount #6 is
 *      additive · does not displace Mount #4).
 *   4. Campaign builder submit flow scaffolding preserved (Create +
 *      Watermark modals still reachable).
 *   5. Guard rail 6 · EmbedPreviewCard copy has no `bounty`
 *      occurrences outside comment lines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CAMPAIGNS_SRC = readFileSync(
  resolve(__dirname, 'CampaignsSection.tsx'),
  'utf-8',
);
const EMBED_SRC = readFileSync(
  resolve(__dirname, '../../routes/campaign-builder/EmbedPreviewCard.tsx'),
  'utf-8',
);

describe('CampaignsSection · Phase 8 Mount #6', () => {
  it('imports EmbedPreviewCard from the ported route', () => {
    expect(CAMPAIGNS_SRC).toMatch(
      /import\s*{\s*EmbedPreviewCard\s*}\s*from\s*['"]\.\.\/\.\.\/routes\/campaign-builder\/EmbedPreviewCard['"]/,
    );
  });

  it('renders <EmbedPreviewCard /> inside the campaign builder view', () => {
    expect(CAMPAIGNS_SRC).toContain('<EmbedPreviewCard');
    // Nested inside the campaign-preview-slot wrapper so the shell
    // can position the preview independently of the carousel.
    expect(CAMPAIGNS_SRC).toContain('campaign-preview-slot');
  });

  it('preserves the Mount #4 CatalogCarousel render (additive · non-displacing)', () => {
    // Mount #6 must not remove or reorder Mount #4's swap.
    expect(CAMPAIGNS_SRC).toContain('<CatalogCarousel />');
    const carouselIdx = CAMPAIGNS_SRC.indexOf('<CatalogCarousel />');
    const previewIdx = CAMPAIGNS_SRC.indexOf('<EmbedPreviewCard');
    expect(carouselIdx).toBeGreaterThan(0);
    expect(previewIdx).toBeGreaterThan(carouselIdx);
  });

  it('preserves the campaign builder Create + Watermark modal scaffolding', () => {
    expect(CAMPAIGNS_SRC).toContain('CreateCampaignModal');
    expect(CAMPAIGNS_SRC).toContain('WatermarkComposerModal');
    // The active-campaign detail block still exposes the watermark
    // composer entry point.
    expect(CAMPAIGNS_SRC).toContain('Set watermark');
  });

  it('EmbedPreviewCard copy has zero `bounty` occurrences (guard rail 6)', () => {
    const nonCommentLines = EMBED_SRC
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*'))
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(nonCommentLines.toLowerCase()).not.toContain('bounty');
  });
});
