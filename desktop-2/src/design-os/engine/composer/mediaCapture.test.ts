/**
 * @vitest-environment jsdom
 *
 * IG-COMPOSER-FF regression guard · Composer Class D · media capture.
 * Covers D3 camera · D2 mic · D4 countdown · all via getUserMedia +
 * MediaRecorder (client-side, no Rust).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isMediaCaptureAvailable,
  pickMimeType,
  startCountdown,
} from "./mediaCapture";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "mediaCapture.ts"), "utf-8");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IG-COMPOSER-FF · Media capture contract (D2 mic · D3 camera · D4 countdown)", () => {
  it("mediaCapture.ts carries the IG-COMPOSER-FF sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-FF/);
  });

  it("routes through navigator.mediaDevices.getUserMedia (WKWebView-compatible)", () => {
    expect(SRC).toMatch(/navigator\.mediaDevices\.getUserMedia/);
  });

  it("does NOT reference getDisplayMedia (broken on Tauri WKWebView per issue #2338)", () => {
    expect(SRC).not.toMatch(/getDisplayMedia/);
  });

  it("isMediaCaptureAvailable is false in a jsdom env without MediaRecorder", () => {
    // jsdom does not implement MediaRecorder · this is the correct answer.
    expect(isMediaCaptureAvailable()).toBe(false);
  });

  it("pickMimeType returns the preferred string when MediaRecorder is unavailable", () => {
    // jsdom · no MediaRecorder, no isTypeSupported. Fall back to preferred.
    expect(pickMimeType("video/webm;codecs=vp9,opus")).toBe("video/webm;codecs=vp9,opus");
  });

  it("startCountdown emits ticks then resolves", async () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const controller = startCountdown(3, (n) => ticks.push(n));
    // Countdown fires tick immediately, then every 1000ms.
    await vi.advanceTimersByTimeAsync(3000);
    await controller.done;
    expect(ticks).toEqual([3, 2, 1]);
    vi.useRealTimers();
  });

  it("startCountdown cancel rejects the done promise", async () => {
    vi.useFakeTimers();
    const controller = startCountdown(5, () => {});
    controller.cancel();
    await expect(controller.done).rejects.toThrow(/cancelled/);
    vi.useRealTimers();
  });

  it("exports the D-family surface (startMediaCapture · startCountdown)", () => {
    expect(SRC).toMatch(/export async function startMediaCapture/);
    expect(SRC).toMatch(/export function startCountdown/);
  });
});
