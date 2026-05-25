// PostHog for partner-app. Observability only — payout truth lives in the
// backend DB. Same privacy posture as account-app: no email, no tokens,
// no Whop access tokens.
//
// Project key (NEXT_PUBLIC_POSTHOG_KEY) only — never a personal API key.

"use client";

import posthog, { type PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let inited = false;

export function initAnalytics(): PostHog | null {
  if (typeof window === "undefined") return null;
  if (!KEY) return null;
  if (inited) return posthog;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
    // Match account-app posture: strip ?ref / ?a / query / hash from the
    // automatic $current_url so an affiliate slug doesn't ride along as
    // PII on default page events.
    sanitize_properties: (props) => {
      if (props && typeof props.$current_url === "string") {
        try {
          const u = new URL(props.$current_url);
          props.$current_url = `${u.origin}${u.pathname}`;
        } catch {
          /* leave as-is */
        }
      }
      return props;
    },
  });
  inited = true;
  return posthog;
}

// Referral URLs are built with ?ref=<affiliate_id> (per buildReferralUrl in
// partner-app/src/app/page.tsx). The brand-first marketing redirect later
// converts ?ref to ?a for Whop's tracker. Either shape can show up depending
// on which URL the user copies/shares, so we accept both.
export function referralIdFromUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.searchParams.get("ref") ?? u.searchParams.get("a") ?? undefined;
  } catch {
    return undefined;
  }
}

export function track(event: PartnerEvent, properties?: Record<string, unknown>): void {
  if (!inited) initAnalytics();
  if (!inited) return;
  posthog.capture(event, sanitize(properties));
}

const FORBIDDEN_KEYS = new Set([
  "email", "user_email", "primary_email",
  "token", "access_token", "id_token", "jwt",
  "api_key", "secret", "password",
]);

function sanitize(props?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

export type PartnerEvent =
  | "partner_dashboard_viewed"
  | "affiliate_link_copied"
  | "affiliate_link_shared"
  | "affiliate_qr_downloaded"          // QR code saved/downloaded
  | "affiliate_checkout_link_viewed"   // referral URL rendered on dashboard (non-empty)
  | "qr_downloaded";                   // legacy alias — kept so existing events don't break
