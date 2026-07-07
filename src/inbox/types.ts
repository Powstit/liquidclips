/**
 * FEATURE-001 · canonical inbox + email-delivery types.
 *
 * Inbox is the source of truth. Resend is a delivery adapter. The two
 * states are intentionally separated: an InboxRecord may exist with no
 * email metadata (UI-only event), or with an EmailDelivery sub-object
 * tracking the Resend attempt(s). Email-delivery state is never the
 * source of truth — it's a side-effect on the record.
 */

/** Initial event kinds per FEATURE-001 scope.
 *  Add kinds at the end of the union to keep the existing localStorage
 *  payloads forward-compatible (TS narrows safely as new kinds land).
 *
 *  2026-06-23 — Daniel's monetisation pass added the `billing.*`,
 *  `campaign.*`, and `bonus.*` kinds for the commitment-point paywall
 *  flow + the $50 activation-bonus state machine. */
export type InboxKind =
  | "clip-generation-complete"
  | "export-complete"
  | "export-failed"
  | "reaction-bake-complete"
  | "trim-regenerate-complete"
  | "caption-apply-complete"
  | "backend-offline-warning"
  | "watermark-warning"
  | "tier-warning"
  | "system"
  | "welcome"
  // billing / paywall
  | "billing.upgrade_required"
  | "billing.checkout_started"
  | "billing.checkout_failed"
  | "billing.subscription_active"
  | "billing.subscription_past_due"
  | "billing.subscription_cancelled"
  | "billing.cap_reached"
  // campaign-specific commit gate
  | "campaign.publish_blocked"
  // $50 activation bonus state machine
  | "bonus.milestone_reached"
  | "bonus.subscription_required"
  | "bonus.pending_clearance"
  | "bonus.approved"
  | "bonus.rejected"
  | "bonus.paid";

/** Honest email-delivery lifecycle. Names match the FEATURE-001 spec:
 *  - "not_sent"        · event was created without an email attempt
 *  - "not_configured"  · Resend backend is not wired · honest no-op
 *  - "sending"         · dispatch in flight (between fetch start + response)
 *  - "sent"            · backend acknowledged the send (Resend message id)
 *  - "failed"          · transport or backend rejected; retry permitted */
export type EmailDeliveryStatus =
  | "not_sent"
  | "not_configured"
  | "sending"
  | "sent"
  | "failed";

export interface EmailDelivery {
  status: EmailDeliveryStatus;
  /** Provider id, set only when status reaches "sent". Until then null. */
  provider: "resend" | null;
  /** Backend-supplied id, set only when status === "sent". */
  messageId?: string;
  /** Total dispatch attempts (initial + retries). */
  attempts: number;
  /** ISO timestamp of the last attempt (sending or terminal). */
  lastAttemptAt?: string;
  /** Last failure error string, set when status === "failed" or
   *  status === "not_configured". Cleared back to undefined on next
   *  successful retry. */
  error?: string;
}

export interface InboxRecord {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  /** ISO timestamp of when the event was recorded locally. */
  receivedAt: string;
  /** ISO timestamp of when the user marked the record read. Falsy = unread. */
  readAt?: string;
  /** Optional CTA target.
   *  - `#/route` → routed via existing hash + bus pattern.
   *  - absolute URL → opens via openSmart(). */
  href?: string;
  ctaLabel?: string;
  /** Email-delivery metadata, present only when this event is configured
   *  to attempt email delivery. Absence = pure in-app notification. */
  email?: EmailDelivery;
}
