/**
 * FounderInviteHero · empty-state hero for pre-first-drop founders.
 * 2026-07-17
 *
 * Renders above the CommandRoom tile grid when the free-tier user has
 * NOT yet dropped a source video. The Kade K5 empty-invite art carries
 * the "come in, drop something, let's begin" moment.
 *
 * Auto-hides the moment `allowanceUsedSeconds > 0` (Whisper ran) OR
 * the freeBundleState leaves `available`. Never re-appears in the same
 * session after that.
 *
 * Non-blocking · purely decorative + informational · does not intercept
 * clicks on the tile grid beneath it.
 */
import { useMemo, type ReactElement } from "react";
import { useMe, type MeSnapshot } from "../../design-os/state/useMe";

/**
 * Shared visibility rule so peer surfaces (e.g. HomeBanner in
 * CommandRoom) can align render decisions against the exact same
 * predicate. Never let a caller re-implement this predicate.
 */
function computeFounderInviteHeroVisible(snap: MeSnapshot | null): boolean {
  if (!snap) return false;
  // Null planTier = /me hasn't fully hydrated · treat as free.
  if (snap.planTier && snap.planTier !== "free") return false;
  if (snap.allowanceUsedSeconds > 0) return false;
  if (snap.freeBundleState && snap.freeBundleState !== "available") return false;
  return true;
}

/** Peer-facing predicate hook. HomeBanner uses this to suppress
 * itself while the founder hero is on-screen. */
export function useFounderInviteHeroVisible(): boolean {
  const me = useMe();
  return useMemo(() => computeFounderInviteHeroVisible(me.snapshot), [me.snapshot]);
}

export function FounderInviteHero(): ReactElement | null {
  const me = useMe();
  const snap = me.snapshot;

  const shouldRender = useMemo(() => computeFounderInviteHeroVisible(snap), [snap]);
  if (!shouldRender) return null;

  return (
    <section
      className="lc-founder-invite-hero"
      data-testid="founder-invite-hero"
      aria-label="Welcome to Liquid Clips"
    >
      <img
        src="/brand/home/kade-empty-invite.png"
        alt=""
        className="lc-founder-invite-hero-art"
        loading="eager"
        decoding="async"
      />
      <div className="lc-founder-invite-hero-copy">
        <p className="lc-founder-invite-hero-eb">Founder seat · reserved</p>
        <h2 className="lc-founder-invite-hero-title">
          Drop a video to begin.
        </h2>
        <p className="lc-founder-invite-hero-sub">
          Drop your first video · we&rsquo;ll cut up to 10 AI clips ·
          watermarked · yours to keep. 100 lifetime exports.
        </p>
      </div>
      <style>{HERO_STYLES}</style>
    </section>
  );
}

const HERO_STYLES = `
.lc-founder-invite-hero {
  position: relative;
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 20px;
  align-items: center;
  margin: 0 0 16px;
  padding: 18px 22px 18px 18px;
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(20, 6, 18, 0.9) 0%, rgba(6, 2, 10, 0.9) 100%),
    radial-gradient(ellipse at 22% 50%, rgba(255, 26, 140, 0.18) 0%, transparent 60%);
  border: 1px solid rgba(255, 26, 140, 0.22);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.42),
    0 0 40px rgba(255, 26, 140, 0.14),
    0 0 0 1px rgba(255, 26, 140, 0.08) inset;
  color: #f4f1ea;
  font-family: "Inter", system-ui, sans-serif;
  animation: lc-founder-invite-in 380ms ease-out;
}
@keyframes lc-founder-invite-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.lc-founder-invite-hero-art {
  width: 160px;
  height: 160px;
  object-fit: contain;
  border-radius: 16px;
  filter: drop-shadow(0 12px 32px rgba(255, 26, 140, 0.36));
}
.lc-founder-invite-hero-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lc-founder-invite-hero-eb {
  margin: 0;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #ff66b8;
}
.lc-founder-invite-hero-title {
  margin: 2px 0 4px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #f4f1ea;
}
.lc-founder-invite-hero-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(244, 241, 234, 0.74);
  max-width: 520px;
}
@media (max-width: 720px) {
  .lc-founder-invite-hero {
    grid-template-columns: 1fr;
    text-align: center;
    padding: 22px;
  }
  .lc-founder-invite-hero-art {
    justify-self: center;
    width: 140px;
    height: 140px;
  }
}
`;
