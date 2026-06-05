import type { WhopSubmission } from "../../lib/sidecar";

// Approved + denied submissions, with an earnings tally at the top. This is
// the dashboard surface that should make the user feel good — money earned,
// money close to being earned.

export function ApprovedList({ items }: { items: WhopSubmission[] }) {
  const approved = items.filter((i) => i.status === "approved");
  const denied = items.filter((i) => i.status === "denied");
  // Approximate total from formatted payout amounts ("£42.50" → 42.50)
  const total = approved.reduce((sum, s) => {
    if (!s.formattedPayoutAmount) return sum;
    const numeric = parseFloat(s.formattedPayoutAmount.replace(/[^\d.]/g, ""));
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  const sym = approved[0]?.formattedPayoutAmount?.[0] || "£";

  // Cockpit pass: the headline total wears the bracket frame; rows below
  // drop their plates and become hairline-separated list lines so the
  // wall stays calm.
  return (
    <div className="flex flex-col gap-3">
      <div className="earn-frame relative flex items-center justify-between px-5 py-4">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia">
            approved this month
          </div>
          <div className="mt-1 font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">
            {sym}{total.toFixed(2)}
          </div>
        </div>
        <div className="text-right font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary">
          {approved.length} approved · {denied.length} denied
          <br />
          Whop pays directly into your account
        </div>
      </div>

      <div className="flex flex-col">
        {approved.map((s) => (
          <article
            key={s.id}
            className="flex items-center justify-between border-b border-line/40 bg-transparent py-3 last:border-b-0"
          >
            <div>
              <h4 className="font-display text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {s.bounty?.title ?? "Reward"}
              </h4>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                approved · {s.verifiedVotesCount} verified votes
              </p>
            </div>
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {s.formattedPayoutAmount ?? "—"}
            </span>
          </article>
        ))}
      </div>

      {denied.length > 0 && (
        <div className="flex flex-col">
          <h3 className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
            denied
          </h3>
          {denied.map((s) => (
            <article
              key={s.id}
              className="border-b border-line/30 bg-transparent py-3 opacity-70 last:border-b-0"
            >
              <h4 className="font-display text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {s.bounty?.title ?? "Reward"}
              </h4>
              {s.denialReason && (
                <p className="mt-1 font-mono text-[11px] text-[#DC2626]">
                  {s.denialReason}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
