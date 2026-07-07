/**
 * AddAccountPopover · Phase 6I-A · hook-driven foundation
 *
 * Lightbox-style picker for "add an account to this clip". Mounted via
 * ModalPortal so position: fixed resolves against the viewport.
 *
 * Phase 6I-A change · reads from `useChannels()` instead of the
 * `FIXTURE_AVAILABLE_ACCOUNTS` constant. The UI is unchanged. Account
 * states (connected · expired · failed · locked · pending-link) all
 * surface through the canonical `AccountChipState` renderer.
 *
 * Future Phase 6I-B (Channels route) will add the "Label this account"
 * Drawer + real OAuth handoff. The popover stays as the click-and-target
 * entry from Export · ClipCard · Studio.
 */

import { useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion as fm, AnimatePresence } from "framer-motion";
import { useModalPortal, useRegisterModal, GlassCard } from "../components";
import { AccountChipState } from "./AccountChipState";
import { useTierCaps } from "../state/useTierCaps";
import { useChannels } from "../state/useChannels";
import { channelToTargetAccount } from "../engine/sidecar-stub";
import type { TargetAccount } from "./types";
import { bus } from "../bridge";
import "./AddAccountPopover.css";

export interface AddAccountPopoverProps {
  open: boolean;
  onClose: () => void;
  /** Already-targeted account ids · displayed as "active-target" in the popover. */
  alreadyTargetedIds: ReadonlyArray<string>;
  /** Fires when the user clicks a connectable account. */
  onPick: (account: TargetAccount) => void;
}

export function AddAccountPopover({
  open, onClose, alreadyTargetedIds, onPick,
}: AddAccountPopoverProps) {
  const host = useModalPortal();
  const tier = useTierCaps();
  const channels = useChannels();
  useRegisterModal({ id: "add-account-popover", open, onEscape: onClose });

  // Group by platform — uses the hook's pre-grouped view.
  const groupedByPlatform = useMemo(() => channels.byPlatform, [channels.byPlatform]);

  if (!host) return null;

  // -------- Safe states (loading / error / empty) --------
  const renderSafe = (): ReactNode => {
    if (channels.loading) {
      return (
        <div className="lc-aap-safe">
          <span className="lc-aap-safe-eb">Loading channels…</span>
        </div>
      );
    }
    if (channels.error) {
      return (
        <div className="lc-aap-safe is-error">
          <span className="lc-aap-safe-eb">Couldn't load channels</span>
          <p className="lc-aap-safe-body">{channels.error}</p>
          <button type="button" className="lc-aap-plan-cta" onClick={() => void channels.reload()}>
            Retry
          </button>
        </div>
      );
    }
    if (channels.channels.length === 0) {
      return (
        <div className="lc-aap-safe is-empty">
          <span className="lc-aap-safe-eb">No accounts yet</span>
          <p className="lc-aap-safe-body">
            Connect your first social account in Channels (lands in Phase 6I-B).
          </p>
        </div>
      );
    }
    return null;
  };

  const safe = renderSafe();

  return createPortal(
    <AnimatePresence>
      {open && (
        <fm.div
          className="lc-aap-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label="Add account to clip"
        >
          <fm.div
            className="lc-aap-card"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 16, scale: 0.985, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.985, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <header className="lc-aap-head">
              <span className="lc-aap-eb">Add account · target this clip</span>
              <button
                type="button"
                className="lc-aap-close"
                aria-label="Close"
                onClick={onClose}
              >
                ×
              </button>
            </header>

            {/* Plan-limit strip · driven by useChannels + useTierCaps */}
            <GlassCard density="quiet" className="lc-aap-plan">
              <div className="lc-aap-plan-row">
                <div>
                  <span className="lc-aap-plan-eb">{tier.tier.toUpperCase()} plan</span>
                  <span className="lc-aap-plan-body">
                    {channels.connectedCount} of {tier.caps.totalChannels} channel slots used
                    {channels.needsAttentionCount > 0 && (
                      <>
                        {" "}· <span className="lc-aap-plan-attn">{channels.needsAttentionCount} need attention</span>
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="lc-aap-plan-cta"
                  onClick={() => bus.emit("toast", {
                    kind: "info", title: "Settings", body: "Billing surface lands in Phase 7+.",
                  })}
                >
                  Upgrade
                </button>
              </div>
            </GlassCard>

            <p className="lc-aap-intro">
              Pick a connected account. Locked + expired + failed + pending accounts surface here
              so you can act on them — real connect flow lands in Channels (Phase 6I-B).
            </p>

            {/* Body · safe state OR platform groups */}
            <div className="lc-aap-groups">
              {safe ?? Object.entries(groupedByPlatform).map(([platform, accounts]) => (
                <section key={platform} className="lc-aap-group">
                  <header className="lc-aap-group-head">
                    <span className="lc-aap-group-eb">
                      {platform}
                      {channels.connectedByPlatform[platform] != null && (
                        <span className="lc-aap-group-count">
                          {" "}· {channels.connectedByPlatform[platform]} of {tier.caps.perPlatformChannels} connected
                        </span>
                      )}
                    </span>
                    <span className="lc-aap-group-sub">
                      {accounts.length} total
                    </span>
                  </header>
                  <div className="lc-aap-group-row">
                    {accounts.map((sidecarChannel) => {
                      const adapted = channelToTargetAccount(sidecarChannel);
                      const isTargeted = alreadyTargetedIds.includes(adapted.id);
                      const displayState = isTargeted
                        ? { ...adapted, state: "active-target" as const }
                        : adapted;
                      const disabled = isTargeted
                        || adapted.state === "plan-limit-reached"
                        || adapted.state === "account-expired"
                        || adapted.state === "failed"
                        || adapted.state === "pending-link";
                      return (
                        <AccountChipState
                          key={adapted.id}
                          account={displayState}
                          variant="row"
                          onClick={disabled ? undefined : () => {
                            onPick(adapted);
                            onClose();
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <footer className="lc-aap-foot">
              <p className="lc-aap-foot-note">
                Real OAuth + connect flow lands with Phase 6I-B Channels build.
                Here, picking a connected account just toggles it as a target.
              </p>
            </footer>
          </fm.div>
        </fm.div>
      )}
    </AnimatePresence>,
    host,
  );
}
