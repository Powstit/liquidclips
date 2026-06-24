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

type ProbeState = "checking" | "ok" | "unknown";

type Surface = {
  id: string;
  name: string;
  url: string;
  probeUrl: string;
  description: string;
  manage: { label: string; href: string }[];
};

const SURFACES: Surface[] = [
  {
    id: "marketing",
    name: "Marketing site",
    url: "https://liquidclips.app",
    probeUrl: "https://liquidclips.app/",
    description: "Public landing · pricing · /founding · /agencies · /clippers funnel pages.",
    manage: [
      { label: "Vercel deploys", href: "https://vercel.com/liquidclips/liquidclips-marketing" },
      { label: "GitHub source", href: "https://github.com/Powstit/liquidclips/tree/main/liquidclips-marketing" },
      { label: "PostHog analytics", href: "https://eu.posthog.com" },
    ],
  },
  {
    id: "account",
    name: "Account + HQ (this app)",
    url: "https://account.liquidclips.app",
    probeUrl: "https://account.liquidclips.app/",
    description: "Sign-in · billing · embed surfaces · admin HQ.",
    manage: [
      { label: "Vercel deploys", href: "https://vercel.com/liquidclips/account-app" },
      { label: "GitHub source", href: "https://github.com/Powstit/liquidclips/tree/main/account-app" },
      { label: "Clerk dashboard", href: "https://dashboard.clerk.com" },
    ],
  },
  {
    id: "backend",
    name: "Backend (junior-backend)",
    url: "https://api.liquidclips.app",
    probeUrl: "https://api.liquidclips.app/healthcheck",
    description: "FastAPI · Railway · webhooks · Ayrshare proxy · Whop carrot rail.",
    manage: [
      { label: "Railway deploys", href: "https://railway.com/project" },
      { label: "GitHub source", href: "https://github.com/Powstit/liquidclips/tree/main/junior-backend" },
      { label: "Sentry errors", href: "https://sentry.io" },
    ],
  },
  {
    id: "desktop",
    name: "Desktop app (Liquid Clips)",
    url: "https://github.com/Powstit/liquidclips/releases",
    probeUrl: "https://api.github.com/repos/Powstit/liquidclips/releases/latest",
    description: "Tauri + Python sidecar · macOS notarised · Windows code-signed.",
    manage: [
      { label: "GitHub releases", href: "https://github.com/Powstit/liquidclips/releases" },
      { label: "GitHub Actions (CI)", href: "https://github.com/Powstit/liquidclips/actions" },
      { label: "Apple Developer", href: "https://developer.apple.com/account" },
    ],
  },
  {
    id: "whop",
    name: "Whop (payments + community)",
    url: "https://whop.com",
    probeUrl: "",
    description: "Sub-merchant rail · sponsored rewards · affiliate checkout · chat agents.",
    manage: [
      { label: "Whop dashboard", href: "https://whop.com/dashboard" },
      { label: "Whop API docs", href: "https://docs.whop.com" },
    ],
  },
  {
    id: "credentials",
    name: "Credentials + secrets",
    url: "",
    probeUrl: "",
    description: "API keys · webhook secrets · OAuth credentials.",
    manage: [
      { label: "1Password — Liquid Clips vault", href: "https://my.1password.com" },
      { label: "Vercel env vars", href: "https://vercel.com/liquidclips" },
      { label: "Railway env vars", href: "https://railway.com/project" },
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
      ? { label: "reachable", color: "var(--lc-ok)", bg: "rgba(77, 198, 168, 0.10)", border: "rgba(77, 198, 168, 0.42)" }
      : state === "checking"
        ? { label: "checking", color: "var(--lc-warn)", bg: "rgba(217, 155, 45, 0.10)", border: "rgba(217, 155, 45, 0.42)" }
        : { label: "unknown", color: "var(--lc-fg-faint)", bg: "color-mix(in srgb, var(--lc-bg-warm) 70%, transparent)", border: "var(--lc-stroke)" };

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
            <a
              href={surface.url}
              target="_blank"
              rel="noopener noreferrer"
              className="lc-body"
              style={{ fontSize: 12, color: "var(--lc-accent-mid)", textDecoration: "none", wordBreak: "break-all" }}
            >
              {surface.url} ↗
            </a>
          )}
        </div>
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
      </div>
      <p className="lc-body" style={{ fontSize: 13, color: "var(--lc-fg-muted)", margin: 0 }}>
        {surface.description}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {surface.manage.map((m) => (
          <a
            key={m.href}
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
          </h2>
          <p className="lc-body" style={{ fontSize: 13, color: "var(--lc-fg-muted)", margin: "4px 0 0" }}>
            Live reachability check + jump-to-manage for marketing, account, backend, desktop, Whop, and credentials.
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
