/**
 * SessionResetButton · IG-014-B recovery affordance · 2026-07-18
 *
 * Detects the "stuck keychain" state — where localStorage says the user
 * is signed out (`hasJwt() === false`) but the OS Keychain still holds a
 * stale LICENSE_JWT entry (`hasJwtKeychainPresence() === true`). That
 * state used to trap users on the login screen with no way forward: the
 * legacy `clearJwtKeychainForAuthAction()` silently swallowed the Tauri
 * purge failure, then the OAuth callback couldn't overwrite the existing
 * entry, so the app booted as signed-out forever.
 *
 * Fixed 2026-07-18 · Daniel's spec: "ensure the fix can never regress
 * ever." Iron gate IG-014-B at authStorage.ts locks the boolean return
 * type + diagnostic emission; this component + its test guarantee the
 * UX affordance stays live.
 */

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import {
  hasJwt,
  hasJwtKeychainPresence,
  clearJwtKeychainForAuthAction,
} from "../../lib/authStorage";
import { lcDiag } from "../../lib/diagnosticLogger";

interface SessionResetButtonProps {
  /** Called after a successful reset so parent surfaces (e.g. the
   *  login panel) can retry the OAuth flow with a clean slate. */
  onReset?: () => void;
}

type ResetState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "stuck-detected" }
  | { kind: "purging" }
  | { kind: "purged" }
  | { kind: "purge-failed" };

const FALLBACK_CMD =
  'security delete-generic-password -s "app.liquidclips.desktop" -a "LICENSE_JWT"';

export function SessionResetButton({
  onReset,
}: SessionResetButtonProps): JSX.Element | null {
  const [state, setState] = useState<ResetState>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inMemory = hasJwt();
        const inKeychain = await hasJwtKeychainPresence();
        if (cancelled) return;
        if (!inMemory && inKeychain) {
          setState({ kind: "stuck-detected" });
          lcDiag("auth.stuck_keychain_detected", {
            source: "SessionResetButton",
          });
        } else {
          setState({ kind: "idle" });
        }
      } catch {
        if (!cancelled) setState({ kind: "idle" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReset = useCallback(async () => {
    setState({ kind: "purging" });
    const ok = await clearJwtKeychainForAuthAction();
    if (ok) {
      setState({ kind: "purged" });
      lcDiag("auth.session_reset_success", { source: "SessionResetButton" });
      onReset?.();
    } else {
      setState({ kind: "purge-failed" });
      lcDiag("auth.session_reset_failed", { source: "SessionResetButton" });
    }
  }, [onReset]);

  if (state.kind === "checking" || state.kind === "idle") return null;

  return (
    <div
      role="status"
      data-testid="session-reset-button"
      data-state={state.kind}
      style={styles.wrap}
    >
      <div aria-hidden="true" style={styles.icon}>
        ⚠
      </div>
      <div style={styles.body}>
        {state.kind === "stuck-detected" && (
          <>
            <div style={styles.title}>
              You&rsquo;re signed out, but a stale credential is still in your keychain.
            </div>
            <div style={styles.hint}>
              This can block a fresh sign-in. Reset the session to fix it — no data lost.
            </div>
            <button
              type="button"
              onClick={handleReset}
              data-testid="session-reset-do"
              style={styles.btn}
            >
              Reset session
            </button>
          </>
        )}
        {state.kind === "purging" && <div style={styles.title}>Purging keychain…</div>}
        {state.kind === "purged" && (
          <>
            <div style={styles.title}>Session reset. Sign in again below.</div>
            <div style={styles.hint}>Your saved clips + settings survive.</div>
          </>
        )}
        {state.kind === "purge-failed" && (
          <>
            <div style={styles.title}>Keychain purge blocked by macOS.</div>
            <div style={styles.hint}>
              Copy this into Terminal and press Enter, then reopen the app:
            </div>
            <pre data-testid="session-reset-fallback" style={styles.cmd}>
              {FALLBACK_CMD}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    marginBottom: 8,
    borderRadius: 12,
    border: "1px solid rgba(255, 190, 46, 0.32)",
    background: "rgba(255, 190, 46, 0.08)",
    color: "#f4f1ea",
    alignItems: "flex-start",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
  },
  icon: {
    fontSize: 16,
    lineHeight: "20px",
    color: "#ffbe2e",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.35,
  },
  hint: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "rgba(244, 241, 234, 0.68)",
  },
  btn: {
    marginTop: 6,
    padding: "8px 14px",
    borderRadius: 8,
    border: 0,
    background: "linear-gradient(180deg, #ffbe2e, #e0a410)",
    color: "#1a1108",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  cmd: {
    marginTop: 4,
    padding: "8px 10px",
    borderRadius: 6,
    background: "rgba(0, 0, 0, 0.42)",
    color: "#f4f1ea",
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};
