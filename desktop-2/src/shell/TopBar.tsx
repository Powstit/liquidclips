import type { SectionEntry } from "./sectionRegistry";
import { madeWithLiquidClips } from "../brand/brandAssets";

// BUG-046 · the legacy AppShell TopBar is `visibility: hidden !important`
// under Design OS (every Simulator route mounts DesignOSAppShell which
// hides the legacy shell · see src/design-os/components/AppShell.css).
// The customer-visible avatar+menu is now in TopHud's user pill. The
// duplicate AvatarOrbit + NotificationBell here were dead code AND
// collided with TopHud's harness testids · removed.

interface TopBarProps {
  section: SectionEntry;
}

export function TopBar({ section }: TopBarProps) {
  const flowId = section.flowIds[0] ?? "";
  const pillText = flowId ? `${section.id} · ${flowId}` : section.id;

  // BUG-046 · prior chrome had an "Upgrade" CTA in this hidden TopBar.
  // The CTA fired a toast → fake-action pattern BUG-038 killed. Since
  // the entire TopBar is `visibility: hidden` under Design OS, this
  // CTA was never customer-reachable anyway. Removed entirely. Real
  // billing lives only in the Settings route's "Plan & access" card.

  return (
    <header className="lc-topbar">
      <div className="lc-topbar-title">{section.label}</div>
      <span className="lc-topbar-pill">{pillText}</span>
      <div className="lc-topbar-spacer" />
      <img
        className="lc-topbar-watermark"
        src={madeWithLiquidClips}
        alt="Made with Liquid Clips"
        height={18}
      />
    </header>
  );
}
