// Phase 8 · Mount #3 (2026-07-04) · WalletDetail is now the canonical
// AccountSection surface. The Section B port rendered the full account
// view — populated CLIPPERS roster · streak / paid / grace / cancelled
// row states · hover detail cards · drop ledger with fictional names
// (Marcus B., Chris N., Ella C., Alex R., Amy A., Jax H., Clara A.,
// Cole & Sam, Sasha G., Maya K. — guard rail 5). Prior AccountSection
// stub HUD cards read from `fixtures/fakeAccount.preview` and did not
// carry any user state (guard rail 11).
//
// Phase 8 · Mount #5 (2026-07-04) · CancellationIntercept is fired from
// a subtle "Cancel subscription" button pinned to the top-right corner
// of the account view. Section B's CancellationIntercept owns the
// full retention modal (loss table · coach video · Keep vs Cancel
// CTAs). `onKeep` dismisses the intercept and returns the user to the
// wallet view. `onQuiet` also dismisses today — the real Whop cancel
// wire (POST /whop/cancel-subscription or the SDK equivalent) is not
// yet implemented; when it lands, replace the `TODO(phase-9)`
// placeholder in `handleQuietCancel` with the real call. Mount #5's
// goal is reachability of the intercept surface, not the actual
// cancellation RPC.
//
// IG-011 (webview room height cascade) is not applicable here —
// AccountSection is not a native-webview room. WalletDetail owns its
// own layout with the `.wd-root` full-viewport container.
//
// Kade decoupling: WalletDetail already computes its per-state kade
// pose internally via `stageDataState` and never imports the shared
// Kade anchor. `scripts/lint-kade-decoupling.sh` + `assert-kade-anchor.sh`
// stay green after this mount.
import { useCallback, useState } from "react";
import { WalletDetail } from "../../routes/wallet-detail/WalletDetail";
import { CancellationIntercept } from "../../routes/cancellation-intercept/CancellationIntercept";

// Corner-pinned trigger. Sized to sit above the intro-splash z-index
// so a first-run user with the demo-shown overlay pinned to
// bottom-right doesn't see the two collide. `pointerEvents` is
// isolated to the button itself so the underlying wallet-row hover
// interactions still fire.
const CANCEL_TRIGGER_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 20,
  right: 20,
  padding: "8px 14px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-ink-soft)",
  background: "rgba(11, 11, 16, 0.55)",
  border: "1px solid var(--color-line)",
  borderRadius: 999,
  cursor: "pointer",
  zIndex: 40,
  backdropFilter: "blur(8px)",
};

export function AccountSection() {
  const [cancelOpen, setCancelOpen] = useState(false);

  const handleKeepSubscription = useCallback(() => {
    setCancelOpen(false);
  }, []);

  const handleQuietCancel = useCallback(() => {
    // TODO(phase-9) · wire the real Whop cancel-subscription RPC here.
    // Mount #5's scope was reachability of the intercept surface only
    // (guard rail 12 · WIRE only · no new RPC wrappers). Once the
    // /whop/cancel-subscription endpoint lands, replace this comment
    // with `void whopCancelSubscription()` and preserve the modal
    // dismissal below so the UI still closes even if the RPC errors.
    setCancelOpen(false);
  }, []);

  return (
    <>
      <WalletDetail />
      <button
        type="button"
        style={CANCEL_TRIGGER_STYLE}
        onClick={() => setCancelOpen(true)}
        data-testid="account-cancel-subscription"
        aria-label="Cancel subscription"
      >
        Cancel subscription
      </button>
      {cancelOpen && (
        <CancellationIntercept
          onKeep={handleKeepSubscription}
          onQuiet={handleQuietCancel}
        />
      )}
    </>
  );
}
