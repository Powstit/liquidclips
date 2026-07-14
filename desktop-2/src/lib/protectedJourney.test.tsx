/**
 * protectedJourney registry tests · Wave D1 · j015-runtime-update.
 *
 * Contract:
 *   - register/release is ref-counted
 *   - hasActiveProtected reflects the registry
 *   - subscribers fire on transitions
 *   - React hook auto-cleans on unmount and on active=false flip
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  registerProtectedJourney,
  hasActiveProtected,
  activeProtectedIds,
  subscribeProtectedJourney,
  useProtectedJourney,
  __resetProtectedJourneyForTests,
  PROTECTED_JOURNEY_IDS,
} from "./protectedJourney";

beforeEach(() => {
  __resetProtectedJourneyForTests();
});

describe("protectedJourney · registry primitives", () => {
  it("hasActiveProtected reflects registrations", () => {
    expect(hasActiveProtected()).toBe(false);
    const release = registerProtectedJourney("j005-upload");
    expect(hasActiveProtected()).toBe(true);
    expect(activeProtectedIds()).toEqual(["j005-upload"]);
    release();
    expect(hasActiveProtected()).toBe(false);
    expect(activeProtectedIds()).toEqual([]);
  });

  it("ref-counted · two registrations of the same id survive one release", () => {
    const r1 = registerProtectedJourney("j006-clip-generation");
    const r2 = registerProtectedJourney("j006-clip-generation");
    expect(hasActiveProtected()).toBe(true);
    r1();
    expect(hasActiveProtected()).toBe(true); // r2 still holds it
    r2();
    expect(hasActiveProtected()).toBe(false);
  });

  it("double-release of the same handle is a no-op", () => {
    const release = registerProtectedJourney("j011-payout");
    release();
    release(); // should not underflow / delete a nonexistent entry
    expect(hasActiveProtected()).toBe(false);
  });

  it("subscribers fire on register + release transitions", () => {
    const cb = vi.fn();
    const unsub = subscribeProtectedJourney(cb);
    const release = registerProtectedJourney("j004-connect-whop");
    expect(cb).toHaveBeenCalledTimes(1);
    release();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    const r2 = registerProtectedJourney("j005-upload");
    // Unsubscribed cb should not fire again.
    expect(cb).toHaveBeenCalledTimes(2);
    r2();
  });

  it("PROTECTED_JOURNEY_IDS contains all six locked ids", () => {
    expect(PROTECTED_JOURNEY_IDS).toEqual(
      expect.arrayContaining([
        "j005-upload",
        "j006-clip-generation",
        "j007-my-clips",
        "j004-connect-whop",
        "j011-payout",
        "j001-fresh-user-otp-identity",
      ]),
    );
    expect(PROTECTED_JOURNEY_IDS.length).toBe(6);
  });
});

describe("protectedJourney · React hook", () => {
  let container: HTMLDivElement;
  let roots: Root[] = [];

  beforeEach(() => {
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

  it("useProtectedJourney registers while active=true and cleans on unmount", () => {
    function Harness({ active }: { active: boolean }) {
      useProtectedJourney("j005-upload", active);
      return null;
    }
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Harness active={true} />);
    });
    expect(hasActiveProtected()).toBe(true);
    act(() => {
      root.render(<Harness active={false} />);
    });
    expect(hasActiveProtected()).toBe(false);
    // Re-flip · registers again.
    act(() => {
      root.render(<Harness active={true} />);
    });
    expect(hasActiveProtected()).toBe(true);
    act(() => {
      root.unmount();
    });
    // Remove from roots since we already unmounted.
    roots = roots.filter((r) => r !== root);
    expect(hasActiveProtected()).toBe(false);
  });
});

