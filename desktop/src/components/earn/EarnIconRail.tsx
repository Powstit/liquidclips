// Earn icon rail — vertical sub-nav, 60px wide. Replaces the text sub-tabs.
// Each icon is a button with a hover tooltip; the active icon gets a fuchsia
// pill background. Bottom icon (Link) opens AffiliateHero as a popover.

import { useState, type ReactNode } from "react";
import { CheckCircle2, Clock4, Link as LinkIcon, Send, Target, Trophy } from "lucide-react";
import { AffiliateHeroPopover, useAffiliateAttention } from "./AffiliateHero";
import type { EarnTab as EarnSubTab } from "./types";

// Tooltip = the long form; chip = the 6-char-or-less label that sits under
// the icon, so a first-time clipper doesn't have to hover to understand
// what they're looking at.
const ITEMS: Array<{ id: EarnSubTab; label: string; chip: string; icon: ReactNode }> = [
  { id: "available",   label: "Open campaigns", chip: "Open",   icon: <Target size={14} /> },
  { id: "in_progress", label: "In progress",    chip: "Doing",  icon: <Clock4 size={14} /> },
  { id: "submitted",   label: "Posted clips",   chip: "Posted", icon: <Send size={14} /> },
  { id: "approved",    label: "Approved",       chip: "Paid",   icon: <CheckCircle2 size={14} /> },
  // Task #69 — "Top affiliates" → "Top allies" per RPO vocab. Sub-tab id
  // ("leaderboard") + chip ("Top") stay; only the hover label flips.
  { id: "leaderboard", label: "Top allies", chip: "Top",    icon: <Trophy size={14} /> },
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
  // Fuchsia dot on the Link icon when the user has earned affiliate $$$ but
  // hasn't finished Stripe Connect onboarding. Live signal, not a one-shot.
  const affiliateAttention = useAffiliateAttention();

  return (
    <div className="flex h-full flex-col items-center py-3">
      {ITEMS.map((it) => {
        const active = it.id === value;
        return (
          <RailButton
            key={it.id}
            active={active}
            label={it.label}
            chip={it.chip}
            onClick={() => onChange(it.id)}
          >
            {it.icon}
          </RailButton>
        );
      })}
      <div className="my-2 h-px w-8 bg-line" />
      <RailButton
        active={affiliateOpen}
        label={
          affiliateAttention
            ? "Earn $ for invites · Connect Stripe to receive payout"
            : "Earn $ for invites"
        }
        chip="Invite"
        onClick={() => setAffiliateOpen(true)}
        dot={affiliateAttention}
      >
        <LinkIcon size={14} />
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
  chip,
  active,
  onClick,
  dot,
}: {
  children: ReactNode;
  label: string;
  // 4-6 char label rendered visibly under the icon. Kids shouldn't need to
  // hover to learn the rail.
  chip: string;
  active: boolean;
  onClick: () => void;
  // Optional small fuchsia dot in the top-right corner of the button — used
  // to flag "this surface needs your attention" without opening it.
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative mb-1.5 flex w-12 flex-col items-center gap-0.5 rounded-xl border py-1.5 transition-colors duration-150 ${
        active
          ? "border-fuchsia bg-fuchsia-soft text-fuchsia-deep shadow-[var(--glow-sm)]"
          : "border-transparent text-text-secondary hover:bg-paper-elev hover:text-ink"
      }`}
    >
      <span className="inline-flex h-5 w-5 items-center justify-center">
        {children}
      </span>
      <span className="font-mono text-[8px] uppercase tracking-[0.04em] leading-none">
        {chip}
      </span>
      {dot && (
        <span
          className="pulse-dot absolute right-1 top-1 h-2 w-2 rounded-full bg-fuchsia ring-2 ring-paper"
          aria-hidden
        />
      )}
    </button>
  );
}
