/**
 * IG-COMPOSER-CLIP-STRIP · 2026-07-23
 *
 * Regression: every clip in `useComposerSession().clips` MUST be
 * rendered as a card. Bug found via remote state.snapshot at 10:20am
 * (user asked for 15 clips, backend delivered 15, UI showed only 1
 * because workbench read `clips[0]` and never mapped the array).
 *
 * Source-code invariant test (matches LC's Composer.mount.test.ts style).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "ComposerWorkbench.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "ComposerWorkbench.css"), "utf-8");

describe("IG-COMPOSER-CLIP-STRIP · every clip renders as a card", () => {
  it("workbench source carries the sentinel", () => {
    expect(SRC).toMatch(/IG-COMPOSER-CLIP-STRIP/);
  });

  it("workbench maps the clips array (not just clips[0])", () => {
    // The clip-strip block must call `clips.map((c, i) =>`
    expect(SRC).toMatch(/clips\.map\(\s*\(\s*c\s*,\s*i\s*\)\s*=>/);
  });

  it("selectedClipIdx state · promotes any card to primary", () => {
    expect(SRC).toMatch(/selectedClipIdx/);
    expect(SRC).toMatch(/setSelectedClipIdx/);
    expect(SRC).toMatch(/onClick=\{\s*\(\s*\)\s*=>\s*setSelectedClipIdx\(i\)\s*\}/);
  });

  it("primary preview reads clips[primaryIdx] · not hardcoded 0", () => {
    expect(SRC).toMatch(/primaryIdx/);
    expect(SRC).toMatch(/const\s+primaryClip\s*=\s*clips\[primaryIdx\]/);
  });

  it("clip strip has a stable testid + per-card testids", () => {
    expect(SRC).toMatch(/data-testid="composer-clip-strip"/);
    expect(SRC).toMatch(/data-testid=\{`composer-clip-card-\$\{i\}`\}/);
  });

  it("card exposes a11y state · data-active + aria-pressed", () => {
    expect(SRC).toMatch(/data-active=\{active/);
    expect(SRC).toMatch(/aria-pressed=\{active\}/);
  });

  it("count label reads clips.length live (not hardcoded)", () => {
    expect(SRC).toMatch(/\{clips\.length\}\s+clips\s+ready/);
  });

  it("CSS defines the strip + card + active + hover states", () => {
    expect(CSS).toMatch(/\.lc-wb-clip-strip\s*\{/);
    expect(CSS).toMatch(/\.lc-wb-clip-strip-card\s*\{/);
    expect(CSS).toMatch(/\.lc-wb-clip-strip-card:hover\s*\{/);
    expect(CSS).toMatch(/\.lc-wb-clip-strip-card\[data-active="true"\]\s*\{/);
    expect(CSS).toMatch(/\.lc-wb-clip-strip-card:focus-visible\s*\{/);
  });
});
