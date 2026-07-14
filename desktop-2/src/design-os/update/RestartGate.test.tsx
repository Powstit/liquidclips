/**
 * RestartGate component tests · Wave D1 · j015-runtime-update.
 *
 * Contract:
 *   - renders locked copy ("Restart to continue", "Restart now", NO "Reload")
 *   - only mounts when state === "gate"
 *   - defers (does not mount) when a protected journey is active — the
 *     journey state stays "staged" with gate_deferred=true so the
 *     UpdateReadyIndicator surfaces instead
 *   - version pair renders when current + next are known
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: vi.fn(),
}));

import { RestartGate } from "./RestartGate";
import {
  __resetUpdateJourneyForTests,
  transitionToChecking,
  transitionToDownloading,
  transitionToStaged,
  tryMountGate,
} from "../../lib/updateJourney";
import {
  __resetProtectedJourneyForTests,
  registerProtectedJourney,
} from "../../lib/protectedJourney";

let container: HTMLDivElement;
let roots: Root[] = [];

beforeEach(() => {
  __resetUpdateJourneyForTests();
  __resetProtectedJourneyForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  roots = [];
});

afterEach(() => {
  act(() => {
    roots.forEach((r) => r.unmount());
  });
  roots = [];
  container.remove();
});

function mount(): void {
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<RestartGate />);
  });
}

describe("RestartGate · Wave D1", () => {
  it("does not mount when journey state is checking", () => {
    transitionToChecking("2.0.0");
    mount();
    expect(document.querySelector('[data-testid="restart-gate"]')).toBeNull();
  });

  it("does not mount when non-critical stage waits for user click", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", null);
    transitionToStaged("2.0.0", "2.1.0", null);
    mount();
    // Non-critical staged does NOT auto-mount the gate.
    expect(document.querySelector('[data-testid="restart-gate"]')).toBeNull();
  });

  it("mounts with locked copy when critical staged auto-promotes", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "auth");
    transitionToStaged("2.0.0", "2.1.0", "auth");
    mount();
    const gate = document.querySelector('[data-testid="restart-gate"]');
    expect(gate).not.toBeNull();
    // Locked copy from j015.
    expect(gate!.textContent).toContain("Restart to continue");
    expect(gate!.textContent).toContain("Restart now");
    // Version pair.
    const versions = document.querySelector('[data-testid="restart-gate-versions"]');
    expect(versions).not.toBeNull();
    expect(versions!.textContent).toContain("2.0.0");
    expect(versions!.textContent).toContain("2.1.0");
    // NO "Reload" wording · Daniel proof requirement 10.
    expect(/\breload\b/i.test(gate!.textContent ?? "")).toBe(false);
  });

  it("defers when a protected journey is active", () => {
    const release = registerProtectedJourney("j005-upload");
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "auth");
    transitionToStaged("2.0.0", "2.1.0", "auth");
    mount();
    // Gate deferred → not mounted.
    expect(document.querySelector('[data-testid="restart-gate"]')).toBeNull();
    release();
  });

  it("mounts after protected journey completes", () => {
    const release = registerProtectedJourney("j005-upload");
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "auth");
    transitionToStaged("2.0.0", "2.1.0", "auth");
    mount();
    expect(document.querySelector('[data-testid="restart-gate"]')).toBeNull();
    // Release · triggers registry subscription → tryMountGate promotes.
    act(() => {
      release();
    });
    expect(document.querySelector('[data-testid="restart-gate"]')).not.toBeNull();
  });

  it("cta is a real button with data-testid restart-gate-cta", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "money");
    transitionToStaged("2.0.0", "2.1.0", "money");
    // Manually promote to gate (money is critical so it already
    // auto-promotes; assert we still see the CTA).
    tryMountGate();
    mount();
    const cta = document.querySelector('[data-testid="restart-gate-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe("BUTTON");
    expect(cta!.textContent).toContain("Restart now");
  });
});
