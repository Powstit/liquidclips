import { achievement } from "../brand/brandAssets";

interface AchievementToastProps {
  show: boolean;
  title?: string;
  blurb?: string;
}

export function AchievementToast({
  show,
  title = "First clip",
  blurb = "You shipped your first 9 / 16. The studio remembers.",
}: AchievementToastProps) {
  return (
    <div className={`lc-toast${show ? "" : " is-hidden"}`} role="status" aria-live="polite">
      <img src={achievement("first-clip")} alt="" aria-hidden="true" draggable={false} />
      <div className="lc-toast-meta">
        <div className="lc-toast-eyebrow">unlocked</div>
        <div className="lc-toast-title">{title}</div>
        <div className="lc-toast-blurb">{blurb}</div>
      </div>
    </div>
  );
}
