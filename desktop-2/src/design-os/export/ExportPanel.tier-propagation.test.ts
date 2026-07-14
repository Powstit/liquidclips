/**
 * ExportPanel · tier-propagation regression · BUG-008 · Train A2 ·
 * 2026-07-12.
 *
 * Locks the class-elimination pattern for BC-002 (multi-writer state
 * drift) as applied to the studio-family tier read:
 *   * ExportPanel · OverlayTemplateGallery · ReactionControls all
 *     drop their ``userTier?: Tier`` prop with the ``"free"`` default.
 *   * Each component reads tier internally via ``useCanonicalStudioTier()``
 *     — a wrapper around useTierCaps that collapses ``clipper`` → ``free``
 *     for the studio Tier vocabulary.
 *   * useTierCaps exposes the wrapper as the single canonical source.
 *   * No caller of the three components passes a ``userTier`` prop.
 *
 * The presets / layouts / overlays each declare their own tier gate
 * in a local data table; those tables are read once + gated by the
 * SAME userTier value. The regression: prior to this fix, three
 * components each independently defaulted to ``"free"`` when a caller
 * forgot the prop — silently downgrading Pro / Growth / Agency users
 * to Free ribbons. This test would fail if any component regressed
 * to a hardcoded default.
 *
 * Follows the source-file grep convention already established across
 * TopHud.pill.test.ts (which locks the sister prop-deletion contract
 * for the identity chrome).
 *
 * Note on filename: the ownership matrix lists ``export/ExportPanel*``
 * as the file path — the actual ExportPanel lives in ``studio/``. The
 * test is placed under ``export/`` per the matrix so integration lead
 * can grep for it; the vitest include ``src/**\/*.test.ts`` picks it
 * up regardless of subdirectory.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tierToStudioTier } from "../state/useTierCaps";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STUDIO = resolve(__dirname, "..", "studio");
const EXPORT_PANEL_SRC = readFileSync(
  resolve(STUDIO, "ExportPanel.tsx"),
  "utf-8",
);
const OVERLAY_GALLERY_SRC = readFileSync(
  resolve(STUDIO, "OverlayTemplateGallery.tsx"),
  "utf-8",
);
const REACTION_CTRL_SRC = readFileSync(
  resolve(STUDIO, "ReactionControls.tsx"),
  "utf-8",
);
const TIER_CAPS_SRC = readFileSync(
  resolve(__dirname, "..", "state", "useTierCaps.ts"),
  "utf-8",
);
const EXPORT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "..", "routes", "ExportRoute.tsx"),
  "utf-8",
);
const TIMELINE_STUDIO_SRC = readFileSync(
  resolve(__dirname, "..", "routes", "TimelineStudio.tsx"),
  "utf-8",
);

/** Strip block + line comments so a source-file grep does not
 *  accidentally match a mention of the deleted prop that lives inside
 *  a rationale comment. Comments describing the DELETED prop are
 *  intentional documentation and must not fail the regression. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const EXPORT_PANEL_CODE = stripComments(EXPORT_PANEL_SRC);
const OVERLAY_GALLERY_CODE = stripComments(OVERLAY_GALLERY_SRC);
const REACTION_CTRL_CODE = stripComments(REACTION_CTRL_SRC);

describe("BUG-008 · tier-propagation · prop-deletion contract", () => {
  it("ExportPanel props interface has no userTier prop", () => {
    // The prop was the vector for the "userTier=free" silent default.
    // Deletion is the class-elimination fix.
    expect(EXPORT_PANEL_CODE).not.toMatch(/userTier\?\s*:\s*Tier/);
    // Also delete the internal default. A default with a fallback like
    // `userTier = "free"` would recreate the same bug even without a
    // prop signature.
    expect(EXPORT_PANEL_CODE).not.toMatch(/userTier\s*=\s*"free"/);
  });

  it("OverlayTemplateGallery props interface has no userTier prop", () => {
    expect(OVERLAY_GALLERY_CODE).not.toMatch(/userTier\?\s*:\s*Tier/);
    expect(OVERLAY_GALLERY_CODE).not.toMatch(/userTier\s*=\s*"free"/);
  });

  it("ReactionControls props interface has no userTier prop", () => {
    expect(REACTION_CTRL_CODE).not.toMatch(/userTier\?\s*:\s*Tier/);
    expect(REACTION_CTRL_CODE).not.toMatch(/userTier\s*=\s*"free"/);
  });
});

describe("BUG-008 · tier-propagation · canonical hook read", () => {
  it("ExportPanel reads tier via useCanonicalStudioTier()", () => {
    expect(EXPORT_PANEL_SRC).toMatch(
      /import\s*\{\s*useCanonicalStudioTier\s*\}/,
    );
    expect(EXPORT_PANEL_SRC).toMatch(/useCanonicalStudioTier\(\)/);
  });

  it("OverlayTemplateGallery reads tier via useCanonicalStudioTier()", () => {
    expect(OVERLAY_GALLERY_SRC).toMatch(
      /import\s*\{\s*useCanonicalStudioTier\s*\}/,
    );
    expect(OVERLAY_GALLERY_SRC).toMatch(/useCanonicalStudioTier\(\)/);
  });

  it("ReactionControls reads tier via useCanonicalStudioTier()", () => {
    expect(REACTION_CTRL_SRC).toMatch(
      /import\s*\{\s*useCanonicalStudioTier\s*\}/,
    );
    expect(REACTION_CTRL_SRC).toMatch(/useCanonicalStudioTier\(\)/);
  });

  it("useTierCaps exports the canonical hook + type mapping", () => {
    expect(TIER_CAPS_SRC).toMatch(/export function useCanonicalStudioTier/);
    expect(TIER_CAPS_SRC).toMatch(/export function tierToStudioTier/);
    expect(TIER_CAPS_SRC).toMatch(/export type StudioTier/);
  });
});

describe("BUG-008 · tier mapping · clipper collapses to free (studio vocab)", () => {
  it("clipper tier maps to 'free' for the studio vocab", () => {
    expect(tierToStudioTier("clipper")).toBe("free");
  });

  it("pro / growth / agency map through unchanged", () => {
    expect(tierToStudioTier("pro")).toBe("pro");
    expect(tierToStudioTier("growth")).toBe("growth");
    expect(tierToStudioTier("agency")).toBe("agency");
  });
});

describe("BUG-008 · tier-propagation · no caller passes a userTier prop", () => {
  it("ExportRoute mounts ExportPanel without userTier prop", () => {
    // Grep the ExportPanel mount block · a `userTier=` attribute would
    // resurrect the prop even after we deleted it from the type.
    const mountBlock = EXPORT_ROUTE_SRC.match(
      /<ExportPanel[\s\S]*?\/>/,
    );
    expect(mountBlock).not.toBeNull();
    expect(mountBlock![0]).not.toMatch(/userTier=/);
  });

  it("ExportRoute mounts OverlayTemplateGallery without userTier prop", () => {
    const mountBlock = EXPORT_ROUTE_SRC.match(
      /<OverlayTemplateGallery[\s\S]*?\/>/,
    );
    expect(mountBlock).not.toBeNull();
    expect(mountBlock![0]).not.toMatch(/userTier=/);
  });

  it("TimelineStudio mounts all three studio components without userTier prop", () => {
    const reactionMount = TIMELINE_STUDIO_SRC.match(
      /<ReactionControls[\s\S]*?\/>/,
    );
    const overlayMount = TIMELINE_STUDIO_SRC.match(
      /<OverlayTemplateGallery[\s\S]*?\/>/,
    );
    const exportMount = TIMELINE_STUDIO_SRC.match(/<ExportPanel[\s\S]*?\/>/);
    expect(reactionMount).not.toBeNull();
    expect(overlayMount).not.toBeNull();
    expect(exportMount).not.toBeNull();
    expect(reactionMount![0]).not.toMatch(/userTier=/);
    expect(overlayMount![0]).not.toMatch(/userTier=/);
    expect(exportMount![0]).not.toMatch(/userTier=/);
  });
});

describe("BUG-008 · preset unlock rules differ by tier (behavioral shape)", () => {
  it("ExportPanel PRESETS table declares tiered gating (free/pro/growth)", () => {
    // The unlock differential is data-driven: presets carry a ``tier``
    // field, and the render body checks ``TIER_RANK[userTier] <
    // TIER_RANK[p.tier]``. If the three components render the same for
    // every tier, the gating collapsed. Grep the shape.
    expect(EXPORT_PANEL_SRC).toMatch(
      /TIER_RANK\[userTier\]\s*<\s*TIER_RANK\[/,
    );
    // Presets table must include at least one gated-behind-paid tier
    // entry so free vs pro vs agency actually diverge in the UI.
    expect(EXPORT_PANEL_SRC).toMatch(/tier:\s*"free"/);
    expect(EXPORT_PANEL_SRC).toMatch(/tier:\s*"pro"/);
    expect(EXPORT_PANEL_SRC).toMatch(/tier:\s*"growth"/);
  });

  it("OverlayTemplateGallery + ReactionControls also tier-gate at render", () => {
    expect(OVERLAY_GALLERY_SRC).toMatch(
      /TIER_RANK\[userTier\]\s*<\s*TIER_RANK\[/,
    );
    expect(REACTION_CTRL_SRC).toMatch(
      /TIER_RANK\[userTier\]\s*<\s*TIER_RANK\[/,
    );
  });
});
