/**
 * Ship-lens P1-002 regression tests · 2026-07-06
 *
 * Locks down the campaign-id write contract across the three surfaces
 * that touch mode-store's activeCampaignId. If any of these regress in
 * a future refactor, the fixture-id leak (ship-lens P0-001) or the
 * subscription regression (ship-lens P1-001) re-opens silently.
 *
 * Source-file assertion pattern per PublishModule.test.ts precedent —
 * these surfaces pull too much cockpit context to unit-mount safely
 * in vitest + jsdom, and the discipline being enforced here is a
 * static contract (call-site shape) not a runtime behaviour.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CAMPAIGNS_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../design-os/routes/Campaigns.tsx"),
  "utf-8",
);
const CAMPAIGNS_SECTION_SRC = readFileSync(
  resolve(__dirname, "../sections/campaigns/CampaignsSection.tsx"),
  "utf-8",
);
const EDITOR_SECTION_SRC = readFileSync(
  resolve(__dirname, "../sections/editor/EditorSection.tsx"),
  "utf-8",
);

describe("mode-store activeCampaignId write contract", () => {
  describe("Campaigns.tsx (real backend-slug surface)", () => {
    it("imports setActiveCampaignId from modeStore", () => {
      expect(CAMPAIGNS_ROUTE_SRC).toMatch(
        /import\s*{\s*setActiveCampaignId\s*}\s*from\s*["'][^"']*modeStore["']/,
      );
    });

    it("writes .slug (never .id) so PublishModule.getBySlug resolves", () => {
      // Every setActiveCampaignId call must pass either `null` or a `.slug`
      // read · never a `.id` (which would be fixture-shaped).
      const calls = CAMPAIGNS_ROUTE_SRC.match(/setActiveCampaignId\([^)]*\)/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call).not.toMatch(/\.id\b/);
        // Allow: (null), (featured.slug), (c.slug), or similar `.slug` refs.
        expect(call).toMatch(/(null|\.slug)/);
      }
    });
  });

  describe("CampaignsSection.tsx (legacy local-fake surface)", () => {
    it("does NOT call setActiveCampaignId anywhere", () => {
      expect(CAMPAIGNS_SECTION_SRC).not.toMatch(/setActiveCampaignId\(/);
    });

    it("does NOT import setActiveCampaignId (comments referencing it are fine)", () => {
      // Restrict to import statements — the ship-lens explanation comment
      // in this file legitimately names the function.
      const importLines = CAMPAIGNS_SECTION_SRC.match(/^import\s+[^;]+;/gm) ?? [];
      const importsNaming = importLines.filter((l) => l.includes("setActiveCampaignId"));
      expect(importsNaming).toEqual([]);
    });

    it("does NOT navigate to the editor with a fixture campaignId (P0-001)", () => {
      // The 'Review · N submissions' button was the last leak vector ·
      // it routed selected.id (fixture-shaped `cmp_fx_00N`) through a URL
      // param into EditorSection's mode-store mirror. Deleted 2026-07-06.
      expect(CAMPAIGNS_SECTION_SRC).not.toMatch(
        /navigateTo\([^)]*SECTION_EDITOR[^)]*campaignId:\s*selected\.id/,
      );
    });
  });

  describe("EditorSection.tsx (URL-param mirror to mode-store)", () => {
    it("uses useUserMode (subscribing) not getModeState (snapshot) at render", () => {
      // A sibling surface writing setActiveCampaignId must trigger a
      // re-render here · getModeState() alone is a stale snapshot.
      expect(EDITOR_SECTION_SRC).toMatch(
        /import\s*{[^}]*useUserMode[^}]*}\s*from\s*["'][^"']*modeStore["']/,
      );
      expect(EDITOR_SECTION_SRC).toMatch(/const\s+mode\s*=\s*useUserMode\(\)/);
    });

    it("guards the URL-param mirror with a slug-shape regex (P0-001 hardening)", () => {
      // Even if a future call-site regresses and passes a fixture-shaped
      // id, this guard blocks it from reaching mode-store.
      expect(EDITOR_SECTION_SRC).toMatch(/looksLikeSlug/);
      expect(EDITOR_SECTION_SRC).toMatch(
        /\/\^\[a-z0-9\]\(\?:\[a-z0-9-\]\*\[a-z0-9\]\)\?\$\//,
      );
    });

    it("only calls setActiveCampaignId inside the guarded useEffect", () => {
      // Static check that no stray direct write bypasses the guard.
      const calls = EDITOR_SECTION_SRC.match(/setActiveCampaignId\([^)]*\)/g) ?? [];
      expect(calls.length).toBe(1);
      expect(calls[0]).toMatch(/paramCampaignId/);
    });
  });
});
