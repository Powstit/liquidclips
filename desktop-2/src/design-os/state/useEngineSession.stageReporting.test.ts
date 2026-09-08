/**
 * useEngineSession · engine stage-reporting fix (2026-09-08)
 *
 * Root cause: the "error" reducer action never touched `state.stage`, so
 * whatever stage the LAST real "progress" event set stayed frozen through
 * an error dispatch. Combined with `llm` never having its own progress
 * event (fixed separately in python-sidecar/sidecar.py's `_run_stage`),
 * a run that succeeded through transcribe and then failed at llm showed
 * "STALLED AT TRANSCRIBE" — a real, reproduced-in-production mislabel,
 * not the invented scenario a synthetic test might otherwise be accused
 * of testing.
 *
 * These tests exercise the reducer directly (both `reducer` and `IDLE`
 * exported for exactly this — no behavior change, same pattern already
 * used for wrapOnDoneWithCrewGate elsewhere in this codebase this
 * session) rather than mounting the full EngineSessionProvider.
 */

import { describe, it, expect } from "vitest";
import { reducer, IDLE } from "./useEngineSession";

describe("useEngineSession reducer · stage-reporting fix", () => {
  it('a "progress" action for llm followed by an error WITH stage:"llm" reports llm, not transcribe', () => {
    // Mirrors the real sequence: transcribe progress arrives first (sets
    // stage to "transcribe", the stale value the bug used to freeze on),
    // then llm's own new stage-start tick arrives (the python-sidecar fix),
    // then llm fails.
    let state = reducer(IDLE, {
      type: "progress",
      stage: "transcribe",
      percent: 1,
    });
    expect(state.stage).toBe("transcribe");

    state = reducer(state, {
      type: "progress",
      stage: "llm",
      percent: 0,
    });
    expect(state.stage).toBe("llm");

    state = reducer(state, {
      type: "error",
      error: "RuntimeError: LLM returned no clips in the 30-75s window after auto-extend.",
      stage: "llm",
    });

    expect(state.phase).toBe("error");
    expect(state.stage).toBe("llm");
  });

  it('an error carrying stage:"llm" corrects a stale stage even without an intervening llm progress event', () => {
    // Defense-in-depth path: proves the error-side fix alone (not just the
    // progress-side fix) is sufficient to correct the label, in case a
    // progress event is ever lost/delayed.
    const afterTranscribe = reducer(IDLE, {
      type: "progress",
      stage: "transcribe",
      percent: 1,
    });
    expect(afterTranscribe.stage).toBe("transcribe");

    const afterError = reducer(afterTranscribe, {
      type: "error",
      error: "RuntimeError: LLM returned no clips in the 30-75s window after auto-extend.",
      stage: "llm",
    });

    expect(afterError.phase).toBe("error");
    expect(afterError.stage).toBe("llm");
  });

  it("an error WITHOUT a stage field preserves the existing stage — backward compatible with every pre-existing engine:error emit site", () => {
    const afterTranscribe = reducer(IDLE, {
      type: "progress",
      stage: "transcribe",
      percent: 1,
    });

    const afterError = reducer(afterTranscribe, {
      type: "error",
      error: "some other failure",
      // no `stage` — matches every engine:error emit site this task did
      // not touch (ExportRoute, tauri-adapter ERROR_BINDINGS, etc.)
    });

    expect(afterError.phase).toBe("error");
    expect(afterError.stage).toBe("transcribe");
  });

  it("an error on a session that never received any progress (stage still null) stays null, unchanged from before this fix", () => {
    const afterError = reducer(IDLE, {
      type: "error",
      error: "immediate failure before any progress",
    });
    expect(afterError.stage).toBeNull();
  });
});
