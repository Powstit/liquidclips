// Avatar picker — gamified unlock modal.
//
// Opens when the user clicks their Dashboard avatar. Renders the 8-avatar
// catalog as a grid; unlocked tiles are clickable, locked tiles are dimmed
// and show the unlock threshold on hover/title. Selection persists to
// $APPDATA/avatar_choice.json via setChosenAvatarId.
//
// Portaled to document.body so it escapes the stacking contexts of any
// modal it might be triggered from (e.g. AffiliateHeroPopover) — without
// the portal, two backdrop-blur layers create nested stacking contexts and
// the picker visually clashes with the surrounding modal.

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Lock, X } from "lucide-react";
import { Button, Card, IconButton, Pill } from "../primitives";
import { Avatar } from "../primitives";
import {
  AVATARS,
  formatUnlockMoney,
  isUnlocked,
  nextUnlock,
  TIER_LABEL,
  type AvatarTier,
} from "../../lib/avatars";
import { setChosenAvatarId, useChosenAvatarId } from "../../lib/avatarChoice";

export function AvatarPicker({
  earnedUsd,
  onClose,
}: {
  earnedUsd: number;
  onClose: () => void;
}) {
  const { avatarId } = useChosenAvatarId();
  const next = nextUnlock(earnedUsd);

  // Esc to close + lock background scroll while the picker is open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function pick(id: string): Promise<void> {
    await setChosenAvatarId(id);
    onClose();
  }

  const overlay = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-paper/90 p-6"
      onClick={onClose}
    >
      <Card
        elevation="raised"
        padding="none"
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
              choose your avatar
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              earned ${earnedUsd.toFixed(2)}
              {next && (
                <>
                  {" · "}
                  next unlock {next.label} at {formatUnlockMoney(next.unlock_usd)}
                </>
              )}
            </span>
          </div>
          <IconButton variant="ghost" label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          {(["rookie", "climber", "pro", "titan"] as AvatarTier[]).map((tier) => {
            const tierAvatars = AVATARS.filter((a) => a.tier === tier);
            const tierUnlocked = tierAvatars.every((a) => isUnlocked(a, earnedUsd));
            const tierLabel = TIER_LABEL[tier];
            const tierThreshold = tierAvatars[0].unlock_usd;
            return (
              <section key={tier} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                    {tierLabel}
                  </span>
                  {tierUnlocked ? (
                    <Pill tone="fuchsia">unlocked</Pill>
                  ) : (
                    <Pill tone="neutral">
                      {formatUnlockMoney(tierThreshold)} to unlock
                    </Pill>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {tierAvatars.map((entry) => {
                    const unlocked = isUnlocked(entry, earnedUsd);
                    const selected = entry.id === avatarId;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => unlocked && void pick(entry.id)}
                        disabled={!unlocked}
                        title={
                          unlocked
                            ? entry.label
                            : `${entry.label} — earn ${formatUnlockMoney(entry.unlock_usd)} to unlock`
                        }
                        className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 transition-all ${
                          selected
                            ? "border-fuchsia bg-fuchsia-soft/30 shadow-[var(--glow-sm)]"
                            : unlocked
                              ? "border-line bg-paper-elev hover:border-fuchsia/40 hover:bg-paper-warm"
                              : "border-line bg-paper-elev opacity-40 cursor-not-allowed"
                        }`}
                      >
                        <Avatar avatarId={entry.id} size="md" />
                        <span className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary">
                          {entry.label}
                        </span>
                        {!unlocked && (
                          <span className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-paper-warm/80 text-text-tertiary">
                            <Lock size={9} strokeWidth={2.5} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            choice saves per device
          </span>
          {avatarId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void pick("")}
              title="Use your profile photo / initials instead"
            >
              Reset
            </Button>
          )}
        </footer>
      </Card>
    </div>
  );

  // Render outside the React tree so the picker isn't trapped under a
  // parent modal's stacking context or clipped by an ancestor's overflow.
  return createPortal(overlay, document.body);
}
