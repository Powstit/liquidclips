/**
 * Regression guard · liquidclips://checkout-complete deep-link routing.
 *
 * 2026-08-05 — Whop checkout runs in the system browser (commerce URLs
 * never open in-app), so nothing brought the user back to the desktop
 * app after paying, and the new tier only appeared on the next
 * throttled focus-revalidation. Fixed by having account-app's
 * /checkout/complete success page fire this deep-link, which the OS
 * uses to bring the app to the foreground — same mechanism `activate`
 * already relies on. This pins the URL-matching rule; the Tauri
 * plugin wiring itself isn't unit-testable without mocking the whole
 * @tauri-apps/plugin-deep-link module.
 */
import { describe, expect, it } from "vitest";
import { isCheckoutCompleteUrl } from "./deepLinkBoot";

describe("isCheckoutCompleteUrl", () => {
  it("matches the real shape fired by account-app's ClientNotify", () => {
    expect(
      isCheckoutCompleteUrl("liquidclips://checkout-complete?status=success&plan=agency"),
    ).toBe(true);
  });

  it("matches with no query params", () => {
    expect(isCheckoutCompleteUrl("liquidclips://checkout-complete")).toBe(true);
  });

  it("does not match the activate verb", () => {
    expect(isCheckoutCompleteUrl("liquidclips://activate?token=abc")).toBe(false);
  });

  it("does not match the google-oauth verb", () => {
    expect(isCheckoutCompleteUrl("liquidclips://google-oauth?token=abc")).toBe(false);
  });

  it("does not match a different protocol", () => {
    expect(isCheckoutCompleteUrl("https://example.com/checkout-complete")).toBe(false);
  });

  it("does not throw on malformed input", () => {
    expect(isCheckoutCompleteUrl("not a url at all")).toBe(false);
  });
});
