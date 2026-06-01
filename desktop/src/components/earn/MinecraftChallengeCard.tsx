// Minecraft Story Clip Challenge — featured campaign card (sprint #14c).
//
// Shown prominently above the workspace dropzone + in the Earn tab's
// "available" subTab. Tap → opens the SubmissionPortal modal.
//
// The strategic thesis (campaign spec §2): Minecraft viewers already train
// the clipping eye. This card converts that latent skill into clipping
// behavior through the $2.50 RPM offer + the watermark conversion engine.

import { useEffect } from "react";
import { Trophy, Zap } from "lucide-react";
import heroImg from "../../assets/minecraft/hero.png";
import { track } from "../../lib/analytics";

export function MinecraftChallengeCard({
  onOpen,
  variant = "full",
}: {
  onOpen: () => void;
  variant?: "full" | "compact";
}) {
  useEffect(() => {
    track("mc_challenge_card_viewed", { variant });
  }, [variant]);

  function handleOpen() {
    track("mc_challenge_card_clicked", { variant });
    onOpen();
  }

  if (variant === "compact") {
    return (
      <button
        onClick={handleOpen}
        className="group relative w-full overflow-hidden rounded-2xl border border-fuchsia/40 bg-gradient-to-br from-fuchsia-soft/30 via-paper to-paper p-4 text-left transition-all hover:border-fuchsia hover:shadow-[var(--glow-md)]"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fuchsia text-paper">
            <Trophy size={16} strokeWidth={2.5} />
          </span>
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
              sponsored · $2.50 rpm
            </p>
            <p className="font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              Get paid to clip Minecraft story moments
            </p>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia-deep group-hover:text-fuchsia">
            open →
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={handleOpen}
      className="group relative w-full overflow-hidden rounded-3xl border border-fuchsia/40 bg-ink text-left transition-all hover:shadow-[0_20px_60px_rgba(255,26,140,0.25)]"
    >
      <div className="absolute inset-0">
        <img
          src={heroImg}
          alt=""
          className="h-full w-full object-cover opacity-60 transition-opacity group-hover:opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/85 to-ink/30" />
      </div>
      <div className="relative z-10 flex flex-col gap-3 p-7">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-paper">
          <Zap size={11} strokeWidth={2.5} /> sponsored campaign
        </span>
        <h2 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-paper">
          Get paid to clip Minecraft<br />story moments
        </h2>
        <p className="max-w-xl font-sans text-[14px] leading-relaxed text-paper/85">
          Spot betrayal, war, friendship, plot twists. Clip them. Earn{" "}
          <span className="font-semibold text-fuchsia">$2.50 per 1,000 views</span>
          {" "}+ daily and weekly winner bonuses.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink shadow-[0_8px_24px_rgba(255,26,140,0.3)] group-hover:bg-fuchsia group-hover:text-paper transition-colors">
            Open the challenge →
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-paper/60">
            4-week test · $4,900 budget · payouts via Whop
          </span>
        </div>
      </div>
    </button>
  );
}
