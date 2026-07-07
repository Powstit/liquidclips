// Offline-first sample campaigns. Matches the shape of `GET /campaigns`
// returned by junior-backend so the SponsoredBannerCarousel can render
// without any backend reachable.
//
// Source: Liquid_Clips_2_Starter_Kit / 05_FEATURE_MAP / home_screen_assets /
//         sample-campaigns.json (locked 2026-06-17).
//
// Three slides intentional: one mp4 (proves LazyVideo branch), one image
// (proves img branch), one locked (proves tier-gate visual).

export interface SponsoredCampaign {
  id: string;
  slug: string;
  name: string;
  brand: string;
  subtitle?: string;
  type: "public" | "invite_only";
  status: "live" | "coming_soon" | "closed";
  rpm_cents?: number;
  budget_cents?: number;
  funded_pct?: number;
  duration_label?: string;
  whop_url?: string;
  whop_campaign_url?: string;
  /** May be an mp4/webm/mov, an image URL, or null when locked. */
  banner_url: string | null;
  eligibility?: string[];
  visibility_tiers?: string[];
  min_lc_score?: number;
  cta_text?: string;
  sort_order?: number;
  your_rpm_cents?: number;
  is_premium_caller?: boolean;
  base_rpm_cents?: number;
  premium_rpm_cents?: number;
  premium_bonus_cents?: number;
}

export const sampleCampaigns: SponsoredCampaign[] = [
  {
    id: "campaign_lc_starter_kit_demo_mp4",
    slug: "demo-video-banner",
    name: "Demo: clip & earn live rewards",
    brand: "Liquid Clips",
    subtitle: "Sample mp4 banner — proves the LazyVideo branch works",
    type: "public",
    status: "live",
    rpm_cents: 800,
    budget_cents: 50_000_000,
    funded_pct: 0.42,
    duration_label: "Live · 6 days left",
    whop_url: "https://whop.com/discover/content-rewards/",
    whop_campaign_url: "https://whop.com/discover/content-rewards/c/demo",
    banner_url: "/brand/intro/intro-splash.mp4",
    eligibility: ["any"],
    visibility_tiers: [],
    min_lc_score: 0,
    cta_text: "Open campaign",
    sort_order: 1,
    your_rpm_cents: 800,
    is_premium_caller: false,
    base_rpm_cents: 800,
    premium_rpm_cents: 1200,
    premium_bonus_cents: 400,
  },
  {
    id: "campaign_lc_starter_kit_demo_image",
    slug: "demo-image-banner",
    name: "Demo: image banner fallback",
    brand: "Acme Brand",
    subtitle: "Sample png banner — proves the img branch works",
    type: "public",
    status: "live",
    rpm_cents: 500,
    budget_cents: 20_000_000,
    funded_pct: 0.18,
    duration_label: "Live · 12 days left",
    whop_url: "https://whop.com/discover/content-rewards/",
    whop_campaign_url: "https://whop.com/discover/content-rewards/c/demo-image",
    banner_url: "/brand/sponsored/thumb-creator.png",
    eligibility: ["any"],
    visibility_tiers: [],
    min_lc_score: 0,
    cta_text: "Open campaign",
    sort_order: 2,
    your_rpm_cents: 500,
  },
  {
    id: "campaign_lc_starter_kit_demo_locked",
    slug: "demo-pro-locked",
    name: "Demo: pro-locked campaign",
    brand: "Pro Partners",
    subtitle: "Sample locked card — proves the tier-gate visual works",
    type: "invite_only",
    status: "live",
    rpm_cents: 2000,
    budget_cents: 100_000_000,
    funded_pct: 0.07,
    duration_label: "Live · 30 days left",
    whop_url: "https://whop.com/discover/content-rewards/",
    whop_campaign_url: "https://whop.com/discover/content-rewards/c/demo-locked",
    banner_url: null,
    eligibility: ["pro", "agency"],
    visibility_tiers: ["pro", "agency"],
    min_lc_score: 75,
    cta_text: "Apply",
    sort_order: 3,
  },
];

/**
 * Offline-first loader. Resolves with the bundled sample after a tiny
 * delay so consumers can see their loading state at least once.
 *
 * No real `backend.campaignsList()` call. No network. No cache writes.
 * Swap this for a real fetcher when junior-backend is reachable.
 */
export async function loadSampleCampaigns(): Promise<SponsoredCampaign[]> {
  await new Promise((r) => setTimeout(r, 150));
  return [...sampleCampaigns].sort(
    (a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99),
  );
}

export const WHOP_REWARDS_URL = "https://whop.com/discover/content-rewards/";
