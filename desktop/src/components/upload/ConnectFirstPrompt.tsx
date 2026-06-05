// Single source of truth for the "you need to connect a channel first" hand-
// holding panel. Rendered as a first-run gate on UploadTab AND as the inline
// empty-state inside PublishModal when the user opens publish before linking
// any account. Same copy, same CTA, two render variants:
//
//   variant="panel"  → standalone card (UploadTab). Fills the deck region.
//   variant="inline" → bare contents (PublishModal). Caller already supplies
//                      the modal wrapper, so we skip the fixed/backdrop chrome
//                      to avoid modal-on-top-of-modal.
//
// Brand voice: terse, lowercase mono eyebrow, display headline, sans body,
// fuchsia primary CTA. No emoji.

import { PlatformIcon } from "../PlatformIcon";

export type ConnectFirstPromptVariant = "panel" | "inline";

export function ConnectFirstPrompt({
  variant = "panel",
  onOpenSchedule,
}: {
  variant?: ConnectFirstPromptVariant;
  onOpenSchedule: () => void;
}) {
  const Body = (
    <>
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        connect first
      </div>

      <h2 className="font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
        Connect a channel first.
      </h2>

      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Liquid Clips publishes to TikTok, YouTube Shorts, Instagram Reels and X.
        Link your accounts in Schedule &rarr; Channels &mdash; takes about 90
        seconds.
      </p>

      {/* Platform rail — soft chips so the user sees the four destinations
          before they click. Dim by default; lights up once a channel is
          actually linked (handled by the host surface — this panel only
          renders when nothing is linked). */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["tiktok", "youtube", "instagram", "x"] as const).map((p) => (
          <div
            key={p}
            className="flex items-center gap-2 rounded-xl border border-line bg-paper-warm/40 px-3 py-2"
          >
            <PlatformIcon id={p} className="h-4 w-4 text-text-tertiary" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
              {p}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          onClick={onOpenSchedule}
          className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Open Schedule &rarr;
        </button>
      </div>
    </>
  );

  if (variant === "inline") {
    // PublishModal already wraps us in its centered card; render contents only.
    return <div className="flex flex-col gap-5">{Body}</div>;
  }

  // Standalone panel for UploadTab.
  return (
    <section className="hud-frame flex flex-col gap-5 rounded-2xl border border-line bg-paper-warm/30 px-6 py-6">
      {Body}
    </section>
  );
}
