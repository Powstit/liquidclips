/**
 * UpdateReadyPill.relaunch · IG-UPDATE-PILL-RELAUNCH-NOT-RELOAD
 *
 * Memory-locked bug (see: liquid_clips_update_pill_bug_reload_vs_relaunch):
 * the pill MUST invoke Tauri `relaunch()` on click, NOT
 * `window.location.reload()`. A webview reload keeps serving the
 * pre-swap bundle; only a shell restart lets runtime.rs atomically
 * swap the promoted bundle before Vite loads. `reload()` may only
 * appear as a documented fallback inside the try/catch for non-Tauri
 * browser dev preview contexts.
 *
 * This test asserts two things at the source-file level:
 *   1. `@tauri-apps/plugin-process` is imported and `relaunch` is
 *      referenced by the primary click path.
 *   2. `window.location.reload()` appears at most once, and only
 *      inside a catch block (fallback path), never as the primary
 *      handler line above it.
 *
 * 4-layer defense per never-regress rule:
 *   L1 sentinel comment · in-source at UpdateReadyPill.tsx:114-118
 *   L2 this vitest · asserts contract at source level
 *   L3 grep guard · UpdateBeacon.no-reload-wording.test.ts covers sibling files
 *   L4 runtime try/catch · at UpdateReadyPill.tsx:119-124
 *
 * 2026-07-24
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PILL_PATH = "src/components/UpdateReadyPill.tsx";

describe("IG-UPDATE-PILL-RELAUNCH-NOT-RELOAD · reload → relaunch source contract", () => {
  const abs = resolve(process.cwd(), PILL_PATH);
  const content = readFileSync(abs, "utf-8");

  it("imports Tauri relaunch from @tauri-apps/plugin-process", () => {
    expect(
      /import\s*\{\s*(?:[^}]*,\s*)?relaunch(?:\s*,[^}]*)?\s*\}\s*from\s*["']@tauri-apps\/plugin-process["']/.test(
        content,
      ),
      "UpdateReadyPill must import { relaunch } from @tauri-apps/plugin-process. " +
        "Do not swap for window.location.reload() — the pre-swap bundle will keep serving.",
    ).toBe(true);
  });

  it("invokes relaunch() somewhere in the file (primary click path)", () => {
    expect(
      /await\s+relaunch\s*\(\s*\)/.test(content) || /\.then\(\s*\(\)\s*=>\s*relaunch\(\)/.test(content),
      "UpdateReadyPill click handler must await relaunch(). Memory-locked · see " +
        "liquid_clips_update_pill_bug_reload_vs_relaunch.md",
    ).toBe(true);
  });

  it("uses window.location.reload() only inside a catch fallback, never as the primary path", () => {
    // Count only CODE lines (skip lines that are pure comments · leading * or //).
    // The doc comment + sentinel comment reference the pattern verbatim as documentation,
    // which is intentional and grep-friendly; they don't count as callers.
    const codeReloadHits = content
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return false;
        return /window\.location\.reload\s*\(\s*\)/.test(line);
      });

    expect(
      codeReloadHits.length <= 1,
      `window.location.reload() must appear at most once as executable code in UpdateReadyPill.tsx, ` +
        `and only inside a catch block as a non-Tauri fallback. Found ${codeReloadHits.length} code ` +
        `hits: ${JSON.stringify(codeReloadHits)}. See UpdateReadyPill.tsx:119-124.`,
    ).toBe(true);

    // Structural check: the reload MUST be preceded by a `catch` opening brace
    // within the last 400 characters (i.e. it lives inside a try/catch).
    if (codeReloadHits.length === 1) {
      // Find the offset of the code hit, skipping comment lines.
      const lines = content.split("\n");
      let charOffset = 0;
      let hitOffset = -1;
      for (const line of lines) {
        const trimmed = line.trim();
        const isComment = trimmed.startsWith("*") || trimmed.startsWith("//");
        if (!isComment && /window\.location\.reload\s*\(\s*\)/.test(line)) {
          hitOffset = charOffset + line.indexOf("window.location.reload");
          break;
        }
        charOffset += line.length + 1;
      }
      expect(hitOffset).toBeGreaterThanOrEqual(0);
      const preceding = content.slice(Math.max(0, hitOffset - 400), hitOffset);
      expect(
        /catch\b[^{]*\{[\s\S]*$/.test(preceding),
        "The single window.location.reload() code reference must live inside a catch block. " +
          "Move it inside try { await relaunch(); } catch { window.location.reload(); }.",
      ).toBe(true);
    }
  });

  it("carries the IG-UPDATE-PILL-RELAUNCH-NOT-RELOAD sentinel or an equivalent memory reference", () => {
    // Accept either the explicit iron-gate id or the memory-file reference,
    // so the sentinel comment remains discoverable via grep.
    const hasSentinel =
      /IG-UPDATE-PILL-RELAUNCH-NOT-RELOAD/.test(content) ||
      /liquid_clips_update_pill_bug_reload_vs_relaunch/.test(content);
    expect(
      hasSentinel,
      "UpdateReadyPill.tsx must reference the iron-gate ID or the memory rule name so a future " +
        "editor grepping for the bug lands on the guard.",
    ).toBe(true);
  });
});
