/**
 * composerCommit regression guard · G4 · 2026-07-19
 *
 * Locks the "Composer picks commit before export_clip" invariant.
 * Root failure this guard prevents: someone removes the re-bake RPC
 * calls, `commitComposerPicks` silently no-ops, Composer's trim /
 * caption picks silently disappear from the shipped MP4 again.
 *
 * Runs under vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMMIT_SRC = readFileSync(
  resolve(__dirname, "composerCommit.ts"),
  "utf-8",
);
const PUBLISH_SRC = readFileSync(
  resolve(
    __dirname,
    "..",
    "design-os",
    "engine",
    "cockpit",
    "PublishModule.tsx",
  ),
  "utf-8",
);

describe("G4 · composerCommit orchestrator · re-bake RPC contract", () => {
  it("commitComposerPicks fires regenerate_clip when trim drifted", () => {
    expect(COMMIT_SRC).toMatch(/sidecar\.regenerateClip\(/);
    expect(COMMIT_SRC).toMatch(/trim.*[dD]rifted/);
  });

  it("commitComposerPicks fires edit_captions when caption style drifted", () => {
    expect(COMMIT_SRC).toMatch(/sidecar\.editCaptions\(/);
    expect(COMMIT_SRC).toMatch(/sidecar\.getCaptions\(/);
    expect(COMMIT_SRC).toMatch(/styleDrifted/);
  });

  it("commitComposerPicks documents reactions as record-time, not commit-time", () => {
    // Prevents accidental re-introduction of a reaction merge call
    // without a real recording · that would fail silently.
    expect(COMMIT_SRC).toMatch(
      /reactions committed by ReactionRecordPreview at record-time/i,
    );
  });

  it("commitComposerPicks non-throwing · errors captured into result.errors", () => {
    // Every RPC call MUST be wrapped in try/catch so a single failure
    // does not halt the whole export.
    const tryBlocks = COMMIT_SRC.match(/try\s*\{/g);
    expect(tryBlocks?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(COMMIT_SRC).toMatch(/result\.errors\.push/);
  });

  it("PublishModule.runExportAndMint calls commitComposerPicks BEFORE exportClip", () => {
    // Order matters · commit must land before the stream-copy so the
    // baked ratio MP4 reflects the picks.
    const commitIdx = PUBLISH_SRC.indexOf("commitComposerPicks(");
    const exportClipIdx = PUBLISH_SRC.indexOf("exportApi.exportClip(");
    expect(commitIdx).toBeGreaterThan(0);
    expect(exportClipIdx).toBeGreaterThan(0);
    expect(commitIdx).toBeLessThan(exportClipIdx);
  });

  it("PublishModule commit is non-blocking · export still runs on commit error", () => {
    // The commit call is wrapped in try/catch so a hard failure of the
    // orchestrator does not prevent exportClip from running.
    const commitCall = PUBLISH_SRC.slice(
      PUBLISH_SRC.indexOf("commitComposerPicks("),
      PUBLISH_SRC.indexOf("exportApi.exportClip("),
    );
    expect(commitCall).toMatch(/composer_commit_orchestrator_failed/);
  });
});
