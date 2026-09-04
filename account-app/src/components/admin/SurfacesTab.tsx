"use client";

// SurfacesTab — single-pane view of every page/surface Liquid Clips runs,
// with live health probe + jump-to-manage links (Vercel, Railway, GitHub,
// PostHog, Whop, Clerk, 1Password). Built 2026-06-24 so Daniel can manage
// marketing + account + backend + desktop from HQ instead of bouncing
// between five dashboards.
//
// Design rules:
//   - Health probe is a client-side HEAD/GET fetch with no-cors so a public
//     URL can be checked without exposing credentials. Failure modes are
//     shown as "unknown" not "down" — same hygiene as the rest of HQ.
//   - "Manage" links open in a new tab. No iframes (CSP would break them).
//   - This tab does NOT mutate anything. It's an index + monitor.

import { useEffect, useState } from "react";

import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";
import { InfoIcon } from "./_lib/InfoIcon";

type ProbeState = "checking" | "ok" | "unknown";

type Surface = {
  id: string;
  name: string;
  url: string;
  probeUrl: string;
  description: string;
  /** Hint about what the URL itself represents. */
  urlHint?: string;
  manage: { label: string; href: string; hint: string }[];
};

const SURFACES: Surface[] = [
  {
    id: "marketing",
    name: "Marketing site",
    url: "https://liquidclips.app",
    probeUrl: "https://liquidclips.app/",
    urlHint: "Public marketing root — Next.js on Vercel. Manual `vercel deploy --prod` from liquidclips-marketing/. Not auto-deployed on git push.",
    description: "Public landing · pricing · /founding · /agencies · /clippers funnel pages.",
    manage: [
      { label: "Vercel deploys", href: "https://vercel.com/danieldiyepriye-gmailcoms-projects/liquidclips-marketing", hint: "Trigger redeploy, manage env vars, see build logs + production aliasing for liquidclips.app. Vercel team is `danieldiyepriye-gmailcoms-projects`." },
      { label: "GitHub source", href: "https://github.com/Powstit/liquidclips/tree/main/liquidclips-marketing", hint: "Source code for the marketing site. Edit copy, components, OG images here." },
      { label: "PostHog analytics", href: "https://eu.posthog.com", hint: "Funnel + event analytics for marketing pages (signup conversion, page views). EU region instance." },
    ],
  },
  {
    id: "account",
    name: "Account + HQ (this app)",
    url: "https://account.liquidclips.app",
    probeUrl: "https://account.liquidclips.app/",
    urlHint: "Account/HQ root — this Next.js app on Vercel. Manual `vercel deploy --prod` from account-app/. Hosts sign-in, billing, embeds, and HQ.",
    description: "Sign-in · billing · embed surfaces · admin HQ.",
    manage: [
      { label: "Vercel deploys", href: "https://vercel.com/danieldiyepriye-gmailcoms-projects/account", hint: "Trigger redeploy, manage env vars, see build logs + production aliasing for account.liquidclips.app. Vercel project name is `account` (team danieldiyepriye-gmailcoms-projects) — NOT `liquidclips/account-app`." },
      { label: "GitHub source", href: "https://github.com/Powstit/liquidclips/tree/main/account-app", hint: "Source code for this app. Edit auth, billing, HQ tabs here." },
      { label: "Clerk dashboard", href: "https://dashboard.clerk.com", hint: "Manage users, sessions, JUNIOR_ADMIN_EMAILS allowlist, billing add-on packs, OAuth providers." },
      { label: "Sentry errors", href: "https://liquidclips.sentry.io/issues/?project=4511540778106880&query=is%3Aunresolved&statsPeriod=14d", hint: "Frontend + server error tracking for account-app (Sentry org `liquidclips`, project 4511540778106880). Runtime capture is always on via SENTRY_DSN; SENTRY_AUTH_TOKEN only makes stack traces readable (build-time source-map upload)." },
    ],
  },
  {
    id: "backend",
    name: "Backend (junior-backend)",
    url: "https://api.jnremployee.com",
    probeUrl: "https://api.jnremployee.com/healthcheck",
    urlHint: "FastAPI backend root — api.jnremployee.com is canonical (api.liquidclips.app is the old/stale alias). Custom domain in front of junior-backend-production.up.railway.app. /healthcheck returns liveness + ayrshare_configured.",
    description: "FastAPI · Railway · webhooks · Ayrshare proxy · Whop carrot rail.",
    manage: [
      { label: "Railway deploys", href: "https://railway.com/project", hint: "Manage backend deploys, env vars (WHOP_API_KEY, JUNIOR_ADMIN_EMAILS, STRIPE_SECRET_KEY, etc), DB connection, replica count." },
      { label: "GitHub source", href: "https://github.com/Powstit/liquidclips/tree/main/junior-backend", hint: "Source code for the FastAPI backend. Routes, models, webhooks, Ayrshare client live here." },
      { label: "Sentry errors", href: "https://liquidclips.sentry.io/issues/?query=is%3Aunresolved&statsPeriod=14d", hint: "Server-side error tracking for the FastAPI process (Sentry org `liquidclips`). Capture is gated on SENTRY_DSN in Railway env — it's set, so events flow. Python needs no source-map token. Pick the backend project in the project dropdown once open." },
    ],
  },
  {
    id: "desktop",
    name: "Desktop app (Liquid Clips)",
    url: "https://github.com/Powstit/liquidclips/releases",
    probeUrl: "https://api.github.com/repos/Powstit/liquidclips/releases/latest",
    urlHint: "GitHub Releases page — canonical distribution channel for signed/notarised DMGs + Windows installers. Tauri updater pulls from here.",
    description: "Tauri + Python sidecar · macOS notarised · Windows code-signed.",
    manage: [
      { label: "GitHub releases", href: "https://github.com/Powstit/liquidclips/releases", hint: "Latest signed builds (DMG / MSI). Tauri auto-updater consumes the updater manifest here." },
      { label: "GitHub Actions (CI)", href: "https://github.com/Powstit/liquidclips/actions", hint: "Tag-triggered build pipeline. Notarises macOS, signs Windows, publishes to Releases. Triggered by desktop/scripts/ship.sh." },
      { label: "Apple Developer", href: "https://developer.apple.com/account", hint: "Manage Apple Developer ID cert + notarisation credentials (used by CI as encrypted secrets)." },
      { label: "Sentry errors", href: "https://liquidclips.sentry.io/issues/?query=is%3Aunresolved&statsPeriod=14d", hint: "Crash + error tracking for the desktop app (Sentry org `liquidclips`). Gated on VITE_SENTRY_DSN at build time. Filter to the LIQUID-CLIPS-DESKTOP project in the project dropdown once open." },
    ],
  },
  {
    id: "whop",
    name: "Whop (payments + community)",
    url: "https://whop.com",
    probeUrl: "",
    urlHint: "Third-party platform — no internal probe (cross-origin). Whop owns the sub-merchant payments rail, community, agents, and affiliate checkout.",
    description: "Sub-merchant rail · sponsored rewards · affiliate checkout · chat agents.",
    manage: [
      { label: "Whop dashboard", href: "https://whop.com/dashboard", hint: "Manage Whop store, pricing plans, discount codes, sub-merchant config, community channels, agent fleet keys." },
      { label: "Whop API docs", href: "https://docs.whop.com", hint: "API reference for Whop endpoints — needed when extending the /whop/* proxy in junior-backend." },
    ],
  },
  {
    id: "credentials",
    name: "Credentials + secrets",
    url: "",
    probeUrl: "",
    urlHint: "No public URL — credentials live in 1Password + Vercel env vars + Railway env vars. Mirror to ~/.claude-credentials/ on the dev machine.",
    description: "API keys · webhook secrets · OAuth credentials.",
    manage: [
      { label: "1Password — Liquid Clips vault", href: "https://my.1password.com", hint: "Canonical secret store. Every rotation lands here first, then propagates to Vercel + Railway + ~/.claude-credentials/." },
      { label: "Vercel env vars", href: "https://vercel.com/danieldiyepriye-gmailcoms-projects", hint: "Per-project env vars (`account` + `liquidclips-marketing`, team danieldiyepriye-gmailcoms-projects). Rotate Clerk + Stripe public keys, and SENTRY_AUTH_TOKEN, here." },
      { label: "Railway env vars", href: "https://railway.com/project", hint: "Backend env vars (JUNIOR_ADMIN_EMAILS, WHOP_API_KEY, STRIPE_SECRET_KEY, AYRSHARE_API_KEY, agent API keys). Rotation forces a redeploy." },
    ],
  },
];

function SurfaceCard({
  surface,
  onProbe,
}: {
  surface: Surface;
  onProbe: (id: string, status: "ok" | "fail" | "skip") => void;
}) {
  const [state, setState] = useState<ProbeState>(surface.probeUrl ? "checking" : "unknown");

  useEffect(() => {
    if (!surface.probeUrl) {
      onProbe(surface.id, "skip");
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    fetch(surface.probeUrl, { mode: "no-cors", signal: ctl.signal, cache: "no-store" })
      .then(() => {
        if (!cancelled) {
          setState("ok");
          onProbe(surface.id, "ok");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState("unknown");
          onProbe(surface.id, "fail");
        }
      })
      .finally(() => clearTimeout(t));
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [surface.probeUrl, surface.id, onProbe]);

  const badge =
    state === "ok"
      ? { label: "reachable", color: "var(--lc-ok)", bg: "rgba(77, 198, 168, 0.10)", border: "rgba(77, 198, 168, 0.42)", hint: "Client-side no-cors HEAD/GET succeeded within 6s. Confirms the URL is publicly reachable (not that it's healthy)." }
      : state === "checking"
        ? { label: "checking", color: "var(--lc-warn)", bg: "rgba(217, 155, 45, 0.10)", border: "rgba(217, 155, 45, 0.42)", hint: "Probe in flight — waiting up to 6s for the no-cors fetch to resolve." }
        : { label: "unknown", color: "var(--lc-fg-faint)", bg: "color-mix(in srgb, var(--lc-bg-warm) 70%, transparent)", border: "var(--lc-stroke)", hint: "No probe URL OR the no-cors fetch failed / timed out. Doesn't necessarily mean the surface is down — could be CORS/network on the browser side." };

  return (
    <div
      style={{
        border: "1px solid var(--lc-stroke)",
        background: "var(--lc-surface)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="lc-display" style={{ fontSize: 16, fontWeight: 600, color: "var(--lc-fg)" }}>
            {surface.name}
          </div>
          {surface.url && (
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              <a
                href={surface.url}
                target="_blank"
                rel="noopener noreferrer"
                className="lc-body"
                style={{ fontSize: 12, color: "var(--lc-accent-mid)", textDecoration: "none", wordBreak: "break-all" }}
              >
                {surface.url} ↗
              </a>
              {surface.urlHint && <InfoIcon hint={surface.urlHint} />}
            </span>
          )}
        </div>
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: badge.color,
              background: badge.bg,
              border: `1px solid ${badge.border}`,
              whiteSpace: "nowrap",
            }}
          >
            {badge.label}
          </span>
          <InfoIcon hint={badge.hint} />
        </span>
      </div>
      <p className="lc-body" style={{ fontSize: 13, color: "var(--lc-fg-muted)", margin: 0 }}>
        {surface.description}
        <InfoIcon hint="Hand-curated one-liner describing what this surface owns. Lives in the SURFACES array of this file — edit there, not in a CMS." />
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4, alignItems: "center" }}>
        {surface.manage.map((m) => (
          <span key={m.href} style={{ display: "inline-flex", alignItems: "center" }}>
            <a
              href={m.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--lc-stroke)",
                color: "var(--lc-fg)",
                textDecoration: "none",
                background: "transparent",
                transition: "background 120ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--lc-accent-soft) 60%, transparent)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {m.label} →
            </a>
            <InfoIcon hint={m.hint} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function SurfacesTab() {
  const src = useDataSource();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 className="lc-display" style={{ fontSize: 20, fontWeight: 600, color: "var(--lc-fg)", margin: 0 }}>
            Every page Liquid Clips runs
            <InfoIcon hint="Single-pane index of every surface (marketing, account, backend, desktop, Whop, credentials). Read-only — manage links jump to the owning dashboard." />
          </h2>
          <p className="lc-body" style={{ fontSize: 13, color: "var(--lc-fg-muted)", margin: "4px 0 0" }}>
            Live reachability check + jump-to-manage for marketing, account, backend, desktop, Whop, and credentials.
            <InfoIcon hint="Each card runs a client-side no-cors probe in parallel — green = HTTP responded within 6s; unknown = no probe URL OR timed out / browser blocked." />
          </p>
        </div>
        <LiveBadge state={src.state} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: 14,
        }}
      >
        {SURFACES.map((s) => (
          <SurfaceCard key={s.id} surface={s} onProbe={src.report} />
        ))}
      </div>
    </div>
  );
}
