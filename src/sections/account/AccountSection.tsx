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
import { useAuditableAction } from "../../lib/useAuditableAction";
import { bridgeToBackend, BridgeError } from "../../lib/bridgeToBackend";
// ag-13 (2026-07-06) · Sovereign-Operator Protocol · wrap the cancel-
// subscription surface so a Whop-side failure (network / 5xx /
// unavailable) surfaces on the HQ Admin dashboard for Daniel to triage
// live. Cancel is a critical money-moment — a swallowed error would
// leave the customer thinking they cancelled when they were still
// being billed. Backend citation: trial_convert.py:245 POST
// /me/trial/cancel.
import { Watchdog } from "../../lib/watchdog";

interface CancelSubscriptionResponse {
  state: "cancelled" | "already_cancelled" | "no_membership" | "unavailable";
  access_ends_at: string | null;
  detail: string;
}

function formatEndsAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

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
  const [cancelToast, setCancelToast] = useState<string | null>(null);

  const handleKeepSubscription = useCallback(() => {
    setCancelOpen(false);
  }, []);

  // 2026-07-05 · CM-T2 · real Whop cancel via new backend endpoint.
  // Was toast-only fake ("Your cancellation request is queued") which
  // lied to the user · they'd get billed next cycle. Now hits
  // POST /me/trial/cancel which calls Whop end_membership + surfaces
  // the actual state (cancelled with access-until date · no membership
  // · Whop unavailable). Wrapped in useAuditableAction so the audit
  // endpoint tracks the flow.
  const cancelAction = useAuditableAction<CancelSubscriptionResponse>(
    "subscription.cancel",
    async () => {
      const res = await bridgeToBackend<CancelSubscriptionResponse>(
        "POST",
        "/me/trial/cancel",
      );
      return res;
    },
    { surface: "AccountSection" },
  );

  const handleQuietCancel = useCallback(async () => {
    setCancelOpen(false);
    const result = await cancelAction.fire();
    if (result === null && cancelAction.lastError) {
      // BridgeError network / 5xx · surface the honest failure
      const bridgeMsg =
        cancelAction.lastError instanceof BridgeError
          ? `Cancel failed · ${cancelAction.lastError.message}`
          : "Cancel failed · check your connection and retry.";
      setCancelToast(bridgeMsg);
      window.setTimeout(() => setCancelToast(null), 12000);
      return;
    }
    if (!result) return;

    // Map the four backend states to distinct user-visible copy.
    if (result.state === "cancelled") {
      const endsAt = formatEndsAt(result.access_ends_at);
      setCancelToast(
        endsAt
          ? `Cancelled · access until ${endsAt}.`
          : "Cancelled · access continues until the end of the billing period.",
      );
    } else if (result.state === "already_cancelled") {
      setCancelToast("Already cancelled. No further action needed.");
    } else if (result.state === "no_membership") {
      setCancelToast(result.detail);
    } else {
      // "unavailable" · Whop refused · surface the support path
      setCancelToast(result.detail);
    }
    window.setTimeout(() => setCancelToast(null), 12000);
  }, [cancelAction]);

  return (
    <>
      <WalletDetail />
      <Watchdog
        id="agency/ag-13/cancel-subscription"
        label="Cancel subscription"
        cluster="agency"
        source="src/sections/account/AccountSection.tsx:cancel-trigger (backend trial_convert.py:245)"
      >
        <>
          <button
            type="button"
            style={CANCEL_TRIGGER_STYLE}
            onClick={() => setCancelOpen(true)}
            disabled={cancelAction.pending}
            data-testid="account-cancel-subscription"
            aria-label="Cancel subscription"
          >
            {cancelAction.pending ? "Cancelling…" : "Cancel subscription"}
          </button>
          {cancelToast ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--color-fuchsia)",
                background: "var(--color-fuchsia-soft)",
                color: "var(--color-fuchsia-deep)",
                fontSize: "0.85rem",
              }}
            >
              {cancelToast}
            </div>
          ) : null}
          {cancelOpen && (
            <CancellationIntercept
              onKeep={handleKeepSubscription}
              onQuiet={handleQuietCancel}
            />
          )}
        </>
      </Watchdog>
    </>
  );
}
