// Pink/fuchsia perspective grid floor for the splash game arena.
// Pure CSS · zero asset cost · animation-free · sits behind everything
// else on the splash. Mounted only on the game stage (no impact on
// intro/loading stages).
import "./SplashGrid.css";

export function SplashGrid() {
  return (
    <div className="splash-grid" aria-hidden="true" data-testid="splash-grid">
      <div className="splash-grid-floor" />
    </div>
  );
}
