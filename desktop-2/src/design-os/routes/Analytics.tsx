/**
 * AnalyticsRoute · UX-4 · honest stub
 *
 * Surface promises what's coming after Batch D without inventing numbers.
 *
 * 2026-06-23 monetisation pass · Daniel's commitment-point principle:
 *   "Agency features should not disappear completely below Agency. Show
 *    locked previews where useful. Especially Campaign Create and
 *    Analytics. The user should understand what Agency unlocks even
 *    before upgrading."
 *
 * Previously: clipper users got redirected to /home on mount — the
 * Analytics route was a dead screen below Agency.
 * Now: every tier RENDERS the analytics preview; below Agency the
 * surface is wrapped in PaywallGate(mode="overlay") so the locked-state
 * upgrade card sits on top. Real per-clip rollups stay Agency-gated
 * (TIER_CAPS.agency.analyticsAccess === "rollups").
 */

import { useCallback, useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { presets } from "../motion";
import { ROUTE_HERO } from "../copy/copyMap";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { PaywallGate } from "../../components/paywall/PaywallGate";
import { authedFetch } from "../../lib/authedFetch";
import "./Analytics.css";

// 2026-07-20 · YouTube channel scan · calls the junior-backend
// /me/youtube-scan proxy which hits YouTube Data API v3 server-side
// (API key stays on Railway, never in the desktop bundle).
interface YtScanResult {
  channel: {
    id: string;
    title: string;
    custom_url: string | null;
    description: string;
    thumbnail: string | null;
    subscribers: number;
    total_views: number;
    video_count: number;
  };
  videos: Array<{
    id: string;
    title: string;
    published_at: string;
    thumbnail: string | null;
    views: number;
    likes: number;
    comments: number;
    duration: string;
  }>;
  fetched_at: string;
}

function fmtInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLACEHOLDERS = [
  { label: "Total views",         value: "—", sub: "Across every clip" },
  { label: "Avg clip score",      value: "—", sub: "Out of 100" },
  { label: "Top performing clip", value: "—", sub: "Best of the week" },
  { label: "Reach by platform",   value: "—", sub: "TikTok · YT · IG · X" },
];

const CHECKLIST = [
  "Per-campaign views, RPM, and clipper rank",
  "Top clips by score, retention, shareability",
  "Channel-level performance breakdown",
];

function YouTubeScanPanel() {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<YtScanResult | null>(null);

  const runScan = useCallback(async () => {
    const q = handle.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await authedFetch(`/me/youtube-scan?handle=${encodeURIComponent(q)}&max_videos=20`);
      if (!r.ok) {
        let msg = `Scan failed (${r.status})`;
        try { const b = await r.json(); msg = b.detail ?? msg; } catch { /* body empty */ }
        throw new Error(msg);
      }
      const data = (await r.json()) as YtScanResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [handle]);

  return (
    <section
      className="lc-yt-scan"
      data-testid="youtube-scan"
      style={{
        margin: "24px 0",
        padding: "18px 20px",
        border: "1px solid rgba(255, 26, 140, 0.24)",
        borderRadius: 16,
        background: "rgba(20, 12, 26, 0.5)",
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(244,241,234,0.55)" }}>
          YouTube channel scan
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#f4f1ea", marginTop: 4 }}>
          Any channel · subs, views, recent uploads
        </div>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runScan(); }}
          placeholder="@handle or https://youtube.com/@handle"
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(11,11,16,0.7)",
            color: "#f4f1ea",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        />
        <button
          type="button"
          onClick={runScan}
          disabled={loading || !handle.trim()}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: 0,
            background: loading ? "rgba(255,26,140,0.3)" : "#ff1a8c",
            color: "#0a0a10",
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {loading ? "Scanning…" : "Scan"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(220,38,38,0.12)", color: "#ff6b6b", fontSize: 12 }}>
          {error}
        </div>
      )}

      {result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {result.channel.thumbnail && (
              <img src={result.channel.thumbnail} alt="" width={48} height={48} style={{ borderRadius: 12 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{result.channel.title}</div>
              <div style={{ fontSize: 11, color: "rgba(244,241,234,0.6)", marginTop: 2 }}>
                {result.channel.custom_url ?? result.channel.id}
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, fontSize: 11 }}>
              <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtInt(result.channel.subscribers)}</div><div style={{ color: "rgba(244,241,234,0.55)" }}>subs</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtInt(result.channel.total_views)}</div><div style={{ color: "rgba(244,241,234,0.55)" }}>views</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 700 }}>{fmtInt(result.channel.video_count)}</div><div style={{ color: "rgba(244,241,234,0.55)" }}>videos</div></div>
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {result.videos.map((v) => (
              <a
                key={v.id}
                href={`https://www.youtube.com/watch?v=${v.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                {v.thumbnail && (
                  <img src={v.thumbnail} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 8 }} />
                )}
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {v.title}
                </div>
                <div style={{ fontSize: 10, color: "rgba(244,241,234,0.55)", marginTop: 4, display: "flex", gap: 10 }}>
                  <span>{fmtInt(v.views)} views</span>
                  <span>{fmtInt(v.likes)} likes</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function AnalyticsRoute() {
  const hero = ROUTE_HERO["analytics"];
  const spec = ROUTE_REGISTRY["analytics"];

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="analytics"
      defaultKade={spec.defaultKade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage lc-an-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>{hero.eyebrow}</fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>{hero.h1}</fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>{hero.sub}</fm.p>
        </fm.div>

        {/* Below Agency: the preview renders + PaywallGate overlay sits
            on top with "Agency required" copy. Above Agency: gate passes
            through and the user sees the live (still placeholder)
            analytics surface. */}
        <PaywallGate requiredTier="agency" action="View per-clip rollups" mode="overlay">
          <section className="lc-an-stub" data-testid="analytics-stub" data-state="coming-soon">
            <header className="lc-an-stub-head">
              <span className="lc-an-stub-eb">Example metrics</span>
              <span className="lc-an-stub-sub" data-testid="analytics-coming-soon-copy">Numbers stay quiet until Batch D wires real data.</span>
            </header>

            <div className="lc-an-grid" data-testid="analytics-grid">
              {/* Ship-lens Batch 2 (Demo-data purge · 2026-07-06) · em-dash
               *  values got announced as "em dash" 4x by screen readers.
               *  C1-BATCH2-T2 hardening (2026-07-06) · lift the aria-label
               *  from the value span onto the <article> so each card reads
               *  as ONE intelligible sentence ("Total views: no data yet.
               *  Across every clip.") instead of piecemeal per-span. Inner
               *  spans go aria-hidden so AT doesn't hear the label / value
               *  / sub separately. Visual layout untouched. */}
              {PLACEHOLDERS.map((m) => {
                const isPlaceholder = m.value === "—";
                const spokenValue = isPlaceholder ? "no data yet" : m.value;
                return (
                  <article
                    key={m.label}
                    className="lc-an-card"
                    aria-disabled="true"
                    aria-label={`${m.label}: ${spokenValue}. ${m.sub}.`}
                    data-analytics-card={m.label}
                  >
                    <span className="lc-an-card-eb" aria-hidden="true">{m.label}</span>
                    <span
                      className="lc-an-card-val"
                      data-testid={`analytics-card-value-${m.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      aria-hidden="true"
                    >
                      {m.value}
                    </span>
                    <span className="lc-an-card-sub" aria-hidden="true">{m.sub}</span>
                  </article>
                );
              })}
            </div>

            <YouTubeScanPanel />

            <aside className="lc-an-checklist">
              <span className="lc-an-checklist-eb">Launch checklist · what we'll wire</span>
              <ul>
                {CHECKLIST.map((line) => (
                  <li key={line}><span className="lc-an-tick" aria-hidden="true">○</span>{line}</li>
                ))}
              </ul>
            </aside>
          </section>
        </PaywallGate>
      </fm.div>
    </DesignOSAppShell>
  );
}
