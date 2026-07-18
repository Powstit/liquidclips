/**
 * @vitest-environment jsdom
 *
 * Composer Class B client contract tests.
 *
 * Iron gates:
 *   * IG-COMPOSER-DD · sidecar runtime flag surface (sidecar-stub.ts)
 *   * IG-COMPOSER-EE · useSidecarFlag React hook
 *
 * The tests hit the mock-fallback path in setSidecarFlag() so they
 * exercise the shape contract without needing a live sidecar.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setSidecarFlag } from "../sidecar-stub";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STUB = readFileSync(resolve(__dirname, "..", "sidecar-stub.ts"), "utf-8");
const HOOK = readFileSync(resolve(__dirname, "useSidecarFlag.ts"), "utf-8");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IG-COMPOSER-DD · Sidecar runtime flag surface", () => {
  it("sidecar-stub.ts carries the IG-COMPOSER-DD sentinel", () => {
    expect(STUB).toMatch(/IRON GATE IG-COMPOSER-DD/);
  });

  it("exports the SidecarFlagName union with the whitelisted + planned flags", () => {
    expect(STUB).toMatch(/"JUNIOR_ANIMATED_CAPTIONS"/);
    expect(STUB).toMatch(/"JUNIOR_SILENCE_REMOVE"/);
    expect(STUB).toMatch(/"JUNIOR_VOICE_ENHANCE"/);
  });

  it("setSidecarFlag routes through sidecarCall('set_runtime_flag', ...)", () => {
    expect(STUB).toMatch(/sidecarCall<[^>]+>\("set_runtime_flag"/);
  });

  it("mock fallback for boolean=true returns value='1'", async () => {
    const r = await setSidecarFlag("JUNIOR_ANIMATED_CAPTIONS", true);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("JUNIOR_ANIMATED_CAPTIONS");
    expect(r.value).toBe("1");
  });

  it("mock fallback for boolean=false returns value='0'", async () => {
    const r = await setSidecarFlag("JUNIOR_SILENCE_REMOVE", false);
    expect(r.value).toBe("0");
  });

  it("mock fallback for null returns value=null (clears the flag)", async () => {
    const r = await setSidecarFlag("JUNIOR_VOICE_ENHANCE", null);
    expect(r.value).toBeNull();
  });
});

describe("IG-COMPOSER-EE · useSidecarFlag hook", () => {
  it("useSidecarFlag.ts carries the IG-COMPOSER-EE sentinel", () => {
    expect(HOOK).toMatch(/IRON GATE IG-COMPOSER-EE/);
  });

  it("exports the useSidecarFlag hook", () => {
    expect(HOOK).toMatch(/export function useSidecarFlag/);
  });

  it("imports setSidecarFlag + SidecarFlagName from sidecar-stub", () => {
    expect(HOOK).toMatch(/setSidecarFlag/);
    expect(HOOK).toMatch(/SidecarFlagName/);
    expect(HOOK).toMatch(/from\s+"\.\.\/sidecar-stub"/);
  });

  it("declares the { value · pending · error · set · toggle } surface", () => {
    expect(HOOK).toMatch(/value:\s*boolean/);
    expect(HOOK).toMatch(/pending:\s*boolean/);
    expect(HOOK).toMatch(/error:\s*string\s*\|\s*null/);
    expect(HOOK).toMatch(/set:/);
    expect(HOOK).toMatch(/toggle:/);
  });

  it("uses optimistic render (setValue before await)", () => {
    // set() writes the optimistic value + then awaits the RPC.
    expect(HOOK).toMatch(/setValue\(next\);\s*try\s*\{\s*const\s+resp\s*=\s*await\s+setSidecarFlag/);
  });
});
