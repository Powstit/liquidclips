/**
 * CampaignLifecyclePill · UI-3
 *
 * Small reusable status pill (DRAFT / LIVE / PAUSED / CLOSED). When the user
 * is the campaign owner (agency mode + ownership), opens a Manage popover to
 * change the lifecycle state.
 *
 * Mock-only — emits `campaign:lifecycle-change`; backend persistence lands in
 * Batch D.
 */

import { useEffect, useRef, useState } from "react";
import { bus } from "../bridge";
import "./CampaignLifecyclePill.css";

export type CampaignStatus = "draft" | "live" | "paused" | "closed";

const STATUSES: ReadonlyArray<{ id: CampaignStatus; label: string; tone: string }> = [
  { id: "draft",  label: "Draft",  tone: "dim" },
  { id: "live",   label: "Live",   tone: "fuchsia" },
  { id: "paused", label: "Paused", tone: "amber" },
  { id: "closed", label: "Closed", tone: "muted" },
];

export interface CampaignLifecyclePillProps {
  status: CampaignStatus;
  campaignSlug: string;
  /** When true, clicking opens the Manage popover. Default = false. */
  manageable?: boolean;
  /** Optional change handler (parent owns persisted state). Without it the
   *  pill is purely visual. */
  onChange?: (next: CampaignStatus) => void;
}

export function CampaignLifecyclePill({
  status, campaignSlug, manageable = false, onChange,
}: CampaignLifecyclePillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = STATUSES.find((s) => s.id === status) ?? STATUSES[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 50);
    return () => { window.clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  const pick = (next: CampaignStatus) => {
    setOpen(false);
    if (next === status) return;
    onChange?.(next);
    bus.emit("campaign:lifecycle-change", { campaignSlug, status: next });
    bus.emit("toast", {
      kind: "info",
      title: "Status updated",
      body: `Campaign · ${next}`,
    });
  };

  if (!manageable) {
    return (
      <span className={`lc-clp lc-clp-${current.tone}`}>
        <span className="lc-clp-dot" />
        {current.label}
      </span>
    );
  }

  return (
    <div className="lc-clp-wrap" ref={ref}>
      <button
        type="button"
        className={`lc-clp lc-clp-${current.tone} lc-clp-mng`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="lc-clp-dot" />
        {current.label}
        <span className="lc-clp-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="lc-clp-pop" role="menu">
          <span className="lc-clp-pop-eb">Manage campaign</span>
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className={`lc-clp-pop-row ${s.id === status ? "on" : ""}`}
              onClick={() => pick(s.id)}
            >
              <span className={`lc-clp-dot lc-clp-dot-${s.tone}`} />
              {s.label}
              {s.id === status && <span className="lc-clp-pop-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
