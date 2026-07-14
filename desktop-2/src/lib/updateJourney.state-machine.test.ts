/**
 * updateJourney state-machine test suite · Wave D1 · j015-runtime-update.
 *
 * Covers the 12 acceptance test IDs listed in the journey file:
 *
 *   1. checking-to-downloading
 *   2. downloading-to-staged
 *   3. staged-to-gate-non-critical
 *   4. staged-to-gate-critical-mounts-immediately
 *   5. gate-defers-during-protected-journey
 *   6. gate-mounts-after-protected-journey-completes
 *   7. restart-persists-restore-state
 *   8. boot-restores-jwt-identity-route-draft
 *   9. boot-mismatch-triggers-failed-state
 *   10. failed-preserves-known-good-runtime
 *   + telemetry-topic-parity (asserts all 8 topics fire)
 *   + never-emits-reload-string
 *
 * Uses vitest + jsdom · no React harness · module-scope state + a
 * spied `lcDiag` mock so we can assert every topic + payload.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the diagnostic logger BEFORE importing the module so the
// registry subscription installed at import time captures the mock.
const diagCalls: Array<{ topic: string; data: Record<string, unknown> }> = [];
vi.mock("./diagnosticLogger", () => ({
  lcDiag: vi.fn((topic: string, data: Record<string, unknown> = {}) => {
    diagCalls.push({ topic, data });
  }),
}));

import {
  transitionToChecking,
  transitionToDownloading,
  transitionToStaged,
  tryMountGate,
  transitionToRestarting,
  verifyBootAndRestore,
  markFailed,
  getUpdateJourneySnapshot,
  __resetUpdateJourneyForTests,
  isCritical,
} from "./updateJourney";
import {
  registerProtectedJourney,
  __resetProtectedJourneyForTests,
} from "./protectedJourney";
import {
  RESTORE_STORAGE_KEY,
  JWT_STORAGE_KEY,
  writeRestore,
  clearRestore,
  type RestoreSnapshot,
} from "./bootRestore";

function topicsSeen(): string[] {
  return diagCalls.map((c) => c.topic);
}

function lastCallFor(topic: string) {
  for (let i = diagCalls.length - 1; i >= 0; i--) {
    if (diagCalls[i].topic === topic) return diagCalls[i];
  }
  return null;
}

beforeEach(() => {
  diagCalls.length = 0;
  __resetUpdateJourneyForTests();
  __resetProtectedJourneyForTests();
  try { window.localStorage.clear(); } catch { /* noop */ }
});

describe("j015 · state machine · 12 acceptance IDs", () => {
  it("checking-to-downloading · manifest report fires update_detected + update_download_started", () => {
    transitionToChecking("2.0.0");
    expect(getUpdateJourneySnapshot().state).toBe("checking");
    transitionToDownloading("2.0.0", "2.1.0", null, 12345);
    const snap = getUpdateJourneySnapshot();
    expect(snap.state).toBe("downloading");
    expect(snap.current).toBe("2.0.0");
    expect(snap.next).toBe("2.1.0");
    expect(topicsSeen()).toEqual(
      expect.arrayContaining(["update_detected", "update_download_started"]),
    );
    const dl = lastCallFor("update_download_started")!;
    expect(dl.data.size_bytes).toBe(12345);
  });

  it("downloading-to-staged · bundle written fires update_staged (non-critical) and does NOT auto-mount gate", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", null);
    transitionToStaged("2.0.0", "2.1.0", null);
    const snap = getUpdateJourneySnapshot();
    expect(snap.state).toBe("staged");
    const st = lastCallFor("update_staged")!;
    expect(typeof st.data.staged_at_ts_ms).toBe("number");
    // Non-critical does NOT auto-mount the gate — waits for user click.
    expect(topicsSeen()).not.toContain("update_gate_shown");
  });

  it("staged-to-gate-non-critical · user click promotes soft indicator to gate", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", null);
    transitionToStaged("2.0.0", "2.1.0", null);
    // User clicks the soft indicator → tryMountGate promotes to gate.
    tryMountGate();
    expect(getUpdateJourneySnapshot().state).toBe("gate");
    const gate = lastCallFor("update_gate_shown")!;
    expect(gate.data.criticality).toBe(null);
    expect(gate.data.deferred_by_protected_journey).toBeUndefined();
  });

  it("staged-to-gate-critical-mounts-immediately · critical stage auto-mounts gate", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "auth");
    transitionToStaged("2.0.0", "2.1.0", "auth");
    // Critical criticality auto-promotes to gate without any user
    // interaction — mandatory.
    expect(getUpdateJourneySnapshot().state).toBe("gate");
    const gate = lastCallFor("update_gate_shown")!;
    expect(gate.data.criticality).toBe("auth");
  });

  it("gate-defers-during-protected-journey · j005-upload active blocks gate mount", () => {
    // A protected journey is active BEFORE the update reaches staged.
    const release = registerProtectedJourney("j005-upload");
    try {
      transitionToChecking("2.0.0");
      transitionToDownloading("2.0.0", "2.1.0", "auth");
      transitionToStaged("2.0.0", "2.1.0", "auth");
      const snap = getUpdateJourneySnapshot();
      // Gate deferred — stays in staged state, deferred flag set.
      expect(snap.state).toBe("staged");
      expect(snap.gate_deferred).toBe(true);
      expect(snap.gate_deferred_by).toBe("j005-upload");
      const gate = lastCallFor("update_gate_shown")!;
      expect(gate.data.deferred_by_protected_journey).toBe("j005-upload");
    } finally {
      release();
    }
  });

  it("gate-mounts-after-protected-journey-completes · release triggers gate promotion", () => {
    const release = registerProtectedJourney("j006-clip-generation");
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "money");
    transitionToStaged("2.0.0", "2.1.0", "money");
    expect(getUpdateJourneySnapshot().gate_deferred).toBe(true);
    // Release the protected journey. Subscription in updateJourney
    // fires `tryMountGate` again which now sees no active protected
    // and promotes to gate.
    release();
    expect(getUpdateJourneySnapshot().state).toBe("gate");
    // Two update_gate_shown events: one deferred, one mounted.
    const gateCalls = diagCalls.filter((c) => c.topic === "update_gate_shown");
    expect(gateCalls.length).toBeGreaterThanOrEqual(2);
    // The second call must NOT carry a deferred_by tag.
    const mountedCall = gateCalls[gateCalls.length - 1];
    expect(mountedCall.data.deferred_by_protected_journey).toBeUndefined();
  });

  it("restart-persists-restore-state · click writes lc.restore.v1", async () => {
    // Seed a JWT so the restore snapshot carries it forward.
    window.localStorage.setItem(JWT_STORAGE_KEY, "fake.jwt.token");
    // Fake a hash route.
    window.location.hash = "#/wallet";
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "money");
    transitionToStaged("2.0.0", "2.1.0", "money");
    expect(getUpdateJourneySnapshot().state).toBe("gate");
    let relaunched = false;
    await transitionToRestarting({
      draft_state: { caption: "half typed" },
      relaunchFn: async () => { relaunched = true; },
      now: 1_700_000_000_000,
    });
    expect(relaunched).toBe(true);
    const raw = window.localStorage.getItem(RESTORE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as RestoreSnapshot;
    expect(parsed.jwt).toBe("fake.jwt.token");
    expect(parsed.last_safe_route).toBe("#/wallet");
    expect(parsed.draft_state).toEqual({ caption: "half typed" });
    expect(parsed.current_version).toBe("2.0.0");
    expect(parsed.staged_version).toBe("2.1.0");
    expect(parsed.ts_ms).toBe(1_700_000_000_000);
    const click = lastCallFor("update_restart_clicked")!;
    expect(click.data.current).toBe("2.0.0");
    expect(click.data.next).toBe("2.1.0");
  });

  it("boot-restores-jwt-identity-route-draft · matching booted_version restores state + clears key", () => {
    // Simulate a pre-restart write followed by a boot on the new bundle.
    // Clear location first so route restoration writes without a stale
    // hash blocking the assignment.
    window.location.hash = "";
    const snap: RestoreSnapshot = {
      jwt: "boot-jwt",
      identity: { handle: "danielx" },
      last_safe_route: "#/campaigns",
      draft_state: { some: "draft" },
      ts_ms: Date.now(),
      current_version: "2.0.0",
      staged_version: "2.1.0",
    };
    writeRestore(snap);
    verifyBootAndRestore({ bootedVersion: "2.1.0" });
    const state = getUpdateJourneySnapshot();
    expect(state.state).toBe("restored");
    expect(state.current).toBe("2.1.0");
    // Key cleared.
    expect(window.localStorage.getItem(RESTORE_STORAGE_KEY)).toBeNull();
    // Telemetry.
    const verified = lastCallFor("update_boot_verified")!;
    expect(verified.data.matches).toBe(true);
    expect(verified.data.booted_version).toBe("2.1.0");
    expect(verified.data.staged_version).toBe("2.1.0");
    const routeRestored = lastCallFor("route_restored_after_update")!;
    expect(routeRestored.data.last_safe_route).toBe("#/campaigns");
    expect(routeRestored.data.restored).toBe(true);
  });

  it("boot-mismatch-triggers-failed-state · booted != staged flips to failed", () => {
    const snap: RestoreSnapshot = {
      jwt: null,
      identity: null,
      last_safe_route: null,
      draft_state: null,
      ts_ms: Date.now(),
      current_version: "2.0.0",
      staged_version: "2.1.0",
    };
    writeRestore(snap);
    verifyBootAndRestore({ bootedVersion: "2.0.0" }); // Did NOT boot into staged.
    const state = getUpdateJourneySnapshot();
    expect(state.state).toBe("failed");
    expect(state.failed_stage).toBe("boot");
    const verified = lastCallFor("update_boot_verified")!;
    expect(verified.data.matches).toBe(false);
    const failed = lastCallFor("update_failed")!;
    expect(failed.data.stage).toBe("boot");
  });

  it("failed-preserves-known-good-runtime · markFailed keeps current version", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", null);
    markFailed("download", "manifest 500");
    const state = getUpdateJourneySnapshot();
    expect(state.state).toBe("failed");
    // We stay pointed at the KNOWN GOOD current version.
    expect(state.current).toBe("2.0.0");
    // Next stays populated so a retry UI can show what was attempted.
    expect(state.next).toBe("2.1.0");
    const failed = lastCallFor("update_failed")!;
    expect(failed.data.stage).toBe("download");
    expect(failed.data.reason).toBe("manifest 500");
  });

  it("telemetry-topic-parity · all 8 j015 topics fire across the happy path", async () => {
    // Walk the entire journey end-to-end and assert every locked topic
    // lands on the diag stream.
    window.location.hash = "";
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "auth", 500);
    transitionToStaged("2.0.0", "2.1.0", "auth");
    // Critical auto-mounts gate → update_gate_shown already fired.
    await transitionToRestarting({
      relaunchFn: async () => { /* noop */ },
      draft_state: null,
    });
    // Simulate the app boot on the new bundle.
    verifyBootAndRestore({ bootedVersion: "2.1.0" });
    // Also fire a failure to cover update_failed on the same tick.
    markFailed("download", "test-only synthetic failure");
    const seen = new Set(topicsSeen());
    for (const required of [
      "update_detected",
      "update_download_started",
      "update_staged",
      "update_gate_shown",
      "update_restart_clicked",
      "update_boot_verified",
      "update_failed",
      "route_restored_after_update",
    ]) {
      expect(seen.has(required)).toBe(true);
    }
  });

  it("isCritical · classifies auth/money/data-integrity/clipping/compatibility as critical", () => {
    expect(isCritical("auth")).toBe(true);
    expect(isCritical("money")).toBe(true);
    expect(isCritical("data-integrity")).toBe(true);
    expect(isCritical("clipping")).toBe(true);
    expect(isCritical("compatibility")).toBe(true);
    expect(isCritical(null)).toBe(false);
    expect(isCritical("cosmetic")).toBe(false);
    expect(isCritical("perf")).toBe(false);
    expect(isCritical("copy")).toBe(false);
  });
});

describe("j015 · never-emits-reload · Daniel proof requirement 10", () => {
  it("no `Reload` string escapes the state machine module", async () => {
    // Read the source of updateJourney.ts + the two design-os update
    // components. `Reload` must not appear as a user-facing string in
    // any of them. The UpdateBeacon test file also owns the same
    // guard against its own file.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const files = [
      "src/lib/updateJourney.ts",
      "src/design-os/update/UpdateReadyIndicator.tsx",
      "src/design-os/update/RestartGate.tsx",
    ];
    for (const rel of files) {
      const abs = path.join(process.cwd(), rel);
      const content = fs.readFileSync(abs, "utf-8");
      // Reload as a copy-string · match with word boundaries to
      // permit "reloading" / "Reload" case-insensitively as a user
      // visible substring. Case-insensitive to catch "reload".
      expect(
        /\breload\b/i.test(content),
        `${rel} contains a "Reload" substring · Daniel's proof requirement 10 locks this out`,
      ).toBe(false);
    }
  });
});

describe("j015 · storage safety", () => {
  it("restore key round-trips · malformed data returns null · clear removes", async () => {
    const s: RestoreSnapshot = {
      jwt: "j",
      identity: null,
      last_safe_route: "#/",
      draft_state: null,
      ts_ms: 123,
      current_version: "a",
      staged_version: "b",
    };
    writeRestore(s);
    expect(window.localStorage.getItem(RESTORE_STORAGE_KEY)).not.toBeNull();
    clearRestore();
    expect(window.localStorage.getItem(RESTORE_STORAGE_KEY)).toBeNull();
    // Malformed → null.
    window.localStorage.setItem(RESTORE_STORAGE_KEY, "not json");
    const mod = await import("./bootRestore");
    expect(mod.readRestore()).toBeNull();
  });
});
