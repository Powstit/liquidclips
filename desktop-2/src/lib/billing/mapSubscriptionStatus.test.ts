/**
 * mapSubscriptionStatus · "trial" vs "trialing" regression.
 *
 * Found via a live interactive debug pass while testing the
 * Submit-to-Whop flow: the console repeatedly logged
 * `[billing] unrecognized subscription_status="trial" · treating as
 * free`. The backend sets "trial" as the default at signup
 * (models.py / desktop_auth.py) and only flips to "trialing" once a
 * real Whop membership webhook confirms the period
 * (webhooks_whop.py) — backend routes already treat both as
 * equivalent (`in {"trial", "trialing"}` in sync.py, trial_convert.py,
 * admin.py). The frontend only recognized "trialing", so every
 * pre-Whop-connect signup (the most common new-user state) fell
 * through to the "unrecognized" fallback.
 */

import { describe, it, expect } from "vitest";
import { mapSubscriptionStatus } from "./adapter";

describe("billing/adapter.ts · mapSubscriptionStatus", () => {
  it("maps both 'trial' and 'trialing' to the 'trial' billing state", () => {
    expect(mapSubscriptionStatus("trial", true, null)).toBe("trial");
    expect(mapSubscriptionStatus("trialing", true, null)).toBe("trial");
  });

  it("still falls back to free for a genuinely unrecognized status", () => {
    expect(mapSubscriptionStatus("some_future_status", true, null)).toBe("free");
  });
});
