// Boss-wave overlay · renders the 3D-illustrated bug-mothbug as a single
// "boss" enemy above the invader formation on every 3rd wave. Pure visual
// flair · the actual engine collision still happens with the pixel-grid
// invaders below. When a boss-wave triggers, the WAVE 3 · BOSS label
// appears in the arena header (rendered by SplashHud).

import "./BossWave.css";

export function BossWave({ wave }: { wave: number }) {
  if (wave % 3 !== 0) return null;
  return (
    <div className="splash-boss" data-testid="splash-boss" aria-hidden="true">
      <img
        className="splash-boss-bug"
        src="/brand/enemies/bug-mothbug.webp"
        alt=""
      />
    </div>
  );
}
