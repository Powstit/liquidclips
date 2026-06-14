// v0.7.73 FIX-3 — Projects locked screen.
//
// Premium value screen for free / solo / signed-out users. The nav item +
// dashboard tile stay visible to everyone so the section is discoverable;
// this is what users see when they click Projects without Pro.
//
// Hierarchy (per Daniel's spec):
//   title → headline → locked copy → primary CTA → 2 secondary CTAs.
//   No warning-box styling. No feature list. No scattered buttons.
//
// CTAs:
//   • Upgrade to Pro — calls the canonical openUpgradeWhenSignedIn
//     helper via the onUpgrade prop. Helper opens Whop checkout via the
//     account-app upgrade page when JWT is cached; otherwise it triggers
//     connect-desktop activation first then opens checkout on return.
//   • Browse Earn — routes to Earn (public bounties stay free)
//   • Open Library — routes to Library (casual outputs stay free)
//
// No passive Keychain reads. No "Reactivate" copy.

export function ProjectsLockedScreen({
  onUpgrade,
  onBrowseEarn,
  onOpenLibrary,
}: {
  onUpgrade: () => void;
  onBrowseEarn: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 pt-6">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
          projects · pro
        </span>
        <h1 className="font-display text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          Organise clips into campaigns, clients, and earning goals.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Projects are included with Liquid Clips Pro. Upgrade to organise
          your clips into workspaces, attach clips to campaigns, and manage
          earning Projects.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onUpgrade} className="btn-primary">
          Upgrade to Pro →
        </button>
        <button type="button" onClick={onBrowseEarn} className="btn-secondary">
          Browse Earn
        </button>
        <button type="button" onClick={onOpenLibrary} className="btn-secondary">
          Open Library
        </button>
      </div>
    </div>
  );
}
