/**
 * IG-COMPOSER-MODE-SWAP · isComposerEngaged regression test.
 *
 * Locks the contract: which state combinations render the greeter
 * (SimpleComposerShell) vs the cockpit (MasterComposerShell). If any
 * of these assertions fail, the idle → engaged swap has drifted.
 *
 * Companion to scripts/lint-composer-mode-swap.sh (Layer 2 fence);
 * this is Layer 3 (vitest regression). Together with the sentinel
 * comments (Layer 1) and the runtime try/catch fallback (Layer 4)
 * they form the 4-layer defense per feedback_never_regress_4_layer_defense.
 *
 * 2026-07-22 · Sprint 2.5
 */

import { describe, it, expect } from "vitest";
import { isComposerEngaged } from "./useComposerSession";

// Minimal shape that matches ComposerSessionState for the pure predicate.
function makeState(overrides: Partial<Parameters<typeof isComposerEngaged>[0]>): Parameters<typeof isComposerEngaged>[0] {
  return {
    command: "",
    history: [],
    pendingUtterance: "",
    awaitingSource: false,
    urlDraft: "",
    showUrlInput: false,
    sessionCtx: {},
    activeSlug: null,
    progress: null,
    clips: [],
    runError: null,
    lastReply: null,
    kadeMood: "idle",
    lastIntentStatus: null,
    shellOverride: "auto",
    // Actions are unused by the predicate but must satisfy the type.
    setCommand: () => {},
    pushHistory: () => {},
    setPendingUtterance: () => {},
    setAwaitingSource: () => {},
    setUrlDraft: () => {},
    setShowUrlInput: () => {},
    updateSessionCtx: () => {},
    setActiveSlug: () => {},
    setProgress: () => {},
    setClips: () => {},
    setRunError: () => {},
    setLastReply: () => {},
    setKadeMood: () => {},
    setLastIntentStatus: () => {},
    setShellOverride: () => {},
    clearSession: () => {},
    ...overrides,
  };
}

describe("isComposerEngaged · idle → engaged shell swap predicate", () => {
  it("pristine state = idle", () => {
    expect(isComposerEngaged(makeState({}))).toBe(false);
  });

  it("history has any command → engaged", () => {
    expect(isComposerEngaged(makeState({ history: ["give me 3 clips"] }))).toBe(true);
  });

  it("awaitingSource = true → engaged", () => {
    expect(isComposerEngaged(makeState({ awaitingSource: true }))).toBe(true);
  });

  it("progress non-null → engaged", () => {
    expect(isComposerEngaged(makeState({ progress: { stage: "transcribe", percent: 0.3 } }))).toBe(true);
  });

  it("clips returned → engaged", () => {
    // Cast the empty-adjacent clip object as the readonly Clip[] shape
    const clips = [{ idx: 0, title: "T", start: 0, end: 30 }] as unknown as Parameters<typeof isComposerEngaged>[0]["clips"];
    expect(isComposerEngaged(makeState({ clips }))).toBe(true);
  });

  it("activeSlug set → engaged (in-flight run)", () => {
    expect(isComposerEngaged(makeState({ activeSlug: "run_abc123" }))).toBe(true);
  });

  it("lastReply set → engaged (Kade has spoken at least once)", () => {
    expect(isComposerEngaged(makeState({ lastReply: { title: "Hi", body: "there", severity: "info" } }))).toBe(true);
  });

  it("shellOverride='idle' forces idle even when engaged flags are set", () => {
    expect(isComposerEngaged(makeState({
      history: ["clip"], progress: { stage: "cut", percent: 0.9 }, shellOverride: "idle",
    }))).toBe(false);
  });

  it("shellOverride='engaged' forces engaged from pristine state", () => {
    expect(isComposerEngaged(makeState({ shellOverride: "engaged" }))).toBe(true);
  });

  it("shellOverride='auto' respects the computed value (idle when pristine)", () => {
    expect(isComposerEngaged(makeState({ shellOverride: "auto" }))).toBe(false);
  });

  it("shellOverride='auto' respects computed value (engaged when history set)", () => {
    expect(isComposerEngaged(makeState({ shellOverride: "auto", history: ["clip"] }))).toBe(true);
  });
});
