/**
 * AssetRansomPaywall · loss-aversion paywall for free-tier feature completion.
 *
 * Ships 2026-07-06 (Max · ransom-paywall handoff). Every gated action —
 * clip 11+ export · thumbnail download · custom captions · watermark
 * removal · schedule confirm · earn publish — routes here at the LAST
 * step. The user's finished asset renders behind a frosted scrim (they
 * see what they've earned), the Whop checkout embed sits above, one
 * click unlocks + auto-fires the deferred action.
 *
 * Non-negotiables (per handoff §1 + Daniel's brief):
 *   - Card-on-file from Gate 1 makes the checkout one-tap (~1s to confirm).
 *   - "Maybe later" keeps the app usable · editor state preserved · asset
 *     stays in drafts. NEVER freeze on dismiss.
 *   - No pre-lock tier badges. Free user hits Export normally, sees paywall
 *     ONLY here.
 *   - Accessibility: focus trap · role="dialog" · aria-modal="true" · Esc
 *     fires onDismiss (never onUnlocked · dismiss is honest).
 *   - Watchdog-wrapped (identity/ransom-paywall/<trigger>) so any Whop
 *     runtime crash renders KadeRepairScreen instead of freezing.
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WhopCheckoutEmbed } from "@whop/checkout/react";
import { Watchdog } from "../../lib/watchdog";
import { useModalPortal, useRegisterModal } from "../../design-os/components/ModalPortal";
import { WHOP_FOUNDER_PLAN_ID } from "../../lib/whopCheckout";
import { useMe } from "../../design-os/state/useMe";
import "./AssetRansomPaywall.css";

export type RansomTrigger =
  | "clip-11-export"
  | "thumbnail-download"
  | "custom-caption-export"
  | "watermark-removal"
  | "schedule-confirm"
  | "earn-publish";

export type AssetPreview =
  | { kind: "video"; src: string; posterUrl?: string }
  | { kind: "image"; src: string }
  | { kind: "node"; content: ReactNode };

export interface AssetRansomPaywallProps {
  trigger: RansomTrigger;
  assetPreview: AssetPreview;
  onUnlocked: () => void | Promise<void>;
  onDismiss: () => void;
  isOpen: boolean;
}

/* Copy dictionary · locked voice (feedback_voice_no_bounty_use_skill.md).
 * Banned word: bounty · use skill / clip job / paid post. */
const COPY: Record<RansomTrigger, { headline: string; sub: string }> = {
  "clip-11-export":         { headline: "Your 11th clip is ready.",             sub: "Free tier ends at 10. Unlock unlimited." },
  "thumbnail-download":     { headline: "Your thumbnail is ready.",             sub: "Download it + generate unlimited thumbs." },
  "custom-caption-export":  { headline: "Your styled captions are ready.",      sub: "Ship this look on every clip." },
  "watermark-removal":      { headline: "Your clean export is ready.",          sub: "Lose the corner logo forever." },
  "schedule-confirm":       { headline: "Your post is queued.",                 sub: "Confirm to lock the time. Cancel anytime." },
  "earn-publish":           { headline: "Your paid post is ready to ship.",     sub: "Publish + start earning · payouts land in your connected account." },
};

const FEATURE_MANIFEST = "watermark off · unlimited clips · thumbnail studio · custom captions · schedule · earn campaigns";

export function AssetRansomPaywall(props: AssetRansomPaywallProps): ReactElement | null {
  if (!props.isOpen) return null;
  return (
    <Watchdog
      id={`identity/ransom-paywall/${props.trigger}`}
      label={`Asset ransom paywall · ${props.trigger}`}
      cluster="identity"
      source="src/components/paywall/AssetRansomPaywall.tsx"
    >
      <AssetRansomPaywallInner {...props} />
    </Watchdog>
  );
}

function AssetRansomPaywallInner({
  trigger,
  assetPreview,
  onUnlocked,
  onDismiss,
}: AssetRansomPaywallProps): ReactElement | null {
  const copy = COPY[trigger];
  const headlineId = `ransom-headline-${trigger}`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const me = useMe();
  const [completing, setCompleting] = useState(false);

  /* Lens RP-P1-003 fix (2026-07-06) · register with the app-wide
   * ModalPortal so we get LIFO Esc handling + body scroll-lock
   * coordinated with every other modal (Drawer / InboxSheet /
   * WatermarkTrialConfirm / etc.). Prior version installed its own
   * capture-phase Esc + no scroll lock — a competing modal above
   * would double-dismiss, and background scroll during checkout was
   * a real UX bug on long assets. Portal is applied at render below. */
  useRegisterModal({
    id: `ransom-paywall/${trigger}`,
    open: true,
    onEscape: onDismiss,
  });
  const portalHost = useModalPortal();

  /* Focus management · trap Tab within the dialog · restore on unmount.
   * Lens RP-P1-006 fix (2026-07-06) · iframe-aware. Whop's checkout
   * embed is an <iframe> which steals focus opaquely — document
   * .activeElement becomes the iframe element, not a member of our
   * focusables set. Prior `activeElement === first/last` check
   * silently failed on tab-out and released focus into the background
   * cockpit. Now: if activeElement is an iframe, treat any Tab as an
   * intentional escape into the checkout, don't fight it. Shift+Tab
   * from the iframe returns to our Maybe-later button naturally. */
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const dlg = dialogRef.current;
    if (!dlg) return;
    const focusables = dlg.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusables.length === 0) return;
      // Iframe (Whop) is the active element · trust the browser to
      // move focus into / out of it naturally.
      if (document.activeElement instanceof HTMLIFrameElement) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Only restore focus if the previously-focused element still
      // lives in the document. Otherwise leave focus wherever the
      // unmounting caller has placed it.
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, []);

  const handleComplete = async (): Promise<void> => {
    setCompleting(true);
    /* Whop granted membership on plan_NMKvKj8SVVKsY · backend
     * apply_membership_tier fires via /whop/checkout-success · we
     * refresh /me so useTierCaps flips to agency BEFORE we invoke
     * onUnlocked. Belt and braces: even if reload throws (network
     * blip), we still fire onUnlocked because the checkout
     * completed · Whop is the source of truth. */
    try {
      await me.reload();
    } catch {
      /* non-fatal · onUnlocked will re-fetch as needed */
    }
    try {
      await onUnlocked();
    } finally {
      setCompleting(false);
    }
  };

  /* Lens RP-P1-003 fix (2026-07-06) · portal into ModalPortal host so
   * `position: fixed` resolves against the viewport, not a transformed
   * cockpit ancestor (`.lc-page` has perspective:1200px). Falls back to
   * document.body when the ModalPortal context isn't provided (e.g.
   * legacy shell paths). */
  const paywallTree = (
    <div
      className="lc-ransom-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headlineId}
      data-trigger={trigger}
      data-testid="asset-ransom-paywall"
    >
      {/* Scrim + locked asset preview behind the modal. Frosted to
       *  say "your asset is done · you can see it · one tap unlocks". */}
      <div className="lc-ransom-asset" aria-hidden="true">
        <RansomAssetPreview preview={assetPreview} />
        <div className="lc-ransom-asset-scrim" />
        <div className="lc-ransom-asset-badge">🔒 LOCKED</div>
      </div>

      <div className="lc-ransom-modal" ref={dialogRef}>
        <div className="lc-ransom-copy">
          <h2 id={headlineId} className="lc-ransom-headline">
            {copy.headline}
          </h2>
          <p className="lc-ransom-sub">{copy.sub}</p>
          {/* Lens RP-P0-002 fix (2026-07-06) · honest price copy. The
           *  ransom paywall wires WHOP_FOUNDER_PLAN_ID (plan_NMKvKj8SVVKsY)
           *  which is documented at whopCheckout.ts:47-57 as "$99.99/mo
           *  immediate charge · no trial". Prior copy "$0 today ·
           *  $99.99/mo after · cancel anytime" was a Gate-1 plan
           *  description ($0-then-$1/365d free-with-card) accidentally
           *  wired to the Agency ransom paywall. Fixed to match the
           *  actual plan semantic. */}
          <p className="lc-ransom-price">
            $99.99/mo · charged now · cancel anytime
          </p>
        </div>

        <div
          className="lc-ransom-checkout"
          aria-live="polite"
          aria-busy={completing}
        >
          <WhopCheckoutEmbed
            planId={WHOP_FOUNDER_PLAN_ID}
            theme="dark"
            skipRedirect
            onComplete={() => {
              void handleComplete();
            }}
            fallback={
              <div className="lc-ransom-checkout-fallback">
                loading checkout…
              </div>
            }
          />
        </div>

        <p className="lc-ransom-manifest">Unlocks: {FEATURE_MANIFEST}</p>

        <button
          type="button"
          className="lc-ransom-dismiss"
          onClick={onDismiss}
          disabled={completing}
        >
          Maybe later
        </button>
      </div>
    </div>
  );

  /* Render into ModalPortal host (portal preserves React context so
   * useMe / useRegisterModal / bus continue to work correctly from
   * the descendant tree). Fall through to document.body if the host
   * hasn't been created yet — matches every other portaled modal in
   * the app (Drawer, ThumbnailPromptPreview, UploadPortal). */
  const host = portalHost ?? (typeof document !== "undefined" ? document.body : null);
  if (!host) return null;
  return createPortal(paywallTree, host);
}

function RansomAssetPreview({ preview }: { preview: AssetPreview }): ReactElement {
  if (preview.kind === "video") {
    return (
      <video
        className="lc-ransom-asset-media"
        src={preview.src}
        poster={preview.posterUrl}
        muted
        loop
        playsInline
        autoPlay
      />
    );
  }
  if (preview.kind === "image") {
    return <img className="lc-ransom-asset-media" src={preview.src} alt="" />;
  }
  return <div className="lc-ransom-asset-node">{preview.content}</div>;
}
