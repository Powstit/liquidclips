/**
 * updater.retry.test.ts · 2026-08-29
 *
 * Proves the applyUpdate() retry fix: a real beta tester's "Download
 * update" looked permanently stuck because downloadAndInstall() is a
 * single unresumable call with no built-in retry. This test simulates
 * exactly that — the first N-1 attempts throw (transient network blip),
 * the final attempt succeeds — and asserts applyUpdate recovers instead
 * of surfacing an error on the first failure.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const relaunchMock = vi.fn(async () => {});
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchMock(),
}));

import { applyUpdate, type UpdateState } from "./updater";
import type { Update } from "@tauri-apps/plugin-updater";

function makeUpdate(behavior: {
  failCount: number;
}): { update: Update; calls: number } {
  let calls = 0;
  const update = {
    version: "2.3.66",
    downloadAndInstall: vi.fn(async (onEvent: (e: unknown) => void) => {
      calls += 1;
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      if (calls <= behavior.failCount) {
        throw new Error("network error: connection reset");
      }
      onEvent({ event: "Progress", data: { chunkLength: 1000 } });
      onEvent({ event: "Finished" });
    }),
  } as unknown as Update;
  return { update, calls: 0 };
}

describe("applyUpdate · retry on transient failure", () => {
  beforeEach(() => {
    relaunchMock.mockClear();
    vi.useFakeTimers();
  });

  it("recovers from a single transient failure instead of erroring out", async () => {
    const { update } = makeUpdate({ failCount: 1 });
    const states: UpdateState[] = [];

    const run = applyUpdate(update, (s) => states.push(s));
    await vi.runAllTimersAsync();
    await run;

    expect(states.some((s) => s.kind === "error")).toBe(false);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    // Second attempt is surfaced distinctly so the UI doesn't look frozen.
    expect(states.some((s) => s.kind === "downloading" && s.attempt === 2)).toBe(true);
  });

  it("surfaces a real error only after exhausting all retry attempts", async () => {
    const { update } = makeUpdate({ failCount: 99 }); // always fails
    const states: UpdateState[] = [];

    const run = applyUpdate(update, (s) => states.push(s));
    await vi.runAllTimersAsync();
    await run;

    const last = states[states.length - 1];
    expect(last.kind).toBe("error");
    expect(relaunchMock).not.toHaveBeenCalled();
    // 4 attempts total per MAX_DOWNLOAD_ATTEMPTS — the 4th is visibly
    // labeled as a retry so the final failure isn't a surprise jump.
    expect(states.some((s) => s.kind === "downloading" && s.attempt === 4)).toBe(true);
  });

  it("succeeds on the very first attempt with no retry noise", async () => {
    const { update } = makeUpdate({ failCount: 0 });
    const states: UpdateState[] = [];

    await applyUpdate(update, (s) => states.push(s));

    expect(states.some((s) => s.kind === "error")).toBe(false);
    expect(states.every((s) => !(s.kind === "downloading" && s.attempt))).toBe(true);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
