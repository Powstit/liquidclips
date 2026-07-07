/**
 * openWhopAction · The locked pattern for Whop-owned action pages.
 *
 * Every Whop-owned surface (wallet, withdraw, KYC, tax docs, bounty
 * create, payout settings, billing) opens INSIDE our persistent-cookie
 * BrowseOverlay via `openInApp`. No iframes. No macOS Safari handoffs.
 *
 * Locked by Daniel 2026-07-07:
 *   "we have a tab open browser · add an automatic switch to it so it
 *    opens anytime an iframe is needed."
 *
 * This helper IS that automatic switch, scoped to Whop URLs. Any
 * whop.com/* URL routes through the in-app browser which already has
 * the user's Whop session from Gate 1 ($1 authorization). One-click.
 *
 * For every Whop-side capability we expose in our branded UI:
 *   openWhopAction(WhopAction.WITHDRAW, { companyId, userId })
 *   openWhopAction(WhopAction.BOUNTY_CREATE, { companyId, prefill: {...} })
 *   openWhopAction(WhopAction.TAX_DOCS)
 *   openWhopAction(WhopAction.PAYMENT_METHODS)
 *
 * See SPRINT_FINAL_2026-07-07.md §5.7 · §1D · §1C.
 */
import { openInApp } from "./openInApp";
import { bus } from "../design-os/bridge";

/** Enum of Whop-owned action pages we expose in our UI. */
export enum WhopAction {
  WITHDRAW = "withdraw",
  WALLET_ADDRESSES = "wallet_addresses",
  PAYOUT_SETTINGS = "payout_settings",
  PAYMENT_METHODS = "payment_methods",
  TAX_DOCS = "tax_docs",
  BILLING_HISTORY = "billing_history",
  BOUNTY_CREATE = "bounty_create",
  MANAGE_MEMBERSHIP = "manage_membership",
  KYC_VERIFY = "kyc_verify",
}

export interface WhopActionOpts {
  /** For company-scoped actions (bounty create, payouts). */
  companyId?: string;
  /** Optional URL-encoded prefill dict for forms (e.g. bounty title/prize). */
  prefill?: Record<string, string | number>;
  /** Overrides the default tab title in the BrowseOverlay chrome. */
  title?: string;
}

/**
 * Build the Whop URL for the given action + open it in-app.
 *
 * Session survives from Gate 1 authorization so the user is already
 * signed in — every click is one-hop.
 */
export function openWhopAction(action: WhopAction, opts: WhopActionOpts = {}): void {
  const url = buildWhopActionUrl(action, opts);
  const title = opts.title ?? actionLabel(action);

  // Telemetry breadcrumb so we can trace conversion + reconcile against
  // the eventual webhook return.
  bus.emit("telemetry:whop-action", { action, url });

  void openInApp(url, { title, intent: "browse-campaign" });
}

function buildWhopActionUrl(action: WhopAction, opts: WhopActionOpts): string {
  const base = "https://whop.com";
  const q = (obj: Record<string, string | number>): string =>
    Object.entries(obj)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
  const prefillQs = opts.prefill && Object.keys(opts.prefill).length > 0
    ? `?${q(opts.prefill)}`
    : "";

  switch (action) {
    case WhopAction.WITHDRAW:
      return `${base}/@me/wallet${prefillQs}`;
    case WhopAction.WALLET_ADDRESSES:
      return `${base}/@me/wallet/addresses${prefillQs}`;
    case WhopAction.PAYOUT_SETTINGS:
      return `${base}/@me/settings/payout${prefillQs}`;
    case WhopAction.PAYMENT_METHODS:
      return `${base}/@me/settings/billing${prefillQs}`;
    case WhopAction.TAX_DOCS:
      return `${base}/@me/settings/tax${prefillQs}`;
    case WhopAction.BILLING_HISTORY:
      return `${base}/@me/settings/orders${prefillQs}`;
    case WhopAction.MANAGE_MEMBERSHIP:
      return `${base}/@me/settings/orders${prefillQs}`;
    case WhopAction.KYC_VERIFY:
      return `${base}/@me/settings/kyc${prefillQs}`;
    case WhopAction.BOUNTY_CREATE: {
      const cid = opts.companyId;
      if (!cid) {
        // Fail-loud in dev, graceful in prod — no company id means we
        // can't scope the bounty create; land the user on their dashboard.
        if (typeof console !== "undefined") {
          console.warn("[openWhopAction] BOUNTY_CREATE without companyId · defaulting to dashboard");
        }
        return `${base}/dashboard${prefillQs}`;
      }
      return `${base}/dashboard/${encodeURIComponent(cid)}/bounties/new${prefillQs}`;
    }
  }
}

function actionLabel(action: WhopAction): string {
  switch (action) {
    case WhopAction.WITHDRAW:            return "Withdraw · Whop";
    case WhopAction.WALLET_ADDRESSES:    return "Wallet addresses · Whop";
    case WhopAction.PAYOUT_SETTINGS:     return "Payout settings · Whop";
    case WhopAction.PAYMENT_METHODS:     return "Payment methods · Whop";
    case WhopAction.TAX_DOCS:            return "Tax documents · Whop";
    case WhopAction.BILLING_HISTORY:     return "Billing history · Whop";
    case WhopAction.MANAGE_MEMBERSHIP:   return "Manage membership · Whop";
    case WhopAction.KYC_VERIFY:          return "Identity verification · Whop";
    case WhopAction.BOUNTY_CREATE:       return "Post to Whop marketplace";
  }
}
