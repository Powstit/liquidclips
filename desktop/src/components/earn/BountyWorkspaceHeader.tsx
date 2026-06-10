import { useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import type { Project } from "../../lib/sidecar";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import { InfoHint } from "../InfoHint";
import { computeBountyFit } from "./bounty-fit";

const KNOWN: PlatformId[] = ["youtube", "tiktok", "instagram", "x"];

// The bounty's "home base" on the results screen. Replaces the old one-line
// banner — gives the clipper everything they need to finish and submit without
// leaving: payout, allowed platforms, source, the brief, and the Whop link.
export function BountyWorkspaceHeader({
  project,
  onGenerateClips,
  onOpenEditor,
}: {
  project: Project;
  onGenerateClips?: () => void;
  onOpenEditor?: () => void;
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  if (!project.whop_bounty_id) return null;

  const sym =
    project.whop_bounty_currency === "GBP" ? "£" : project.whop_bounty_currency === "USD" ? "$" : "";
  const platforms = (project.whop_bounty_platforms || []).filter((p): p is PlatformId =>
    (KNOWN as string[]).includes(p),
  );
  const whopUrl = project.whop_bounty_url;
  const source = project.whop_bounty_source_url;
  const readyClipList = project.clips.filter((c) => c.vertical_path || c.cut_path);
  const readyClips = readyClipList.length;
  const fitScores = project.clips
    .map((c) => computeBountyFit(c, project)?.score)
    .filter((n): n is number => typeof n === "number");
  const avgFit = fitScores.length
    ? Math.round(fitScores.reduce((sum, n) => sum + n, 0) / fitScores.length)
    : null;
  const bestFit = fitScores.length ? Math.max(...fitScores) : null;

  // "next step: submit" was telling users to submit clips that were still
  // unpolished — exported but no captions, low fit, no virality signal. We
  // only call a clip ship-ready when at least one of:
  //   - virality / score signal >= 50 (LLM picked it as a strong cut)
  //   - captions baked in OR caption files present (caption_style proxy)
  //   - fit score vs the brief is >= 70
  // Otherwise the next step is to polish a clip, not submit a weak one.
  const hasShipReadyClip = readyClipList.some((c) => {
    if ((c.virality ?? 0) >= 50) return true;
    if (c.captions_burned || c.srt_path || c.vtt_path) return true;
    return false;
  });
  const fitReady = (bestFit ?? 0) >= 70;
  const nextStep =
    readyClips === 0
      ? "generate"
      : hasShipReadyClip || fitReady
        ? "submit"
        : "polish a clip first";

  return (
    <div className="mb-4 rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/25 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-fuchsia font-mono text-[11px] font-bold leading-none text-white" aria-hidden>
              /
            </span>
            clipping for a Whop reward
            <InfoHint text="This project is linked to a Whop Content Reward. Every clip is tagged with it, and the actions below help you submit." />
          </div>
          <h3 className="mt-1.5 font-display text-[18px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {project.whop_bounty_title}
          </h3>
          {project.whop_bounty_creator && (
            <p className="mt-0.5 font-mono text-[11px] text-text-tertiary">by @{project.whop_bounty_creator}</p>
          )}
        </div>
        {whopUrl && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={async () => {
                setOpenError(null);
                try {
                  await openExternal(whopUrl);
                } catch (e) {
                  console.error("[bounty-workspace-header] openExternal failed:", e);
                  setOpenError("Couldn't open Whop — copy the link manually.");
                }
              }}
              className="shrink-0 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
            >
              Open reward on Whop ↗
            </button>
            {openError && (
              <p className="font-mono text-[11px] text-[var(--color-danger)]">{openError}</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            payout
            <InfoHint text="Per 1,000 views on an approved clip. Whop measures the views and pays out — Liquid Clips just helps you qualify." />
          </div>
          <div className="mt-1 font-display text-[16px] font-semibold text-ink">
            {project.whop_bounty_reward_per_unit != null
              ? `${sym}${project.whop_bounty_reward_per_unit.toFixed(2)} / 1k`
              : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            allowed platforms
            <InfoHint text="Only clips posted to these platforms count toward this reward." />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {platforms.length > 0 ? (
              platforms.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em] text-text-secondary">
                  <PlatformIcon id={p} className="h-3.5 w-3.5" />
                </span>
              ))
            ) : (
              <span className="font-mono text-[12px] text-text-tertiary">any</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            source
            <InfoHint text="The video Liquid Clips clipped from — the link you gave at setup, or a local upload." />
          </div>
          <div className="mt-1 truncate font-mono text-[12px] text-ink" title={source ?? "local upload"}>
            {source ?? "local upload"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <ProgressTile label="clips ready" value={`${readyClips}/${project.clips.length || 0}`} />
        <ProgressTile label="avg fit" value={avgFit == null ? "—" : `${avgFit}/100`} />
        <ProgressTile label="best clip" value={bestFit == null ? "—" : `${bestFit}/100`} />
        <NextStepTile
          step={nextStep}
          onGenerateClips={onGenerateClips}
          onOpenEditor={onOpenEditor}
          whopUrl={whopUrl}
        />
      </div>

      {project.whop_bounty_description && (
        <div className="mt-3 border-t border-fuchsia-soft/60 pt-3">
          <button
            onClick={() => setBriefOpen((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep hover:text-ink"
          >
            {briefOpen ? "▾" : "▸"} brief & rules
            <InfoHint text="The brand's instructions. Re-check before submitting — clips that miss the brief get rejected on Whop." />
          </button>
          {briefOpen && (
            <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">
              {project.whop_bounty_description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</div>
      <div className="mt-1 truncate font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">{value}</div>
    </div>
  );
}

function NextStepTile({
  step,
  onGenerateClips,
  onOpenEditor,
  whopUrl,
}: {
  step: string;
  onGenerateClips?: () => void;
  onOpenEditor?: () => void;
  whopUrl?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copySubmissionLink() {
    if (!whopUrl) return;
    try {
      await navigator.clipboard.writeText(whopUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  if (step === "generate" && onGenerateClips) {
    return (
      <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">next step</div>
        <button
          onClick={onGenerateClips}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-3 py-1 font-sans text-[11px] font-medium text-white hover:bg-fuchsia-bright"
        >
          Generate clips
        </button>
      </div>
    );
  }

  if (step === "polish a clip first" && onOpenEditor) {
    return (
      <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">next step</div>
        <button
          onClick={onOpenEditor}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-fuchsia px-3 py-1 font-sans text-[11px] font-medium text-fuchsia hover:bg-fuchsia/10"
        >
          Open editor
        </button>
      </div>
    );
  }

  if (step === "submit" && whopUrl) {
    return (
      <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">next step</div>
        <button
          onClick={copySubmissionLink}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-3 py-1 font-sans text-[11px] font-medium text-white hover:bg-fuchsia-bright"
        >
          {copied ? "Copied!" : "Copy submission link"}
        </button>
      </div>
    );
  }

  // Fallback: render as plain text when no action is wired
  return (
    <div className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">next step</div>
      <div className="mt-1 truncate font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">{step}</div>
    </div>
  );
}
