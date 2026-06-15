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
//
// v0.7.77 polish: motion entry stagger + button focus rings + aria labels.

import { motion, useReducedMotion } from "motion/react";

export function ProjectsLockedScreen({
  onUpgrade,
  onBrowseEarn,
  onOpenLibrary,
}: {
  onUpgrade: () => void;
  onBrowseEarn: () => void;
  onOpenLibrary: () => void;
}) {
  const reduced = useReducedMotion();
  const initialY = reduced ? 0 : 8;
  const transition = reduced
    ? { duration: 0.12 }
    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <motion.div
      className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 pt-6"
      role="region"
      aria-label="Projects locked"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.12 : 0.24 }}
    >
      <motion.div
        className="flex flex-col gap-2"
        initial={{ opacity: 0, y: initialY }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition, delay: reduced ? 0 : 0.04 }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
          projects · pro
        </span>
        <h1 className="font-display text-[clamp(24px,3.4vw,30px)] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          Organise clips into campaigns, clients, and earning goals.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          Projects are included with Liquid Clips Pro. Upgrade to organise
          your clips into workspaces, attach clips to campaigns, and manage
          earning Projects.
        </p>
      </motion.div>

      <motion.div
        className="flex flex-wrap items-center gap-2"
        initial={{ opacity: 0, y: initialY }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition, delay: reduced ? 0 : 0.12 }}
      >
        <button
          type="button"
          onClick={onUpgrade}
          aria-label="Upgrade to Liquid Clips Pro"
          className="btn-primary focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          Upgrade to Pro →
        </button>
        <button
          type="button"
          onClick={onBrowseEarn}
          aria-label="Browse public Earn bounties"
          className="btn-secondary focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          Browse Earn
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          aria-label="Open Library"
          className="btn-secondary focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          Open Library
        </button>
      </motion.div>
    </motion.div>
  );
}
