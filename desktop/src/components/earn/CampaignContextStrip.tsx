// Campaign context strip — RC-3.
//
// Compact pill rendered above the Upload tab + Results grid when an active
// CampaignBrief is set. Surfaces the brief's payout / platforms / first
// rule so the user knows what they're clipping toward without going back
// to Earn. Three actions:
//   View brief — opens the BriefDetailModal
//   Change      — toggles the brief picker dropdown
//   Clear       — drops the active brief (workspace becomes platform-generic)

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, X } from "lucide-react";
import { Pill } from "../primitives";
import {
  useActiveBrief,
  useBriefs,
  type AllowedPlatform,
  type CampaignBrief,
  type PayoutProvider,
} from "../../lib/briefs";
import { humanError } from "../../lib/sidecar";
import { ConfirmDialog } from "../ConfirmDialog";

const PAYOUT_LABEL: Record<PayoutProvider, string> = {
  whop: "Whop",
  external_platform: "Platform",
  liquid_clips_stripe: "Liquid Clips",
  unknown: "—",
};

const PLATFORM_LABEL: Record<AllowedPlatform, string> = {
  tiktok: "TikTok",
  instagram: "IG",
  youtube_shorts: "YT",
  x: "X",
};

export function CampaignContextStrip({
  onViewBrief,
}: {
  onViewBrief?: (brief: CampaignBrief) => void;
}) {
  const { active, setActive } = useActiveBrief();
  const { briefs } = useBriefs();
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // PREVENTS — silent setActive() failures leaving the strip out of sync
  // with what the user just clicked.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Branded confirm replaces window.confirm() — native dialog blocks Tauri
  // webview thread + breaks the cockpit voice on detach.
  const [confirmDetachOpen, setConfirmDetachOpen] = useState(false);

  async function applyActive(id: string | null): Promise<void> {
    setSaveError(null);
    try {
      await setActive(id);
    } catch (e) {
      setSaveError(`Couldn't save — try again. (${humanError(e)})`);
    }
  }

  function clearActive(): void {
    // PREVENTS — destructive "Clear" tap dropping the user's chosen
    // campaign by accident. Branded ConfirmDialog before detach.
    setConfirmDetachOpen(true);
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function onClickOutside(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerOpen]);

  if (!active) {
    // When nothing is active but the user has briefs, surface a thin nudge.
    if (briefs.length === 0) return null;
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-line bg-paper-elev/40 px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          no campaign attached
        </span>
        <div className="relative ml-auto" ref={wrapRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
          >
            Attach brief <ChevronDown size={12} />
          </button>
          {pickerOpen && (
            <BriefPicker
              briefs={briefs}
              onPick={(id) => {
                setPickerOpen(false);
                void applyActive(id);
              }}
            />
          )}
        </div>
        {saveError && (
          <p role="alert" className="basis-full font-sans text-[11px] text-[var(--color-danger-bright)]">
            {saveError}
          </p>
        )}
      </div>
    );
  }

  const firstRule = active.rules[0];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-fuchsia/30 bg-fuchsia-soft/40 px-4 py-2.5 shadow-[var(--glow-sm)]">
      <div className="flex flex-col gap-0.5 truncate">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
          campaign · paid by {PAYOUT_LABEL[active.payout_provider]}
        </span>
        <span className="truncate font-sans text-[13px] font-medium text-ink">
          {active.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {active.payout_label && <Pill tone="fuchsia">{active.payout_label}</Pill>}
        {active.allowed_platforms.slice(0, 4).map((p) => (
          <Pill key={p} tone="neutral">
            {PLATFORM_LABEL[p]}
          </Pill>
        ))}
      </div>
      {firstRule && (
        <span className="hidden truncate font-sans text-[12px] text-text-secondary md:inline">
          · {firstRule}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {onViewBrief && (
          <button
            type="button"
            onClick={() => onViewBrief(active)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
          >
            <Eye size={11} /> View brief
          </button>
        )}
        <div className="relative" ref={wrapRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
          >
            Change <ChevronDown size={11} />
          </button>
          {pickerOpen && (
            <BriefPicker
              briefs={briefs}
              activeId={active.id}
              onPick={(id) => {
                setPickerOpen(false);
                void applyActive(id);
              }}
            />
          )}
        </div>
        <button
          type="button"
          onClick={clearActive}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:border-[var(--color-danger)] hover:text-[var(--color-danger-bright)]"
          title="Clear active campaign"
        >
          <X size={11} /> Clear
        </button>
      </div>
      {saveError && (
        <p role="alert" className="basis-full font-sans text-[11px] text-[var(--color-danger-bright)]">
          {saveError}
        </p>
      )}
      <ConfirmDialog
        open={confirmDetachOpen}
        tone="neutral"
        title="Detach this campaign?"
        body={<>You can re-attach it from the dropdown any time.</>}
        confirmLabel="Detach campaign"
        onCancel={() => setConfirmDetachOpen(false)}
        onConfirm={() => {
          setConfirmDetachOpen(false);
          void applyActive(null);
        }}
      />
    </div>
  );
}

function BriefPicker({
  briefs,
  activeId,
  onPick,
}: {
  briefs: CampaignBrief[];
  activeId?: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="absolute right-0 top-[calc(100%+6px)] z-20 flex max-h-[300px] w-[280px] flex-col overflow-y-auto rounded-xl border border-line bg-paper-elev shadow-[var(--shadow-e3)]">
      {briefs.length === 0 ? (
        <span className="px-3 py-2 font-sans text-[12px] text-text-secondary">
          No briefs saved yet.
        </span>
      ) : (
        briefs.map((b) => {
          const isActive = b.id === activeId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onPick(b.id)}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-paper ${
                isActive ? "bg-fuchsia-soft/30" : ""
              }`}
            >
              <span className="font-sans text-[13px] text-ink">{b.title}</span>
              <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                {b.payout_label || PAYOUT_LABEL[b.payout_provider]}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
