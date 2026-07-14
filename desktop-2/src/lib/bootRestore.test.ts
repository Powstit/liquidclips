/**
 * bootRestore tests · Wave D1 · j015-runtime-update.
 *
 * Contract:
 *   - write/read/clear round-trip
 *   - verifyBoot returns the right verdict per (booted, staged) pair
 *   - stale snapshots (>10min old) are recognized as stale
 *   - restoreLastSafeRoute is a no-op when the current hash is non-empty
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  RESTORE_STORAGE_KEY,
  writeRestore,
  readRestore,
  clearRestore,
  verifyBoot,
  restoreLastSafeRoute,
  currentJwt,
  currentSafeRoute,
  isStale,
  JWT_STORAGE_KEY,
  type RestoreSnapshot,
} from "./bootRestore";

function snap(overrides: Partial<RestoreSnapshot> = {}): RestoreSnapshot {
  return {
    jwt: "jwt-abc",
    identity: { handle: "danielx", lcId: "LC-1" },
    last_safe_route: "#/wallet",
    draft_state: { caption: "half-typed" },
    ts_ms: Date.now(),
    current_version: "2.0.0",
    staged_version: "2.1.0",
    ...overrides,
  };
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* noop */ }
  try { window.location.hash = ""; } catch { /* noop */ }
});

describe("bootRestore · round-trip", () => {
  it("write + read returns the same snapshot", () => {
    const s = snap();
    expect(writeRestore(s)).toBe(true);
    expect(window.localStorage.getItem(RESTORE_STORAGE_KEY)).not.toBeNull();
    const readback = readRestore();
    expect(readback).not.toBeNull();
    expect(readback!.jwt).toBe(s.jwt);
    expect(readback!.staged_version).toBe(s.staged_version);
    expect(readback!.last_safe_route).toBe("#/wallet");
    expect(readback!.draft_state).toEqual({ caption: "half-typed" });
  });

  it("clear removes the key", () => {
    writeRestore(snap());
    clearRestore();
    expect(window.localStorage.getItem(RESTORE_STORAGE_KEY)).toBeNull();
  });

  it("readRestore returns null when key absent", () => {
    expect(readRestore()).toBeNull();
  });

  it("readRestore returns null on malformed JSON", () => {
    window.localStorage.setItem(RESTORE_STORAGE_KEY, "{not valid");
    expect(readRestore()).toBeNull();
  });

  it("readRestore returns null on shape drift (missing staged_version)", () => {
    window.localStorage.setItem(
      RESTORE_STORAGE_KEY,
      JSON.stringify({ jwt: "j", ts_ms: 1 }),
    );
    expect(readRestore()).toBeNull();
  });
});

describe("bootRestore · verifyBoot verdicts", () => {
  it("no-snapshot when snapshot argument is null", () => {
    expect(verifyBoot("2.1.0", null)).toBe("no-snapshot");
  });

  it("matched when bootedVersion == staged_version", () => {
    expect(verifyBoot("2.1.0", snap())).toBe("matched");
  });

  it("mismatched when bootedVersion != staged_version", () => {
    expect(verifyBoot("2.0.9", snap())).toBe("mismatched");
  });

  it("stale when ts_ms is > 10 min ago", () => {
    const old = snap({ ts_ms: Date.now() - 11 * 60 * 1000 });
    expect(verifyBoot("2.1.0", old)).toBe("stale");
  });

  it("isStale threshold is 10 minutes", () => {
    expect(isStale(snap({ ts_ms: Date.now() - 9 * 60 * 1000 }))).toBe(false);
    expect(isStale(snap({ ts_ms: Date.now() - 11 * 60 * 1000 }))).toBe(true);
  });
});

describe("bootRestore · route restoration", () => {
  it("writes hash when current is empty", () => {
    window.location.hash = "";
    const restored = restoreLastSafeRoute(snap({ last_safe_route: "#/campaigns" }));
    expect(restored).toBe(true);
    expect(window.location.hash).toBe("#/campaigns");
  });

  it("does not overwrite an already-populated hash", () => {
    window.location.hash = "#/settings";
    const restored = restoreLastSafeRoute(snap({ last_safe_route: "#/campaigns" }));
    expect(restored).toBe(false);
    expect(window.location.hash).toBe("#/settings");
  });

  it("no-op when last_safe_route is null", () => {
    window.location.hash = "";
    const restored = restoreLastSafeRoute(snap({ last_safe_route: null }));
    expect(restored).toBe(false);
  });
});

describe("bootRestore · helpers", () => {
  it("currentJwt reads the license storage key", () => {
    window.localStorage.setItem(JWT_STORAGE_KEY, "token-xyz");
    expect(currentJwt()).toBe("token-xyz");
  });

  it("currentSafeRoute reads location.hash", () => {
    window.location.hash = "#/library";
    expect(currentSafeRoute()).toBe("#/library");
  });
});
