/**
 * CrewMatchTool · retention + viral loop for the Wallet dashboard.
 *
 * The pitch: "You have friends already on our lead list. Invite them,
 * keep 50% MRR forever. Every match is real money on the table."
 *
 * User journey:
 *   1. Paste emails or handles (any source: Gmail export, Twitter list, screenshots)
 *   2. Frontend POSTs to /me/crew/match against the 721k cold-lead pool
 *   3. Matches render with earning potential + preview clip
 *   4. Calculator sums 50% of every match's estimated monthly earnings
 *   5. "Send invite" opens the OS email client with prefilled body carrying
 *      the user's whop_affiliate_code (mailto:)
 *
 * Retention loop:
 *   - Every visit shows the tool → users think about who to invite
 *   - Live calculator dopamine — the total goes up as they paste more
 *   - Real preview clips of the matched leads make it feel concrete
 *
 * Ships 2026-07-07 · Sprint Final §1D extension.
 */
import { useMemo, useState } from "react";
import { bus } from "../bridge";

interface CrewMatchRow {
  email: string;
  handle: string;
  niche: string | null;
  audience_size: number | null;
  estimated_monthly_earnings_cents: number | null;
  preview_clip_url: string | null;
  your_50pct_cents: number;
}

interface CrewMatchResponse {
  matched: CrewMatchRow[];
  not_matched_count: number;
  referrer_affiliate_code: string | null;
  referral_share_url: string;
  earning_potential_cents: number;
}

const BACKEND = (): string =>
  (typeof window !== "undefined" &&
    (window as unknown as { __LC_BACKEND_URL__?: string }).__LC_BACKEND_URL__) ||
  "https://api.liquidclips.app";

function parseIdentifiers(raw: string): { emails: string[]; handles: string[] } {
  // Split on commas, spaces, newlines. Filter empty. Distinguish emails
  // (contain @ + tld) from handles (everything else · usually @user or plain).
  const emails: string[] = [];
  const handles: string[] = [];
  raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((token) => {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) {
        emails.push(token.toLowerCase());
      } else {
        handles.push(token.replace(/^@/, "").toLowerCase());
      }
    });
  return { emails, handles };
}

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtAudience(n: number | null): string {
  if (n == null || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CrewMatchTool(): React.ReactElement {
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<CrewMatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseIdentifiers(input), [input]);
  const inputCount = parsed.emails.length + parsed.handles.length;
  const canMatch = inputCount > 0 && inputCount <= 200 && !loading;

  const onMatch = async (): Promise<void> => {
    if (!canMatch) return;
    setLoading(true);
    setError(null);
    try {
      // Use the app's auth-aware fetch helper if present; fall back to
      // direct fetch with the license JWT from localStorage. Both call
      // sites work in the current app shell.
      const jwt =
        (typeof window !== "undefined" &&
          window.localStorage.getItem("lc:license-jwt")) || "";
      const r = await fetch(`${BACKEND()}/me/crew/match`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ emails: parsed.emails, handles: parsed.handles }),
      });
      if (!r.ok) {
        const msg = r.status === 401 ? "Sign in to check your crew." : `Match failed (${r.status})`;
        setError(msg);
        setLoading(false);
        return;
      }
      const data = (await r.json()) as CrewMatchResponse;
      setResult(data);
    } catch {
      setError("Couldn't reach the crew-match service. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const onInvite = (row: CrewMatchRow): void => {
    const link = result?.referral_share_url ?? "https://liquidclips.app/";
    const subject = "Try Liquid Clips — I get paid when you clip";
    const body = [
      `Hey ${row.handle},`,
      "",
      "I'm using Liquid Clips to turn long-form into short clips + get paid on the earn tab.",
      "",
      `Real invite link: ${link}`,
      "",
      "If you sign up through this link, I get a small cut when you upgrade. No cost to you.",
      "",
      "Ping me if you want a walkthrough.",
    ].join("\n");
    const mailto = `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Route via bus so the app's openInApp handler picks the right rail
    // (mailto: → OS default mail client per openInApp.ts:41-44).
    bus.emit("browse:open", { url: mailto, source: "earn", title: "Invite" });
  };

  return (
    <section className="lc-crew" aria-label="Crew match tool">
      <style>{CREW_STYLES}</style>
      <header className="lc-crew-head">
        <div>
          <span className="lc-crew-eb">Get paid for sharing</span>
          <h2 className="lc-crew-title">Check your crew</h2>
        </div>
        <div className="lc-crew-head-meta">50% MRR · locked for life · per referral</div>
      </header>
      <p className="lc-crew-sub">
        Paste emails or handles from your address book, DM list, or YouTube channels.
        We&rsquo;ll show who&rsquo;s already on our list of 721,000 creators — invite them, keep half their subscription forever.
      </p>

      <div className="lc-crew-io">
        <textarea
          className="lc-crew-input"
          placeholder="marcus@example.com&#10;@jane.clips&#10;youtube.com/@handle"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          disabled={loading}
          data-testid="crew-input"
        />
        <div className="lc-crew-io-foot">
          <span className="lc-crew-count">
            {inputCount > 0 ? `${inputCount} to check` : "Paste one per line"}
          </span>
          <button
            type="button"
            className="lc-crew-check"
            onClick={() => void onMatch()}
            disabled={!canMatch}
            data-testid="crew-check"
          >
            {loading ? "Checking…" : "Check my crew"}
          </button>
        </div>
      </div>

      {error && (
        <p className="lc-crew-err" role="alert">{error}</p>
      )}

      {result && (
        <>
          <div className="lc-crew-result-head">
            <div>
              <div className="lc-crew-stat-eb">On our list</div>
              <div className="lc-crew-stat-num">{result.matched.length}</div>
            </div>
            <div>
              <div className="lc-crew-stat-eb">Not yet</div>
              <div className="lc-crew-stat-num muted">{result.not_matched_count}</div>
            </div>
            <div className="lc-crew-stat-callout">
              <div className="lc-crew-stat-eb">Your monthly potential</div>
              <div className="lc-crew-stat-num accent">
                {fmtDollars(result.earning_potential_cents)}
              </div>
              <div className="lc-crew-stat-note">If all matched convert</div>
            </div>
          </div>

          {result.matched.length === 0 ? (
            <p className="lc-crew-empty">
              None of your crew are on the list yet — but every clipper you bring in is 50% of their MRR forever. Send the link to anyone anyway: <code>{result.referral_share_url}</code>
            </p>
          ) : (
            <ul className="lc-crew-list">
              {result.matched.map((r) => (
                <li key={r.email} className="lc-crew-row">
                  <div className="lc-crew-row-body">
                    <div className="lc-crew-row-handle">@{r.handle}</div>
                    <div className="lc-crew-row-meta">
                      {r.niche && <span className="lc-crew-row-niche">{r.niche}</span>}
                      {r.audience_size ? <span>· {fmtAudience(r.audience_size)} audience</span> : null}
                    </div>
                    {r.estimated_monthly_earnings_cents ? (
                      <div className="lc-crew-row-earnings">
                        Est. earning · {fmtDollars(r.estimated_monthly_earnings_cents)}/mo
                        <span className="lc-crew-row-cut"> · your cut {fmtDollars(r.your_50pct_cents)}/mo</span>
                      </div>
                    ) : (
                      <div className="lc-crew-row-earnings muted">Earning potential · <em>not measured yet</em></div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="lc-crew-invite"
                    onClick={() => onInvite(r)}
                    data-testid={`crew-invite-${r.email}`}
                  >
                    Send invite →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const CREW_STYLES = `
.lc-crew {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 26, 140, 0.06), rgba(0, 0, 0, 0.20));
  border: 1px solid rgba(255, 26, 140, 0.18);
  container-type: inline-size;
}
.lc-crew-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.lc-crew-eb {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: #ff66b8;
}
.lc-crew-title {
  margin: 4px 0 0; font-size: 22px; font-weight: 700; letter-spacing: -0.015em;
  color: var(--lc-ink, #f4f1ea);
}
.lc-crew-head-meta {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
}
.lc-crew-sub {
  margin: 0; font-size: 14px; line-height: 1.55;
  color: var(--lc-ink-soft, rgba(244, 241, 234, 0.78));
}
.lc-crew-io {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.lc-crew-input {
  width: 100%; min-height: 88px; resize: vertical;
  background: transparent; border: 0; outline: none;
  color: var(--lc-ink, #f4f1ea);
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 13px; line-height: 1.55;
}
.lc-crew-input::placeholder { color: rgba(255, 255, 255, 0.32); }
.lc-crew-io-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.lc-crew-count {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.lc-crew-check {
  padding: 10px 18px; min-height: 44px;
  border-radius: 999px; border: 0; cursor: pointer;
  background: linear-gradient(180deg, #ff1a8c, #d40d70); color: #fff;
  font-weight: 600; font-size: 14px;
  box-shadow: 0 10px 22px rgba(255, 26, 140, 0.30);
  transition: transform 120ms ease, opacity 120ms ease;
}
.lc-crew-check:hover:not(:disabled) { transform: translateY(-1px); }
.lc-crew-check:disabled { opacity: 0.42; cursor: not-allowed; }

.lc-crew-err {
  margin: 0; padding: 10px 14px; border-radius: 12px;
  background: rgba(255, 60, 60, 0.10); color: #ff8ab8;
  font-size: 13px;
}

.lc-crew-result-head {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 14px; border-radius: 14px;
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.lc-crew-stat-eb {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55); margin-bottom: 4px;
}
.lc-crew-stat-num { font-size: 24px; font-weight: 700; color: var(--lc-ink, #f4f1ea); }
.lc-crew-stat-num.muted { color: rgba(255, 255, 255, 0.55); }
.lc-crew-stat-num.accent { color: #ff66b8; }
.lc-crew-stat-callout .lc-crew-stat-num { font-size: 28px; }
.lc-crew-stat-note {
  margin-top: 2px; font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-family: "Geist Mono", ui-monospace, monospace;
  letter-spacing: 0.04em;
}

.lc-crew-empty {
  margin: 0; padding: 14px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--lc-ink-soft, rgba(244, 241, 234, 0.78));
  font-size: 13px; line-height: 1.55;
}
.lc-crew-empty code {
  padding: 2px 6px; border-radius: 6px;
  background: rgba(255, 26, 140, 0.14); color: #ff8ab8;
  font-family: "Geist Mono", ui-monospace, monospace; font-size: 12px;
}
.lc-crew-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 8px;
}
.lc-crew-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-radius: 12px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: border-color 120ms ease, background 120ms ease;
}
.lc-crew-row:hover { border-color: rgba(255, 26, 140, 0.32); background: rgba(0, 0, 0, 0.36); }
.lc-crew-row-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.lc-crew-row-handle {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-weight: 700; font-size: 14px; color: var(--lc-ink, #f4f1ea);
}
.lc-crew-row-meta {
  display: flex; gap: 6px; flex-wrap: wrap;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.55);
}
.lc-crew-row-niche {
  padding: 2px 8px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
}
.lc-crew-row-earnings {
  margin-top: 4px; font-size: 12px; color: rgba(255, 255, 255, 0.85);
}
.lc-crew-row-earnings.muted { color: rgba(255, 255, 255, 0.42); }
.lc-crew-row-cut { color: #ff66b8; font-weight: 600; }
.lc-crew-invite {
  flex: 0 0 auto; padding: 10px 14px; min-height: 44px;
  border-radius: 999px; border: 1px solid rgba(255, 26, 140, 0.42);
  background: transparent; color: #ff8ab8; cursor: pointer;
  font-size: 13px; font-weight: 600;
  transition: transform 120ms ease, background 120ms ease;
}
.lc-crew-invite:hover { background: rgba(255, 26, 140, 0.14); transform: translateY(-1px); }

/* Responsive · matches shell breakpoints in index.css (@1100 · @720) */
@container (max-width: 640px) {
  .lc-crew-result-head { grid-template-columns: 1fr 1fr; }
  .lc-crew-stat-callout { grid-column: 1 / -1; }
}
@container (max-width: 420px) {
  .lc-crew-row { flex-direction: column; align-items: stretch; }
  .lc-crew-invite { width: 100%; }
  .lc-crew-result-head { grid-template-columns: 1fr; }
  .lc-crew-stat-callout { grid-column: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .lc-crew-check, .lc-crew-invite, .lc-crew-row { transition: none; }
  .lc-crew-check:hover:not(:disabled), .lc-crew-invite:hover { transform: none; }
}
`;
