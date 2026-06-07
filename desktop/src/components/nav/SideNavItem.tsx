import { useState } from "react";
import type { LucideIcon } from "lucide-react";

// One rail item. Matches the existing NavTab prop shape (label + active +
// onClick + Icon) so converting call sites in App.tsx is a 1:1 swap.
//
// Behavior (per v0.6.0 sidebar restructure):
//   default → 28px icon, ink colour, 60% opacity
//   hover   → icon scales 1.1, opacity 100%, fuchsia tint, label pill 8px right
//   active  → opacity 100%, 3px fuchsia indicator bar on the LEFT edge,
//             icon stays ink (NOT fuchsia — only the bar is fuchsia),
//             small uppercase mono label rendered BELOW the icon
//   click   → 200ms fuchsia glow pulse on the bar (.lc-sidenav-pulse)
//
// Tooltip pills are suppressed on <800px widths via the .lc-sidenav-item CSS
// (media query in src/index.css).
//
// Icon source: either a Vite-bundled image URL via `iconSrc` (preferred — the
// custom OASIS-style badge icons land at src/assets/nav-icons/*.png) OR a
// lucide-react component via `Icon` (fallback for items without a custom
// badge yet, e.g. Account). Exactly one must be provided at runtime.
type SideNavItemBaseProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

type SideNavItemProps = SideNavItemBaseProps & {
  // Both optional in the type, but at least one must be set. Runtime guard
  // below throws a clear error if neither is provided (TS can't enforce
  // "at least one of two optionals" cleanly without a discriminated union,
  // and a union here would force every call site to spell out a discriminant
  // for no real gain).
  iconSrc?: string;
  Icon?: LucideIcon;
  /** v0.7.14 K-γ mount — opt-in anchor key for StudioTour's CoachMark
   *  spotlight (`[data-tour="<key>"]`). Set per SideNav item where the tour
   *  expects to land. */
  dataTour?: string;
};

export function SideNavItem({
  label,
  active,
  onClick,
  iconSrc,
  Icon,
  dataTour,
}: SideNavItemProps) {
  // Local pulse trigger — toggled true on click, cleared on animation end.
  // Cheaper than re-mounting the bar; the keyframe handles the timing.
  const [pulsing, setPulsing] = useState(false);

  if (!iconSrc && !Icon) {
    // Loud failure — much better than silently rendering a blank rail slot.
    throw new Error(
      `SideNavItem("${label}") requires either iconSrc or Icon to be set.`,
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setPulsing(true);
        onClick();
      }}
      aria-label={label}
      title={label}
      data-active={active ? "true" : "false"}
      data-tour={dataTour}
      className="lc-sidenav-item group relative flex w-full flex-col items-center justify-center gap-1 py-3"
    >
      {/* Left-edge fuchsia indicator bar — only visible when active. */}
      <span
        aria-hidden="true"
        data-pulsing={pulsing ? "true" : "false"}
        onAnimationEnd={() => setPulsing(false)}
        className="lc-sidenav-bar"
      />
      {/* v0.6.7 — Radial fuchsia halo behind the icon. Invisible by default,
          fades in on hover/active so the rail reads as polished + tactile
          without crowding the icon. Sits below the icon (z-index 0). */}
      <span aria-hidden="true" className="lc-sidenav-halo" />
      {/* Icon — 28px, ink, 60% opacity by default; CSS handles hover/active.
          Prefer the custom badge image when provided. */}
      {/* v0.6.35 — Inline width/height removed. CSS now drives badge size
          (56px in the new "rich" default, 36px in the collapsed rail). */}
      {iconSrc ? (
        <img
          src={iconSrc}
          alt=""
          aria-hidden="true"
          loading="eager"
          draggable={false}
          className="lc-sidenav-icon lc-sidenav-item-icon-img"
        />
      ) : (
        Icon && (
          <Icon
            className="lc-sidenav-icon"
            size={28}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )
      )}
      {/* Active label — small uppercase mono, always visible when active.
          When inactive, .lc-sidenav-tooltip surfaces this same label as a
          pill on hover (8px to the right of the rail). */}
      <span className="lc-sidenav-label">{label}</span>
      <span className="lc-sidenav-tooltip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
