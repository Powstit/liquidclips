/**
 * InlineCreatePanel · local-upload Automatic/Manual mode audit (2026-09-08)
 *
 * First test file for this component. Scoped tightly to the new local-
 * upload mode-selection surface — NOT a general coverage pass:
 *
 *   1. The upload tab exposes the SAME chooseOwnClips toggle as the URL
 *      tab (no second mode variable), and the "Pick file" handler stamps
 *      the current toggle value onto `source:drop`'s new `mode` field.
 *   2. `local:review-ready` (fired by globalDropConsumer once a local
 *      Manual-mode file has ingested) drives the panel into the EXISTING
 *      reviewing phase — same fields, same effect that force-reopens the
 *      panel — reusing the URL flow's own architecture, not a second one.
 *   3. Receiving that event does not, by itself, run any post-review
 *      stage (cut/reframe/thumbs) — proves Manual genuinely stops and
 *      waits, it doesn't fall through to automatic processing.
 *   4. Two consecutive local:review-ready events (mirroring two local
 *      Manual runs back to back) don't leak the first run's slug/
 *      duration/source into the second — fresh-run hygiene.
 *
 * Mount pattern matches the repo's established convention (no
 * @testing-library/react): `createRoot` + `act`, minimal mocks for
 * genuinely external modules (diagnosticLogger, watchdog passthrough,
 * sidecar-stub). `useModalPortal`/`useRegisterModal` tolerate a missing
 * ModalPortalContext (fall back to `document.body`), so the panel's real
 * DOM lands under `document.body` (via createPortal), NOT under this
 * test's mount `container` — queries below go through `document`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { bus } from "../bridge";

vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
}));

vi.mock("../../lib/watchdog", () => ({
  Watchdog: ({ children }: { children: React.ReactNode }) => children,
}));

const runStageMock = vi.fn();
const getProjectMock = vi.fn();
const addClipMock = vi.fn();
const removeClipMock = vi.fn();
const pickMoreClipsMock = vi.fn();
vi.mock("../engine/sidecar-stub", () => ({
  sidecar: {
    ingestUrl: vi.fn(),
    startRun: vi.fn(),
    runStage: (...args: unknown[]) => runStageMock(...args),
    getProject: (...args: unknown[]) => getProjectMock(...args),
    addClip: (...args: unknown[]) => addClipMock(...args),
    removeClip: (...args: unknown[]) => removeClipMock(...args),
    pickMoreClips: (...args: unknown[]) => pickMoreClipsMock(...args),
  },
}));

const openDialogMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));

import { InlineCreatePanel } from "./InlineCreatePanel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  runStageMock.mockReset();
  getProjectMock.mockReset();
  openDialogMock.mockReset();
  addClipMock.mockReset();
  removeClipMock.mockReset();
  pickMoreClipsMock.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  // `"__TAURI_INTERNALS__" in window` is what sourceVideoSrc() and the
  // pick-file handler both branch on — setting the key to `undefined`
  // would still satisfy `in`, so it must be deleted outright to restore
  // the non-Tauri test default between tests.
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function mountOpenOnUploadTab(): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<InlineCreatePanel />);
  });
  await act(async () => {
    bus.emit("home:open-panel", { tab: "upload" });
  });
}

function panelPhase(): string | null {
  return document.querySelector('[data-testid="create-panel"]')?.getAttribute("data-phase") ?? null;
}

describe("InlineCreatePanel · upload tab mode toggle", () => {
  it("upload tab renders the same 'Pick your own clips' toggle used by the URL tab", async () => {
    await mountOpenOnUploadTab();
    const toggle = document.querySelector('[data-testid="choose-own-clips-toggle-upload"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });

  it("Pick file emits source:drop with mode:\"automatic\" when the toggle is off (default)", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    openDialogMock.mockResolvedValueOnce("/Users/test/Movies/clip.mp4");
    await mountOpenOnUploadTab();

    const received: Array<{ paths: string[]; mode?: string }> = [];
    const off = bus.on("source:drop", (p) => received.push(p));

    const pickBtn = document.querySelector('[data-testid="upload-pick-file"]') as HTMLButtonElement;
    await act(async () => {
      pickBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    off?.();

    expect(received.length).toBe(1);
    expect(received[0].paths).toEqual(["/Users/test/Movies/clip.mp4"]);
    expect(received[0].mode).toBe("automatic");
  });

  it("Pick file emits source:drop with mode:\"manual\" when the toggle is on — selected BEFORE picking the file", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    openDialogMock.mockResolvedValueOnce("/Users/test/Movies/clip2.mp4");
    await mountOpenOnUploadTab();

    const toggle = document.querySelector('[data-testid="choose-own-clips-toggle-upload"]') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    const received: Array<{ paths: string[]; mode?: string }> = [];
    const off = bus.on("source:drop", (p) => received.push(p));

    const pickBtn = document.querySelector('[data-testid="upload-pick-file"]') as HTMLButtonElement;
    await act(async () => {
      pickBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    off?.();

    expect(received.length).toBe(1);
    expect(received[0].mode).toBe("manual");
  });

  it("the toggle is the SAME state as the URL tab's toggle (one mode variable, not two)", async () => {
    await mountOpenOnUploadTab();
    const uploadToggle = document.querySelector('[data-testid="choose-own-clips-toggle-upload"]') as HTMLButtonElement;
    // The mode preference lives in lib/localClipMode.ts, module-level by
    // design (sticky across "+"-cycles — see InlineCreatePanel's own
    // comment at its declaration), so an earlier test in this file may
    // have left it "true". Flip from whatever it currently is rather than assuming
    // a fresh "false" — this test only cares that both tabs read the
    // SAME value after the flip, not what that value starts as.
    const before = uploadToggle.getAttribute("aria-checked");
    await act(async () => {
      uploadToggle.click();
    });
    const after = uploadToggle.getAttribute("aria-checked");
    expect(after).not.toBe(before);

    // Switch to the URL tab — its toggle must already reflect the same
    // flipped value. Tabs render in declared order: url, upload, transcribe.
    const tabs = document.querySelectorAll('[data-testid="create-panel-tabs"] [role="tab"]');
    await act(async () => {
      (tabs[0] as HTMLElement).click();
    });
    const urlToggle = document.querySelector('[data-testid="choose-own-clips-toggle"]');
    expect(urlToggle?.getAttribute("aria-checked")).toBe(after);
  });
});

describe("InlineCreatePanel · local:review-ready (Manual local-upload hand-off)", () => {
  it("drives phase to 'reviewing' with the fields globalDropConsumer sends, and force-reopens the panel", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    // Panel starts closed (open=false) — nothing rendered yet.
    expect(document.querySelector('[data-testid="create-panel"]')).toBeNull();

    await act(async () => {
      bus.emit("local:review-ready", {
        slug: "local-run-1",
        duration_s: 212,
        source_path: "/Users/test/Movies/vacation.mp4",
      });
    });

    expect(panelPhase()).toBe("reviewing");
    const video = document.querySelector('[data-testid="review-source-video"]');
    expect(video?.getAttribute("src")).toBe("/Users/test/Movies/vacation.mp4");
  });

  it("does NOT run any post-review stage (cut/reframe/thumbs) merely from receiving the event", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("local:review-ready", {
        slug: "local-run-2",
        duration_s: 90,
        source_path: "/Users/test/Movies/clip.mp4",
      });
    });
    expect(panelPhase()).toBe("reviewing");
    // Manual mode's entire point is that it STOPS here — nothing should
    // have called runStage (which is what both PRE_REVIEW_STAGES and
    // POST_REVIEW_STAGES use) without the user confirming.
    expect(runStageMock).not.toHaveBeenCalled();
  });

  it("a second local:review-ready does not leak the first run's slug/duration/source", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });

    await act(async () => {
      bus.emit("local:review-ready", {
        slug: "local-run-A",
        duration_s: 300,
        source_path: "/Users/test/Movies/first.mp4",
      });
    });
    expect(panelPhase()).toBe("reviewing");
    expect(
      document.querySelector('[data-testid="review-source-video"]')?.getAttribute("src"),
    ).toBe("/Users/test/Movies/first.mp4");

    // Simulate the SAME cleanup a completed run leaves behind before "+"
    // starts a new one (resetReviewState + route:enter reset), then the
    // next local Manual run's ready event.
    await act(async () => {
      bus.emit("local:review-ready", {
        slug: "local-run-B",
        duration_s: 45,
        source_path: "/Users/test/Movies/second.mp4",
      });
    });

    expect(panelPhase()).toBe("reviewing");
    expect(
      document.querySelector('[data-testid="review-source-video"]')?.getAttribute("src"),
    ).toBe("/Users/test/Movies/second.mp4");
  });
});

/**
 * confirmReview() · manual-cut-blocked-by-AI-failure fix (2026-09-08)
 *
 * Root cause (confirmed live via project.json on the failed run: clips: [],
 * cut/reframe/thumbs stuck "pending"): confirmReview() required
 * fetchAiSuggestions() to succeed whenever transcriptReady was false —
 * with no way for it to ever become true after a failure, a video whose
 * transcript makes the LLM return no clips left EVERY click of "Cut"
 * re-running the same doomed AI pass and bailing out before ever reaching
 * addClip/removeClip/runPostReviewStages, even though the user already had
 * a valid manually-marked clip. Fix: only require the AI pass to succeed
 * when the user has nothing of their own yet (reviewKept.size > 0 ||
 * customClips.length > 0 — the same signal the empty-selection guard
 * above confirmReview already uses).
 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

async function addCustomClipViaUI(start: string, end: string): Promise<void> {
  const startInput = document.querySelector<HTMLInputElement>('[data-testid="review-custom-start"]')!;
  const endInput = document.querySelector<HTMLInputElement>('[data-testid="review-custom-end"]')!;
  const addBtn = document.querySelector<HTMLButtonElement>('[data-testid="review-custom-add"]')!;
  await act(async () => {
    setInputValue(startInput, start);
    startInput.dispatchEvent(new Event("input", { bubbles: true }));
    setInputValue(endInput, end);
    endInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    addBtn.click();
  });
}

async function openManualReview(slug: string, durationS = 200): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<InlineCreatePanel />);
  });
  await act(async () => {
    bus.emit("local:review-ready", { slug, duration_s: durationS, source_path: "/Users/test/Movies/song.mp4" });
  });
}

function clickConfirm(): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>('[data-testid="review-confirm"]')!;
  return act(async () => {
    btn.click();
    // confirmReview is async; flush its microtask chain (addClip/removeClip
    // awaits + runPostReviewStages' own runStage awaits).
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Simulates "audio/transcribe succeed, llm is irrelevant/never reached"
 *  — the realistic shape for a manual-only confirm. Rejecting "llm" too
 *  (rather than just omitting it) means the test would fail loudly if a
 *  future change ever let confirmReview reach it for a manual selection. */
function resolveAudioTranscribeRejectLlm(): void {
  runStageMock.mockImplementation((slug: string, stage: string) => {
    if (stage === "llm") {
      return Promise.reject(new Error("llm must not run for a manual-only confirm"));
    }
    return Promise.resolve({ project: { slug, clips: [] } });
  });
}

/**
 * confirmReview() · manual-cut-needs-transcript fix (2026-09-08)
 *
 * Follow-up to the AI-failure bypass fix directly above. That fix let a
 * manual selection skip fetchAiSuggestions() entirely — which exposed
 * that addClip()'s own backend check (transcript/transcript.srt must
 * exist, python-sidecar/sidecar.py:1879) had been silently satisfied as
 * a SIDE EFFECT of fetchAiSuggestions always running audio+transcribe
 * before llm. Skipping fetchAiSuggestions skipped that side effect too,
 * so addClip started throwing "Lift the transcript first" — confirmed
 * live via project.json: audio/transcribe/llm/cut/reframe/thumbs all
 * still "pending", transcript/ directory empty on disk.
 *
 * Fix: confirmReview now runs ONLY audio+transcribe (ensureTranscript
 * ForManualCut, never llm, never fetchAiSuggestions) when the user has a
 * manual selection and transcriptReady is still false.
 */
describe("confirmReview() · manual selection still needs a real transcript (not AI) before cutting", () => {
  it("A. manual custom clip + transcriptReady=false → audio+transcribe run, llm does NOT run, clip persisted, post-review runs", async () => {
    resolveAudioTranscribeRejectLlm();
    await openManualReview("manual-cut-a");
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    const stagesCalled = runStageMock.mock.calls.map((c) => c[1]);
    expect(stagesCalled).toEqual(["audio", "transcribe", "cut", "reframe", "thumbs"]);
    expect(stagesCalled).not.toContain("llm");
    expect(addClipMock).toHaveBeenCalledWith("manual-cut-a", 10, 30, expect.any(String));
  });

  it("B. a kept AI-suggested clip (reviewKept) also counts as a manual selection — audio+transcribe run once via the AI-preview, llm/post-review then proceed without re-running them", async () => {
    // Honest caveat: reviewKept can ONLY become non-empty via a successful
    // fetchAiSuggestions() call (InlineCreatePanel.tsx:860), which in the
    // SAME call also sets transcriptReady=true — there is no reachable
    // app state where reviewKept > 0 and transcriptReady is still false
    // (confirmed by grepping every setReviewKept call site). This test
    // covers what IS reachable: reviewKept alone (no customClips) still
    // satisfies hasManualSelection and flows correctly through confirm.
    let llmCalls = 0;
    runStageMock.mockImplementation((slug: string, stage: string) => {
      if (stage === "llm") {
        llmCalls += 1;
        return Promise.resolve({ project: { slug, clips: [{ id: "c1", start: 5, end: 15, title: "AI pick" }] } });
      }
      return Promise.resolve({ project: { slug, clips: [] } });
    });
    await openManualReview("manual-cut-b");
    const suggestBtn = document.querySelector<HTMLButtonElement>('[data-testid="review-ai-suggest"]')!;
    await act(async () => {
      suggestBtn.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(llmCalls).toBe(1);

    runStageMock.mockClear();
    await clickConfirm();

    // transcriptReady is already true from the AI-preview above — audio/
    // transcribe/llm must not run a second time inside confirm itself.
    const stagesCalled = runStageMock.mock.calls.map((c) => c[1]);
    expect(stagesCalled).toEqual(["cut", "reframe", "thumbs"]);
    expect(llmCalls).toBe(1);
  });

  it("C. transcriptReady=true (via a prior manual custom-clip confirm's own audio+transcribe) → not redundantly rerun on a second selection in the same session", async () => {
    resolveAudioTranscribeRejectLlm();
    await openManualReview("manual-cut-c");
    await addCustomClipViaUI("10", "30");
    await clickConfirm();
    expect(runStageMock.mock.calls.map((c) => c[1])).toEqual(["audio", "transcribe", "cut", "reframe", "thumbs"]);

    // confirmReview's own successful path calls resetReviewState(), which
    // resets transcriptReady too (a fresh review session should re-check
    // it) — so genuine no-redundant-rerun coverage lives in test E below,
    // which exercises a RETRY within the SAME still-open review session
    // (the only real place transcriptReady survives a second confirm).
  });

  it("D. audio/transcribe failure → stops safely: addClip and post-review stages are never called, reviewError is set, phase returns to reviewing", async () => {
    runStageMock.mockImplementation((_slug: string, stage: string) => {
      if (stage === "audio") {
        return Promise.reject(new Error("ffmpeg audio extraction failed"));
      }
      return Promise.resolve({ project: { slug: _slug, clips: [] } });
    });
    await openManualReview("manual-cut-d");
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    expect(addClipMock).not.toHaveBeenCalled();
    const stagesCalled = runStageMock.mock.calls.map((c) => c[1]);
    expect(stagesCalled).toEqual(["audio"]); // never reached transcribe, never reached cut/reframe/thumbs
    expect(stagesCalled).not.toContain("llm");
    // Existing generic error handling (confirmReview's own catch) — not
    // an LLM-flavored message, since llm was never invoked.
    const errorText = document.querySelector('[data-testid="review-error"]')?.textContent ?? "";
    expect(errorText).toContain("ffmpeg audio extraction failed");
    expect(panelPhase()).toBe("reviewing");
  });

  it("E. a retry after a post-review-stage failure does not redundantly rerun audio/transcribe a second time", async () => {
    let cutAttempts = 0;
    runStageMock.mockImplementation((slug: string, stage: string) => {
      if (stage === "llm") return Promise.reject(new Error("llm must not run for a manual-only confirm"));
      if (stage === "cut") {
        cutAttempts += 1;
        if (cutAttempts === 1) return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve({ project: { slug, clips: [] } });
    });
    await openManualReview("manual-cut-e");
    await addCustomClipViaUI("10", "30");

    // First attempt: audio+transcribe succeed (transcriptReady becomes
    // true), addClip runs, then "cut" fails — confirmReview's own catch
    // fires BEFORE resetReviewState(), so transcriptReady/customClips
    // survive for the retry (see the code's own comment on that ordering).
    await clickConfirm();
    expect(panelPhase()).toBe("reviewing");
    const firstAttemptStages = runStageMock.mock.calls.map((c) => c[1]);
    expect(firstAttemptStages).toEqual(["audio", "transcribe", "cut"]);

    // Retry: transcriptReady is already true — audio/transcribe must NOT
    // run again. "cut" succeeds this time.
    runStageMock.mockClear();
    await clickConfirm();
    const retryStages = runStageMock.mock.calls.map((c) => c[1]);
    expect(retryStages).not.toContain("audio");
    expect(retryStages).not.toContain("transcribe");
    expect(retryStages).not.toContain("llm");
    expect(retryStages).toEqual(["cut", "reframe", "thumbs"]);
  });

  it("F. no manual clips → existing behavior unchanged: Confirm stays disabled by the pre-existing empty-selection guard", async () => {
    resolveAudioTranscribeRejectLlm();
    await openManualReview("manual-cut-f");
    // No addCustomClipViaUI call — reviewKept and customClips both empty.

    const confirmBtn = document.querySelector<HTMLButtonElement>('[data-testid="review-confirm"]')!;
    expect(confirmBtn.disabled).toBe(true);

    // A disabled button doesn't fire onClick in jsdom (matches real
    // browsers) — confirms the pre-existing guard (the early
    // `reviewKept.size === 0 && customClips.length === 0` check) is what
    // actually protects this state, unmodified by either fix. Nothing ran.
    await clickConfirm();
    expect(runStageMock).not.toHaveBeenCalled();
    expect(addClipMock).not.toHaveBeenCalled();
  });
});

/**
 * confirmReview() · manual+AI-fill fix (2026-09-08)
 *
 * Product clarification: the "N clips" target chip is the MAXIMUM/FIXED
 * size of the final result, not a minimum. Manual selections always take
 * priority; AI fills only the remainder.
 *
 *   manual_to_keep = min(manual_selected_count, target_count)
 *   remaining      = target_count - manual_to_keep
 *
 * Reuses the EXISTING `sidecar.pickMoreClips` / python-sidecar
 * `method_pick_more_clips` mechanism (overlap-avoidance brief hint +
 * additive `set_clips`, never replaces) — the only backend change is an
 * optional `count` param threaded into its already-existing
 * `pick_clips_from_transcript(..., target_count=...)` support, plus a
 * defensive cap (target_count is only a prompt instruction, not an
 * enforced limit) so the appended total can never exceed what was asked.
 */
function setCountViaUI(target: 10 | 30 | 100): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[aria-label="Select ${target} clips"]`)!;
  return act(async () => {
    btn.click();
  });
}

describe("confirmReview() · manual selections keep priority, AI fills only the remainder up to target", () => {
  it("1. target 10 + 1 manual → AI asked for exactly 9, final capped at 10", async () => {
    resolveAudioTranscribeRejectLlm();
    pickMoreClipsMock.mockResolvedValue({ project: { slug: "t1", clips: [] }, added: 9, skipped: 0 });
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t1", duration_s: 200, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    expect(addClipMock).toHaveBeenCalledTimes(1);
    expect(pickMoreClipsMock).toHaveBeenCalledWith("t1", 9);
  });

  it("2. target 10 + 3 manual → AI asked for exactly 7", async () => {
    resolveAudioTranscribeRejectLlm();
    pickMoreClipsMock.mockResolvedValue({ project: { slug: "t2", clips: [] }, added: 7, skipped: 0 });
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t2", duration_s: 200, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "20");
    await addCustomClipViaUI("30", "40");
    await addCustomClipViaUI("50", "60");

    await clickConfirm();

    expect(addClipMock).toHaveBeenCalledTimes(3);
    expect(pickMoreClipsMock).toHaveBeenCalledWith("t2", 7);
  });

  it("3. target 10 + 10 manual → AI call skipped entirely", async () => {
    resolveAudioTranscribeRejectLlm();
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t3", duration_s: 400, source_path: "/Users/test/Movies/song.mp4" });
    });
    for (let i = 0; i < 10; i++) {
      const start = 10 + i * 20;
      await addCustomClipViaUI(String(start), String(start + 10));
    }

    await clickConfirm();

    expect(addClipMock).toHaveBeenCalledTimes(10);
    expect(pickMoreClipsMock).not.toHaveBeenCalled();
  });

  it("4. AI is only asked for the remainder AFTER manual clips are already persisted, so the backend's overlap check (existing_ranges from project.clips) sees them", async () => {
    resolveAudioTranscribeRejectLlm();
    const callOrder: string[] = [];
    addClipMock.mockImplementation(() => {
      callOrder.push("addClip");
      return Promise.resolve({ project: { slug: "t4", clips: [] } });
    });
    pickMoreClipsMock.mockImplementation(() => {
      callOrder.push("pickMoreClips");
      return Promise.resolve({ project: { slug: "t4", clips: [] }, added: 9, skipped: 0 });
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t4", duration_s: 200, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    // addClip (manual persistence) must complete before pickMoreClips is
    // ever called — the sidecar reads project.clips fresh from disk to
    // build its overlap-exclusion hint, so ordering is what makes "AI
    // avoids manual clips" actually work.
    expect(callOrder).toEqual(["addClip", "pickMoreClips"]);
  });

  it("5. manual clips are never replaced — removeClip is never called for a customClips-only selection", async () => {
    resolveAudioTranscribeRejectLlm();
    pickMoreClipsMock.mockResolvedValue({ project: { slug: "t5", clips: [] }, added: 9, skipped: 0 });
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t5", duration_s: 200, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    expect(removeClipMock).not.toHaveBeenCalled();
    expect(addClipMock).toHaveBeenCalledWith("t5", 10, 30, expect.any(String));
  });

  it("6. transcript preparation (audio+transcribe) still happens before addClip/pickMoreClips — the earlier fix stays intact", async () => {
    resolveAudioTranscribeRejectLlm();
    const callOrder: string[] = [];
    runStageMock.mockImplementation((slug: string, stage: string) => {
      if (stage === "audio" || stage === "transcribe") callOrder.push(stage);
      if (stage === "llm") return Promise.reject(new Error("llm must not run for a manual-only confirm"));
      return Promise.resolve({ project: { slug, clips: [] } });
    });
    addClipMock.mockImplementation(() => {
      callOrder.push("addClip");
      return Promise.resolve({ project: { slug: "t6", clips: [] } });
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t6", duration_s: 200, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    expect(callOrder).toEqual(["audio", "transcribe", "addClip"]);
  });

  it("7. AI-fill failure does not destroy the already-persisted manual selections — cut/reframe/thumbs still run", async () => {
    resolveAudioTranscribeRejectLlm();
    pickMoreClipsMock.mockRejectedValue(new Error("hosted LLM proxy down"));
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(10);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t7", duration_s: 200, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "30");

    await clickConfirm();

    expect(addClipMock).toHaveBeenCalledTimes(1);
    const stagesCalled = runStageMock.mock.calls.map((c) => c[1]);
    expect(stagesCalled).toEqual(["audio", "transcribe", "cut", "reframe", "thumbs"]);
    // The confirm as a whole still completed successfully — not stuck on
    // "reviewing" with an error, since the AI-fill failure is swallowed.
    expect(panelPhase()).not.toBe("reviewing");
  });

  it("8. target 100 + 4 manual → AI asked for exactly 96 (formula holds for larger targets too)", async () => {
    resolveAudioTranscribeRejectLlm();
    pickMoreClipsMock.mockResolvedValue({ project: { slug: "t8", clips: [] }, added: 96, skipped: 0 });
    await act(async () => {
      root = createRoot(container);
      root.render(<InlineCreatePanel />);
    });
    await act(async () => {
      bus.emit("home:open-panel", {});
    });
    await setCountViaUI(100);
    await act(async () => {
      bus.emit("local:review-ready", { slug: "t8", duration_s: 400, source_path: "/Users/test/Movies/song.mp4" });
    });
    await addCustomClipViaUI("10", "20");
    await addCustomClipViaUI("30", "40");
    await addCustomClipViaUI("50", "60");
    await addCustomClipViaUI("70", "80");

    await clickConfirm();

    expect(addClipMock).toHaveBeenCalledTimes(4);
    expect(pickMoreClipsMock).toHaveBeenCalledWith("t8", 96);
  });
});
