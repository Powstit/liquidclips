// 2026-06-23 · tier vocab aligned with useTierCaps Tier (clipper/pro/growth/agency)
// "solo" dropped (was the pre-rename name for "pro"). "free" kept as alias for
// "clipper" so existing AccountSection/EngineClipGrid string comparisons stay valid.
// SOVEREIGN-2.2 · this whole fixture retires when backend /me is fully wired.
export type Tier = "free" | "clipper" | "pro" | "growth" | "agency";

export interface FakeAccount {
  displayName: string;
  email: string;
  tier: Tier;
  clipsRemaining: number;
  clipsCap: number;
  accountPacks: number;
  affiliateId: string | null;
}

export const fakeAccount: FakeAccount = {
  displayName: "Daniel Diyepriye Dokubo",
  email: "you@example.com",
  tier: "free",
  clipsRemaining: 73,
  clipsCap: 100,
  accountPacks: 0,
  affiliateId: "aff_demo_001",
};
