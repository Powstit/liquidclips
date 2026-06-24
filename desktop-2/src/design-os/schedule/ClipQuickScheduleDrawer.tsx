/**
 * ClipQuickScheduleDrawer · Phase 6J-C
 *
 * Thin wrapper around ScheduleFromExportDrawer that owns the
 * "what targets do we pre-select?" decision for surfaces that don't
 * already have a TargetAccountsRow (ClipCard in Engine results, future
 * Library cards).
 *
 * Why a wrapper:
 *   - ScheduleFromExportDrawer is presentational and takes `targets` as a
 *     prop. The Export route owns its TargetAccountsRow state; ClipCard
 *     does not. This wrapper bridges the gap by sourcing default targets
 *     from `useChannels().asTargetAccounts` (channel-id space, no more
 *     fixture id-space mismatch) limited by the active tier cap.
 *   - No duplicate scheduling UI · drawer body + styles all reused.
 */

import { useMemo } from "react";
import { ScheduleFromExportDrawer } from "./ScheduleFromExportDrawer";
import { useChannels } from "../state/useChannels";
import { useTierCaps } from "../state/useTierCaps";
import { bus } from "../bridge";

export interface ClipQuickScheduleDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Clip context · ScheduleFromExportDrawer expects `{ idx, title }`. */
  clip: { idx: number; title: string } | null;
  /** Project slug · falls into the new ScheduledJob.projectSlug field. */
  projectSlug: string;
  /** Hide brand badges (Clipper). */
  hideBrand?: boolean;
  /** Optional · called after a successful schedule. Default behaviour
   *  navigates to /schedule. Pass a custom handler if the caller wants to
   *  stay on the current route. */
  onScheduled?: (count: number) => void;
}

export function ClipQuickScheduleDrawer({
  open, onClose, clip, projectSlug, hideBrand, onScheduled,
}: ClipQuickScheduleDrawerProps) {
  const channels = useChannels();
  const tier = useTierCaps();

  /* Pre-pick the first N connected channels (N = accountsPerClip cap).
   * Drawer reads targets as a prop so this list stays stable while the
   * drawer is open — channel additions during the open session won't
   * surprise the user mid-confirm. */
  const targets = useMemo(() => {
    const connected = channels.asTargetAccounts.filter(
      (a) => a.state === "connected" || a.state === "active-target"
    );
    return connected
      .slice(0, tier.caps.accountsPerClip)
      .map((a) => ({ ...a, state: "active-target" as const }));
  }, [channels.asTargetAccounts, tier.caps.accountsPerClip]);

  const handleScheduled = (count: number) => {
    if (onScheduled) {
      onScheduled(count);
      return;
    }
    /* Default: route to /schedule so the user sees the new rows. */
    bus.emit("nav:click", { route: "schedule" });
  };

  return (
    <ScheduleFromExportDrawer
      open={open}
      onClose={onClose}
      targets={targets}
      clip={clip}
      projectSlug={projectSlug}
      hideBrand={hideBrand}
      onScheduled={handleScheduled}
    />
  );
}
