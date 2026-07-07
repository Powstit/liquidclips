/**
 * CampaignShellTestHook · SPRINT_FINAL §1H test seam
 * (Max · 2026-07-07)
 *
 * Dev-only. Playwright emits `test:open-campaign-shell` via
 * `page.evaluate(() => window.__lcBus.emit("test:open-campaign-shell",
 * { slug, title, description, rewardPoolCents }))` · this component
 * subscribes and mounts CampaignPageShell with a synthetic Campaign
 * so the P10 syndicate spec can assert the "Post to Whop marketplace"
 * button + prefill URL contract without seeding the campaign RPC.
 *
 * Guarded by `import.meta.env.DEV` so the wrapper compiles out of
 * production bundles · zero runtime cost in installed builds.
 *
 * Mount at top-level in App.tsx alongside the AuthGate + ransom hook.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useEvent } from "../../design-os/bridge";
import { CampaignPageShell } from "../../design-os/campaigns/CampaignPageShell";
import type { Campaign } from "../../design-os/campaigns/types";

export function CampaignShellTestHook(): ReactElement | null {
  if (!import.meta.env.DEV) return null;
  return <CampaignShellTestHookInner />;
}

function CampaignShellTestHookInner(): ReactElement | null {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEvent("test:open-campaign-shell", (p) => {
    setCampaign(buildSyntheticCampaign(p));
  });

  // Race-safe seam · Playwright can `waitForFunction` on
  // `window.__lc_test_open_campaign_shell` to confirm the hook is
  // subscribed before firing the trigger, so a spec that emits the
  // bus event too early doesn't drop it on the floor. Mirrors
  // AssetRansomPaywallTestHook.tsx:40-52. Both write + tear-down
  // are DEV-only via the outer guard-render.
  useEffect(() => {
    const w = window as unknown as {
      __lc_test_open_campaign_shell?: (p: {
        slug: string;
        title: string;
        description?: string;
        rewardPoolCents?: number;
      }) => void;
    };
    w.__lc_test_open_campaign_shell = (p) => {
      setCampaign(buildSyntheticCampaign(p));
    };
    return () => {
      w.__lc_test_open_campaign_shell = undefined;
    };
  }, []);

  if (!campaign) return null;

  return (
    <CampaignPageShell
      campaign={campaign}
      open={true}
      onClose={() => setCampaign(null)}
    />
  );
}

function buildSyntheticCampaign(p: {
  slug: string;
  title: string;
  description?: string;
  rewardPoolCents?: number;
}): Campaign {
  const now = new Date().toISOString();
  return {
    id: `test_${p.slug}`,
    slug: p.slug,
    title: p.title,
    subtitle: null,
    description: p.description ?? "",
    brand: null,
    businessUnit: null,
    createdBy: "user_admin",
    createdAt: now,
    updatedAt: now,
    campaignType: "clip",
    status: "live",
    visibility: "public",
    placementQuality: "standard",
    rewardKind: "usd",
    rewardPoolCents: p.rewardPoolCents ?? 100_00,
    payoutRules: { kind: "rpm", rpmCents: 100, minVerifiedViews: 1000 },
    fundedPct: 0,
    minLcScore: 75,
    capacityTotal: null,
    capacityUsed: 0,
    capacityWindowStart: null,
    capacityWindowEnd: null,
    deadline: null,
    durationLabel: null,
    targetPlatforms: [],
    targetGeos: null,
    targetHashtags: null,
    visibilityTiers: ["free", "solo", "pro", "agency"],
    requiredTier: null,
    requiresMembership: false,
    tierRules: {},
    discussionProvider: "whop",
    communityChannelId: null,
    nativeDiscussionId: null,
    assetSources: [],
    bannerUrl: null,
    featuredThumbUrl: null,
    whopUrl: null,
    whopCampaignId: null,
    whopCampaignUrl: null,
    affiliateEnabled: false,
    whopRewardId: null,
    whopRewardUrl: null,
    whopRewardState: null,
    whopRewardSnapshotStatus: "not_attempted",
    whopRewardSnapshot: null,
    whopRewardSnapshotBusinessGoal: null,
    whopRewardSnapshotBountyType: null,
    whopRewardSyncedAt: null,
    whopRewardLastError: null,
    watermarkAllowed: true,
    watermarkOverlayConfig: null,
  } as Campaign;
}
