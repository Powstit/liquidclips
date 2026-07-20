/**
 * S3 · ComposerBaseWindow.layout field regression guard.
 *
 * Locks the app-shell layout contract added to ComposerBaseWindow so the
 * mockup's `.layout-btn` clicks (Single / Split-V / Split-H / 2×2) can
 * persist as real per-clip state via `setBaseWindow({ layout })`.
 *
 * Reference: capabilities.ts:524 declares
 *   `writes_to: "baseWindow.layout"`
 * for the `layout.set` base action. If ComposerBaseWindow ever drops the
 * `layout?` field, that capability write silently no-ops and every
 * Composer layout button becomes visual-only again.
 *
 * The check is compile-time-ish: a TypeScript object literal typed as
 * ComposerBaseWindow is assigned to a value for each of the four legal
 * values. If the interface loses the field, `tsc --noEmit` fails here
 * before any runtime code sees the regression.
 *
 * Runs under vitest (executes the assertions AND participates in the
 * project's tsc typecheck).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ComposerBaseWindow } from "./CockpitContext";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CTX_SRC = readFileSync(resolve(__dirname, "CockpitContext.tsx"), "utf-8");

describe("ComposerBaseWindow · `layout` app-shell field (S3)", () => {
  it("interface accepts every layout value the mockup emits (compile-time)", () => {
    // If the interface drops `layout?`, tsc --noEmit fails on these four
    // literal assignments before vitest ever runs the block.
    const single: ComposerBaseWindow = { layout: "single" };
    const splitV: ComposerBaseWindow = { layout: "split-vertical" };
    const splitH: ComposerBaseWindow = { layout: "split-horizontal" };
    const grid: ComposerBaseWindow = { layout: "grid-2x2" };

    expect(single.layout).toBe("single");
    expect(splitV.layout).toBe("split-vertical");
    expect(splitH.layout).toBe("split-horizontal");
    expect(grid.layout).toBe("grid-2x2");
  });

  it("interface still accepts an empty object · field is optional", () => {
    // IG-COMPOSER-E · every field on ComposerBaseWindow MUST stay `?:` so
    // v0.7-era clip entries load clean. If someone flips `layout` to
    // required, this line fails to compile.
    const empty: ComposerBaseWindow = {};
    expect(empty.layout).toBeUndefined();
  });

  it("CockpitContext.tsx source declares the four legal layout literals", () => {
    // Belt-and-braces string check so a rename ("single" → "solo" etc.)
    // still trips the guard even if the type name stays intact.
    expect(CTX_SRC).toMatch(/layout\?:\s*"single"\s*\|\s*"split-vertical"\s*\|\s*"split-horizontal"\s*\|\s*"grid-2x2"/);
  });
});
