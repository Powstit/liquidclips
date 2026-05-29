// Earn icon rail — vertical sub-nav, 60px wide. Replaces the text sub-tabs.
// Each icon is a button with a hover tooltip; the active icon gets a fuchsia
// pill background. Bottom icon (Link) opens AffiliateHero as a popover.

import { useState, type ReactNode } from "react";
import { CheckCircle2, Clock4, Link as LinkIcon, Send, Target } from "lucide-react";
import { AffiliateHeroPopover } from "./AffiliateHero";
import type { EarnTab as EarnSubTab } from "./types";

const ITEMS: Array<{ id: EarnSubTab; label: string; icon: ReactNode }> = [
  { id: "available", label: "Open campaigns", icon: <Target size={16} /> },
  { id: "in_progress", label: "In progress", icon: <Clock4 size={16} /> },
  { id: "submitted", label: "Submitted", icon: <Send size={16} /> },
  { id: "approved", label: "Approved", icon: <CheckCircle2 size={16} /> },
];

export function EarnIconRail({
  value,
  onChange,
  onSignIn,
}: {
  value: EarnSubTab;
  onChange: (v: EarnSubTab) => void;
  onSignIn?: () => void;
}) {
  const [affiliateOpen, setAffiliateOpen] = useState(false);

  return (
    <div className="flex h-full flex-col items-center py-3">
      {ITEMS.map((it) => {
        const active = it.id === value;
        return (
          <RailButton
            key={it.id}
            active={active}
            label={it.label}
            onClick={() => onChange(it.id)}
          >
            {it.icon}
          </RailButton>
        );
      })}
      <div className="my-2 h-px w-8 bg-line" />
      <RailButton
        active={affiliateOpen}
        label="Earn $ for invites"
        onClick={() => setAffiliateOpen(true)}
      >
        <LinkIcon size={16} />
      </RailButton>
      <div className="mt-auto" />
      {affiliateOpen && (
        <AffiliateHeroPopover onClose={() => setAffiliateOpen(false)} onSignIn={onSignIn} />
      )}
    </div>
  );
}

function RailButton({
  children,
  label,
  active,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors duration-150 ${
        active
          ? "border-fuchsia bg-fuchsia-soft text-fuchsia-deep shadow-[var(--glow-sm)]"
          : "border-transparent text-text-secondary hover:bg-paper-elev hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
