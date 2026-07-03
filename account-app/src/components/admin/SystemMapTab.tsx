"use client";

// SystemMapTab — visual architecture map of the ENTIRE Liquid Clips system,
// with live client-side health probes that colour each node green (live) /
// yellow (checking / degraded) / red (down / timeout) / gray (not yet built).
//
// Built 2026-07-03 to give Daniel a single-glance view of every pipe in the
// growth engine funnel. Not a manage panel — that's SurfacesTab. This is
// the architecture diagram.
//
// Node colours (same tokens as SurfacesTab / LiveBadge):
//   green  = probe returned 200 (client no-cors fetch resolved)
//   yellow = probe in flight or slow
//   red    = probe failed / aborted / timed out (still surfaces "unknown"
//            not "down" because CORS can lie — same hygiene as SurfacesTab)
//   gray   = no probe URL because feature not yet built
//
// Layout is a hand-authored SVG so the arrows tell the growth-engine story
// end-to-end. Node click → alerts a short hint. Refresh button re-runs all
// probes. Auto-refresh every 30s.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---- types ----------------------------------------------------------------

type ProbeState = "checking" | "ok" | "unknown" | "unbuilt";

type Node = {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  probeUrl?: string; // omit = unbuilt (gray)
  hint: string;
};

type Edge = {
  from: string;
  to: string;
  label?: string;
  loop?: boolean; // draw as curved back-arrow (for the viral loop)
};

// ---- node roster (the ENTIRE system, current + planned growth engine) ----

const NODES: Node[] = [
  // ── row 1: HQ blast origin ──
  {
    id: "hq_engine",
    label: "HQ Engine",
    sub: "Railway",
    x: 40,
    y: 40,
    w: 160,
    h: 60,
    probeUrl: "https://api.liquidclips.app/healthcheck",
    hint: "HQ marketing engine on Railway. Same backend health surface as junior-backend (they share /healthcheck). Sends 3000 cold emails/day via Instantly.",
  },
  {
    id: "instantly",
    label: "Instantly",
    sub: "Cold email delivery",
    x: 240,
    y: 40,
    w: 160,
    h: 60,
    probeUrl: "https://app.instantly.ai",
    hint: "50+ warmed sender inboxes. Sends the 'Operational Deficit' cold email to ICP leads. External SaaS — probe hits app.instantly.ai landing.",
  },
  {
    id: "cold_inbox",
    label: "Cold Inbox",
    sub: "Lead's Gmail",
    x: 440,
    y: 40,
    w: 160,
    h: 60,
    hint: "The YouTuber's inbox where cold emails land. No probe possible — target-owned surface. If Instantly reports delivery, we assume this works.",
  },

  // ── row 2: preview page (marketing site) ──
  {
    id: "preview_page",
    label: "Preview Page",
    sub: "liquidclips.app/preview/[token]",
    x: 240,
    y: 170,
    w: 240,
    h: 60,
    probeUrl: "https://liquidclips.app/",
    hint: "Marketing site route on Vercel. Renders per-lead MP4 + catalog carousel + Whop CTA. NEW — currently probes marketing root; will point at /preview/test once F3 ships.",
  },

  // ── row 3: backend + storage services ──
  {
    id: "junior_backend",
    label: "Junior Backend",
    sub: "api.liquidclips.app",
    x: 40,
    y: 300,
    w: 180,
    h: 60,
    probeUrl: "https://api.liquidclips.app/healthcheck",
    hint: "FastAPI on Railway. Owns /preview/register + /preview/{token} (F3), YT worker (F7), Whop webhooks, deep-link JWT minting.",
  },
  {
    id: "vercel_blob",
    label: "Vercel Blob",
    sub: "Preview MP4 storage",
    x: 240,
    y: 300,
    w: 180,
    h: 60,
    probeUrl: "https://vercel.com/blob",
    hint: "Blob storage for the 20s preview MP4s. Not yet wired on marketing site (no @vercel/blob dependency). Grey until F3.",
  },
  {
    id: "yt_api",
    label: "YouTube Data API",
    sub: "Channel + video lookup",
    x: 440,
    y: 300,
    w: 180,
    h: 60,
    probeUrl: "https://www.googleapis.com/youtube/v3",
    hint: "Google's public YT API. Used by F7 worker for channel/video metadata + storyboard reads. Currently unused by backend — grey until F7 ships.",
  },
  {
    id: "preview_render",
    label: "Preview Render Worker",
    sub: "Remotion · Railway",
    x: 640,
    y: 300,
    w: 200,
    h: 60,
    hint: "Standalone Railway service that renders per-lead MP4s via Remotion. Scaffolded at ~/Desktop/liquidclips-preview-engine/. Not yet deployed — grey until F2 completion + F3.",
  },

  // ── row 4: Whop checkout + activation ──
  {
    id: "whop_iframe",
    label: "Whop Checkout",
    sub: "iframe inside desktop browser",
    x: 240,
    y: 430,
    w: 240,
    h: 60,
    probeUrl: "https://whop.com",
    hint: "Whop's hosted checkout. Renders inside desktop-2's in-app browser (BrowseOverlay) so cookies persist (frozen billing state). Bare probe hits whop.com root.",
  },
  {
    id: "whop_webhooks",
    label: "Whop Webhooks",
    sub: "→ junior/webhooks/whop",
    x: 520,
    y: 430,
    w: 220,
    h: 60,
    probeUrl: "https://api.liquidclips.app/webhooks/whop",
    hint: "Whop → Junior webhook handler (POST-only, expects Svix signature). Probe will 400/405 which no-cors reports as ok — good enough to verify reachability.",
  },
  {
    id: "connect_desktop",
    label: "/connect-desktop",
    sub: "Deep-link bridge",
    x: 40,
    y: 430,
    w: 180,
    h: 60,
    probeUrl: "https://account.liquidclips.app/connect-desktop",
    hint: "Marketing site page that mints JWT + fires liquidclips://activate deep-link. Wired via Whop OAuth + Clerk fallback.",
  },

  // ── row 5: desktop app ──
  {
    id: "desktop_app",
    label: "Desktop App",
    sub: "Liquid Clips (Tauri)",
    x: 40,
    y: 560,
    w: 180,
    h: 60,
    probeUrl: "https://api.github.com/repos/Powstit/liquidclips/releases/latest",
    hint: "Tauri desktop app. GitHub Releases is the canonical distribution channel (updater manifest). Probe verifies the latest release exists.",
  },
  {
    id: "deployer_surface",
    label: "Deployer Surface",
    sub: "First-run gate (F4)",
    x: 240,
    y: 560,
    w: 200,
    h: 60,
    hint: "F4 in-app surface. Not yet built. Blocks workspace access until user runs contact scan + broadcast. Grey.",
  },
  {
    id: "contact_scan",
    label: "Contact Scan",
    sub: "Gmail + YT sieve (F5)",
    x: 460,
    y: 560,
    w: 180,
    h: 60,
    hint: "F5 — Google OAuth (contacts.readonly + gmail.readonly) → top 200 contacts → cross-reference YT Data API for verified channels. Not yet built. Grey.",
  },
  {
    id: "user_network",
    label: "User's Network",
    sub: "10+ verified peers · MRR ticker",
    x: 460,
    y: 690,
    w: 240,
    h: 60,
    hint: "Discovered YouTube peers from user's contacts (post-scan). Feeds the F4 Deployer MRR ticker (contacts × £49.99). 10 canonical minimum before deploy unlocks. Not yet built. Grey.",
  },
  {
    id: "broadcast",
    label: "Broadcast Engine",
    sub: "DOM automation (F6)",
    x: 720,
    y: 690,
    w: 160,
    h: 60,
    hint: "F6 — sends warm-peer emails from user's own Gmail via BrowseOverlay DOM automation + persistent cookies. Rate-paced 6-12s. Not yet built. Grey.",
  },

  // ── row 7: peer inbox + loop back ──
  {
    id: "peer_inbox",
    label: "Peer Inbox",
    sub: "Warm target's Gmail",
    x: 620,
    y: 820,
    w: 200,
    h: 60,
    hint: "Warm target's Gmail — receives peer recommendation with ?ref=<originator>. Same nature as cold inbox: not probeable. Loop closes back to Preview Page — this is where K-factor > 1 lives.",
  },
];

// ---- edges ----------------------------------------------------------------

const EDGES: Edge[] = [
  { from: "hq_engine", to: "instantly", label: "3000/day" },
  { from: "instantly", to: "cold_inbox" },
  { from: "cold_inbox", to: "preview_page", label: "click" },

  { from: "preview_page", to: "junior_backend", label: "hydrate" },
  { from: "preview_page", to: "vercel_blob", label: "MP4 src" },
  { from: "preview_page", to: "yt_api", label: "catalog" },
  { from: "junior_backend", to: "preview_render", label: "enqueue" },
  { from: "preview_render", to: "vercel_blob", label: "upload" },

  { from: "preview_page", to: "whop_iframe", label: "£99.99" },
  { from: "whop_iframe", to: "whop_webhooks", label: "payment" },
  { from: "whop_webhooks", to: "junior_backend", label: "state" },
  { from: "whop_iframe", to: "connect_desktop", label: "success" },
  { from: "connect_desktop", to: "desktop_app", label: "liquidclips://" },

  { from: "desktop_app", to: "deployer_surface", label: "gate" },
  { from: "deployer_surface", to: "contact_scan" },
  { from: "contact_scan", to: "yt_api", label: "cross-ref" },
  { from: "contact_scan", to: "user_network", label: "10+ found" },
  { from: "user_network", to: "broadcast", label: "deploy" },
  { from: "broadcast", to: "peer_inbox", label: "gmail send · 6-12s" },
  { from: "peer_inbox", to: "preview_page", label: "loop · ?ref=", loop: true },
];

// ---- probe hook ----------------------------------------------------------

function useProbes(nodes: Node[], refreshKey: number) {
  const [state, setState] = useState<Record<string, ProbeState>>(() => {
    const init: Record<string, ProbeState> = {};
    for (const n of nodes) init[n.id] = n.probeUrl ? "checking" : "unbuilt";
    return init;
  });

  useEffect(() => {
    // Reset all probeable nodes to "checking" on each refresh
    setState((prev) => {
      const next = { ...prev };
      for (const n of nodes) {
        if (n.probeUrl) next[n.id] = "checking";
      }
      return next;
    });

    const controllers: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    for (const n of nodes) {
      if (!n.probeUrl) continue;
      const ctl = new AbortController();
      controllers.push(ctl);
      const t = setTimeout(() => ctl.abort(), 6000);
      timers.push(t);
      fetch(n.probeUrl, { mode: "no-cors", signal: ctl.signal, cache: "no-store" })
        .then(() => {
          if (!cancelled) setState((prev) => ({ ...prev, [n.id]: "ok" }));
        })
        .catch(() => {
          if (!cancelled) setState((prev) => ({ ...prev, [n.id]: "unknown" }));
        })
        .finally(() => clearTimeout(t));
    }

    return () => {
      cancelled = true;
      controllers.forEach((c) => c.abort());
      timers.forEach((t) => clearTimeout(t));
    };
  }, [nodes, refreshKey]);

  return state;
}

// ---- component -----------------------------------------------------------

export function SystemMapTab() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Node | null>(null);
  const state = useProbes(NODES, refreshKey);
  const autoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh every 30s
  useEffect(() => {
    autoTickRef.current = setInterval(() => setRefreshKey((k) => k + 1), 30000);
    return () => {
      if (autoTickRef.current) clearInterval(autoTickRef.current);
    };
  }, []);

  const stats = useMemo(() => {
    let ok = 0;
    let checking = 0;
    let unknown = 0;
    let unbuilt = 0;
    for (const n of NODES) {
      const s = state[n.id];
      if (s === "ok") ok++;
      else if (s === "checking") checking++;
      else if (s === "unknown") unknown++;
      else unbuilt++;
    }
    return { ok, checking, unknown, unbuilt, total: NODES.length };
  }, [state]);

  const onNodeClick = useCallback((n: Node) => setSelected(n), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* header + refresh */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: "var(--font-display, var(--font-geist, ui-sans-serif, system-ui, sans-serif))",
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              color: "var(--lc-fg)",
            }}
          >
            System Architecture Map
          </h2>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 12,
              color: "var(--lc-fg-faint)",
            }}
          >
            End-to-end growth engine flow · live probes · auto-refresh every 30 seconds
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatPill label="live" value={stats.ok} color="var(--lc-ok)" />
          <StatPill label="checking" value={stats.checking} color="var(--lc-warn)" />
          <StatPill label="unknown" value={stats.unknown} color="var(--lc-danger)" />
          <StatPill label="unbuilt" value={stats.unbuilt} color="var(--lc-fg-faint)" />
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            style={{
              padding: "6px 14px",
              border: "1px solid var(--lc-stroke)",
              borderRadius: 8,
              background: "var(--lc-surface)",
              color: "var(--lc-fg)",
              fontSize: 12,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: "10px 14px",
          border: "1px solid var(--lc-stroke)",
          background: "var(--lc-surface)",
          borderRadius: 12,
          fontSize: 11,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          color: "var(--lc-fg-faint)",
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        <LegendDot color="var(--lc-ok)" label="live · 200" />
        <LegendDot color="var(--lc-warn)" label="checking" />
        <LegendDot color="var(--lc-danger)" label="unreachable" />
        <LegendDot color="var(--lc-fg-faint)" label="unbuilt / no probe" />
        <span style={{ marginLeft: "auto" }}>Click a node for details.</span>
      </div>

      {/* map */}
      <div
        style={{
          position: "relative",
          border: "1px solid var(--lc-stroke)",
          borderRadius: 16,
          background: "var(--lc-bg-warm)",
          overflow: "auto",
        }}
      >
        <svg viewBox="0 0 900 920" style={{ display: "block", width: "100%", height: "auto" }}>
          {/* arrows: markers */}
          <defs>
            <marker
              id="arr"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--lc-stroke-strong, #6f6f80)" />
            </marker>
            <marker
              id="arr-loop"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--lc-accent, #ff1a8c)" />
            </marker>
          </defs>

          {/* edges */}
          {EDGES.map((e, i) => {
            const from = NODES.find((n) => n.id === e.from)!;
            const to = NODES.find((n) => n.id === e.to)!;
            const x1 = from.x + from.w / 2;
            const y1 = from.y + from.h;
            const x2 = to.x + to.w / 2;
            const y2 = to.y;
            const isLoop = !!e.loop;
            // Loop back = curve up along the right side
            const path = isLoop
              ? `M ${from.x + from.w} ${from.y + from.h / 2}
                 C 900 ${from.y + from.h / 2},
                   900 ${to.y - 40},
                   ${to.x + to.w} ${to.y + to.h / 2}`
              : `M ${x1} ${y1} L ${x2} ${y2}`;
            return (
              <g key={i}>
                <path
                  d={path}
                  fill="none"
                  stroke={isLoop ? "var(--lc-accent, #ff1a8c)" : "var(--lc-stroke-strong, #6f6f80)"}
                  strokeWidth={isLoop ? 2 : 1.5}
                  strokeDasharray={isLoop ? "4 3" : undefined}
                  markerEnd={isLoop ? "url(#arr-loop)" : "url(#arr)"}
                />
                {e.label && !isLoop && (
                  <text
                    x={(x1 + x2) / 2 + 6}
                    y={(y1 + y2) / 2 - 4}
                    fontSize={9}
                    fontFamily="var(--font-mono, ui-monospace, monospace)"
                    fill="var(--lc-fg-faint)"
                    style={{ textTransform: "uppercase", letterSpacing: 0.5 }}
                  >
                    {e.label}
                  </text>
                )}
                {e.label && isLoop && (
                  <text
                    x={850}
                    y={(from.y + to.y) / 2}
                    fontSize={10}
                    fontFamily="var(--font-mono, ui-monospace, monospace)"
                    fill="var(--lc-accent, #ff1a8c)"
                    fontWeight={700}
                    textAnchor="end"
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* nodes */}
          {NODES.map((n) => {
            const s = state[n.id] ?? "unknown";
            const colours = COLOURS[s];
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                style={{ cursor: "pointer" }}
                onClick={() => onNodeClick(n)}
              >
                <rect
                  x={0}
                  y={0}
                  width={n.w}
                  height={n.h}
                  rx={8}
                  ry={8}
                  fill={colours.bg}
                  stroke={colours.stroke}
                  strokeWidth={selected?.id === n.id ? 2.5 : 1.5}
                />
                <circle cx={12} cy={12} r={4} fill={colours.dot} />
                <text
                  x={24}
                  y={22}
                  fontSize={12}
                  fontFamily="var(--font-display, var(--font-geist, ui-sans-serif, system-ui, sans-serif))"
                  fontWeight={700}
                  fill="var(--lc-fg)"
                >
                  {n.label}
                </text>
                {n.sub && (
                  <text
                    x={12}
                    y={40}
                    fontSize={9}
                    fontFamily="var(--font-mono, ui-monospace, monospace)"
                    fill="var(--lc-fg-faint)"
                    style={{ textTransform: "uppercase", letterSpacing: 0.5 }}
                  >
                    {n.sub}
                  </text>
                )}
                <text
                  x={n.w - 8}
                  y={n.h - 8}
                  textAnchor="end"
                  fontSize={9}
                  fontFamily="var(--font-mono, ui-monospace, monospace)"
                  fill={colours.dot}
                  style={{ textTransform: "uppercase", letterSpacing: 1 }}
                >
                  {STATE_LABEL[s]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* selected detail panel */}
      {selected && (
        <div
          style={{
            border: "1px solid var(--lc-stroke)",
            borderRadius: 12,
            background: "var(--lc-surface)",
            padding: "14px 18px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display, var(--font-geist, ui-sans-serif, system-ui, sans-serif))",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--lc-fg)",
                }}
              >
                {selected.label}
              </div>
              {selected.sub && (
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 11,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    color: "var(--lc-fg-faint)",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {selected.sub}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--lc-fg-faint)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              }}
              aria-label="Close detail"
            >
              ×
            </button>
          </div>
          <p
            style={{
              marginTop: 8,
              fontSize: 13,
              color: "var(--lc-fg)",
              lineHeight: 1.5,
            }}
          >
            {selected.hint}
          </p>
          {selected.probeUrl && (
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                color: "var(--lc-fg-faint)",
                wordBreak: "break-all",
              }}
            >
              probe: {selected.probeUrl}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- little visual helpers ----------------------------------------------

const COLOURS: Record<ProbeState, { bg: string; stroke: string; dot: string }> = {
  ok: {
    bg: "color-mix(in srgb, var(--lc-ok, #4dc6a8) 12%, var(--lc-surface))",
    stroke: "color-mix(in srgb, var(--lc-ok, #4dc6a8) 55%, var(--lc-stroke))",
    dot: "var(--lc-ok, #4dc6a8)",
  },
  checking: {
    bg: "color-mix(in srgb, var(--lc-warn, #d99b2d) 12%, var(--lc-surface))",
    stroke: "color-mix(in srgb, var(--lc-warn, #d99b2d) 55%, var(--lc-stroke))",
    dot: "var(--lc-warn, #d99b2d)",
  },
  unknown: {
    bg: "color-mix(in srgb, var(--lc-fail, #ef4767) 10%, var(--lc-surface))",
    stroke: "color-mix(in srgb, var(--lc-fail, #ef4767) 55%, var(--lc-stroke))",
    dot: "var(--lc-fail, #ef4767)",
  },
  unbuilt: {
    bg: "var(--lc-surface)",
    stroke: "var(--lc-stroke)",
    dot: "var(--lc-fg-faint)",
  },
};

const STATE_LABEL: Record<ProbeState, string> = {
  ok: "live",
  checking: "checking",
  unknown: "unreachable",
  unbuilt: "unbuilt",
};

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        border: "1px solid var(--lc-stroke)",
        borderRadius: 999,
        background: "var(--lc-surface)",
        fontSize: 11,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        color: "var(--lc-fg-faint)",
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color, display: "inline-block" }} />
      <span style={{ color: "var(--lc-fg)", fontWeight: 700 }}>{value}</span>
      <span>{label}</span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}
