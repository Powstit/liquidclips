/**
 * @vitest-environment jsdom
 *
 * Composer Class F client contracts · F3 beat snap + F4 batch apply.
 * (F5 · brand presets has its own dedicated test file.)
 *
 * Iron gates IG-COMPOSER-BB (F3) · CC (F4).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  BEAT_SNAP_WINDOW_S,
  generateBeatsForBpm,
  nearestBeat,
  snapToBeat,
} from "./beatSnap";
import { batchApply } from "./batchApply";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BEAT_SRC = readFileSync(resolve(__dirname, "beatSnap.ts"), "utf-8");
const BATCH_SRC = readFileSync(resolve(__dirname, "batchApply.ts"), "utf-8");

describe("IG-COMPOSER-BB · Beat snap contract (F3)", () => {
  it("beatSnap.ts carries the IG-COMPOSER-BB sentinel", () => {
    expect(BEAT_SRC).toMatch(/IRON GATE IG-COMPOSER-BB/);
  });
  it("BEAT_SNAP_WINDOW_S is locked at 0.35 s", () => {
    expect(BEAT_SNAP_WINDOW_S).toBe(0.35);
  });
  it("generateBeatsForBpm produces evenly spaced beats", () => {
    const beats = generateBeatsForBpm(120, 4); // 2 Hz · beats at 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4
    expect(beats[0]).toBe(0);
    expect(beats[1]).toBeCloseTo(0.5, 2);
    expect(beats[beats.length - 1]).toBeCloseTo(4, 2);
    expect(beats.length).toBe(9);
  });
  it("nearestBeat returns the closest beat within the window", () => {
    const beats = [0, 0.5, 1, 1.5, 2];
    expect(nearestBeat(0.55, beats)).toBe(0.5);
    expect(nearestBeat(1.4, beats)).toBe(1.5);
  });
  it("nearestBeat returns null when the closest beat is outside the window", () => {
    const beats = [0, 3.5];
    expect(nearestBeat(1.7, beats)).toBeNull();
  });
  it("nearestBeat returns null for empty / non-finite input", () => {
    expect(nearestBeat(1, [])).toBeNull();
    expect(nearestBeat(NaN, [0, 1])).toBeNull();
  });
  it("snapToBeat pass-throughs when disabled", () => {
    expect(snapToBeat(0.55, [0, 0.5, 1], false)).toBe(0.55);
  });
  it("snapToBeat pass-throughs when no beat is close enough", () => {
    expect(snapToBeat(2, [0, 5], true)).toBe(2);
  });
  it("snapToBeat locks to nearest beat when enabled + in window", () => {
    expect(snapToBeat(0.6, [0, 0.5, 1], true)).toBe(0.5);
  });
});

describe("IG-COMPOSER-CC · Batch apply contract (F4)", () => {
  it("batchApply.ts carries the IG-COMPOSER-CC sentinel", () => {
    expect(BATCH_SRC).toMatch(/IRON GATE IG-COMPOSER-CC/);
  });
  it("exports batchApply", () => {
    expect(BATCH_SRC).toMatch(/export\s+async\s+function\s+batchApply/);
  });
  it("runs apply sequentially and emits progress per clip", async () => {
    const events: string[] = [];
    const result = await batchApply({
      clips: [{ id: "a" }, { id: "b" }, { id: "c" }],
      clipId: (c) => c.id,
      apply: async (c) => {
        events.push(`applied:${c.id}`);
      },
      onProgress: (p) => events.push(`${p.status}:${p.clipId}:${p.index}`),
    });
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(events.filter((e) => e.startsWith("applied"))).toEqual([
      "applied:a",
      "applied:b",
      "applied:c",
    ]);
  });
  it("records per-clip errors without stopping the batch", async () => {
    const result = await batchApply({
      clips: ["ok1", "boom", "ok2"],
      clipId: (c) => c,
      apply: async (c) => {
        if (c === "boom") throw new Error("kaboom");
      },
    });
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0].clipId).toBe("boom");
    expect(result.errors[0].error).toBe("kaboom");
  });
  it("honours an AbortSignal · returns cancelled: true on abort", async () => {
    const controller = new AbortController();
    const apply = vi.fn(async () => {
      controller.abort();
    });
    const result = await batchApply({
      clips: ["a", "b", "c"],
      clipId: (c) => c,
      apply,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    // First clip runs · abort fires · second clip is not applied.
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
