/**
 * UpgradeApprovalModal · v2.2.15
 *
 * The one-click convert moment. Fires on `trial:upgrade-request` from
 * anywhere in the app (TopHud pill, paywall 402, Settings, onboarding
 * card). Shows a single primary button that hits POST /me/trial/approve
 * → server calls Whop end-trial-early → charges card on file → webhook
 * flips tier to agency.
 *
 * Pricing pivot 2026-07-06 · Agency $99.99/mo is the sole paid plan.
 * Every copy string that historically referenced Solo/$29.99 has been
 * migrated to Agency/$99.99 so the money-path never leaks the
 * deferred Pro/Growth/Solo/Enterprise ladder to real users. If Whop
 * can't force-charge (unavailable), the modal still logs the click
 * and tells the user their $99.99 will land on the natural 7-day
 * timer. Same modal · honest copy branches on the returned state.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { bus, useEvent } from "../bridge";
import { approveTrialConversion, useTrial } from "../../lib/trial";
import { useRegisterModal } from "./ModalPortal";
import "./UpgradeApprovalModal.css";

export function UpgradeApprovalModal(): JSX.Element {
  const { trial, refresh } = useTrial();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "confirming" | "success" | "unavailable" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  useEvent("trial:upgrade-request", () => {
    // Only open the modal if the viewer is actually on a trial. Free
    // users hitting this event should be routed to the sign-up flow
    // instead (that's the caller's job — this modal is trial-only).
    if (trial.isTrialing) {
      setPhase("idle");
      setDetail(null);
      setOpen(true);
    }
  });

  const onApprove = async () => {
    setPhase("confirming");
    // 2026-08-11 — this had no try/catch. Both buttons are `disabled` while
    // phase === "confirming" (so a mid-flight Esc/click-away can't cancel
    // a real charge), but that means any exception here — the watchdog
    // wrapper around approveTrialConversion throws if its node is flagged
    // disabled, and any future throw would do the same — left phase stuck
    // at "confirming" forever, both buttons permanently dead, on a $99.99
    // card-charging modal. Reported live: exactly this state, both buttons
    // unresponsive. The existing "error" phase already has working
    // Close/Retry buttons a few lines below — route failures there instead
    // of hanging.
    try {
      const res = await approveTrialConversion();
      setDetail(res.detail);
      if (res.state === "approved") {
        setPhase("success");
        void refresh();
        bus.emit("trial:upgrade-resolved", { state: "approved" });
      } else if (res.state === "already_paid") {
        setPhase("success");
        void refresh();
        bus.emit("trial:upgrade-resolved", { state: "already_paid" });
      } else if (res.state === "unavailable" || res.state === "not_trialing") {
        setPhase("unavailable");
        bus.emit("trial:upgrade-resolved", { state: "unavailable" });
      } else {
        setPhase("error");
      }
    } catch {
      setDetail("Something went wrong · your card is untouched.");
      setPhase("error");
    }
  };

  const onDismiss = () => {
    if (phase === "confirming") return;
    setOpen(false);
    bus.emit("trial:upgrade-resolved", { state: "dismissed" });
  };

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · LIFO modal
  // registration for Esc + shared scroll-lock. Confirming phase is
  // guarded by the onDismiss early-return so Esc during checkout is
  // a no-op instead of cancelling mid-flight.
  useRegisterModal({ id: "upgrade-approval", open, onEscape: onDismiss });

  const clips = trial.clipsRemaining ?? 0;
  const days = trial.daysRemaining ?? 0;
  const headline =
    clips <= 0
      ? "You've clipped 100. Ready for unlimited?"
      : days <= 0
        ? "Your 7-day trial ended. Ready for unlimited?"
        : "Lock in Agency now?";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="upgrade-approval-backdrop"
          className="lc-upgrade-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDismiss}
          data-testid="lc-upgrade-modal"
        >
          <motion.div
            className="lc-upgrade-modal"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Upgrade approval"
          >
            {phase === "success" ? (
              <div className="lc-upgrade-modal-body is-success">
                <span className="lc-upgrade-modal-eyebrow">AGENCY UNLOCKED</span>
                <h2 className="lc-upgrade-modal-headline">🎉 You're on Agency.</h2>
                <p className="lc-upgrade-modal-copy">{detail ?? "Card on file charged · unlimited unlocked."}</p>
                <button type="button" className="lc-upgrade-modal-primary" onClick={onDismiss}>
                  Keep clipping
                </button>
              </div>
            ) : phase === "unavailable" ? (
              <div className="lc-upgrade-modal-body">
                <span className="lc-upgrade-modal-eyebrow">APPROVAL LOGGED</span>
                <h2 className="lc-upgrade-modal-headline">You're queued.</h2>
                <p className="lc-upgrade-modal-copy">{detail ?? "Your $99.99 will land on the natural 7-day timer."}</p>
                <button type="button" className="lc-upgrade-modal-primary" onClick={onDismiss}>
                  Got it
                </button>
              </div>
            ) : phase === "error" ? (
              <div className="lc-upgrade-modal-body">
                <span className="lc-upgrade-modal-eyebrow">COULDN'T REACH WHOP</span>
                <h2 className="lc-upgrade-modal-headline">Try again in a moment.</h2>
                <p className="lc-upgrade-modal-copy">{detail ?? "Network issue · your card is untouched."}</p>
                <div className="lc-upgrade-modal-actions">
                  <button type="button" className="lc-upgrade-modal-quiet" onClick={onDismiss}>Close</button>
                  <button type="button" className="lc-upgrade-modal-primary" onClick={() => void onApprove()}>
                    Retry
                  </button>
                </div>
              </div>
            ) : (
              <div className="lc-upgrade-modal-body">
                <span className="lc-upgrade-modal-eyebrow">
                  ONE-CLICK · CARD ON FILE
                </span>
                <h2 className="lc-upgrade-modal-headline">{headline}</h2>
                <p className="lc-upgrade-modal-copy">
                  Continue exporting, unlock hosted AI, keep your affiliate link. Your
                  Whop card is already on file · we charge $99.99/mo the moment you
                  approve.
                </p>
                <div className="lc-upgrade-modal-price-strip">
                  <div className="lc-upgrade-modal-price-row">
                    <span>Agency · monthly</span>
                    <span className="lc-upgrade-modal-price">$99.99</span>
                  </div>
                  <div className="lc-upgrade-modal-price-row lc-upgrade-modal-price-row-quiet">
                    <span>Cancel anytime</span>
                    <span>account.liquidclips.app</span>
                  </div>
                </div>
                <div className="lc-upgrade-modal-actions">
                  <button
                    type="button"
                    className="lc-upgrade-modal-quiet"
                    onClick={onDismiss}
                    data-testid="lc-upgrade-dismiss"
                    disabled={phase === "confirming"}
                  >
                    Not yet
                  </button>
                  <button
                    type="button"
                    className="lc-upgrade-modal-primary"
                    onClick={() => void onApprove()}
                    data-testid="lc-upgrade-approve"
                    disabled={phase === "confirming"}
                  >
                    {phase === "confirming" ? "Confirming with Whop…" : "Continue on Agency · $99.99/mo"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
