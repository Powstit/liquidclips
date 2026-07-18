/**
 * IG-COMPOSER-GG regression guard · Native screen capture contract.
 * Covers D1 (screen) · D5 (multi-monitor list) · D2 (system audio path).
 * Tauri fallback path is exercised · real invoke calls need a Tauri
 * runtime so are out of scope for vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  nativeCaptureListTargets,
  nativeCaptureRequestPermission,
  nativeCaptureSupportStatus,
} from "./nativeCapture";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT = readFileSync(resolve(__dirname, "nativeCapture.ts"), "utf-8");
const RUST = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "src-tauri", "src", "screen_capture.rs"),
  "utf-8",
);
const CARGO = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "src-tauri", "Cargo.toml"),
  "utf-8",
);
const LIB_RS = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "src-tauri", "src", "lib.rs"),
  "utf-8",
);

describe("IG-COMPOSER-GG · Native screen capture contract (D1/D2/D5)", () => {
  it("nativeCapture.ts carries the IG-COMPOSER-GG sentinel", () => {
    expect(CLIENT).toMatch(/IRON GATE IG-COMPOSER-GG/);
  });

  it("screen_capture.rs carries the IG-COMPOSER-GG sentinel", () => {
    expect(RUST).toMatch(/IRON GATE IG-COMPOSER-GG/);
  });

  it("Cargo.toml pins scap to 0.1.0-beta.1 (verified via WebFetch 2026-07-18)", () => {
    expect(CARGO).toMatch(/scap\s*=\s*\{\s*version\s*=\s*"0\.1\.0-beta\.1"/);
  });

  it("lib.rs registers the 5 screen_capture Tauri commands", () => {
    expect(LIB_RS).toMatch(/screen_capture::screen_capture_support_status/);
    expect(LIB_RS).toMatch(/screen_capture::screen_capture_request_permission/);
    expect(LIB_RS).toMatch(/screen_capture::screen_capture_list_targets/);
    expect(LIB_RS).toMatch(/screen_capture::screen_capture_start/);
    expect(LIB_RS).toMatch(/screen_capture::screen_capture_stop/);
  });

  it("lib.rs registers the SessionStore as Tauri managed state", () => {
    expect(LIB_RS).toMatch(/\.manage\(screen_capture::SessionStore::default\(\)\)/);
  });

  it("client invokes the 5 Tauri command names verbatim (schema match)", () => {
    expect(CLIENT).toMatch(/"screen_capture_support_status"/);
    expect(CLIENT).toMatch(/"screen_capture_request_permission"/);
    expect(CLIENT).toMatch(/"screen_capture_list_targets"/);
    expect(CLIENT).toMatch(/"screen_capture_start"/);
    expect(CLIENT).toMatch(/"screen_capture_stop"/);
    // The 5 names are also referenced through the `invoke` call. Grep
    // globally for "invoke(" — presence is sufficient because the whole
    // module purpose is Tauri invoke.
    expect(CLIENT.match(/invoke</g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("returns safe fallbacks when Tauri is not available (SSR / plain browser)", async () => {
    const status = await nativeCaptureSupportStatus();
    expect(status).toEqual({ supported: false, hasPermission: false });
    const perm = await nativeCaptureRequestPermission();
    expect(perm).toBe(false);
    const targets = await nativeCaptureListTargets();
    expect(targets).toEqual([]);
  });

  it("uses macOS 13.0+ · matches scap's ScreenCaptureKit floor", () => {
    // tauri.conf.json is checked separately in scripts/lint · this test
    // just asserts the code documents the requirement.
    expect(RUST).toMatch(/macOS 13\.0\+/);
  });
});
