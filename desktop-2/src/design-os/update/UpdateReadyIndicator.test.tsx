/**
 * UpdateReadyIndicator component tests · Wave D1 · j015-runtime-update.
 *
 * Contract:
 *   - hidden by default
 *   - visible when non-critical staged
 *   - visible when critical + deferred behind a protected journey
 *   - click promotes to gate (state transitions to "gate")
 *   - copy locked from j015; NO "Reload" wording
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: vi.fn(),
}));

import { UpdateReadyIndicator } from "./UpdateReadyIndicator";
import {
  __resetUpdateJourneyForTests,
  transitionToChecking,
  transitionToDownloading,
  transitionToStaged,
  getUpdateJourneySnapshot,
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
    root.render(<UpdateReadyIndicator />);
  });
}

describe("UpdateReadyIndicator · Wave D1", () => {
  it("hidden when journey is in checking state", () => {
    transitionToChecking("2.0.0");
    mount();
    expect(document.querySelector('[data-testid="update-ready-indicator"]')).toBeNull();
  });

  it("visible when non-critical stage lands", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", null);
    transitionToStaged("2.0.0", "2.1.0", null);
    mount();
    const pill = document.querySelector('[data-testid="update-ready-indicator"]');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain("Update ready");
    expect(pill!.textContent).toContain("Restart to continue");
    // NO "Reload" wording.
    expect(/\breload\b/i.test(pill!.textContent ?? "")).toBe(false);
    // data attrs surface the criticality + version pair.
    expect(pill!.getAttribute("data-critical")).toBe("false");
    expect(pill!.getAttribute("data-next")).toBe("2.1.0");
  });

  it("visible with deferred copy when critical is deferred behind a protected journey", () => {
    const release = registerProtectedJourney("j006-clip-generation");
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "money");
    transitionToStaged("2.0.0", "2.1.0", "money");
    mount();
    const pill = document.querySelector('[data-testid="update-ready-indicator"]');
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("data-deferred")).toBe("true");
    expect(pill!.getAttribute("data-deferred-by")).toBe("j006-clip-generation");
    expect(pill!.textContent).toContain("Waiting for clipping run");
    release();
  });

  it("click on non-critical promotes to gate state", () => {
    transitionToChecking("2.0.0");
    transitionToDownloading("2.0.0", "2.1.0", "copy");
    transitionToStaged("2.0.0", "2.1.0", "copy");
    mount();
    const btn = document.querySelector('[data-testid="update-ready-indicator-btn"]');
    expect(btn).not.toBeNull();
    act(() => {
      (btn as HTMLButtonElement).click();
    });
    expect(getUpdateJourneySnapshot().state).toBe("gate");
  });
});
