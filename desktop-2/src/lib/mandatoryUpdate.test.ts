/**
 * mandatoryUpdate · 2026-07-14 · unit coverage
 *
 * Locks Daniel's Path-B rules:
 *   - Deterministic semver comparison (numeric segments + pre-release tag)
 *   - Malformed input never triggers a false mandatory gate
 *   - Manifest field absent → policy has null minimum
 *   - Manifest field present but active >= min → NOT mandatory
 *   - Active < minimum → mandatory
 *   - Offline + cached mandatory policy → still mandatory
 *   - Offline + no cache → unknown (do not brick, allow with warning)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  cmpVersion,
  isMandatory,
  fetchUpdatePolicy,
  readCachedPolicy,
  writeCachedPolicy,
  resolveMandatoryStatus,
  CACHED_POLICY_KEY,
} from "./mandatoryUpdate";

beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch { /* jsdom-less env */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cmpVersion · deterministic semver", () => {
  it("orders equal versions to 0", () => {
    expect(cmpVersion("2.2.36", "2.2.36")).toBe(0);
  });

  it("orders patch increment", () => {
    expect(cmpVersion("2.2.36", "2.2.37")).toBe(-1);
    expect(cmpVersion("2.2.37", "2.2.36")).toBe(1);
  });

  it("orders minor increment", () => {
    expect(cmpVersion("2.2.99", "2.3.0")).toBe(-1);
  });

  it("orders major increment", () => {
    expect(cmpVersion("2.99.99", "3.0.0")).toBe(-1);
  });

  it("treats no-tag as > tagged (SemVer 2.0.0)", () => {
    expect(cmpVersion("2.2.36", "2.2.36-control-tower-1")).toBe(1);
    expect(cmpVersion("2.2.36-a", "2.2.36")).toBe(-1);
  });

  it("orders tag lexically within same numeric prefix", () => {
    expect(cmpVersion("2.2.36-a", "2.2.36-b")).toBe(-1);
    expect(cmpVersion("2.2.36-b", "2.2.36-a")).toBe(1);
  });

  it("numeric prefix wins over tag order", () => {
    // Even though `-z` > `-a` lexically, the higher patch wins.
    expect(cmpVersion("2.2.36-z", "2.2.37-a")).toBe(-1);
  });

  it("numeric tag segments compared as numbers, not strings", () => {
    expect(cmpVersion("2.2.36-9", "2.2.36-10")).toBe(-1);
    expect(cmpVersion("2.2.36-canary.9", "2.2.36-canary.10")).toBe(-1);
  });

  it("SemVer rule · numeric tag segment ranks lower than string", () => {
    expect(cmpVersion("2.2.36-1", "2.2.36-alpha")).toBe(-1);
  });

  it("shorter tag ranks lower than longer prefixed tag", () => {
    expect(cmpVersion("2.2.36-alpha", "2.2.36-alpha.1")).toBe(-1);
  });

  it("ignores +build metadata", () => {
    expect(cmpVersion("2.2.36+abc", "2.2.36+xyz")).toBe(0);
    expect(cmpVersion("2.2.36-a+abc", "2.2.36-a+xyz")).toBe(0);
  });

  it("returns null on malformed input", () => {
    expect(cmpVersion("2.2", "2.2.36")).toBeNull();
    expect(cmpVersion("2.2.36.4", "2.2.36")).toBeNull();
    expect(cmpVersion("v2.2.36", "2.2.36")).toBeNull();
    expect(cmpVersion("", "2.2.36")).toBeNull();
    expect(cmpVersion("abc", "2.2.36")).toBeNull();
  });
});

describe("isMandatory · gate decision predicate", () => {
  it("true when active < minimum", () => {
    expect(isMandatory("2.2.36", "2.2.37")).toBe(true);
  });

  it("false when active === minimum", () => {
    expect(isMandatory("2.2.36", "2.2.36")).toBe(false);
  });

  it("false when active > minimum", () => {
    expect(isMandatory("2.2.37", "2.2.36")).toBe(false);
  });

  it("false when either input missing (never trigger on ambiguous data)", () => {
    expect(isMandatory(null, "2.2.36")).toBe(false);
    expect(isMandatory("2.2.36", null)).toBe(false);
    expect(isMandatory(undefined, undefined)).toBe(false);
    expect(isMandatory("", "2.2.36")).toBe(false);
  });

  it("false when either input malformed (never trigger on ambiguous data)", () => {
    expect(isMandatory("garbage", "2.2.36")).toBe(false);
    expect(isMandatory("2.2.36", "garbage")).toBe(false);
  });

  it("respects pre-release tag ordering (Stage 1 → Stage 2)", () => {
    // Stage 1 published as `2.2.37-stage1`, Stage 2 published as `2.2.38`
    // with `minimum_supported_version=2.2.38`. An app on `2.2.37-stage1`
    // is below the mandatory floor.
    expect(isMandatory("2.2.37-stage1", "2.2.38")).toBe(true);
    // And an app on `2.2.38` is exactly at the floor · not mandatory.
    expect(isMandatory("2.2.38", "2.2.38")).toBe(false);
  });
});

describe("fetchUpdatePolicy · manifest fetch", () => {
  it("returns null on network error (fetch rejects)", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network"));
    const p = await fetchUpdatePolicy("http://x", "stable", "2.2.36");
    expect(p).toBeNull();
  });

  it("returns null on non-OK response other than 204", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 });
    const p = await fetchUpdatePolicy("http://x", "stable", "2.2.36");
    expect(p).toBeNull();
  });

  it("204 → policy with null minimum (client is on latest)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 204 });
    const p = await fetchUpdatePolicy("http://x", "stable", "2.2.36");
    expect(p).not.toBeNull();
    expect(p!.minimum_supported_version).toBeNull();
    expect(p!.latest_version).toBe("2.2.36");
  });

  it("200 · manifest without minimum_supported_version → policy field is null", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        version: "2.2.37",
        channel: "stable",
        sha256: "x",
        signature: "y",
        url: "http://x/download",
      }),
    });
    const p = await fetchUpdatePolicy("http://x", "stable", "2.2.36");
    expect(p!.minimum_supported_version).toBeNull();
    expect(p!.latest_version).toBe("2.2.37");
  });

  it("200 · manifest WITH minimum_supported_version → policy carries it", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        version: "2.2.38",
        channel: "stable",
        sha256: "x",
        signature: "y",
        url: "http://x/download",
        minimum_supported_version: "2.2.38",
      }),
    });
    const p = await fetchUpdatePolicy("http://x", "stable", "2.2.37");
    expect(p!.minimum_supported_version).toBe("2.2.38");
  });
});

describe("cached policy · offline enforcement", () => {
  it("round-trips through localStorage", () => {
    const policy = {
      active: "2.2.37",
      channel: "stable",
      latest_version: "2.2.38",
      minimum_supported_version: "2.2.38",
      fetched_at: 1_784_000_000_000,
    };
    writeCachedPolicy(policy);
    expect(readCachedPolicy()).toEqual(policy);
  });

  it("rejects malformed cached JSON", () => {
    globalThis.localStorage?.setItem(CACHED_POLICY_KEY, "{not valid json");
    expect(readCachedPolicy()).toBeNull();
  });

  it("rejects cached rows missing required fields", () => {
    globalThis.localStorage?.setItem(
      CACHED_POLICY_KEY,
      JSON.stringify({ active: "2.2.37" }),
    );
    expect(readCachedPolicy()).toBeNull();
  });
});

describe("resolveMandatoryStatus · integration", () => {
  it("live · active < min → mandatory (fresh policy cached)", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        version: "2.2.38",
        channel: "stable",
        sha256: "x",
        signature: "y",
        url: "http://x/download",
        minimum_supported_version: "2.2.38",
      }),
    });
    const s = await resolveMandatoryStatus("http://x", "stable", "2.2.37-stage1");
    expect(s.kind).toBe("mandatory");
    // Cached policy is now written for offline fallback.
    const cached = readCachedPolicy();
    expect(cached?.minimum_supported_version).toBe("2.2.38");
  });

  it("live · active === min → ok", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        version: "2.2.38",
        channel: "stable",
        sha256: "x",
        signature: "y",
        url: "http://x/download",
        minimum_supported_version: "2.2.38",
      }),
    });
    const s = await resolveMandatoryStatus("http://x", "stable", "2.2.38");
    expect(s.kind).toBe("ok");
  });

  it("offline + cached mandatory → still mandatory (Rule 1)", async () => {
    writeCachedPolicy({
      active: "2.2.37",
      channel: "stable",
      latest_version: "2.2.38",
      minimum_supported_version: "2.2.38",
      fetched_at: Date.now() - 1_000,
    });
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network"));
    const s = await resolveMandatoryStatus("http://x", "stable", "2.2.37");
    expect(s.kind).toBe("mandatory_cached");
  });

  it("offline + no cache → unknown (Rule 2 · do not brick)", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network"));
    const s = await resolveMandatoryStatus("http://x", "stable", "2.2.37");
    expect(s.kind).toBe("unknown");
    if (s.kind === "unknown") expect(s.reason).toBe("offline_no_cache");
  });
});
