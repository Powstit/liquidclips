/**
 * ArcadePanel · left-rail arcade cabinet marquee for the splash gameplay stage.
 *
 * Mirrors SplashLeaderboard's layout (absolute · vertical rail · same top/
 * bottom anchors) but on the LEFT side. Renders the $1,000 monthly prize
 * marquee with Kade as the tall hero figure, animated Tron background,
 * CSS-drawn marquee bays, and a live LEADER chip fed from the arcade
 * leaderboard hook that Batch 3E wired to real backend data.
 *
 * Composition (top → bottom, matches gameplay-panel-bg-v5.png):
 *   R1 · 0–6%   eyebrow marquee     · "HIGH SCORE"
 *   R2 · 6–21%  hero marquee         · "$1,000" + "TOP SCORE WINS"
 *   R3 · 21–74% stage                · canonical Kade shooter pose
 *   R4 · 74–81% progress marquee     · LEADER chip + 12 animated cells
 *   R5 · 81–94% invaders floor       · baked into bg
 *   R6 · 94–100% footer marquee      · unlock condition
 *
 * All marquee bays are CSS-drawn (cyan piping + inset glow) so their
 * positions are 100% predictable regardless of what the bg PNG contains.
 * Font sizes use `cqw` (container query width) so they scale with the
 * PANEL width, not viewport width — the "$1,000" can never overflow.
 */

import { useArcadeLeaderboard } from "../../lib/useArcadeLeaderboard";
import "./ArcadePanel.css";

interface ArcadePanelProps {
  /** Optional score to display on the LEADER chip when no live leader
   *  exists yet — falls back to a house copy in that case. */
  liveScore?: number;
}

export function ArcadePanel({ liveScore }: ArcadePanelProps = {}) {
  const arcade = useArcadeLeaderboard(5);
  const topClipper = arcade.clippers[0] ?? null;
  const topAgency = arcade.agencies[0] ?? null;
  // Whichever is higher wins the current-leader chip.
  const leader =
    topClipper && topAgency
      ? topClipper.score >= topAgency.score
        ? topClipper
        : topAgency
      : topClipper ?? topAgency;

  const leaderCopy = leader
    ? `LEADER · ${leader.handle.toUpperCase()} · ${leader.score.toLocaleString()}`
    : arcade.loading
    ? "LOADING LEADERBOARD…"
    : liveScore && liveScore > 0
    ? `YOUR SCORE · ${liveScore.toLocaleString()}`
    : "FIRST TO 1000 WINS FOUNDER";

  return (
    <aside
      className="arcade-panel"
      data-testid="arcade-panel"
      aria-label="Liquid Clips arcade prize marquee"
    >
      {/* Motion field — parallax sparks + scan sweep */}
      <div className="arcade-motion-field" aria-hidden="true">
        <span className="arcade-spark" style={{ left: "8%",  bottom: "-10%", animationDuration: "5s" }} />
        <span className="arcade-spark pink" style={{ left: "22%", bottom: "-20%", animationDuration: "7s", animationDelay: "1s" }} />
        <span className="arcade-spark" style={{ left: "38%", bottom: "-5%",  animationDuration: "6s", animationDelay: "2s" }} />
        <span className="arcade-spark" style={{ left: "55%", bottom: "-30%", animationDuration: "8s", animationDelay: "0.5s" }} />
        <span className="arcade-spark pink" style={{ left: "68%", bottom: "-15%", animationDuration: "5.5s", animationDelay: "3s" }} />
        <span className="arcade-spark" style={{ left: "84%", bottom: "-25%", animationDuration: "6.5s", animationDelay: "1.5s" }} />
        <span className="arcade-spark" style={{ left: "92%", bottom: "-8%",  animationDuration: "7.5s", animationDelay: "2.5s" }} />
        <span className="arcade-spark pink" style={{ left: "15%", bottom: "-35%", animationDuration: "9s" }} />
        <span className="arcade-spark" style={{ left: "45%", bottom: "-12%", animationDuration: "5.5s", animationDelay: "3.5s" }} />
        <span className="arcade-spark" style={{ left: "75%", bottom: "-22%", animationDuration: "6s",   animationDelay: "4s" }} />
      </div>
      <div className="arcade-scan-sweep" aria-hidden="true" />

      {/* R1 · Eyebrow */}
      <div className="arcade-row arcade-row-eyebrow">
        <div className="arcade-marquee-eyebrow">
          <span className="arcade-eyebrow-text">HIGH SCORE</span>
        </div>
      </div>

      {/* R2 · Hero marquee — the prize */}
      <div className="arcade-row arcade-row-hero">
        <div className="arcade-marquee-hero">
          <span className="arcade-prize">$1,000</span>
          <span className="arcade-prize-sub">TOP SCORE WINS</span>
        </div>
      </div>

      {/* R3 · Stage · Kade */}
      <div className="arcade-row-stage">
        <div className="arcade-kade-wrap">
          <div className="arcade-kade-halo" aria-hidden="true" />
          <img
            className="arcade-kade"
            src="/brand/kade/kade-shooter.webp"
            alt="Kade"
            draggable={false}
          />
          <div className="arcade-kade-pedestal" aria-hidden="true" />
        </div>
      </div>

      {/* R4 · Progress marquee + LEADER chip */}
      <div className="arcade-row arcade-row-progress">
        <div className="arcade-marquee-progress">
          <div className="arcade-leader-chip">{leaderCopy}</div>
          <div className="arcade-bars">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="arcade-cell" />
            ))}
          </div>
        </div>
      </div>

      {/* R5 · Invaders floor — baked into bg, no HTML */}
      <div className="arcade-row-floor" aria-hidden="true" />

      {/* R6 · Footer */}
      <div className="arcade-row arcade-row-footer">
        <div className="arcade-marquee-footer">
          <span className="arcade-footer-text">UNLOCKS AT 1K SUBS · DOUBLES PER 1K</span>
        </div>
      </div>
    </aside>
  );
}
