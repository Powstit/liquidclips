/**
 * ClaimHandleSheet · Wave 1 · Cluster 1 · identity ladder (2026-07-12).
 *
 * First-run bottom-sheet that lets a signed-in customer with no handle
 * claim one. Renders when ``useMe().snapshot.handle == null`` AND
 * ``useMe().snapshot.lcId != null`` (the LC-ID is what the user pastes
 * from the welcome email to recover — showing it here proves we're
 * about to persist against their real row).
 *
 * Ships with ``CrewOnboarding.onDone`` — mounted by the crew route so
 * the customer sees it exactly once at the end of the invite flow.
 * Dismissal is soft (``onDismiss()`` closes the sheet without
 * persistence); a later wave will add the 24h nudge for un-claimed
 * users.
 *
 * Contract:
 *   * regex ``^[a-z0-9_]{3,20}$`` — same shape the backend enforces so
 *     invalid submissions never leave the sheet.
 *   * reserved-word list mirrors ``junior-backend/app/routes/me.py``
 *     ``_RESERVED_CLAIM_HANDLES``.
 *   * on success, calls ``loadMe()`` (via ``useMe().reload``) to
 *     hydrate the ladder immediately — no need for the sheet to know
 *     about ``bus.emit``.
 *   * emits ``handle_claimed`` telemetry via ``lcDiag``.
 *
 * No new npm deps. Uses existing brand tokens from ``design-os/index``
 * indirectly (inline styles kept minimal + neutral). The sheet lives
 * in ``design-os/onboarding/`` so any future onboarding surface can
 * import from a stable location.
 */

import { useCallback, useMemo, useState } from "react";
import { useMe } from "../state/useMe";
import { authedFetch } from "../../lib/authedFetch";
import { lcDiag } from "../../lib/diagnosticLogger";

/** Local mirror of the backend regex. Kept identical (not imported)
 *  because the backend lives in a different repo tree and pulling a
 *  Python-source string into the TS bundle would require a build-time
 *  extractor. If either side changes without the other, the
 *  ``handle-claim.flow.test.ts`` grep-test flags the drift. */
const CLAIM_HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** Client-side mirror of the backend reserved-word set. See
 *  ``junior-backend/app/routes/me.py::_RESERVED_CLAIM_HANDLES``. Kept
 *  in sync manually — the flow test file grep-asserts the two sets
 *  match on every run so a drift fails CI before it ships. */
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "system-bot", "admin", "staff", "mod", "root", "founder",
  "whop", "liquid", "liquidclips", "liquid-clips", "kade",
  "support", "help", "billing", "hq",
  "guest", "anonymous", "you", "me", "self", "daniel",
  "clip", "clipper", "agency", "signin", "signup", "login", "logout",
]);

function envBackend(): string {
  try {
    const env = (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env;
    return (env?.VITE_BACKEND_URL ?? "https://api.liquidclips.app").replace(/\/+$/, "");
  } catch {
    return "https://api.liquidclips.app";
  }
}

export interface ClaimHandleSheetProps {
  /** Fires when the sheet is dismissed OR after a successful claim.
   *  The parent decides whether to unmount or leave the sheet in
   *  place; either way the ladder has already updated. */
  onClose: () => void;
  /** Test seam · override the backend URL. */
  backendBaseUrl?: string;
  /** Test seam · override the fetch implementation. Falls back to
   *  ``authedFetch`` so real deploys use the shared 401 interceptor. */
  fetcher?: typeof fetch;
}

/**
 * Returns a copy string describing why a handle is invalid. Null when
 * the handle passes local validation.
 */
function localValidation(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw.length === 0) return "Pick a handle to continue.";
  if (raw.length < 3) return "At least 3 characters.";
  if (raw.length > 20) return "20 characters or fewer.";
  if (!CLAIM_HANDLE_RE.test(raw)) return "Lowercase letters, numbers, and underscores only.";
  if (RESERVED_HANDLES.has(raw)) return "That one's reserved · pick another.";
  return null;
}

export function ClaimHandleSheet(props: ClaimHandleSheetProps): React.ReactElement | null {
  const me = useMe();
  const [input, setInput] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const backend = props.backendBaseUrl ?? envBackend();
  const fetchImpl = props.fetcher ?? authedFetch;

  const lcId = me.snapshot?.lcId ?? null;
  const handle = me.snapshot?.handle ?? null;

  const localError = useMemo(() => localValidation(input), [input]);
  const canSubmit = !submitting && localError === null && lcId !== null;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const trimmed = input.trim().toLowerCase();
    setSubmitting(true);
    setRemoteError(null);
    try {
      const res = await fetchImpl(`${backend}/me/lc-id/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: trimmed }),
      });
      if (res.status === 409) {
        setRemoteError("Handle already taken · pick another.");
        return;
      }
      if (res.status === 422) {
        setRemoteError("Handle format was rejected · try lowercase letters and numbers only.");
        return;
      }
      if (!res.ok) {
        setRemoteError(`Couldn't save (${res.status}) · try again in a moment.`);
        return;
      }
      // Success. Fire telemetry BEFORE reload so a slow /me refetch
      // never eats the ``handle_claimed`` topic. Payload is minimal
      // by design — HQ persistence lands in a later wave.
      try {
        lcDiag("handle_claimed", {
          lc_id: lcId,
          handle: trimmed,
          ts_ms: Date.now(),
        });
      } catch { /* diagnostic failures never block UI */ }
      // Reload /me so the identity ladder in TopHud +
      // SplashLeaderboard picks up the new handle within the same
      // React tick as the close.
      await me.reload();
      props.onClose();
    } catch (e) {
      setRemoteError(`Network hiccup · ${String(e).slice(0, 80)}`);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, input, backend, fetchImpl, lcId, me, props]);

  const onDismiss = useCallback(() => {
    if (submitting) return;
    props.onClose();
  }, [submitting, props]);

  // The sheet is only meaningful when we know the customer's LC-ID
  // (so we can show it as the "claim your handle" anchor) AND they
  // don't already have a handle. Both come from ``useMe``.
  if (lcId === null) return null;
  if (handle !== null) return null;

  return (
    <div
      className="lc-claim-handle-sheet"
      data-testid="claim-handle-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Claim your handle"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.55)",
        zIndex: 9_000,
        padding: 24,
      }}
      onKeyDown={(e) => { if (e.key === "Escape") onDismiss(); }}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          padding: 24,
          borderRadius: 20,
          background: "rgba(20, 12, 22, 0.98)",
          border: "1px solid rgba(255, 26, 140, 0.35)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.7)",
          color: "var(--color-paper, #f5f2ee)",
        }}
      >
        <div
          data-testid="claim-handle-lc-id"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(245, 242, 238, 0.72)",
            marginBottom: 6,
          }}
        >
          Your LC-ID: {lcId}
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 600,
            margin: "0 0 8px",
          }}
        >
          Claim your handle
        </h2>
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "rgba(245, 242, 238, 0.78)",
          }}
        >
          Your handle appears on your clips, leaderboard row, and referral
          share URL. Lowercase letters, numbers, and underscores only ·
          between 3 and 20 characters.
        </p>
        <label
          htmlFor="claim-handle-input"
          style={{
            display: "block",
            fontSize: 12,
            marginBottom: 6,
            color: "rgba(245, 242, 238, 0.72)",
          }}
        >
          Handle
        </label>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 12px",
            border: "1px solid rgba(255, 26, 140, 0.32)",
            borderRadius: 10,
            background: "rgba(0, 0, 0, 0.4)",
          }}
        >
          <span style={{ opacity: 0.55 }}>@</span>
          <input
            id="claim-handle-input"
            data-testid="claim-handle-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            style={{
              flex: 1,
              border: 0,
              background: "transparent",
              color: "inherit",
              fontFamily: "inherit",
              fontSize: 15,
              outline: "none",
            }}
          />
        </div>
        {(localError || remoteError) && (
          <div
            data-testid="claim-handle-error"
            role="alert"
            style={{
              marginTop: 8,
              fontSize: 13,
              color: "#ff9db3",
            }}
          >
            {remoteError ?? localError}
          </div>
        )}
        <div
          style={{
            marginTop: 18,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            data-testid="claim-handle-dismiss"
            onClick={onDismiss}
            disabled={submitting}
            style={{
              padding: "10px 14px",
              borderRadius: 9999,
              border: "1px solid rgba(245, 242, 238, 0.2)",
              background: "transparent",
              color: "inherit",
              cursor: submitting ? "wait" : "pointer",
              fontSize: 13,
            }}
          >
            Not now
          </button>
          <button
            type="button"
            data-testid="claim-handle-submit"
            onClick={() => void onSubmit()}
            disabled={!canSubmit}
            style={{
              padding: "10px 18px",
              borderRadius: 9999,
              border: "1px solid var(--color-fuchsia, #ff1a8c)",
              background: canSubmit ? "var(--color-fuchsia, #ff1a8c)" : "rgba(255, 26, 140, 0.35)",
              color: "var(--color-paper, #fff)",
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {submitting ? "Claiming…" : "Claim @" + (input.trim().toLowerCase() || "handle")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Exported for the flow test to grep the reserved list against the
 * backend list — keeps client + server locked-step. */
export const _RESERVED_HANDLES_FOR_TESTS = RESERVED_HANDLES;
export const _CLAIM_HANDLE_RE_FOR_TESTS = CLAIM_HANDLE_RE;
