/**
 * ReferralPipelineTile · closes the loop the CrewMatchTool opens.
 *
 * Shows: invites sent → activated → earning-from → monthly earnings.
 * Refreshes on every crew:invite-sent bus event so the number updates
 * live as users send invites without a full page reload.
 *
 * Ships 2026-07-07 · Sprint Final §1D (crew retention amplifier).
 */
import { useCallback, useEffect, useState } from "react";
import { useEvent } from "../bridge";

interface PipelineData {
  invites_sent: number;
  activated_count: number;
  earning_count: number;
  monthly_earnings_cents: number;
  total_earned_cents: number;
  next_milestone: string;
}

const BACKEND = (): string =>
  (typeof window !== "undefined" &&
    (window as unknown as { __LC_BACKEND_URL__?: string }).__LC_BACKEND_URL__) ||
  "https://api.liquidclips.app";

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

async function fetchPipeline(): Promise<PipelineData | null> {
  try {
    const jwt =
      (typeof window !== "undefined" &&
        window.localStorage.getItem("lc:license-jwt")) || "";
    const r = await fetch(`${BACKEND()}/me/crew/pipeline`, {
      headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
    });
    if (!r.ok) return null;
    return (await r.json()) as PipelineData;
  } catch {
    return null;
  }
}

export function ReferralPipelineTile(): React.ReactElement | null {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const d = await fetchPipeline();
    setData(d);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEvent("crew:invite-sent", () => {
    void load();
  });

  // Don't render at all if the user has no pipeline yet AND the fetch
  // failed (JWT missing / offline). Silent empty is honest — no fake
  // "0 invites sent" for guests who haven't authorized.
  if (!loaded || !data) return null;

  // Also hide the tile if user has literally zero activity yet — the
  // CrewMatchTool below already prompts them to send their first invite.
  if (data.invites_sent === 0 && data.earning_count === 0) return null;

  return (
    <section className="lc-referrals" aria-label="Referral pipeline">
      <style>{REFERRAL_STYLES}</style>
      <header className="lc-referrals-head">
        <div>
          <span className="lc-referrals-eb">Your affiliate rail</span>
          <h2 className="lc-referrals-title">
            {fmtDollars(data.monthly_earnings_cents)}/mo passive
          </h2>
        </div>
        <div className="lc-referrals-milestone">{data.next_milestone}</div>
      </header>

      <div className="lc-referrals-grid">
        <div className="lc-referrals-cell">
          <div className="lc-referrals-cell-eb">Sent</div>
          <div className="lc-referrals-cell-num">{data.invites_sent}</div>
        </div>
        <div className="lc-referrals-cell">
          <div className="lc-referrals-cell-eb">Activated</div>
          <div className="lc-referrals-cell-num">{data.activated_count}</div>
        </div>
        <div className="lc-referrals-cell lc-referrals-cell--accent">
          <div className="lc-referrals-cell-eb">Paying</div>
          <div className="lc-referrals-cell-num">{data.earning_count}</div>
        </div>
        <div className="lc-referrals-cell">
          <div className="lc-referrals-cell-eb">Lifetime</div>
          <div className="lc-referrals-cell-num">
            {fmtDollars(data.total_earned_cents)}
          </div>
        </div>
      </div>

      {data.invites_sent > 0 && (
        <div
          className="lc-referrals-progress"
          role="progressbar"
          aria-valuenow={data.earning_count}
          aria-valuemin={0}
          aria-valuemax={Math.max(20, data.earning_count)}
          aria-label="Progress to top-affiliate tier"
        >
          <div
            className="lc-referrals-progress-fill"
            style={{
              width: `${Math.min(100, (data.earning_count / 20) * 100)}%`,
            }}
          />
        </div>
      )}
    </section>
  );
}

const REFERRAL_STYLES = `
.lc-referrals {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 26, 140, 0.14), rgba(255, 26, 140, 0.02));
  border: 1px solid rgba(255, 26, 140, 0.28);
  container-type: inline-size;
}
.lc-referrals-head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.lc-referrals-eb {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: #ff66b8;
}
.lc-referrals-title {
  margin: 4px 0 0;
  font-size: 28px; font-weight: 700; letter-spacing: -0.02em;
  color: var(--lc-ink, #f4f1ea);
}
.lc-referrals-milestone {
  max-width: 320px;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 12px; line-height: 1.5;
  color: rgba(255, 255, 255, 0.62);
  text-align: right;
}
.lc-referrals-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.lc-referrals-cell {
  padding: 12px 14px; border-radius: 12px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.lc-referrals-cell--accent {
  background: linear-gradient(180deg, rgba(255, 26, 140, 0.22), rgba(255, 26, 140, 0.06));
  border-color: rgba(255, 26, 140, 0.38);
}
.lc-referrals-cell-eb {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55); margin-bottom: 4px;
}
.lc-referrals-cell-num {
  font-size: 22px; font-weight: 700;
  color: var(--lc-ink, #f4f1ea);
}
.lc-referrals-cell--accent .lc-referrals-cell-num { color: #ff66b8; }

.lc-referrals-progress {
  height: 6px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.lc-referrals-progress-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #ff1a8c, #ff8fca);
  transition: width 320ms cubic-bezier(0.4, 0, 0.2, 1);
}

@container (max-width: 640px) {
  .lc-referrals-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lc-referrals-milestone { text-align: left; max-width: none; }
}
@container (max-width: 420px) {
  .lc-referrals-grid { grid-template-columns: 1fr 1fr; }
  .lc-referrals-title { font-size: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .lc-referrals-progress-fill { transition: none; }
}
`;
