// "How earning works" — extracted from EarnTab body (old inline block) into
// a standalone popover triggered by the `?` icon on the EarnTickerStrip.
//
// Same 8-step content, condensed and reframed. Stays out of the main feed
// so the kid who already knows the loop doesn't see another wall of text.

import { X } from "lucide-react";
import { Card, IconButton } from "../primitives";

const STEPS: Array<{ title: string; detail: string }> = [
  {
    title: "Activate Liquid Clips",
    detail: "Sign in once. Your license stays in your Mac's keychain.",
  },
  {
    title: "Pick a campaign",
    detail: "Browse the in-app campaign feed or save your own briefs.",
  },
  {
    title: "Clip it",
    detail: "Drop a source video. Liquid Clips cuts, captions, and reframes.",
  },
  {
    title: "Export",
    detail: "Get a folder of vertical clips ready for TikTok / IG / YT Shorts.",
  },
  {
    title: "Post + log it",
    detail: "Paste your post URL into Your Clips so you can track the status.",
  },
  {
    title: "Get paid",
    detail:
      "Whop pays for reward campaigns. Liquid Clips pays for affiliate signups via Stripe.",
  },
];

export function EarnHowItWorksPopover({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <Card
        elevation="raised"
        padding="none"
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
            how earning works
          </span>
          <IconButton variant="ghost" label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <ol className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-fuchsia/40 bg-fuchsia-soft/40 font-mono text-[11px] font-medium text-fuchsia-deep">
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="font-sans text-[13px] font-medium text-ink">
                  {s.title}
                </span>
                <span className="font-sans text-[12px] text-text-secondary">
                  {s.detail}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
