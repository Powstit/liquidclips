/**
 * EditorSection · C1-T2 wire tests
 *
 * MASTER_AUDIT_2026-07-05 P0 finding #1: Editor rendered 100 %
 * fixture clips (`generateClips(6, 0)` + `fakeEditor.preview`) in
 * prod path — no real user footage ever hit the timeline. C1-T2
 * replaces the fixture source with `useEngineSession().project.clips`
 * (persistence-hydrated from `readPersistedSession()` +
 * `sidecar.getProject(slug)`).
 *
 * Same source-file assertion pattern as the Phase 8 mount tests —
 * safer than pulling in a full Suspense-aware SSR harness for a
 * section that mounts an EngineSessionProvider + several drawer
 * components.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EDITOR_SRC = readFileSync(
  resolve(__dirname, "EditorSection.tsx"),
  "utf-8",
);

describe("EditorSection · C1-T2 real clip pipeline", () => {
  it("no longer imports generateClips or resetClipSequence from fakeEditor.preview", () => {
    // Both were the fixture-clip generators. `createEditState` is
    // still fair game (pure per-clip edit state initialiser · no fake
    // clip data).
    expect(EDITOR_SRC).not.toMatch(/import\s*{[^}]*generateClips[^}]*}\s*from/);
    expect(EDITOR_SRC).not.toMatch(/import\s*{[^}]*resetClipSequence[^}]*}\s*from/);
    expect(EDITOR_SRC).not.toMatch(/import\s*{[^}]*regenerateClip[^}]*}\s*from/);
  });

  it("no longer defines a getCampaignById stub", () => {
    // The `function getCampaignById(_id: string): FakeCampaign | undefined`
    // stub added during the 2.2.24 fixture purge is removed as part
    // of C1-T2. Real campaign-store wiring is CM lane's territory.
    expect(EDITOR_SRC).not.toMatch(/function\s+getCampaignById\s*\(/);
    expect(EDITOR_SRC).not.toMatch(/import\s+type\s*{[^}]*FakeCampaign[^}]*}\s*from/);
  });

  it("imports useEngineSession + persistence helpers + sidecar", () => {
    expect(EDITOR_SRC).toMatch(
      /import\s*{[^}]*EngineSessionProvider[^}]*useEngineSession[^}]*}\s*from\s*["'][^"']*useEngineSession["']/,
    );
    expect(EDITOR_SRC).toMatch(
      /import\s*{[^}]*readPersistedSession[^}]*useEngineSessionPersistence[^}]*}\s*from\s*["'][^"']*engineSessionPersistence["']/,
    );
    expect(EDITOR_SRC).toMatch(
      /import\s*{[^}]*sidecar[^}]*}\s*from\s*["'][^"']*sidecar-stub["']/,
    );
  });

  it("wraps the section body in EngineSessionProvider", () => {
    expect(EDITOR_SRC).toMatch(/<EngineSessionProvider[^>]*resetOnRouteEnter=\{false\}/);
  });

  it("reads clips from session.project.clips (or persistence-hydrated project)", () => {
    // The adapter turns real Clip → UI Clip via toUiClip. `realProject`
    // resolves to `session.project ?? hydratedProject`.
    expect(EDITOR_SRC).toMatch(/session\.project\s*\?\?\s*hydratedProject/);
    expect(EDITOR_SRC).toMatch(/realProject\?\.clips\s*\?\?\s*\[\]/);
    expect(EDITOR_SRC).toMatch(/function\s+toUiClip\s*\(/);
  });

  it("renders an explicit empty state when no clips are available", () => {
    expect(EDITOR_SRC).toMatch(/data-testid="editor-empty-state"/);
    expect(EDITOR_SRC).toMatch(/data-testid="editor-empty-cta"/);
    expect(EDITOR_SRC).toMatch(/No clips yet\./);
    // Empty-state CTA nudges the user back to the Workstation route.
    expect(EDITOR_SRC).toMatch(/bus\.emit\(\s*"nav:click"\s*,\s*{\s*route:\s*"workstation"\s*}\s*\)/);
  });

  it("Publish + Whop modals fire against project-scoped composite clip IDs", () => {
    // Composite id shape is `${slug}/${clip.idx}` when a project is
    // hydrated. The helper `realClipHandoffId` centralises the format.
    expect(EDITOR_SRC).toMatch(/function\s+realClipHandoffId\s*\(/);
    expect(EDITOR_SRC).toMatch(/`\${slug}\/\${clipIdx}`/);
    expect(EDITOR_SRC).toMatch(/clipId=\{\s*selectedHandoffId\s*\?\?\s*"clip_unselected"\s*\}/);
    expect(EDITOR_SRC).toMatch(/clipId=\{\s*selectedHandoffId\s*\}/);
  });

  it("guards against sidecar-stub fixture fallback (FIXTURE_PROJECT.name)", () => {
    expect(EDITOR_SRC).toMatch(/project\.name\s*===\s*FIXTURE_PROJECT\.name/);
  });

  it("regenerate / generate / generate-more surface a nudge toast, not a silent no-op", () => {
    expect(EDITOR_SRC).toMatch(/nudgeToWorkstation/);
    expect(EDITOR_SRC).toMatch(/bake more clips in the Workstation/);
  });
});
