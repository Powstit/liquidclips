/**
 * WelcomeRoute · post-auth crew-onboarding deadlock fix (2026-09-08)
 *
 * Root cause: `wrapOnDoneWithCrewGate()`'s crew-onboarding branch used to
 * `return` before calling `onDone()`. `onDone` is what flips App.tsx's
 * `WelcomeGate` `acked` state — skipping it meant `SimulatorRouter` (which
 * owns the `#/crew-onboarding` route) never mounted, so a first-time user
 * stayed stuck on "You're signed in. Opening Liquid Clips…" forever.
 *
 * Fix: `onDone()` now always runs, whether or not the crew-onboarding
 * hash was also set. These tests exercise `wrapOnDoneWithCrewGate`
 * directly (now exported — the smallest testability change, matching the
 * file's existing pattern of exporting standalone helpers like
 * `readColdLead`/`hasAckedWelcome`) rather than mocking the whole
 * `fetchCrewMarkers` implementation: only its two real dependencies
 * (`authStorage.getJwt`, `authedFetch.authedFetch`) are mocked, so the
 * actual gate logic (`shouldShowCrewOnboarding`) runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getJwtMock = vi.fn<() => string | null>();
vi.mock("../../lib/authStorage", () => ({
  getJwt: () => getJwtMock(),
}));

const authedFetchMock = vi.fn();
vi.mock("../../lib/authedFetch", () => ({
  authedFetch: (...args: unknown[]) => authedFetchMock(...args),
}));

import { wrapOnDoneWithCrewGate } from "./WelcomeRoute";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  getJwtMock.mockReset();
  authedFetchMock.mockReset();
  getJwtMock.mockReturnValue("fake-jwt-for-test");
  window.location.hash = "";
});

describe("wrapOnDoneWithCrewGate · post-auth deadlock fix", () => {
  it("fresh-user markers: sets #/crew-onboarding hash AND calls onDone exactly once", async () => {
    authedFetchMock.mockResolvedValueOnce(
      jsonResponse({ shown_at: null, completed_at: null, dismissed_at: null }),
    );
    const onDone = vi.fn();
    const wrapped = wrapOnDoneWithCrewGate(onDone);

    await wrapped();

    expect(window.location.hash).toBe("#/crew-onboarding");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("existing-user markers (already shown): does NOT set the crew-onboarding hash, still calls onDone exactly once", async () => {
    authedFetchMock.mockResolvedValueOnce(
      jsonResponse({ shown_at: "2026-07-01T00:00:00Z", completed_at: null, dismissed_at: null }),
    );
    const onDone = vi.fn();
    const wrapped = wrapOnDoneWithCrewGate(onDone);

    await wrapped();

    expect(window.location.hash).not.toBe("#/crew-onboarding");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("fetchCrewMarkers failure (authedFetch rejects): fails safe — no crew-onboarding hash, onDone still called exactly once", async () => {
    authedFetchMock.mockRejectedValueOnce(new Error("network down"));
    const onDone = vi.fn();
    const wrapped = wrapOnDoneWithCrewGate(onDone);

    await wrapped();

    expect(window.location.hash).not.toBe("#/crew-onboarding");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("fetchCrewMarkers null (no JWT): fails safe — no crew-onboarding hash, onDone still called exactly once", async () => {
    getJwtMock.mockReturnValue(null);
    const onDone = vi.fn();
    const wrapped = wrapOnDoneWithCrewGate(onDone);

    await wrapped();

    expect(authedFetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).not.toBe("#/crew-onboarding");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("non-ok HTTP response: fails safe — no crew-onboarding hash, onDone still called exactly once", async () => {
    authedFetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    const onDone = vi.fn();
    const wrapped = wrapOnDoneWithCrewGate(onDone);

    await wrapped();

    expect(window.location.hash).not.toBe("#/crew-onboarding");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
