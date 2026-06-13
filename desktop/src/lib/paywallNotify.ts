import { backend, type Tier } from "./backend";
import { getCachedLicenseJwt } from "./authStorage";

// Session-level dedup so we don't spam the backend inbox.
const sessionDedup = new Set<string>();

export type PaywallFeature =
  | "generate_more_clips"
  | "reaction_layout"
  | "reaction_layout_retry"
  | "overlay_template"
  | "publish_now"
  | "schedule_one"
  | "publish_multi_platform"
  | "thumbnail_studio_ai"
  | "watermark_free_export";

const FEATURE_COPY: Record<
  PaywallFeature,
  { title: string; body: string; requiredTier: Tier }
> = {
  generate_more_clips: {
    title: "Generate more clips",
    body:
      "Re-run the AI picker on your transcript to find additional viral moments. Unlock with Solo.",
    requiredTier: "solo",
  },
  reaction_layout: {
    title: "Reaction layouts",
    body:
      "Add picture-in-picture, split-screen, and stacked reaction layouts to your clips. Unlock with Solo.",
    requiredTier: "solo",
  },
  reaction_layout_retry: {
    title: "Retry reaction bake",
    body:
      "Re-render your reaction layout after fixing a source clip. Unlock with Solo.",
    requiredTier: "solo",
  },
  overlay_template: {
    title: "Overlay templates",
    body:
      "Apply branded overlay templates to your clips. Unlock with Solo.",
    requiredTier: "solo",
  },
  publish_now: {
    title: "Publish now",
    body:
      "Push clips directly to your social platforms without leaving the app. Unlock with Solo.",
    requiredTier: "solo",
  },
  schedule_one: {
    title: "Schedule posts",
    body:
      "Queue clips to publish automatically at the best time. Unlock with Pro.",
    requiredTier: "pro",
  },
  publish_multi_platform: {
    title: "Multi-platform publishing",
    body:
      "Publish to multiple platforms in one shot. Unlock with Pro.",
    requiredTier: "pro",
  },
  thumbnail_studio_ai: {
    title: "AI thumbnail generation",
    body:
      "Generate character-locked YouTube thumbnails with AI. Unlock with Solo.",
    requiredTier: "solo",
  },
  watermark_free_export: {
    title: "Watermark-free exports",
    body:
      "Export clips without the Liquid Clips watermark. Unlock with Solo.",
    requiredTier: "solo",
  },
};

/**
 * Fires a paywall toast immediately and (once per session) drops a
 * notification into the backend inbox so serious clippers see a
 * persistent, actionable upgrade prompt instead of a silent block.
 *
 * Call this right before openAuthPanel("upgrade") at every feature gate.
 */
export async function notifyPaywall(
  feature: PaywallFeature,
  currentTier?: Tier | null,
): Promise<void> {
  const copy = FEATURE_COPY[feature];

  // 1. Toast — always fires for immediate feedback
  window.dispatchEvent(
    new CustomEvent("lc:toast", {
      detail: {
        kind: "info",
        message: `${copy.title} is locked — upgrade to ${copy.requiredTier} to unlock.`,
        durationMs: 6000,
      },
    }),
  );

  // 2. Backend inbox — deduped per session so we don't spam.
  // currentTier is folded into the dedup key so a free user upgrading to
  // Solo mid-session can still trigger relevant Pro+ paywalls without
  // their earlier free-tier nudges blocking the new ones. Also forwarded
  // to the backend so mailer.send_paywall_hit can mention the user's
  // current tier in the email copy.
  const tierTag = currentTier ?? "anon";
  const dedupKey = `paywall:${feature}:${copy.requiredTier}:${tierTag}`;
  if (sessionDedup.has(dedupKey)) return;
  sessionDedup.add(dedupKey);

  try {
    // v0.7.58 P0 — auth-keychain invariant. Paywall hit fires from a gated
    // user click (e.g. trying a Pro feature on Free). Cache-only; cache
    // miss = unauthed, nothing to notify.
    const jwt = getCachedLicenseJwt();
    if (!jwt) return; // Unauthed users have nothing to notify
    await backend.notifications.create(jwt, {
      category: "paywall",
      title: copy.title,
      body: copy.body,
      priority: "medium",
      action_kind: "open_auth_panel",
      action_data: {
        mode: "upgrade",
        target_tier: copy.requiredTier,
        // Forwarded to the backend POST /notifications handler, which
        // reads feature_label + required_tier from action_data when
        // firing send_paywall_hit() through Resend. Keeps the email
        // copy in sync with the in-app notification without a second
        // contract.
        current_tier: tierTag,
        feature_label: copy.title,
        required_tier: copy.requiredTier,
      },
      external_dedup_key: dedupKey,
    });
  } catch {
    // Best-effort — don't let a notification failure block the UX flow
  }
}
