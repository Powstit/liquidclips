/**
 * WatermarkTrialConfirmModal · C1-T5 · 2026-07-05
 *
 * Trial-active user confirmation for the "remove watermark now"
 * flow. Rendered when `paywall.confirmingTrial` flips true from
 * `useWatermarkRemovalPaywall()`. The modal is pure presentation —
 * all state + the audit-tick RPC live in the hook.
 *
 * Copy is deliberately blunt about the money moment (§13a locked
 * pricing: $99.99/mo · charged now · watermark drops immediately).
 * Keep + Charge are the only two choices — no third state.
 */

import type { WatermarkRemovalPaywall } from "../../lib/useWatermarkRemovalPaywall";
import { useRegisterModal } from "../../design-os/components/ModalPortal";

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.66)",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
};

const CARD_STYLE: React.CSSProperties = {
  maxWidth: 460,
  width: "100%",
  background: "var(--color-paper, #14141b)",
  border: "1px solid var(--color-line-strong, rgba(255,255,255,0.14))",
  borderRadius: 16,
  padding: 28,
  color: "var(--color-ink, #ffffff)",
  boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const TITLE_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-display, inherit)",
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "-0.02em",
};

const BODY_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--color-ink-soft, rgba(255,255,255,0.7))",
};

const ERROR_STYLE: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--color-fuchsia, #ff1a8c)",
  background: "var(--color-fuchsia-soft, rgba(255,26,140,0.10))",
  color: "var(--color-fuchsia-deep, #ff1a8c)",
  fontSize: 13,
  lineHeight: 1.4,
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  marginTop: 6,
};

// Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) · both button
// styles bumped to min-height 44px so the WCAG 2.5.5 touch minimum
// is met even on Charge-my-card / Keep-trial. Prior 10-20px padding
// produced ~40px total height · sub-target for a money moment.
const KEEP_STYLE: React.CSSProperties = {
  padding: "12px 18px",
  minHeight: 44,
  borderRadius: 999,
  border: "1px solid var(--color-line-strong, rgba(255,255,255,0.14))",
  background: "transparent",
  color: "var(--color-ink-soft, rgba(255,255,255,0.7))",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const CHARGE_STYLE: React.CSSProperties = {
  padding: "12px 20px",
  minHeight: 44,
  borderRadius: 999,
  border: "1px solid var(--color-fuchsia, #ff1a8c)",
  background: "var(--color-fuchsia, #ff1a8c)",
  color: "var(--color-paper, #14141b)",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
  fontWeight: 600,
};

export interface WatermarkTrialConfirmModalProps {
  paywall: WatermarkRemovalPaywall;
}

export function WatermarkTrialConfirmModal({
  paywall,
}: WatermarkTrialConfirmModalProps) {
  const open = paywall.confirmingTrial;
  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · Esc + shared
  // scroll-lock via ModalPortal stack. Only the TOP-most modal's
  // onEscape fires so opening this from within PublishModule doesn't
  // dismiss two surfaces at once.
  useRegisterModal({ id: "watermark-trial-confirm", open, onEscape: paywall.cancelConfirm });
  if (!open) return null;
  return (
    <div
      style={OVERLAY_STYLE}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wm-trial-confirm-title"
      data-testid="watermark-trial-confirm-modal"
      onClick={(e) => e.target === e.currentTarget && paywall.cancelConfirm()}
    >
      <div style={CARD_STYLE}>
        <div id="wm-trial-confirm-title" style={TITLE_STYLE}>
          Charge my card $99.99 now?
        </div>
        <div style={BODY_STYLE}>
          Ending your trial early charges your card on file for the
          full month ($99.99) and drops the Liquid watermark immediately.
          Your card auto-charges on day 8 anyway if you keep the trial.
        </div>
        {paywall.errorMessage && (
          <div style={ERROR_STYLE} role="status" aria-live="polite">
            {paywall.errorMessage}
          </div>
        )}
        <div style={ROW_STYLE}>
          <button
            type="button"
            style={KEEP_STYLE}
            onClick={paywall.cancelConfirm}
            disabled={paywall.pending}
            data-testid="watermark-trial-keep"
          >
            Keep trial
          </button>
          <button
            type="button"
            style={CHARGE_STYLE}
            onClick={() => void paywall.confirmCharge()}
            disabled={paywall.pending}
            aria-busy={paywall.pending}
            data-testid="watermark-trial-charge"
          >
            {paywall.pending ? "Charging…" : "Charge $99.99"}
          </button>
        </div>
      </div>
    </div>
  );
}
