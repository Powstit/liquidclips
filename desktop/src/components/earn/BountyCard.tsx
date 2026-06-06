// BountyCard — Earn → Open campaigns grid tile (~280px wide).
//
// Tightened for the 3-column auto-fit grid: payout-first hierarchy, thumbnail
// header, title + brand under it, fit/effort/risk reduced to compact pills,
// description dropped (lives in BountyDetail when opened). Primary action
// `Start` + secondary `Brief` inline at the bottom.

import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import { Sparkles, Users, Wallet, ArrowRight } from "lucide-react";
import { openBrowsePanel } from "../../lib/browse";
import { BROWSE_PANEL_ENABLED } from "../../lib/flags";
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
  const hot = score >= 78;
  const [starting, setStarting] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);

  // Whop's API occasionally returns null for numeric fields the TS type marks
  // as non-null. Coerce here so `null spots` never reaches the user.
  const num = (v: unknown, d = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  const spotsRemaining = num(bounty.spotsRemaining);

  return (
    <article
      className="library-card group relative flex h-full flex-col gap-3 bg-transparent p-4"
      data-hot={hot ? "true" : "false"}
    >
      {/* v0.6.38 — Cockpit cards: transparent fill, fuchsia HUD bracket
          corners only. Hot campaigns get brighter brackets via [data-hot].
          Reuses library-card + library-card-corner-* CSS so Workstation /
          Library / Earn all speak the same chrome. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      {/* Thumbnail + payout overlay */}
      <div className="relative h-[110px] overflow-hidden rounded-xl bg-transparent">
        {bounty.thumbnail ? (
          <img
            src={bounty.thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-200 ease-out group-hover:scale-[1.03] group-hover:brightness-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            no thumbnail
          </div>
        )}
        <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          <span className="rounded-md bg-paper/90 px-2 py-1 font-display text-[18px] font-semibold leading-none tracking-[-0.01em] text-ink shadow-[var(--shadow-e1)] tabular-nums">
            {formatPayout(bounty)}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] ${
              hot
                ? "border-fuchsia/40 bg-fuchsia text-white"
                : score >= 58
                  ? "border-line bg-paper text-ink"
                  : "border-line bg-paper text-text-tertiary"
            }`}
          >
            {hot && <Sparkles size={9} strokeWidth={2.5} />}
            {label} · {score}
          </span>
        </div>
      </div>

      {/* Title + brand + via Whop */}
      <div className="flex flex-col gap-0.5">
        <h3 className="line-clamp-2 font-display text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {bounty.title}
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          @{bounty.user.username ?? "unknown"} · via Whop
        </p>
      </div>

      {/* Compact stats: spots / budget / platform icons */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        <span className="inline-flex items-center gap-1">
          <Users size={11} strokeWidth={2} />
          <span className="tabular-nums text-ink">{spotsRemaining}</span>
          <span>spots</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Wallet size={11} strokeWidth={2} />
          <span className="tabular-nums text-ink">{formatBudget(bounty)}</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          {platforms.map((p) => (
            <PlatformIcon key={p} id={p} className="h-3 w-3 text-text-tertiary" />
          ))}
        </span>
      </div>

      {/* Quality pills */}
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)]">
        <QualityPill label="fit" value={`${fit}`} tone={fit >= 80 ? "good" : fit >= 60 ? "ok" : "warn"} />
        <QualityPill label="effort" value={effort} tone={effort === "low" ? "good" : effort === "med" ? "ok" : "warn"} />
        <QualityPill label="risk" value={risk} tone={risk === "low" ? "good" : risk === "med" ? "ok" : "warn"} />
      </div>

      {/* Actions */}
      <div className="mt-auto flex items-center gap-1.5">
        <button
          onClick={async () => {
            if (starting) return;
            setStarting(true);
            try {
              await Promise.resolve(onStart());
            } finally {
              // onStart usually navigates away; reset so the button isn't
              // stuck if the parent stays on this view.
              setStarting(false);
            }
          }}
          disabled={starting}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-fuchsia px-3 py-1.5 font-sans text-[12px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {starting ? "Starting…" : "Start"}
          {!starting && <ArrowRight size={12} strokeWidth={2.25} />}
        </button>
        <button
          onClick={onOpen}
          className="rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
          title="Open card details"
        >
          Details
        </button>
        {briefUrl && (
          <button
            onClick={async () => {
              if (briefBusy) return;
              setBriefBusy(true);
              try {
                if (BROWSE_PANEL_ENABLED) {
                  try {
                    await openBrowsePanel(briefUrl);
                    return;
                  } catch (e) {
                    console.error("[earn] Browse panel failed, falling back to system browser:", e);
                  }
                }
                try {
                  await openExternal(briefUrl);
                } catch (e) {
                  console.error("[earn] Failed to open brief externally:", e);
                }
              } finally {
                setBriefBusy(false);
              }
            }}
            disabled={briefBusy}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-60 disabled:cursor-not-allowed"
            title="Open the brand's brief in the side panel"
          >
            {briefBusy ? "Opening…" : "Brief"}
          </button>
        )}
      </div>
    </article>
  );
}

function QualityPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "ok" | "warn";
}) {
  const cls =
    tone === "good"
      ? "border-fuchsia/30 bg-fuchsia-soft/30 text-fuchsia-deep"
      : tone === "ok"
        ? "border-line bg-paper-warm/40 text-text-secondary"
        : "border-line bg-paper-warm/40 text-text-tertiary";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${cls}`}>
      <span className="text-text-tertiary">{label}</span>
      <span className="text-ink">{value}</span>
    </span>
  );
}
