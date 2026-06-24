/**
 * WhopBoundaryCard · UI-3
 *
 * Reusable 2-column "Liquid Clips handles · Whop handles" boundary card.
 * Mounted inside the Submit-to-Whop modal, the Agency Submissions Review
 * right rail, and (optionally) Settings.
 *
 * Pure copy + tokens — no new visual language.
 */

import "./WhopBoundaryCard.css";

const LC_OWNS = [
  "Source ingest + clip cuts",
  "Captions / trim / style / cockpit edits",
  "Branding + watermark",
  "Render + schedule + post handoff",
];

const WHOP_OWNS = [
  "Reward rules + payout amount",
  "Submission review (when delegated)",
  "Payment processing",
  "Receipts + dispute resolution",
];

export interface WhopBoundaryCardProps {
  /** "compact" trims the heading and drops to a single column at narrow
   *  widths; "full" is the default surface treatment. */
  variant?: "full" | "compact";
}

export function WhopBoundaryCard({ variant = "full" }: WhopBoundaryCardProps) {
  return (
    <aside className={`lc-wbc lc-wbc-${variant}`} aria-label="Whop / Liquid Clips boundary">
      {variant === "full" && (
        <header className="lc-wbc-head">
          <span className="lc-wbc-eb">Where the work happens</span>
          <span className="lc-wbc-sub">Liquid Clips prepares the submission. Whop handles approval and payout.</span>
        </header>
      )}

      <div className="lc-wbc-grid">
        <section className="lc-wbc-col lc-wbc-col-lc">
          <span className="lc-wbc-col-eb">Liquid Clips handles</span>
          <ul className="lc-wbc-list">
            {LC_OWNS.map((line) => (
              <li key={line}><span className="lc-wbc-tick" aria-hidden="true">●</span>{line}</li>
            ))}
          </ul>
        </section>

        <section className="lc-wbc-col lc-wbc-col-whop">
          <span className="lc-wbc-col-eb">Whop handles</span>
          <ul className="lc-wbc-list">
            {WHOP_OWNS.map((line) => (
              <li key={line}><span className="lc-wbc-tick" aria-hidden="true">●</span>{line}</li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
