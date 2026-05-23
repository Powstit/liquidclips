import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import {
  allowedPlatforms,
  approvalRisk,
  effortFor,
  fitScore,
  formatPayout,
  type ConnectedPlatform,
} from "./types";

// One bounty card in the Earn / Available list. Answers the three questions
// at a glance: Can I earn? Can I finish fast? Will it get approved?

export function BountyCard({
  bounty,
  connectedPlatforms,
  onOpen,
  onStart,
}: {
  bounty: WhopBounty;
  connectedPlatforms: ConnectedPlatform[];
  onOpen: () => void;
  onStart: () => void;
}) {
  const platforms = allowedPlatforms(bounty);
  const fit = fitScore(bounty, connectedPlatforms);
  const effort = effortFor(bounty);
  const risk = approvalRisk(bounty);

  return (
    <article className="rounded-2xl border border-line bg-paper p-5 shadow-[0_2px_12px_rgba(15,15,18,0.04)] transition-all hover:border-fuchsia/40 hover:shadow-[0_8px_28px_rgba(15,15,18,0.08)]">
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="font-display text-[15px] font-semibold text-ink">
          {formatPayout(bounty)}
        </span>
        <span>·</span>
        <span>
          <span className="text-ink">{bounty.spotsRemaining}</span> of {bounty.acceptedSubmissionsLimit} spots left
        </span>
        <span>·</span>
        <span className="flex items-center gap-1.5">
          {platforms.map((p) => (
            <PlatformIcon key={p} id={p} className="h-3.5 w-3.5 text-ink" />
          ))}
        </span>
      </div>

      <h3 className="mt-3 font-display text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink">
        {bounty.title}
      </h3>
      <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
        by @{bounty.user.username ?? "unknown"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em]">
        <Pill label="fit" value={`${fit}`} tone={fit >= 80 ? "good" : fit >= 60 ? "ok" : "warn"} />
        <Pill label="effort" value={effort} tone={effort === "low" ? "good" : effort === "med" ? "ok" : "warn"} />
        <Pill label="approval risk" value={risk} tone={risk === "low" ? "good" : risk === "med" ? "ok" : "warn"} />
      </div>

      <p className="mt-3 max-w-[680px] line-clamp-3 font-sans text-[13px] leading-relaxed text-text-secondary">
        {bounty.description}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onStart}
          className="rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Start clipping →
        </button>
        <button
          onClick={onOpen}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Details
        </button>
      </div>
    </article>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone: "good" | "ok" | "warn" }) {
  const cls =
    tone === "good"
      ? "border-fuchsia-soft bg-fuchsia-soft/30 text-fuchsia-deep"
      : tone === "ok"
      ? "border-line bg-paper-warm/40 text-text-secondary"
      : "border-line bg-paper-warm/40 text-text-tertiary";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${cls}`}>
      <span className="text-text-tertiary">{label}</span>
      <span className="text-ink">{value}</span>
    </span>
  );
}
