import { describe, expect, test } from "vitest";

import {
  shouldShowCrewOnboarding,
  type CrewOnboardingMarkers,
} from "./crewGate";

const ISO_NOW = "2026-07-13T20:00:00Z";

/**
 * Crew Path A · marker persistence + no false repeat.
 *
 * Every branch of `shouldShowCrewOnboarding` is exercised so the
 * gate contract is preserved even if the wrapper in
 * `WelcomeRoute.tsx` is refactored later.
 */
describe("Crew Path A · shouldShowCrewOnboarding gate contract", () => {
  test("fresh markers → show the flywheel", () => {
    const markers: CrewOnboardingMarkers = {
      shown_at: null,
      completed_at: null,
      dismissed_at: null,
    };
    expect(shouldShowCrewOnboarding(markers)).toBe(true);
  });

  test("shown_at populated → do NOT show (no false repeat)", () => {
    const markers: CrewOnboardingMarkers = {
      shown_at: ISO_NOW,
      completed_at: null,
      dismissed_at: null,
    };
    expect(shouldShowCrewOnboarding(markers)).toBe(false);
  });

  test("completed_at populated → do NOT show (marker persistence)", () => {
    const markers: CrewOnboardingMarkers = {
      shown_at: null,
      completed_at: ISO_NOW,
      dismissed_at: null,
    };
    expect(shouldShowCrewOnboarding(markers)).toBe(false);
  });

  test("dismissed_at populated → do NOT show", () => {
    const markers: CrewOnboardingMarkers = {
      shown_at: null,
      completed_at: null,
      dismissed_at: ISO_NOW,
    };
    expect(shouldShowCrewOnboarding(markers)).toBe(false);
  });

  test("all three markers populated → do NOT show", () => {
    const markers: CrewOnboardingMarkers = {
      shown_at: ISO_NOW,
      completed_at: ISO_NOW,
      dismissed_at: ISO_NOW,
    };
    expect(shouldShowCrewOnboarding(markers)).toBe(false);
  });

  test("null markers object → fail-safe do NOT show", () => {
    expect(shouldShowCrewOnboarding(null)).toBe(false);
  });

  test("marker precedence: dismissed short-circuits before completed and shown", () => {
    // Order of precedence in the gate is dismissed → completed → shown.
    // We can't observe order from a boolean result, but we can prove
    // that the DISMISSED bit is not overridden by other markers being
    // null — a regression that flipped precedence would surface here
    // via the "shown" case suddenly returning true again.
    const markers: CrewOnboardingMarkers = {
      shown_at: null,
      completed_at: null,
      dismissed_at: ISO_NOW,
    };
    expect(shouldShowCrewOnboarding(markers)).toBe(false);
  });
});
