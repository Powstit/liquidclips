import type { WhopSubmission } from "../../lib/sidecar";

// Submitted / in-review submissions, with polling timestamp + auto-approve
// deadline countdown.

export function SubmittedList({
  items,
  lastChecked,
}: {
  items: WhopSubmission[];
  lastChecked: Date | null;
}) {
  if (items.length === 0) {
    return (
      <p className="font-mono text-[12px] text-text-tertiary">
        No submissions in review. Publish a clip from a bounty to fill this up.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        polled {lastChecked ? `${ago(lastChecked)} ago` : "never"} · auto-refresh every 10 min
      </p>
      {items.map((s) => (
        <article
          key={s.id}
          className="rounded-2xl border border-line bg-paper p-4 transition-colors hover:border-fuchsia/40"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {s.bounty?.title ?? "Bounty"}
              </h4>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                {s.status} {s.expiresAt ? ` · auto-approves in ${hoursUntil(s.expiresAt)}h` : ""}
              </p>
            </div>
            <div className="text-right">
              <div className="font-mono text-[11px] text-text-secondary">
                {s.bounty ? `${sym(s.bounty.currency)}${s.bounty.rewardPerUnitAmount.toFixed(2)} / 1k` : ""}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function sym(currency: string): string {
  if (currency === "GBP") return "£";
  if (currency === "USD") return "$";
  return "";
}

function ago(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function hoursUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 3600_000));
}
