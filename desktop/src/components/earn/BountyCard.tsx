// BountyCard — Earn → Open campaigns grid tile (~280px wide).
//
// Tightened for the 3-column auto-fit grid: payout-first hierarchy, thumbnail
// header, title + brand under it, fit/effort/risk reduced to compact pills,
// description dropped (lives in BountyDetail when opened). Primary action
// `Start` + secondary `Brief` inline at the bottom.

import { useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import { Sparkles, Users, ArrowRight } from "lucide-react";
import { openBrowsePanel } from "../../lib/browse";
import { BROWSE_PANEL_ENABLED } from "../../lib/flags";
import {
  allowedPlatforms,
  approvalRisk,
  effortFor,
  fitScore,
  formatPayout,
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
  startLabel,
  startTitle,
}: {
  bounty: WhopBounty;
  connectedPlatforms: ConnectedPlatform[];
  onOpen: () => void;
  onStart: () => void;
  // v0.7.68 — inline gating for "Unlock to start this bounty" copy when a
  // public-feed card is shown to a cold-launched user with no cached JWT.
  // Defaults to "Start" so existing callers are unaffected.
  startLabel?: string;
  startTitle?: string;
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
      className="library-card group relative flex h-full flex-col gap-3 bg-transparent p-4 transition-all duration-200 hover:ring-1 hover:ring-fuchsia/40"
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

      {/* Compact stats: RPM / spots / status / platform icons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia/30 bg-fuchsia-soft/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
          {formatPayout(bounty)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <Users size={10} strokeWidth={2} />
          <span className="tabular-nums text-ink">{spotsRemaining}</span>
          <span>left</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary">
          {spotsRemaining > 0 ? "Live" : "Closed"}
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
          title={startTitle}
          className={`flex-1 ${startLabel === "Unlock to start" ? "btn-locked" : "btn-primary"}`}
        >
          {starting ? "Starting…" : (startLabel ?? "Start")}
          {!starting && <ArrowRight size={12} strokeWidth={2.25} />}
        </button>
        <button
          onClick={onOpen}
          className="btn-secondary"
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
            className="btn-secondary disabled:opacity-60"
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
