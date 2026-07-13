/**
 * ActivateFounderPanel · P0 first-run access · shell-before-Whop · 2026-07-08
 *
 * After Clerk OTP lands a license JWT and the shell mounts, the
 * MembershipGate checks whether the user has an active subscription.
 * When they don't, this panel materializes as a DISMISSIBLE floating
 * card inside the app · Whop iframe opens IN-APP (InlineWhopCheckout),
 * never in a browser tab, never as a first-run wall.
 *
 * Dismissible on purpose: the free tier is a real product surface (10
 * clips · no watermark for the first N). The panel is a nudge, not a
 * gate. Once dismissed, `lc.membership.activate-nudge-dismissed-at` is
 * set for 24h so we don't re-nag on every route change.
 *
 * Success (Whop webhook landing) fires `activation:complete` which
 * WelcomeGate + useMe already react to. This panel unmounts on next
 * useMe snapshot showing `subscription_status === "active"`.
 */
import { useState, type ReactElement } from "react";
import { InlineWhopCheckout, type InlineWhopCheckoutReceipt } from "../checkout/InlineWhopCheckout";
import { WHOP_FOUNDER_PLAN_ID } from "../../lib/whopCheckout";
import { bus } from "../../design-os/bridge";

const NUDGE_DISMISSED_KEY = "lc.membership.activate-nudge-dismissed-at";
const NUDGE_DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000;

// Ship-lens P0-G01 fix (2026-07-08) · was hardcoding the legacy
// grandfathered `plan_VWj1uoy2RcOsg`. Import the current locked
// Founder plan id from the shared whopCheckout module so a single
// source of truth drives every checkout URL. Overridable via
// `VITE_WHOP_FOUNDER_PLAN_ID` for staging plans.
function planId(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_WHOP_FOUNDER_PLAN_ID;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return WHOP_FOUNDER_PLAN_ID;
}

// Track panel-shown telemetry once per mount so the funnel view can
// read shown → continue → dismiss without double-counting on re-renders.
// Ship-lens P2-G07 · symmetric funnel.
let _shownTelemetryFiredForMount = new WeakSet<object>();

/** Read-only helper the parent gate uses to decide whether to mount. */
export function isNudgeDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(NUDGE_DISMISSED_KEY);
    if (!raw) return false;
    const t = Number(raw);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < NUDGE_DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

function markNudgeDismissed(): void {
  try {
    window.localStorage.setItem(NUDGE_DISMISSED_KEY, String(Date.now()));
  } catch { /* private mode · never crash */ }
}

interface ActivateFounderPanelProps {
  /** User's verified email · prefilled into the Whop checkout for
   *  one-click flow. */
  email?: string;
  /** Fires after the Whop iframe reports a successful checkout receipt
   *  · MembershipGate unmounts this panel + re-fetches useMe. */
  onActivated: (receipt: InlineWhopCheckoutReceipt) => void;
  /** Fires when the user closes the panel (either the ✕ or the
   *  "Maybe later" link). MembershipGate marks the nudge dismissed and
   *  unmounts. */
  onDismiss: () => void;
}

export function ActivateFounderPanel({
  email,
  onActivated,
  onDismiss,
}: ActivateFounderPanelProps): ReactElement {
  const [showCheckout, setShowCheckout] = useState(false);
  // Ship-lens P1-G03 fix (2026-07-08) · processing state so a webhook
  // stall (Whop → junior-backend) doesn't hide the panel behind a
  // silent-success lie. onActivated flips this to "processing"; the
  // parent MembershipGate polls /me until tier flips or a max window
  // elapses, then either dismisses (real success) or reverts to the
  // CTA with a "still processing…" note.
  const [processing, setProcessing] = useState(false);

  function handleDismiss(): void {
    markNudgeDismissed();
    bus.emit("telemetry:whop-action", {
      action: "activate_panel_dismiss",
      url: "",
    });
    onDismiss();
  }

  // Ship-lens P2-G07 fix · fire panel-shown telemetry once per mount.
  const mountKey = { _: null };
  if (!_shownTelemetryFiredForMount.has(mountKey)) {
    _shownTelemetryFiredForMount.add(mountKey);
    bus.emit("telemetry:whop-action", {
      action: "activate_panel_shown",
      url: "",
    });
  }

  return (
    <div
      className="lc-activate-panel"
      // Ship-lens P1-G04 fix · was `role="dialog"` which VoiceOver /
      // NVDA / JAWS treat as focus-yanking modals. This panel is a
      // non-blocking nudge · `region` + `aria-label` matches the
      // approved accessible pattern for site-corner promos.
      role="region"
      aria-label="Agency Access activation"
      data-testid="activate-founder-panel"
    >
      <button
        type="button"
        className="lc-activate-close"
        aria-label="Dismiss activation nudge"
        onClick={handleDismiss}
        data-testid="activate-founder-close"
      >
        ×
      </button>

      {processing ? (
        <>
          <p className="lc-activate-eb">Activating…</p>
          <h2 id="lc-activate-title" className="lc-activate-title">
            Confirming your payment.
          </h2>
          <p className="lc-activate-sub">
            Whop received your payment. We&rsquo;re waiting on the webhook to
            unlock everything · usually 5-15 seconds. This panel closes
            automatically when your tier flips.
          </p>
        </>
      ) : !showCheckout ? (
        <>
          <p className="lc-activate-eb">Agency Access</p>
          <h2 id="lc-activate-title" className="lc-activate-title">
            Unlock everything.
          </h2>
          <p className="lc-activate-sub">
            You&rsquo;re in — free tier is 10 clips. Agency ($99.99/mo)
            lifts the cap, drops the watermark, and opens agency campaigns.
          </p>
          <div className="lc-activate-actions">
            <button
              type="button"
              className="lc-activate-cta"
              onClick={() => {
                bus.emit("telemetry:whop-action", {
                  action: "activate_panel_continue",
                  url: "",
                });
                setShowCheckout(true);
              }}
              data-testid="activate-founder-continue"
            >
              Continue with Whop
            </button>
            <button
              type="button"
              className="lc-activate-later"
              onClick={handleDismiss}
              data-testid="activate-founder-later"
            >
              Maybe later
            </button>
          </div>
        </>
      ) : (
        <InlineWhopCheckout
          planId={planId()}
          email={email}
          onComplete={(receipt) => {
            // Ship-lens P1-G03 fix · flip to processing state instead
            // of setDismissedInSession=true. Parent polls /me until
            // tier flips + then dismisses via the onActivated bubble.
            setProcessing(true);
            onActivated(receipt);
          }}
        />
      )}

      <style>{ACTIVATE_STYLES}</style>
    </div>
  );
}

const ACTIVATE_STYLES = `
.lc-activate-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 50;
  width: min(420px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 24px;
  border-radius: 18px;
  background: linear-gradient(180deg, #140612 0%, #0a0308 100%);
  border: 1px solid rgba(255, 26, 140, 0.32);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.62),
    0 0 0 1px rgba(255, 26, 140, 0.12) inset,
    0 0 40px rgba(255, 26, 140, 0.24);
  color: #f4f1ea;
  font-family: "Inter", system-ui, sans-serif;
  animation: lc-activate-slide-in 240ms ease-out;
}
@keyframes lc-activate-slide-in {
  from { transform: translateY(12px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.lc-activate-close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(244, 241, 234, 0.72);
  font-size: 18px;
  cursor: pointer;
  transition: background 120ms;
}
.lc-activate-close:hover { background: rgba(255, 255, 255, 0.12); }
.lc-activate-eb {
  margin: 0 0 6px;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #ff66b8;
}
.lc-activate-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #f4f1ea;
}
.lc-activate-sub {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(244, 241, 234, 0.72);
}
.lc-activate-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.lc-activate-cta {
  font-family: "Inter", system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 10px;
  border: 0;
  background: linear-gradient(180deg, #ff1a8c, #d40d70);
  color: #ffffff;
  cursor: pointer;
  transition: transform 100ms, box-shadow 120ms;
}
.lc-activate-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(255, 26, 140, 0.36);
}
.lc-activate-later {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 8px 12px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: rgba(244, 241, 234, 0.55);
  cursor: pointer;
}
.lc-activate-later:hover { color: rgba(244, 241, 234, 0.85); }
`;
