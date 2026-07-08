/**
 * ClerkOtpPanel · P0 first-run access primary sign-in lane · 2026-07-08
 *
 * Single smart input accepts an email OR a phone number. On submit we
 * (1) create a Clerk sign-in with that identifier, (2) prepareFirstFactor
 * with the matching strategy (`email_code` or `phone_code`), (3) collect
 * the 6-digit OTP, (4) attemptFirstFactor to verify, (5) setActive with
 * the created session, (6) getToken() via useAuth → POST
 * /auth/clerk/exchange, and (7) hand the returned Liquid Clips license
 * JWT to `authStorage.setJwt` + native keychain mirror so WelcomeGate
 * flips and the shell mounts.
 *
 * Source of truth: `@clerk/clerk-react` 5.61.8 · `signIn.create` +
 * `prepareFirstFactor` + `attemptFirstFactor` + `setActive` +
 * `useAuth().getToken()`. Public resource types imported from
 * `@clerk/shared/types` (canonical location per clerk-react's own
 * d.ts imports at node_modules/@clerk/clerk-react/dist/index.d.ts).
 *
 * Never logs the Clerk token or the LC JWT. Never logs the OTP code.
 * Phone normalization: E.164 pass-through, UK 07... → +447..., 00... → +...
 */
import { useState, type ReactElement, type FormEvent } from "react";
import { useAuth, useSignIn } from "@clerk/clerk-react";
import type {
  EmailCodeFactor,
  PhoneCodeFactor,
  SignInFirstFactor,
  SignInResource,
} from "@clerk/shared/types";
import { setJwt, setJwtKeychainForAuthAction } from "../../lib/authStorage";
import { logLoginStep } from "../../lib/loginTelemetry";

type Phase = "identifier" | "code" | "verifying" | "exchanging";

const CLERK_EXCHANGE_PATH = "/auth/clerk/exchange";

/** Public gate for WelcomeRoute · returns false when the Vite env-var
 *  is unset so the parent can render an LC-ID-first fallback panel
 *  instead of mounting ClerkOtpPanel and crashing on `useSignIn()`
 *  (which requires a ClerkProvider ancestor). */
export function isClerkAvailable(): boolean {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_CLERK_PUBLISHABLE_KEY;
    return typeof v === "string" && v.length > 0;
  } catch {
    return false;
  }
}

function backendUrl(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_BACKEND_URL;
    if (typeof v === "string" && v.length > 0) return v.replace(/\/+$/, "");
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/** UK-friendly phone normalizer. Full E.164 pass-through; `07…` and
 *  `00…` local formats get promoted. Anything else falls through to
 *  Clerk which will reject with a clear error. */
export function normalizePhone(raw: string): string {
  const s = raw.replace(/[\s\-().]/g, "");
  if (!s) return s;
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return `+${s.slice(2)}`;
  if (s.startsWith("07") && s.length === 11) return `+44${s.slice(1)}`;
  return s; // let Clerk decide
}

/** Cheap identifier discriminator. Prefer email if `@` present. */
export function classifyIdentifier(raw: string): "email" | "phone" {
  return raw.includes("@") ? "email" : "phone";
}

interface ClerkOtpPanelProps {
  /** Fired once the exchange lands + JWT is persisted. Host closes the
   *  Clerk state and lets WelcomeGate re-check `hasJwt()`. */
  onSuccess: () => void;
  /** Fires when Clerk returns a status we can't complete inline
   *  (needs_second_factor / needs_new_password). Host renders a
   *  "use LC-ID fallback" hint or routes to a specialized surface. */
  onNeedsAdvancedFlow?: (status: string) => void;
  /** Optional presentation hook — the LoginScreen root can style state
   *  transitions on this signal. */
  onPhaseChange?: (phase: Phase) => void;
}

export function ClerkOtpPanel({
  onSuccess,
  onNeedsAdvancedFlow,
  onPhaseChange,
}: ClerkOtpPanelProps): ReactElement {
  const { signIn, isLoaded, setActive } = useSignIn();
  const { getToken } = useAuth();

  const [identifier, setIdentifierRaw] = useState("");
  const [phase, setPhaseInner] = useState<Phase>("identifier");
  const [strategy, setStrategy] = useState<"email_code" | "phone_code" | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function setPhase(p: Phase): void {
    setPhaseInner(p);
    onPhaseChange?.(p);
  }

  /** Kick step 1-2: create a sign-in and send the first-factor code. */
  async function handleSendCode(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault();
    if (!isLoaded || !signIn) return;
    setErr(null);

    const kind = classifyIdentifier(identifier);
    const normalized =
      kind === "phone" ? normalizePhone(identifier) : identifier.trim();

    if (kind === "phone" && !normalized.startsWith("+")) {
      setErr("Phone must be in international format · e.g. +447700900000");
      return;
    }
    if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setErr("That doesn't look like a valid email");
      return;
    }

    setSending(true);
    logLoginStep("clerk_send_code_attempted", { kind });
    try {
      const attempt: SignInResource = await signIn.create({
        identifier: normalized,
      });

      const factor = attempt.supportedFirstFactors?.find((f: SignInFirstFactor) =>
        kind === "email"
          ? f.strategy === "email_code"
          : f.strategy === "phone_code",
      );
      if (!factor) {
        // Ship-lens P1-F04 fix · telemetry so we can see when the
        // configured Clerk instance doesn't offer OTP for a given user.
        logLoginStep("clerk_send_code_failed", {
          kind,
          err: "factor_unsupported",
        });
        setErr(
          kind === "email"
            ? "This account can't sign in with an email code"
            : "This account can't sign in with an SMS code · try email",
        );
        setSending(false);
        return;
      }

      if (kind === "email") {
        await attempt.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: (factor as EmailCodeFactor).emailAddressId,
        });
        setStrategy("email_code");
      } else {
        await attempt.prepareFirstFactor({
          strategy: "phone_code",
          phoneNumberId: (factor as PhoneCodeFactor).phoneNumberId,
        });
        setStrategy("phone_code");
      }
      setPhase("code");
      logLoginStep("clerk_send_code_succeeded", { kind });
    } catch (e2: unknown) {
      const msg =
        (e2 as { errors?: Array<{ longMessage?: string; message?: string }> })
          ?.errors?.[0]?.longMessage ??
        (e2 as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ??
        (e2 instanceof Error ? e2.message : "Couldn't send code · try again");
      setErr(msg);
      logLoginStep("clerk_send_code_failed", { kind, err: msg });
    } finally {
      setSending(false);
    }
  }

  /** Kick step 3-7: verify code, set active session, exchange with backend. */
  async function handleVerify(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault();
    if (!isLoaded || !signIn || !strategy) return;
    if (!/^\d{6}$/.test(code)) {
      setErr("Enter the 6-digit code from your email or phone");
      return;
    }
    setErr(null);
    setPhase("verifying");
    logLoginStep("clerk_verify_attempted", { strategy });

    let attempt: SignInResource;
    try {
      attempt = await signIn.attemptFirstFactor({ strategy, code });
    } catch (e2: unknown) {
      const msg =
        (e2 as { errors?: Array<{ longMessage?: string; message?: string }> })
          ?.errors?.[0]?.longMessage ??
        (e2 as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ??
        "Code invalid or expired";
      setErr(msg);
      setPhase("code");
      logLoginStep("clerk_verify_failed", { strategy, err: msg });
      return;
    }

    // Ship-lens P0-F02 fix · handle every non-complete status. The
    // union is `needs_identifier | needs_first_factor | needs_second_factor
    // | needs_new_password | complete` per @clerk/shared/dist/types
    // /index.d.ts. Only `complete` should land the exchange · everything
    // else routes the user to the LC-ID fallback so a MFA-enabled or
    // password-reset-required account isn't locked out silently.
    if (attempt.status === "needs_second_factor") {
      logLoginStep("clerk_verify_failed", {
        strategy,
        err: "needs_second_factor",
      });
      setErr(
        "Two-factor is required on this account · use the LC-ID fallback below to continue.",
      );
      setPhase("code");
      onNeedsAdvancedFlow?.("needs_second_factor");
      return;
    }
    if (attempt.status === "needs_new_password") {
      logLoginStep("clerk_verify_failed", {
        strategy,
        err: "needs_new_password",
      });
      setErr(
        "Password reset required on this account · use the LC-ID fallback below to continue.",
      );
      setPhase("code");
      onNeedsAdvancedFlow?.("needs_new_password");
      return;
    }
    if (attempt.status !== "complete" || !attempt.createdSessionId) {
      logLoginStep("clerk_verify_failed", {
        strategy,
        err: attempt.status || "incomplete",
      });
      setErr("Sign-in incomplete · retry from the top");
      setPhase("identifier");
      return;
    }

    // Activate the session so `getToken()` reads from it.
    try {
      await setActive({ session: attempt.createdSessionId });
    } catch (e2: unknown) {
      const msg = e2 instanceof Error ? e2.message : "Couldn't activate session";
      setErr(msg);
      setPhase("code");
      return;
    }

    // Fetch the fresh session token via useAuth().getToken.
    // Ship-lens P1-F02 fix · use hook API instead of window.Clerk.
    setPhase("exchanging");
    try {
      const token = await getToken();
      if (!token) {
        setErr("Session token missing · retry sign-in");
        setPhase("identifier");
        return;
      }

      const r = await fetch(`${backendUrl()}${CLERK_EXCHANGE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clerk_session_token: token }),
      });
      if (!r.ok) {
        setErr(
          r.status === 403
            ? "Email must be verified before signing in"
            : r.status === 401
              ? "Session rejected · try again"
              : "Sign-in couldn't finish · try again",
        );
        setPhase("code");
        // Deliberately DON'T log the response body · could carry backend
        // stack traces or internals we don't want in HQ telemetry
        // (ship-lens P2-F02).
        logLoginStep("clerk_exchange_failed", { status: r.status });
        return;
      }
      const j = (await r.json()) as { license_jwt?: string };
      if (!j.license_jwt) {
        setErr("Backend didn't return a license · try again");
        setPhase("identifier");
        return;
      }
      // Ship-lens P1-F01 fix · mirror to the native keychain so a
      // webview storage wipe doesn't silently sign the user out.
      setJwt(j.license_jwt);
      await setJwtKeychainForAuthAction(j.license_jwt);
      logLoginStep("clerk_exchange_succeeded", { strategy });
      onSuccess();
    } catch (e2: unknown) {
      const msg = e2 instanceof Error ? e2.message : "Network error";
      setErr(msg);
      setPhase("code");
    }
  }

  async function handleResend(): Promise<void> {
    if (!strategy) return;
    setErr(null);
    setCode("");
    await handleSendCode();
  }

  const disabled = !isLoaded || sending || phase === "verifying" || phase === "exchanging";
  const identifierKind = classifyIdentifier(identifier);

  return (
    <div className="lc-clerk-panel" data-testid="clerk-otp-panel" data-phase={phase}>
      {phase === "identifier" ? (
        <form onSubmit={handleSendCode} className="lc-clerk-form">
          <label className="lc-clerk-label" htmlFor="clerk-identifier">
            Continue with email or phone
          </label>
          <input
            id="clerk-identifier"
            className="lc-clerk-input"
            type="text"
            autoComplete="username"
            inputMode={identifierKind === "phone" ? "tel" : "email"}
            placeholder="you@example.com  ·  +44 7700 900000"
            value={identifier}
            onChange={(e) => setIdentifierRaw(e.target.value)}
            data-testid="clerk-identifier-input"
            disabled={disabled}
            required
          />
          {err && (
            <p
              className="lc-clerk-error"
              data-testid="clerk-error"
              role="alert"
              aria-live="assertive"
            >
              {err}
            </p>
          )}
          <button
            type="submit"
            className="lc-clerk-primary"
            disabled={disabled || identifier.trim().length < 3}
            data-testid="clerk-send-code"
          >
            {sending ? "Sending code…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="lc-clerk-form">
          <label className="lc-clerk-label" htmlFor="clerk-code">
            Enter the 6-digit code sent to {identifier}
          </label>
          <input
            id="clerk-code"
            className="lc-clerk-input lc-clerk-input-code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            data-testid="clerk-code-input"
            disabled={disabled}
            autoFocus
            required
          />
          {err && (
            <p
              className="lc-clerk-error"
              data-testid="clerk-error"
              role="alert"
              aria-live="assertive"
            >
              {err}
            </p>
          )}
          <div className="lc-clerk-actions">
            <button
              type="submit"
              className="lc-clerk-primary"
              disabled={disabled || code.length !== 6}
              data-testid="clerk-verify-code"
              aria-label={
                phase === "verifying"
                  ? "Verifying code"
                  : phase === "exchanging"
                    ? "Signing you in"
                    : "Verify code"
              }
            >
              {phase === "verifying"
                ? "Verifying…"
                : phase === "exchanging"
                  ? "Signing you in…"
                  : "Verify"}
            </button>
            <button
              type="button"
              className="lc-clerk-quiet"
              onClick={() => void handleResend()}
              disabled={disabled}
              data-testid="clerk-resend"
            >
              Resend code
            </button>
            <button
              type="button"
              className="lc-clerk-quiet"
              onClick={() => {
                setPhase("identifier");
                setCode("");
                setErr(null);
              }}
              disabled={disabled}
            >
              Change email / phone
            </button>
          </div>
        </form>
      )}

      <style>{CLERK_PANEL_STYLES}</style>
    </div>
  );
}

const CLERK_PANEL_STYLES = `
.lc-clerk-panel {
  display: grid;
  gap: 12px;
  width: 100%;
}
.lc-clerk-form {
  display: grid;
  gap: 10px;
}
.lc-clerk-label {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(244, 241, 234, 0.7);
}
.lc-clerk-input {
  font-family: "Inter", system-ui, sans-serif;
  font-size: 15px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(11, 4, 12, 0.68);
  color: #f4f1ea;
  outline: none;
  transition: border-color 120ms, background 120ms;
}
.lc-clerk-input:focus {
  border-color: rgba(255, 26, 140, 0.72);
  background: rgba(11, 4, 12, 0.86);
}
.lc-clerk-input-code {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 24px;
  letter-spacing: 0.32em;
  text-align: center;
}
.lc-clerk-primary {
  font-family: "Inter", system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  padding: 12px 18px;
  border-radius: 12px;
  border: 0;
  background: linear-gradient(180deg, #ff1a8c, #d40d70);
  color: #ffffff;
  cursor: pointer;
  transition: transform 100ms, box-shadow 120ms, opacity 120ms;
}
.lc-clerk-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(255, 26, 140, 0.36);
}
.lc-clerk-primary:disabled { opacity: 0.55; cursor: not-allowed; }
.lc-clerk-quiet {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 8px 12px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: rgba(244, 241, 234, 0.62);
  cursor: pointer;
}
.lc-clerk-quiet:hover:not(:disabled) { color: rgba(244, 241, 234, 0.88); }
.lc-clerk-quiet:disabled { opacity: 0.4; cursor: not-allowed; }
.lc-clerk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.lc-clerk-error {
  margin: 0;
  font-size: 12px;
  color: #ffb0d0;
  font-weight: 500;
}
`;
