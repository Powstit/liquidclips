/**
 * InlineWhopCheckout · mandatory-authorization panel wrapping WhopCheckoutEmbed.
 *
 * Ships 2026-07-06 as State C of the LoginScreen. When the user picks
 * "I want to make clips" or the cold-lead "Sign in with Whop" CTA, we
 * swap the Kade + copy + buttons out for this inline picker so Whop's
 * card-on-file happens INSIDE the app · never in the OS browser · never
 * with a "Back" escape.
 *
 * Visual measurements come directly from the login-screen preview at
 * /tmp/lc-preview/login-screen-preview.html (State C):
 *   - 520px iframe height  · fits Whop's full checkout without scroll
 *   - 560px inner container override (see .lc-login-root[data-state="checkout"])
 *   - 20px card radius     · matches the demo notch cutout math
 *   - fuchsia glow, 4s     · lc-checkout-breathe animation
 *   - "Powered by Whop"    · top-center notch overlapping the border
 *
 * Watchdog-wrapped under identity/id-11/inline-whop-checkout so any
 * @whop/checkout runtime crash routes to KadeRepairScreen instead of
 * killing the LoginScreen shell.
 */

import { useEffect, type ReactElement } from "react";
import { WhopCheckoutEmbed } from "@whop/checkout/react";
import { Watchdog } from "../../lib/watchdog";

export interface InlineWhopCheckoutReceipt {
  planId: string;
  receiptId: string;
}

interface InlineWhopCheckoutProps {
  planId: string;
  email?: string;
  affiliateCode?: string;
  onComplete: (receipt: InlineWhopCheckoutReceipt) => void;
}

export function InlineWhopCheckout(props: InlineWhopCheckoutProps): ReactElement {
  return (
    <Watchdog
      id="identity/id-11/inline-whop-checkout"
      label="Inline Whop checkout"
      cluster="identity"
      source="src/components/checkout/InlineWhopCheckout.tsx"
    >
      <InlineWhopCheckoutInner {...props} />
    </Watchdog>
  );
}

function InlineWhopCheckoutInner({
  planId,
  email,
  affiliateCode,
  onComplete,
}: InlineWhopCheckoutProps): ReactElement {
  useEffect(() => {
    // Announce mount for HQ · the Watchdog registry above already fires
    // registerNode, but a fire-and-forget analytics ping here would be
    // where a future funnel tick lands. Left intentionally empty · avoid
    // scope creep.
  }, []);

  return (
    <>
      <style>{INLINE_CHECKOUT_STYLES}</style>
      {/* P0 fix (2026-07-08) · outer wrap holds the notch + halo without
       *  overflow:hidden so the "Powered by Whop" pill isn't sliced in
       *  half at its `translate(-50%, -50%)` overhang. Inner container
       *  keeps overflow:hidden so the iframe's own edges stay clipped
       *  cleanly. Fixes InlineWhopCheckout icon clipping seen by Daniel
       *  in the ship-day walk. */}
      <div className="lc-checkout-frame-wrap" data-testid="inline-whop-checkout">
        <div className="lc-checkout-notch" aria-hidden>
          <span>Powered by</span>
          <img src="/brand/whop-lockup-white.svg" alt="Whop" />
        </div>
        <div className="lc-checkout-frame-inner">
          <WhopCheckoutEmbed
            planId={planId}
            theme="dark"
            skipRedirect
            prefill={email ? { email } : undefined}
            affiliateCode={affiliateCode}
            onComplete={(receivedPlanId, receiptId) => {
              onComplete({
                planId: receivedPlanId ?? planId,
                receiptId: String(receiptId ?? ""),
              });
            }}
            fallback={
              <div className="lc-checkout-fallback">loading checkout…</div>
            }
          />
        </div>
      </div>
    </>
  );
}

const INLINE_CHECKOUT_STYLES = `
.lc-checkout-frame-wrap {
  position: relative;
  width: 100%;
  /* P0 fix (2026-07-08) · matches approved mirror at
   * docs/login-screen-preview.html:511. Viewport-height percentage
   * instead of a min-height floor so short viewports (1040x680)
   * shrink cleanly without shoving the notch off-screen.
   * Ship-lens P1-001 fix. */
  height: min(88vh, 780px);
  margin-top: 22px;
  border-radius: 20px;
  border: 1px solid rgba(255, 26, 140, 0.42);
  background: rgba(255, 255, 255, 0.02);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 26, 140, 0.10) inset,
    0 0 60px rgba(255, 26, 140, 0.28);
  animation: lc-checkout-breathe 4s ease-in-out infinite;
  /* P0 fix · outer allows notch + halo to render outside
   * bounds. Inner clips the iframe. */
  overflow: visible;
}
.lc-checkout-frame-inner {
  position: relative;
  width: 100%;
  height: 100%;
  /* Ship-lens P2-002 fix · matches mirror at
   * docs/login-screen-preview.html:524 · 20px inner radius. */
  border-radius: 20px;
  overflow: hidden;
}
/* Short-viewport carve-out · picker padding trim so wrap + chrome
 * fit within 680h without the notch clipping. */
@media (max-height: 720px) {
  .lc-checkout-frame-wrap {
    margin-top: 14px;
  }
}
@keyframes lc-checkout-breathe {
  0%, 100% {
    box-shadow:
      0 20px 40px rgba(0, 0, 0, 0.45),
      0 0 0 1px rgba(255, 26, 140, 0.10) inset,
      0 0 40px rgba(255, 26, 140, 0.22);
  }
  50% {
    box-shadow:
      0 24px 48px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 26, 140, 0.14) inset,
      0 0 80px rgba(255, 26, 140, 0.42);
  }
}
.lc-checkout-frame-inner > * {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  border-radius: 16px;
}
.lc-checkout-notch {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 26, 140, 0.42);
  background: linear-gradient(180deg, #150612 0%, #0d040c 100%);
  box-shadow:
    0 8px 20px rgba(0, 0, 0, 0.55),
    0 0 0 4px rgba(11, 4, 12, 0.9);
  font-family: "Geist Mono", ui-monospace, "SF Mono", monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(244, 241, 234, 0.82);
  white-space: nowrap;
  user-select: none;
  z-index: 4;
}
.lc-checkout-notch img {
  height: 14px;
  width: auto;
  display: block;
}
.lc-checkout-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(244, 241, 234, 0.6);
}
`;
