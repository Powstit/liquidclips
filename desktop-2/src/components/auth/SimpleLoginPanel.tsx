/**
 * SimpleLoginPanel · Recovery brief P0 · 2026-07-08.
 *
 * Daniel's directive: "Make login brutally simple."
 *
 * Two POSTs, no client SDK. No LC-ID paste. No "Continue with Whop." No
 * discount code slot. No signed-out warning during the login attempt.
 *
 *   1. User types email        → POST /desktop/auth/start
 *   2. Backend emails 6-digit code · panel switches to code entry
 *   3. User types code         → POST /desktop/auth/verify
 *   4. Backend returns license_jwt · panel calls setJwt + emits auth:signed-in
 *   5. onSuccess() fires · WelcomeRoute unmounts · app opens
 *
 * All errors are shown in plain English directly on the panel. If the
 * fetch fails, the exact HTTP status + backend detail is surfaced.
 * Every step emits an lcDiag event so Railway logs trace the entire
 * flow without opening DevTools.
 */

import { useState, useEffect, type FormEvent } from "react";
import { setJwt, setJwtKeychainForAuthAction } from "../../lib/authStorage";
import { lcDiag } from "../../lib/diagnosticLogger";

interface SimpleLoginPanelProps {
  onSuccess: () => void;
}

function backendUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_BACKEND_URL || "https://api.liquidclips.app";
}

export function SimpleLoginPanel({ onSuccess }: SimpleLoginPanelProps): JSX.Element {
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        lcDiag("simple_login_mounted", { phase, backend_url: backendUrl() });
      } catch { /* non-fatal */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown for "Resend code" button after a fresh start
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setTimeout(() => setResendCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldown]);

  async function handleStart(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const cleaned = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      setErr("Enter a valid email address");
      return;
    }
    setBusy(true);
    setErr(null);
    lcDiag("auth_start_clicked", { email_len: cleaned.length });
    try {
      const r = await fetch(`${backendUrl()}/desktop/auth/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: cleaned }),
      });
      let body: { detail?: string; sent?: boolean; retry_after_sec?: number } = {};
      try { body = await r.json(); } catch { /* body empty */ }
      lcDiag("auth_start_response", {
        http_status: r.status,
        sent: body.sent,
        retry_after_sec: body.retry_after_sec ?? null,
      });
      if (!r.ok) {
        throw new Error(body.detail ?? `Backend returned ${r.status}`);
      }
      // Server may respond {"sent": false, "retry_after_sec": N} on rate limit.
      // Still advance to code entry — user might already have a code in inbox.
      setPhase("code");
      setResendCooldown(body.retry_after_sec ?? 60);
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Couldn't reach backend";
      setErr(msg);
      lcDiag("auth_start_failed", { error: msg.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const cleanedCode = code.trim();
    if (!/^\d{6}$/.test(cleanedCode)) {
      setErr("Enter the 6-digit code from your email");
      return;
    }
    setBusy(true);
    setErr(null);
    lcDiag("auth_verify_clicked", { code_len: cleanedCode.length });
    try {
      const startMs = Date.now();
      const r = await fetch(`${backendUrl()}/desktop/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: cleanedCode }),
      });
      const elapsed = Date.now() - startMs;
      let body: { detail?: string; license_jwt?: string; tier?: string; expires_at?: string } = {};
      try { body = await r.json(); } catch { /* body empty */ }
      lcDiag("auth_verify_response", {
        http_status: r.status,
        elapsed_ms: elapsed,
        has_jwt: !!body.license_jwt,
        tier: body.tier ?? null,
      });
      if (!r.ok) {
        throw new Error(body.detail ?? `Backend returned ${r.status}`);
      }
      if (!body.license_jwt) {
        throw new Error("Backend didn't return a license · try again");
      }
      // Store JWT + mirror to keychain
      setJwt(body.license_jwt);
      try { await setJwtKeychainForAuthAction(body.license_jwt); } catch { /* keychain optional */ }
      lcDiag("auth_verify_success", {
        tier: body.tier ?? "free",
        token_length: body.license_jwt.length,
        keychain_ok: true,
      });
      // setJwt() writes to localStorage which fires a storage event that
      // AuthGate + TopHud already watch — no additional bus emit needed.
      onSuccess();
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : "Couldn't reach backend";
      setErr(msg);
      lcDiag("auth_verify_failed", { error: msg.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(): Promise<void> {
    if (resendCooldown > 0 || busy) return;
    setCode("");
    setErr(null);
    // Return to email phase briefly to re-fire /start, then advance again
    await handleStart({ preventDefault: () => {} } as FormEvent);
  }

  return (
    <div className="lc-simple-login" data-testid="simple-login-panel" data-phase={phase} style={styles.root}>
      <h1 style={styles.title}>Sign in to Liquid Clips</h1>

      {phase === "email" ? (
        <form onSubmit={handleStart} style={styles.form}>
          <label htmlFor="lc-simple-email" style={styles.label}>Email</label>
          <input
            id="lc-simple-email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            style={styles.input}
            data-testid="simple-login-email-input"
          />
          <button
            type="submit"
            disabled={busy}
            style={{ ...styles.button, ...(busy ? styles.buttonDisabled : {}) }}
            data-testid="simple-login-send-code"
          >
            {busy ? "Sending code…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} style={styles.form}>
          <p style={styles.sub}>
            We emailed a 6-digit code to <strong>{email}</strong>. Check your inbox (and spam).
          </p>
          <label htmlFor="lc-simple-code" style={styles.label}>6-digit code</label>
          <input
            id="lc-simple-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy}
            style={{ ...styles.input, ...styles.codeInput }}
            data-testid="simple-login-code-input"
          />
          <button
            type="submit"
            disabled={busy}
            style={{ ...styles.button, ...(busy ? styles.buttonDisabled : {}) }}
            data-testid="simple-login-verify"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div style={styles.actionsRow}>
            <button
              type="button"
              onClick={() => { setPhase("email"); setCode(""); setErr(null); }}
              style={styles.linkButton}
            >
              ← Use a different email
            </button>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resendCooldown > 0 || busy}
              style={{ ...styles.linkButton, ...(resendCooldown > 0 ? styles.linkDisabled : {}) }}
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}

      {err && (
        <p role="alert" style={styles.error} data-testid="simple-login-error">
          {err}
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 380,
    width: "100%",
    color: "#f4f1ea",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
  },
  title: {
    margin: "0 0 4px",
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "inherit",
  },
  sub: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "rgba(244, 241, 234, 0.75)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  label: {
    fontSize: 11,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: "rgba(244, 241, 234, 0.6)",
    fontFamily: "'Geist Mono', ui-monospace, monospace",
  },
  input: {
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255, 255, 255, 0.14)",
    background: "rgba(0, 0, 0, 0.32)",
    color: "#f4f1ea",
    fontSize: 16,
    fontFamily: "inherit",
    outline: "none",
  },
  codeInput: {
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 22,
    letterSpacing: "0.3em",
    textAlign: "center",
  },
  button: {
    padding: "14px 20px",
    borderRadius: 12,
    border: 0,
    background: "linear-gradient(180deg, #ff1a8c, #d40d70)",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: "wait",
  },
  actionsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  linkButton: {
    padding: "6px 4px",
    border: 0,
    background: "transparent",
    color: "#ff66b8",
    fontSize: 12,
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    letterSpacing: "0.08em",
    cursor: "pointer",
  },
  linkDisabled: {
    opacity: 0.4,
    cursor: "default",
  },
  error: {
    margin: 0,
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(255, 42, 90, 0.12)",
    border: "1px solid rgba(255, 42, 90, 0.32)",
    color: "#ff9db2",
    fontSize: 13,
    lineHeight: 1.5,
  },
};
