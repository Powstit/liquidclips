import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import { Sparkles, Users, Wallet, ArrowRight, ExternalLink } from "lucide-react";
import {
  allowedPlatforms,
  approvalRisk,
  effortFor,
  fitScore,
  formatPayout,
  formatBudget,
  opportunityLabel,
  opportunityScore,
  whopBountyUrl,
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
  const score = opportunityScore(bounty, connectedPlatforms);
  const effort = effortFor(bounty);
  const risk = approvalRisk(bounty);
  const label = opportunityLabel(score);
  const briefUrl = whopBountyUrl(bounty);

  return (
    <article className="rounded-2xl border border-line bg-paper p-5 shadow-[var(--shadow-e1)] transition-all duration-200 hover:-translate-y-[2px] hover:border-fuchsia/40 hover:shadow-[var(--shadow-e2)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* PRIMARY: opportunity score chip + the big money figure */}
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
            score >= 78
              ? "border-fuchsia-soft bg-fuchsia-soft/40 text-fuchsia-deep shadow-[var(--glow-sm)]"
              : score >= 58
              ? "border-line bg-paper-warm/40 text-ink"
              : "border-line bg-paper-warm/40 text-text-tertiary"
          }`}>
            {score >= 78 && <Sparkles className="h-3 w-3" strokeWidth={2.25} />}
            {label} · {score}
          </span>
          <span className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {formatPayout(bounty)}
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          {platforms.map((p) => (
            <PlatformIcon key={p} id={p} className="h-3.5 w-3.5 text-text-tertiary" />
          ))}
        </span>
      </div>

      {/* Secondary stats with icons */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="tabular-nums text-ink">{bounty.spotsRemaining}</span>
          <span>of {bounty.acceptedSubmissionsLimit} spots</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="tabular-nums text-ink">{formatBudget(bounty)}</span>
          <span>open</span>
        </span>
      </div>

      <div className="mt-3 flex items-start gap-3">
        {bounty.thumbnail && (
          <img
            src={bounty.thumbnail}
            alt=""
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
          />
        )}
        <div className="min-w-0">
          <h3 className="font-display text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink">
            {bounty.title}
          </h3>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
            by @{bounty.user.username ?? "unknown"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em]">
        <Pill label="fit" value={`${fit}`} tone={fit >= 80 ? "good" : fit >= 60 ? "ok" : "warn"} />
        <Pill label="effort" value={effort} tone={effort === "low" ? "good" : effort === "med" ? "ok" : "warn"} />
        <Pill label="approval risk" value={risk} tone={risk === "low" ? "good" : risk === "med" ? "ok" : "warn"} />
      </div>

      <p className="mt-3 max-w-[680px] line-clamp-3 font-sans text-[13px] leading-relaxed text-text-secondary">
        {bounty.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={onStart}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[var(--glow-md)]"
        >
          Start clipping
          <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
        </button>
        <button
          onClick={onOpen}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Details
        </button>
        {briefUrl && (
          <button
            onClick={() => void openExternal(briefUrl)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-sans text-[12px] font-medium text-text-secondary hover:text-fuchsia-deep"
            title="Open the brand's brief on Whop in your browser. Useful when the source video lives in a discussion post Junior can't read."
          >
            Open brief
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
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
