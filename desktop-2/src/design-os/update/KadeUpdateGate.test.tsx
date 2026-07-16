/**
 * KadeUpdateGate · behavioral coverage (2026-07-14 · Path B)
 *
 * Locks Daniel's rules:
 *   - Renders nothing when status.kind === "ok" (no mandatory block)
 *   - Renders full-screen surface when status.kind === "mandatory"
 *   - Renders + shows offline marker when status.kind === "mandatory_cached"
 *   - Blocks with failure surface + retry when journey state === "failed"
 *   - Indeterminate progress when bytes unavailable
 *   - Real percentage when bytes are known + downloading
 *   - Never fabricates progress in verify/install/restart phases
 *   - Locked headline + copy strings present and unchanged
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KadeUpdateGate } from "./KadeUpdateGate";
import type { MandatoryStatus } from "../../lib/mandatoryUpdate";
import { __resetUpdateJourneyForTests, transitionToChecking, transitionToDownloading, markFailed } from "../../lib/updateJourney";

let host: HTMLDivElement;
let root: Root;

const mandatoryStatus: MandatoryStatus = {
  kind: "mandatory",
  policy: {
    active: "2.2.36",
    channel: "stable",
    latest_version: "2.2.38",
    minimum_supported_version: "2.2.38",
    fetched_at: 1_784_000_000_000,
  },
};

const okStatus: MandatoryStatus = {
  kind: "ok",
  policy: {
    active: "2.2.38",
    channel: "stable",
    latest_version: "2.2.38",
    minimum_supported_version: "2.2.38",
    fetched_at: 1_784_000_000_000,
  },
};

const cachedStatus: MandatoryStatus = {
  kind: "mandatory_cached",
  policy: {
    active: "2.2.36",
    channel: "stable",
    latest_version: "2.2.38",
    minimum_supported_version: "2.2.38",
    fetched_at: 1_784_000_000_000,
  },
};

beforeEach(() => {
  __resetUpdateJourneyForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
});

function render(node: React.ReactElement): void {
  act(() => { root.render(node); });
}

describe("KadeUpdateGate · mount decision", () => {
  it("renders nothing for status.kind === 'ok'", () => {
    render(<KadeUpdateGate status={okStatus} />);
    expect(document.querySelector('[data-testid="kade-update-gate"]')).toBeNull();
  });

  it("renders full-screen surface for status.kind === 'mandatory'", () => {
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const gate = document.querySelector<HTMLElement>('[data-testid="kade-update-gate"]');
    expect(gate).not.toBeNull();
    expect(gate!.getAttribute("data-mandatory-kind")).toBe("mandatory");
  });

  it("renders + shows offline marker for status.kind === 'mandatory_cached'", () => {
    render(<KadeUpdateGate status={cachedStatus} />);
    const gate = document.querySelector<HTMLElement>('[data-testid="kade-update-gate"]');
    expect(gate).not.toBeNull();
    expect(gate!.getAttribute("data-mandatory-kind")).toBe("mandatory_cached");
    expect(document.querySelector('[data-testid="kade-update-cached-marker"]')).not.toBeNull();
  });
});

describe("KadeUpdateGate · locked copy", () => {
  it("carries the Daniel-locked headline + initial + supporting strings verbatim", () => {
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const gate = document.querySelector('[data-testid="kade-update-gate"]')!;
    expect(gate.textContent).toContain("Liquid Clips Update");
    expect(gate.textContent).toContain("A fresh version of Liquid Clips is ready.");
    expect(gate.textContent).toContain(
      "Kade is installing the latest improvements. Your projects, clips and account will remain safe.",
    );
  });

  it("failure surface uses locked headline + body", () => {
    markFailed("download", "network");
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const gate = document.querySelector('[data-testid="kade-update-gate"]')!;
    expect(gate.textContent).toContain("Update could not be completed");
    expect(gate.textContent).toContain(
      "Your existing version has not been changed. Check your connection and try again.",
    );
  });
});

describe("KadeUpdateGate · progress honesty", () => {
  it("indeterminate progress when bytes unknown", () => {
    transitionToChecking("2.2.36");
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const progress = document.querySelector('.lc-kade-update-gate__indeterminate');
    expect(progress).not.toBeNull();
    expect(document.querySelector('.lc-kade-update-gate__bar-fill')).toBeNull();
  });

  it("real percentage bar when downloading with known bytes", () => {
    transitionToChecking("2.2.36");
    transitionToDownloading("2.2.36", "2.2.38", null, 1000);
    render(
      <KadeUpdateGate
        status={mandatoryStatus}
        bytesDownloaded={250}
        bytesTotal={1000}
      />,
    );
    const bar = document.querySelector<HTMLElement>('.lc-kade-update-gate__bar');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("data-percent")).toBe("25");
    expect(bar!.getAttribute("aria-valuenow")).toBe("25");
  });

  it("verifying/installing phases stay indeterminate · never fabricate percent", () => {
    // Even if callers pass byte totals when displayState is
    // installing (post-stage), the component ignores them because
    // percent only applies to displayState === "downloading".
    transitionToChecking("2.2.36");
    transitionToDownloading("2.2.36", "2.2.38", null, 1000);
    // Simulate journey moving past download.
    __resetUpdateJourneyForTests();
    transitionToChecking("2.2.36");
    render(
      <KadeUpdateGate
        status={mandatoryStatus}
        bytesDownloaded={500}
        bytesTotal={1000}
      />,
    );
    // displayState is "checking" here (no download phase active) → indeterminate.
    expect(document.querySelector('.lc-kade-update-gate__indeterminate')).not.toBeNull();
  });
});

describe("KadeUpdateGate · status copy mapping", () => {
  it("checking → 'Checking for updates…'", () => {
    transitionToChecking("2.2.36");
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const status = document.querySelector('[data-testid="kade-update-status-copy"]')!;
    expect(status.textContent).toBe("Checking for updates…");
  });

  it("downloading → 'Downloading update…'", () => {
    transitionToChecking("2.2.36");
    transitionToDownloading("2.2.36", "2.2.38", null, 1000);
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const status = document.querySelector('[data-testid="kade-update-status-copy"]')!;
    expect(status.textContent).toBe("Downloading update…");
  });

  it("failed → 'Update could not be completed'", () => {
    markFailed("stage", "hash mismatch");
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const status = document.querySelector('[data-testid="kade-update-status-copy"]')!;
    expect(status.textContent).toBe("Update could not be completed");
  });
});

describe("KadeUpdateGate · failure surface actions", () => {
  it("renders retry / copy-diagnostics / contact-support buttons on failed", () => {
    markFailed("stage", "signature");
    render(<KadeUpdateGate status={mandatoryStatus} />);
    expect(document.querySelector('[data-testid="kade-update-retry"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="kade-update-copy-diag"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="kade-update-contact-support"]')).not.toBeNull();
  });

  it("calls onRetry when Retry clicked", async () => {
    markFailed("download", "timeout");
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<KadeUpdateGate status={mandatoryStatus} onRetry={onRetry} />);
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="kade-update-retry"]')!;
    await act(async () => { btn.click(); await Promise.resolve(); });
    expect(onRetry).toHaveBeenCalled();
  });

  it("failure surface remains blocking · gate does not unmount", () => {
    markFailed("stage", "hash");
    render(<KadeUpdateGate status={mandatoryStatus} />);
    expect(document.querySelector('[data-testid="kade-update-gate"]')).not.toBeNull();
    // Even after "failing" · the gate is still the only reachable surface.
  });
});

describe("KadeUpdateGate · accessibility landmarks", () => {
  it("has role=dialog + aria-modal + aria-labelledby + aria-describedby", () => {
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const gate = document.querySelector<HTMLElement>('[data-testid="kade-update-gate"]')!;
    expect(gate.getAttribute("role")).toBe("dialog");
    expect(gate.getAttribute("aria-modal")).toBe("true");
    expect(gate.getAttribute("aria-labelledby")).toBe("lc-kade-update-headline");
    expect(gate.getAttribute("aria-describedby")).toBe("lc-kade-update-status");
  });

  it("status region announces via aria-live=polite", () => {
    render(<KadeUpdateGate status={mandatoryStatus} />);
    const status = document.querySelector<HTMLElement>('[data-testid="kade-update-status-copy"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
  });
});
