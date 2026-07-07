/**
 * FEATURE-001 · single entry point for emitting an inbox event.
 *
 * Callers do `notify({ kind, title, body })` and the facade:
 *   1. Decides whether the event is email-worthy (default policy below).
 *   2. Adds an InboxRecord to the store · bus emits `inbox:added`.
 *   3. If email-worthy, kicks off `dispatchEmail()` async · bus emits
 *      `inbox:email-state` per lifecycle transition.
 *
 * Spec rule:
 *   "Do not email every tiny event. Only email important events by
 *    default: export complete, export failed, generation complete,
 *    billing/tier warnings, critical backend failure."
 *
 * Callers can override the default policy via `emailOverride` when
 * a per-call rule applies.
 */
import { add } from "./store";
import { dispatchEmail } from "./emailAdapter";
import type { EmailDelivery, InboxKind, InboxRecord } from "./types";

const EMAIL_WORTHY_KINDS: ReadonlySet<InboxKind> = new Set<InboxKind>([
  "clip-generation-complete",
  "export-complete",
  "export-failed",
  "tier-warning",
  "backend-offline-warning",
]);

export function isEmailWorthy(kind: InboxKind): boolean {
  return EMAIL_WORTHY_KINDS.has(kind);
}

export interface NotifyArgs {
  kind: InboxKind;
  title: string;
  body: string;
  href?: string;
  ctaLabel?: string;
  /** Override the default per-kind policy.
   *  - true  → always create EmailDelivery + dispatch
   *  - false → never (pure in-app notification)
   *  - undefined → defer to EMAIL_WORTHY_KINDS */
  emailOverride?: boolean;
}

export function notify(args: NotifyArgs): InboxRecord {
  const wantEmail = args.emailOverride ?? isEmailWorthy(args.kind);
  const email: EmailDelivery | undefined = wantEmail
    ? { status: "not_sent", provider: null, attempts: 0 }
    : undefined;
  const record = add({
    kind: args.kind,
    title: args.title,
    body: args.body,
    href: args.href,
    ctaLabel: args.ctaLabel,
    email,
  });
  if (email) {
    // Fire-and-forget. The adapter writes lifecycle transitions back
    // into the store via `updateEmailDelivery`, which subscribers will
    // see on the next `inbox:email-state` event.
    void dispatchEmail(record.id);
  }
  return record;
}

/* ────────────────────────────────────────────────────────────────────
   2026-06-23 — billing / paywall / activation-bonus helpers.
   Each helper is a thin wrapper around `notify()` so call-sites can
   stay terse and the inbox keeps a single ingestion point. None of
   these are email-worthy by default · billing UIs already show the
   state in-app; email would be spam.
   ──────────────────────────────────────────────────────────────────── */

export function notifyUpgradeRequired(opts: {
  action: string;
  requiredPlan: string;
  currentPlan: string;
}): InboxRecord {
  return notify({
    kind: "billing.upgrade_required",
    title: `${opts.action} · ${opts.requiredPlan} required`,
    body: `Your current plan (${opts.currentPlan}) doesn't include this. Upgrade to ${opts.requiredPlan} to ${opts.action.toLowerCase()}.`,
    href: "#/settings",
    ctaLabel: `Upgrade to ${opts.requiredPlan}`,
  });
}

export function notifyCheckoutStarted(planName: string): InboxRecord {
  return notify({
    kind: "billing.checkout_started",
    title: `Checkout opened · ${planName}`,
    body: "Complete the checkout flow to activate your new plan.",
  });
}

export function notifyCheckoutFailed(planName: string, reason?: string): InboxRecord {
  return notify({
    kind: "billing.checkout_failed",
    title: `Checkout failed · ${planName}`,
    body: reason ?? "We couldn't confirm your payment. Try again or contact support.",
    href: "#/settings",
    ctaLabel: "Try again",
  });
}

export function notifySubscriptionActive(planName: string): InboxRecord {
  return notify({
    kind: "billing.subscription_active",
    title: `${planName} activated`,
    body: `Welcome to ${planName}. Your new caps are live across the app.`,
  });
}

export function notifySubscriptionPastDue(planName: string): InboxRecord {
  return notify({
    kind: "billing.subscription_past_due",
    title: `${planName} payment past due`,
    body: "Update your payment method to keep your plan active. We'll keep your caps live during a short grace period.",
    href: "#/settings",
    ctaLabel: "Update payment",
  });
}

export function notifySubscriptionCancelled(planName: string): InboxRecord {
  return notify({
    kind: "billing.subscription_cancelled",
    title: `${planName} cancelled`,
    body: "Your caps stay live until the current billing period ends, then drop to Free Clipper.",
  });
}

export function notifyCapReached(opts: {
  capLabel: string;
  current: number | string;
  cap: number | string;
  nextTier: string;
}): InboxRecord {
  return notify({
    kind: "billing.cap_reached",
    title: `${opts.capLabel} cap reached`,
    body: `You've used ${opts.current} of ${opts.cap}. Upgrade to ${opts.nextTier} to keep going.`,
    href: "#/settings",
    ctaLabel: `Upgrade to ${opts.nextTier}`,
  });
}

export function notifyCampaignPublishBlocked(campaignName?: string): InboxRecord {
  const tail = campaignName ? `Your draft "${campaignName}" is ready to launch.` : "Your draft is ready.";
  return notify({
    kind: "campaign.publish_blocked",
    title: "Campaign ready to launch — Agency required",
    body: `${tail} Upgrade to Agency to publish campaigns and activate rewards.`,
    href: "#/settings",
    ctaLabel: "Upgrade to Agency",
  });
}

export function notifyAgencyPreviewUnlocked(): InboxRecord {
  return notify({
    kind: "campaign.publish_blocked", // reuse kind · same surface · no new schema entry needed
    title: "Agency Preview unlocked",
    body: "Build your campaign draft now. Upgrade only when you are ready to launch.",
    href: "#/campaigns",
    ctaLabel: "Open Agency",
  });
}

export function notifyBonusMilestoneReached(viewCount: number): InboxRecord {
  return notify({
    kind: "bonus.milestone_reached",
    title: "🏆 5,000 views reached. Your $50 activation bonus is pending.",
    body: `Your tracked views (${viewCount.toLocaleString()}) crossed the 5,000-view threshold. Subscribe to claim the bonus.`,
    href: "#/earn",
    ctaLabel: "Claim bonus",
  });
}

export function notifyBonusSubscriptionRequired(): InboxRecord {
  return notify({
    kind: "bonus.subscription_required",
    title: "Subscribe to claim your $50 bonus",
    body: "Your activation bonus is waiting. Pick a paid plan first; the bonus then enters a 7-day clearance hold.",
    href: "#/settings",
    ctaLabel: "Pick a plan",
  });
}

export function notifyBonusPendingClearance(): InboxRecord {
  return notify({
    kind: "bonus.pending_clearance",
    title: "$50 bonus in 7-day clearance",
    body: "Anti-fraud hold. Once cleared, your bonus becomes withdrawable in the Earn tab.",
    href: "#/earn",
    ctaLabel: "See status",
  });
}

export function notifyBonusApproved(): InboxRecord {
  return notify({
    kind: "bonus.approved",
    title: "$50 bonus approved — withdrawable",
    body: "Your activation bonus cleared the 7-day hold. Withdraw it from the Earn tab.",
    href: "#/earn",
    ctaLabel: "Withdraw",
  });
}

export function notifyBonusRejected(reason: string): InboxRecord {
  return notify({
    kind: "bonus.rejected",
    title: "$50 bonus rejected",
    body: reason,
    href: "#/earn",
    ctaLabel: "See details",
  });
}

export function notifyBonusPaid(amountUsd: number): InboxRecord {
  return notify({
    kind: "bonus.paid",
    title: `$${amountUsd} bonus paid`,
    body: "Your activation bonus has been sent. Check your withdrawal method for the funds.",
  });
}
