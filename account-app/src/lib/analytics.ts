// PostHog — observability only. Backend DB is the source of truth for
// attribution; these events tell us where the funnel breaks, not who gets paid.
//
// Privacy rules (reviewer spec):
//   - Identify with internal IDs only: clerk_id / affiliate_id / whop_user_id
//   - NEVER send: raw email, access tokens, license JWTs, local paths,
//     video filenames, transcripts, Whop access tokens
//
// Project key (NEXT_PUBLIC_POSTHOG_KEY) is public-safe by design. The
// secret-style "personal API key" PostHog also offers is NOT used here — we
// only need event capture.

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
    capture_pageview: false, // We send our own page events with stable names
    capture_pageleave: true,
    persistence: "localStorage+cookie",
    // Default would send `$current_url` with raw URLs. Strip query strings on
    // marketing pages so an affiliate code (?a=…) doesn't ride along as PII.
    sanitize_properties: (props) => {
      if (props && typeof props.$current_url === "string") {
        try {
          const u = new URL(props.$current_url);
          // Keep host + path; drop search + hash (search may contain ?a=, ?ref=, etc.)
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

export type IdentifyContext = {
  clerk_id: string;
  affiliate_id?: string | null;
  tier?: string;
  whop_user_id?: string | null;
  // No email. No name. No platform handles.
};

export function identifyUser(ctx: IdentifyContext): void {
  if (!inited) return;
  posthog.identify(ctx.clerk_id, {
    // Only the IDs and tier. Email is intentionally absent.
    affiliate_id: ctx.affiliate_id ?? undefined,
    tier: ctx.tier ?? undefined,
    whop_user_id: ctx.whop_user_id ?? undefined,
  });
}

export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!inited) return;
  posthog.capture(event, sanitize(properties));
}

export function resetAnalytics(): void {
  if (!inited) return;
  posthog.reset();
}

// --- safe property filter -----------------------------------------------
// Defence-in-depth: even though every call site is meant to send only
// allowed properties, we strip anything that looks like PII or a secret
// before it leaves the browser.

const FORBIDDEN_KEYS = new Set([
  "email", "user_email", "primary_email",
  "token", "access_token", "id_token", "jwt", "license_jwt",
  "api_key", "secret", "password",
  "path", "filename", "transcript", "source_filename", "source_path",
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

// --- the closed event vocabulary ---------------------------------------
// One enum for the whole app — adding a new event = adding to this union.
// PostHog dashboards reference these names verbatim.

export type AnalyticsEvent =
  // Affiliate funnel (marketing surface in this app for now)
  | "affiliate_landing_viewed"
  | "affiliate_ref_captured"
  // Top-of-funnel: a referred visitor reached the app (ref cookie/param seen),
  // fired once per session before they reach the signup form. Distinct from
  // affiliate_ref_captured (which fires on the signup surface itself).
  | "affiliate_link_clicked"
  // Signup → activated
  | "signup_started"
  | "signup_completed"
  | "dashboard_viewed"
  | "desktop_download_clicked"
  // Billing
  | "checkout_started"
  | "upgrade_viewed"
  // Connections
  | "whop_connect_clicked"
  | "connection_added";
