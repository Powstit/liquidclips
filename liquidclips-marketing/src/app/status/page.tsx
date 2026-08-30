"use client";

/**
 * /status · public status page.
 *
 * Polls `/api/status` (server-side proxy that hits junior-backend
 * /healthcheck) every 30s. Renders an overall pill + per-subsystem
 * chips + last-checked timestamp. Deflects "the app is broken" support
 * rage into "we can see it; here's what's affected."
 *
 * Client-side polling only — no server-render of stale state that
 * would look outdated on first paint. Initial "checking…" state is
 * <200ms because the api route is edge-cached.
 *
 * Linked from:
 *   - Chrome footer (added in the same commit).
 *   - KadeRepairScreen in the desktop app (crash-repair screen) —
 *     so users landing on a crash see a real "here's the live status"
 *     link instead of blaming the whole product.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { supportEmail } from "@/lib/site";
import { PageShell } from "@/components/Chrome";

type SubsystemStatus = "operational" | "degraded" | "down" | "unknown";

interface StatusSubsystem {
  key: string;
  label: string;
  status: SubsystemStatus;
  note?: string | null;
}

interface StatusPayload {
  overall: SubsystemStatus;
  subsystems: StatusSubsystem[];
  checked_at_iso: string;
  backend_url: string;
}

const POLL_MS = 30_000;

const STATUS_COPY: Record<SubsystemStatus, { label: string; color: string; dot: string }> = {
  operational: { label: "Operational",  color: "#0f7c3f", dot: "#22c55e" },
  degraded:    { label: "Degraded",     color: "#8a5a00", dot: "#f59e0b" },
  down:        { label: "Down",         color: "#991b1b", dot: "#ef4444" },
  unknown:     { label: "Checking…",    color: "#666",    dot: "#94a3b8" },
};

export default function StatusPage() {
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchOnce = async (): Promise<void> => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) {
          setError(`Status endpoint returned ${r.status}. The app may still be operational — this page couldn't verify.`);
          return;
        }
        const data = (await r.json()) as StatusPayload;
        if (cancelled) return;
        setPayload(data);
        setLastFetchedAt(new Date());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to reach the status endpoint.");
      }
    };

    void fetchOnce();
    const id = window.setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const overall = payload?.overall ?? "unknown";
  const overallCopy = STATUS_COPY[overall];

  return (
    <PageShell>
      <main className="legal-page">
        <div className="container" style={{ maxWidth: 720 }}>
          <div className="eyebrow">Status</div>
          <h1 className="page-title">Liquid Clips status</h1>
          <p className="page-lede">
            Real-time health of the Liquid Clips backend + integrations. Polls
            every 30 seconds. This page reflects the LIVE state — if it says
            operational and you still see a bug in the desktop app, please email{" "}
            <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> with the
            diagnostic id from the Kade repair screen.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "18px 22px",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.08)",
              background: "rgba(0,0,0,0.02)",
              margin: "20px 0 24px",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: overallCopy.dot,
                boxShadow: `0 0 0 4px ${overallCopy.dot}22`,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 18,
                  color: overallCopy.color,
                  lineHeight: 1.2,
                }}
              >
                {overall === "operational"
                  ? "All systems operational"
                  : overall === "degraded"
                    ? "Partial degradation"
                    : overall === "down"
                      ? "Active outage"
                      : "Checking status…"}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {lastFetchedAt
                  ? `Last checked ${lastFetchedAt.toLocaleTimeString()} · next check in ≤${Math.round(POLL_MS / 1000)}s`
                  : "First check in progress…"}
              </div>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: "12px 16px",
                border: "1px solid rgba(239,68,68,0.4)",
                background: "rgba(239,68,68,0.08)",
                borderRadius: 10,
                color: "#991b1b",
                fontSize: 13,
                margin: "0 0 20px",
              }}
            >
              {error}
            </div>
          )}

          <article className="prose">
            <h2>Subsystems</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 10,
                margin: "12px 0 32px",
              }}
            >
              {(payload?.subsystems ?? [
                { key: "backend", label: "Backend API", status: "unknown" as SubsystemStatus },
              ]).map((sub) => {
                const copy = STATUS_COPY[sub.status];
                return (
                  <div
                    key={sub.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 16px",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "white",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: copy.dot,
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{sub.label}</span>
                        {sub.note && (
                          <span style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                            {sub.note}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: copy.color,
                      }}
                    >
                      {copy.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <h2>What each status means</h2>
            <ul>
              <li>
                <strong>Operational</strong> — subsystem is responding within
                normal latency. All features work.
              </li>
              <li>
                <strong>Degraded</strong> — subsystem is up but slow, or a
                secondary component (like webhook signing) is misconfigured.
                Most features work; some may feel sluggish.
              </li>
              <li>
                <strong>Down</strong> — subsystem is not responding. Features
                that depend on it are paused; others keep working. The Liquid
                Clips desktop app degrades gracefully — you can keep editing
                clips locally even if the backend is out.
              </li>
              <li>
                <strong>Checking / Unknown</strong> — this page couldn't verify
                state (backend unreachable from status probes). Try again in
                30 seconds.
              </li>
            </ul>

            <h2>When something's down</h2>
            <ol>
              <li>
                <strong>Your local work is safe.</strong> Clips already on disk
                aren't touched. Drafts stay drafted.
              </li>
              <li>
                <strong>Sign-in + submissions</strong> depend on the backend.
                Those pause during a backend outage.
              </li>
              <li>
                <strong>Your Whop earnings</strong> are held by Whop, not us.
                An outage here does not affect payouts already queued.
              </li>
              <li>
                <strong>We're on it.</strong> Every outage triggers an alert to
                the founder. You don't need to email us to report it — but if
                you do, mention the exact time and any diagnostic id from the
                Kade repair screen.
              </li>
            </ol>

            <p className="footnote">
              Prefer another channel? Email{" "}
              <Link href={`mailto:${supportEmail}?subject=Liquid%20Clips%20status`}>{supportEmail}</Link>{" "}
              or ping Telegram{" "}
              <Link href="https://t.me/liquidclips_support" target="_blank" rel="noreferrer noopener">
                @liquidclips_support
              </Link>
              . Related pages: <Link href="/help">Help centre</Link>,{" "}
              <Link href="/support">Support</Link>.
            </p>
          </article>
        </div>
      </main>
    </PageShell>
  );
}
