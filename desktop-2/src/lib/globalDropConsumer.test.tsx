/**
 * GlobalDropConsumer · local-upload ingest audit (2026-09-08) — fix 4
 * regression test.
 *
 * The audit found that a local `startRun()` failure reached the
 * `engine:error` bus event with only a flattened `.error` string —
 * `human`/`code` were never forwarded, even though a `SidecarError`
 * instance already carries both (and `IngestErrorStrip` reads them
 * directly, gating its verbatim-copy path on `.code`). This test proves
 * the fix: both fields now reach the emitted event.
 *
 * Testing strategy matches the established local pattern (see
 * `SimpleLoginPanel.test.tsx`) — no @testing-library/react in this
 * project. Mount via `createRoot`, drive via the real event bus, `act`
 * to flush.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { bus } from "../design-os/bridge";
import { SidecarError } from "../design-os/engine/sidecarCall";
import { GlobalDropConsumer } from "./globalDropConsumer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Passthrough — the real Watchdog is an error boundary + telemetry
// wrapper irrelevant to this test; mocking it keeps the test focused on
// GlobalDropConsumerInner's own logic.
vi.mock("./watchdog", () => ({
  Watchdog: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./diagnosticLogger", () => ({
  lcDiag: () => undefined,
  probeSidecarState: async () => undefined,
}));

vi.mock("../design-os/state/engineSessionPersistence", () => ({
  startPersistedSession: () => undefined,
}));

const startRunMock = vi.fn();
const runStageMock = vi.fn();
vi.mock("../design-os/engine/sidecar-stub", () => ({
  sidecar: {
    startRun: (...args: unknown[]) => startRunMock(...args),
    runStage: (...args: unknown[]) => runStageMock(...args),
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  startRunMock.mockReset();
  runStageMock.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function emitDrop(path: string): Promise<void> {
  await act(async () => {
    bus.emit("source:drop", { paths: [path] });
  });
}

/** handleDrop chains several real awaits (preflight, toast/nav, session
 *  persistence, the sidecarCall itself, then a dynamic `import("./hqEmit")`
 *  in the catch branch) before it reaches bus.emit("engine:error", ...) —
 *  more microtask ticks than a fixed few Promise.resolve() flushes can
 *  reliably drain. Poll instead. */
async function waitForCondition(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitForCondition timed out");
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

describe("GlobalDropConsumer · auth/ingest audit fix 4 — human/code passthrough", () => {
  it("forwards a SidecarError's human and code fields onto engine:error for a local upload failure", async () => {
    const sidecarErr = new SidecarError({
      error: "source_path is outside the allowed roots (/etc/hosts).",
      human: "Move the file into your home folder or a mounted volume (Volumes), or set LIQUIDCLIPS_EXTRA_SOURCE_ROOTS.",
      code: "unknown",
    });
    startRunMock.mockRejectedValueOnce(sidecarErr);

    const received: Array<Record<string, unknown>> = [];
    const off = bus.on("engine:error", (p: Record<string, unknown>) => {
      if (p.kind === "ingest") received.push(p);
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    await emitDrop("/Users/test/some-folder/my_clip.mp4");
    await waitForCondition(() => received.length > 0);

    off?.();

    expect(received.length).toBeGreaterThan(0);
    const evt = received[0];
    expect(evt.human).toBe(sidecarErr.human);
    expect(evt.code).toBe(sidecarErr.code);
    expect(evt.error).toBe(sidecarErr.message);
  });

  it("still emits engine:error for a plain (non-SidecarError) throw, with human/code left undefined rather than fabricated", async () => {
    startRunMock.mockRejectedValueOnce(new Error("boom"));

    const received: Array<Record<string, unknown>> = [];
    const off = bus.on("engine:error", (p: Record<string, unknown>) => {
      if (p.kind === "ingest") received.push(p);
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    await emitDrop("/Users/test/some-folder/other_clip.mov");
    await waitForCondition(() => received.length > 0);

    off?.();

    expect(received.length).toBeGreaterThan(0);
    const evt = received[0];
    expect(evt.error).toBe("boom");
    expect(evt.human).toBeUndefined();
    expect(evt.code).toBeUndefined();
  });
});

/**
 * Local-upload Automatic/Manual mode audit (2026-09-08) — mode propagation.
 *
 * globalDropConsumer is the ONE local-ingest path both the file picker
 * (InlineCreatePanel's upload tab) and raw drag/drop (DropOverlay) funnel
 * through via `source:drop`. These tests prove:
 *   - an explicit `mode: "manual"` skips drivePostIngestStages and instead
 *     hands off to InlineCreatePanel's existing review architecture via
 *     `local:review-ready` (not a second review implementation);
 *   - `mode: "automatic"` (or the field absent entirely, exactly what
 *     DropOverlay's raw drag/drop and UploadPortal's native picker still
 *     send) runs the SAME full stage sequence as before this change —
 *     zero regression to existing drag/drop behavior.
 */
describe("GlobalDropConsumer · local-upload Automatic/Manual mode propagation", () => {
  it('mode: "manual" emits local:review-ready with the ingested project\'s fields and does NOT run drivePostIngestStages', async () => {
    startRunMock.mockResolvedValueOnce({
      project: { slug: "manual-run-1", duration_s: 187, source_path: "/Volumes/Drive/manual_clip.mp4" },
    });

    const reviewReady: Array<Record<string, unknown>> = [];
    const offReview = bus.on("local:review-ready", (p: Record<string, unknown>) => reviewReady.push(p));
    const completeEvents: Array<Record<string, unknown>> = [];
    const offComplete = bus.on("engine:complete", (p: Record<string, unknown>) => completeEvents.push(p));

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    await act(async () => {
      bus.emit("source:drop", { paths: ["/Volumes/Drive/manual_clip.mp4"], mode: "manual" });
    });
    await waitForCondition(() => reviewReady.length > 0);

    offReview?.();
    offComplete?.();

    expect(reviewReady.length).toBe(1);
    expect(reviewReady[0]).toEqual({
      slug: "manual-run-1",
      duration_s: 187,
      source_path: "/Volumes/Drive/manual_clip.mp4",
    });
    // The whole point of Manual: nothing past ingest ran automatically.
    expect(runStageMock).not.toHaveBeenCalled();
    expect(completeEvents.find((e) => e.kind === "pick")).toBeUndefined();
  });

  it('mode: "automatic" runs the full existing drivePostIngestStages sequence, unchanged', async () => {
    startRunMock.mockResolvedValueOnce({
      project: { slug: "auto-run-1", duration_s: 60, source_path: "/Users/test/Movies/auto_clip.mp4" },
    });
    runStageMock.mockImplementation((slug: string, stage: string) =>
      Promise.resolve({ project: { slug, stage_last_run: stage, clips: [] } }),
    );

    const reviewReady: Array<Record<string, unknown>> = [];
    const offReview = bus.on("local:review-ready", (p: Record<string, unknown>) => reviewReady.push(p));
    const completeEvents: Array<Record<string, unknown>> = [];
    const offComplete = bus.on("engine:complete", (p: Record<string, unknown>) => completeEvents.push(p));

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Movies/auto_clip.mp4"], mode: "automatic" });
    });
    await waitForCondition(() => completeEvents.some((e) => e.kind === "pick"));

    offReview?.();
    offComplete?.();

    expect(reviewReady.length).toBe(0);
    expect(runStageMock).toHaveBeenCalledTimes(6);
    expect(runStageMock.mock.calls.map((c) => c[1])).toEqual([
      "audio", "transcribe", "llm", "cut", "reframe", "thumbs",
    ]);
  });

  it("backwards compatibility: source:drop with NO mode field behaves exactly like automatic (existing drag/drop callers unchanged)", async () => {
    startRunMock.mockResolvedValueOnce({
      project: { slug: "no-mode-run-1", duration_s: 30, source_path: "/Users/test/Desktop/dropped.mov" },
    });
    runStageMock.mockImplementation((slug: string, stage: string) =>
      Promise.resolve({ project: { slug, stage_last_run: stage, clips: [] } }),
    );

    const reviewReady: Array<Record<string, unknown>> = [];
    const offReview = bus.on("local:review-ready", (p: Record<string, unknown>) => reviewReady.push(p));
    const completeEvents: Array<Record<string, unknown>> = [];
    const offComplete = bus.on("engine:complete", (p: Record<string, unknown>) => completeEvents.push(p));

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    // No `mode` key at all — exactly what DropOverlay.tsx (raw window
    // drag/drop) and UploadPortal.tsx's native picker still emit today.
    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Desktop/dropped.mov"] });
    });
    await waitForCondition(() => completeEvents.some((e) => e.kind === "pick"));

    offReview?.();
    offComplete?.();

    expect(reviewReady.length).toBe(0);
    expect(runStageMock).toHaveBeenCalledTimes(6);
  });
});

/**
 * Local-upload drag/drop mode-propagation follow-up (2026-09-08) —
 * back-to-back cross-mode runs through the ONE local-ingest path, proving
 * a completed run of one mode doesn't leak into or block a fresh run of
 * the other mode. Complements InlineCreatePanel.test.tsx's own
 * "second local:review-ready doesn't leak" coverage on the Manual→Manual
 * side — these two cover Manual→Automatic and Automatic→Manual, which
 * globalDropConsumer (not InlineCreatePanel) is the right place to prove
 * since an automatic run never touches InlineCreatePanel state at all.
 */
describe("GlobalDropConsumer · cross-mode sequencing ('+' / New Video)", () => {
  it("Local Manual finishes, then a NEW Local Automatic run is unaffected and completes normally", async () => {
    runStageMock.mockImplementation((slug: string, stage: string) =>
      Promise.resolve({ project: { slug, stage_last_run: stage, clips: [] } }),
    );

    const reviewReady: Array<Record<string, unknown>> = [];
    const offReview = bus.on("local:review-ready", (p: Record<string, unknown>) => reviewReady.push(p));
    const completeEvents: Array<Record<string, unknown>> = [];
    const offComplete = bus.on("engine:complete", (p: Record<string, unknown>) => completeEvents.push(p));

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    // Run 1 · Manual — pauses at review, never touches runStage.
    startRunMock.mockResolvedValueOnce({
      project: { slug: "seq-manual-1", duration_s: 120, source_path: "/Users/test/Movies/seq1.mp4" },
    });
    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Movies/seq1.mp4"], mode: "manual" });
    });
    await waitForCondition(() => reviewReady.length === 1);
    expect(runStageMock).not.toHaveBeenCalled();

    // "+" → Run 2 · a DIFFERENT local file, Automatic this time.
    startRunMock.mockResolvedValueOnce({
      project: { slug: "seq-auto-2", duration_s: 45, source_path: "/Users/test/Movies/seq2.mp4" },
    });
    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Movies/seq2.mp4"], mode: "automatic" });
    });
    await waitForCondition(() => completeEvents.some((e) => e.kind === "pick" && e.slug === "seq-auto-2"));

    offReview?.();
    offComplete?.();

    // The stale Manual review-ready is still the only one recorded — run 2
    // never emitted a second one, and its own stages ran on ITS slug only.
    expect(reviewReady.length).toBe(1);
    expect(reviewReady[0].slug).toBe("seq-manual-1");
    expect(runStageMock.mock.calls.every((c) => c[0] === "seq-auto-2")).toBe(true);
    expect(runStageMock).toHaveBeenCalledTimes(6);
  });

  it("Local Automatic finishes, then a NEW Local Manual run is unaffected and pauses for review", async () => {
    runStageMock.mockImplementation((slug: string, stage: string) =>
      Promise.resolve({ project: { slug, stage_last_run: stage, clips: [] } }),
    );

    const reviewReady: Array<Record<string, unknown>> = [];
    const offReview = bus.on("local:review-ready", (p: Record<string, unknown>) => reviewReady.push(p));
    const completeEvents: Array<Record<string, unknown>> = [];
    const offComplete = bus.on("engine:complete", (p: Record<string, unknown>) => completeEvents.push(p));

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    // Run 1 · Automatic — runs the full stage sequence to completion.
    startRunMock.mockResolvedValueOnce({
      project: { slug: "seq-auto-1", duration_s: 50, source_path: "/Users/test/Movies/seq3.mp4" },
    });
    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Movies/seq3.mp4"], mode: "automatic" });
    });
    await waitForCondition(() => completeEvents.some((e) => e.kind === "pick" && e.slug === "seq-auto-1"));
    expect(reviewReady.length).toBe(0);

    // "+" → Run 2 · a DIFFERENT local file, Manual this time.
    startRunMock.mockResolvedValueOnce({
      project: { slug: "seq-manual-2", duration_s: 80, source_path: "/Users/test/Movies/seq4.mp4" },
    });
    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Movies/seq4.mp4"], mode: "manual" });
    });
    await waitForCondition(() => reviewReady.length === 1);

    offReview?.();
    offComplete?.();

    expect(reviewReady[0].slug).toBe("seq-manual-2");
    // Run 2 (Manual) must not have run ANY stage — the 6 calls already
    // recorded belong entirely to run 1 (Automatic).
    expect(runStageMock).toHaveBeenCalledTimes(6);
    expect(runStageMock.mock.calls.every((c) => c[0] === "seq-auto-1")).toBe(true);
  });
});

/**
 * Engine stage-reporting fix (2026-09-08) — proves drivePostIngestStages'
 * catch block reports WHICH stage actually failed, not just that
 * something failed. Root bug: an engine:error with no `stage` field left
 * useEngineSession's session.stage frozen on whichever earlier stage last
 * reported real progress (e.g. "transcribe"), even when the failure was
 * actually several stages later (e.g. "llm") — "STALLED AT TRANSCRIBE"
 * for an LLM failure. This is the local-Automatic half of that fix;
 * python-sidecar/sidecar.py's _run_stage carries the other half
 * (announcing every stage's start, not just the ones that already had
 * mid-work progress calls).
 */
describe("GlobalDropConsumer · engine:error carries the failing stage", () => {
  it("a failure on the llm stage (3rd of 6) reports stage:\"llm\", not the earlier audio/transcribe stages that already succeeded", async () => {
    startRunMock.mockResolvedValueOnce({
      project: { slug: "stage-fail-1", duration_s: 40, source_path: "/Users/test/Movies/stagefail.mp4" },
    });
    runStageMock.mockImplementation((slug: string, stage: string) => {
      if (stage === "llm") {
        return Promise.reject(new Error("RuntimeError: LLM returned no clips in the 30-75s window after auto-extend."));
      }
      return Promise.resolve({ project: { slug, stage_last_run: stage, clips: [] } });
    });

    const errorEvents: Array<Record<string, unknown>> = [];
    const offError = bus.on("engine:error", (p: Record<string, unknown>) => {
      if (p.kind === "bake") errorEvents.push(p);
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<GlobalDropConsumer />);
    });

    await act(async () => {
      bus.emit("source:drop", { paths: ["/Users/test/Movies/stagefail.mp4"], mode: "automatic" });
    });
    await waitForCondition(() => errorEvents.length > 0);

    offError?.();

    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].stage).toBe("llm");
    // audio + transcribe ran (succeeded) before llm; cut/reframe/thumbs
    // never ran — proves the loop actually stopped AT llm, matching the
    // reported stage.
    expect(runStageMock.mock.calls.map((c) => c[1])).toEqual(["audio", "transcribe", "llm"]);
  });
});
