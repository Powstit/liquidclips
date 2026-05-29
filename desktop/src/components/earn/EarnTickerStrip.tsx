// Earn ticker — 60px top strip. Four money tiles inline, no card chrome.
// First thing the user sees, last thing they look back at when they wonder
// "how much did I make today?"
//
// Tiles:
//   PAID     — sum of submissions in `paid` status
//   PENDING  — sum of submissions in posted/submitted/approved (in flight)
//   VIEWS    — total views across tracked submissions
//   SUBS     — count of tracked submissions overall
//
// Each number counts up on mount via useCountUp. The `?` button on the
// right opens the EarnHowItWorks popover (collapsed from the big block in
// the old layout).

import { useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  countByStatus,
  totalActualPayout,
  totalViews,
  useSubmissions,
} from "../../lib/submissions";
import { useCountUp } from "../../lib/useCountUp";
import { EarnHowItWorksPopover } from "./EarnHowItWorks";

export function EarnTickerStrip() {
  const { submissions } = useSubmissions();
  const [helpOpen, setHelpOpen] = useState(false);

  const paidNumber = useMemo(() => totalActualPayout(submissions), [submissions]);
  const counts = useMemo(() => countByStatus(submissions), [submissions]);
  const pendingNumber = useMemo(() => {
    // estimated payout total for in-flight submissions — anything posted,
    // submitted, or approved but not yet paid.
    let sum = 0;
    for (const s of submissions) {
      if (s.status === "paid" || s.status === "draft" || s.status === "rejected") continue;
      const m = (s.estimated_payout || "").match(/-?\d+(\.\d+)?/);
      if (m) sum += parseFloat(m[0]);
    }
    return sum;
  }, [submissions]);
  const viewsNumber = useMemo(() => totalViews(submissions), [submissions]);
  const subsNumber = submissions.length;

  const paid = useCountUp(paidNumber, { prefix: "$", decimals: 2 });
  const pending = useCountUp(pendingNumber, { prefix: "$", decimals: 2 });
  const views = useCountUp(viewsNumber);
  const subs = useCountUp(subsNumber);

  const inFlight = counts.posted + counts.submitted + counts.approved;

  return (
    <div className="flex h-[60px] items-center gap-5 px-5">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        earn
      </span>
      <div className="flex flex-1 items-center gap-6">
        <Tile label="paid" value={paid} tone="success" />
        <Tile label="pending" value={pending} tone="fuchsia" pulse={inFlight > 0} />
        <Tile label="views" value={views} />
        <Tile label="clips" value={subs} />
      </div>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        title="How earning works"
        aria-label="How earning works"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-fuchsia"
      >
        <HelpCircle size={14} />
      </button>
      {helpOpen && <EarnHowItWorksPopover onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  pulse,
}: {
  label: string;
  value: string;
  tone?: "success" | "fuchsia";
  pulse?: boolean;
}) {
  const valueColor =
    tone === "success"
      ? "text-[#34D399]"
      : tone === "fuchsia"
        ? "text-fuchsia-deep"
        : "text-ink";
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
      </span>
      <span
        className={`font-display text-[18px] font-semibold tracking-[-0.01em] ${valueColor} ${
          pulse ? "pulse-dot" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
