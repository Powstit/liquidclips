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
  });
  inited = true;
  return posthog;
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
  | "qr_downloaded";
