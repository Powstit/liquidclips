/**
 * InAppBrowser · IG-INAPP-BROWSER-CLEAN regression tests
 *
 * Proves the four customer-facing contract points from the 2026-07-22
 * clean sprint:
 *   1. The customer default render does NOT show any of the banned
 *      dev-tooling strings ("BROWSER OVERLAY" · "NATIVE WEBKIT" ·
 *      "COMMERCE URLS OPEN IN SYSTEM BROWSER" · "In-app browser tour"
 *      · "TAP TO UNMUTE" · "Desktop app · Home"), does NOT expose the
 *      raw URL bar input, does NOT expose "Copy URL" / "Use in Engine".
 *   2. When `showScrubber` is forced ON (equivalent to `?dev=1` or
 *      Vite DEV), the dev testids DO appear: `dev-backdrop-label`,
 *      `dev-chrome-title`, `dev-address-bar`, `dev-copy-url`,
 *      `dev-use-in-engine`.
 *   3. The customer chrome still renders a subtle site pill so the
 *      URL bar area isn't empty.
 *   4. The error state's primary CTA reads "Try again" (verb-first).
 *
 * Testing strategy — the desktop-2 project has NO `@testing-library/react`
 * dependency. Follow the established local pattern (see
 * `App.test.tsx` + `safe-inline.test.tsx` + `SectionWithFallback.test.tsx`):
 * mount into a jsdom container via `createRoot`, `act` to flush,
 * then read `container.textContent` + `container.querySelector`.
 *
 * We stub `lcDiag` via `vi.mock` so the batch flusher in
 * `diagnosticLogger` never fires (no network, no interval leak).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InAppBrowser } from "./InAppBrowser";

vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

// SafeImg + safe-inline both call into real modules; that's fine.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const BANNED_STRINGS = [
  "BROWSER OVERLAY",
  "NATIVE WEBKIT",
  "COMMERCE URLS OPEN IN SYSTEM BROWSER",
  "In-app browser tour",
  "TAP TO UNMUTE",
  "Desktop app · Home",
];

describe("InAppBrowser · customer view (isDev=false)", () => {
  it("does NOT render any banned dev-tooling strings", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    const text = container.textContent ?? "";
    for (const banned of BANNED_STRINGS) {
      expect(text).not.toContain(banned);
    }
  });

  it("does NOT render the raw URL address bar", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    expect(container.querySelector(".iab-address-input")).toBeNull();
    expect(container.querySelector('[data-testid="dev-address-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="dev-address-input"]')).toBeNull();
  });

  it("does NOT render Copy URL or Use in Engine dev buttons", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    expect(container.querySelector('[data-testid="dev-copy-url"]')).toBeNull();
    expect(container.querySelector('[data-testid="dev-use-in-engine"]')).toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Copy URL");
    expect(text).not.toContain("Use in Engine");
  });

  it("does NOT render the dev backdrop label", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    expect(container.querySelector('[data-testid="dev-backdrop-label"]')).toBeNull();
    expect(container.querySelector('[data-testid="dev-chrome-title"]')).toBeNull();
  });

  it("does NOT render the STATE scrubber for customers", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    expect(container.querySelector(".iab-scrubber")).toBeNull();
  });

  it("DOES render the customer-facing site pill", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    const pill = container.querySelector(".iab-site-pill");
    expect(pill).not.toBeNull();
    // Default state points at whop.com/rewards → host label = whop.com.
    expect(pill?.textContent ?? "").toContain("whop.com");
  });

  it("DOES render Back/Forward/Reload nav buttons (customer-facing chrome)", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    const navButtons = container.querySelectorAll(".iab-nav-btn");
    expect(navButtons.length).toBeGreaterThanOrEqual(3);
  });

  it("DOES render Sync Gmail + Other sync-mail buttons (customer-facing)", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={false} />);
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Sync Gmail");
    expect(text).toContain("Other");
  });
});

describe("InAppBrowser · dev view (showScrubber=true)", () => {
  it("DOES render every dev testid when scrubber forced on", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={true} />);
    });
    expect(container.querySelector('[data-testid="dev-backdrop-label"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dev-chrome-title"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dev-address-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dev-copy-url"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dev-use-in-engine"]')).not.toBeNull();
  });

  it("DOES render the STATE scrubber when forced", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={true} />);
    });
    expect(container.querySelector(".iab-scrubber")).not.toBeNull();
  });

  it("does NOT render the customer site pill when dev chrome is shown", () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={true} />);
    });
    // Site pill is the customer branch; dev branch uses .iab-address-bar
    expect(container.querySelector(".iab-site-pill")).toBeNull();
    expect(container.querySelector(".iab-address-input")).not.toBeNull();
  });
});

describe("InAppBrowser · error state", () => {
  // The error state is reachable via the scrubber (dev-only route in
  // this port). We assert the primary CTA text + styling class through
  // the scrubber-on render since scrubber === dev chrome.
  it('primary error CTA reads "Try again" verb-first when the error webview is active', () => {
    act(() => {
      root.render(<InAppBrowser showScrubber={true} />);
    });
    // Click the "error" scrubber pill to swap into the error state.
    const scrubberBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".iab-scrubber-btn"),
    );
    const errorBtn = scrubberBtns.find((b) => (b.textContent ?? "").includes("error"));
    expect(errorBtn).not.toBeUndefined();
    act(() => {
      errorBtn?.click();
    });
    const primary = container.querySelector<HTMLButtonElement>(
      ".iab-error-btn.is-primary",
    );
    expect(primary).not.toBeNull();
    expect((primary?.textContent ?? "").trim()).toBe("Try again");
  });
});
