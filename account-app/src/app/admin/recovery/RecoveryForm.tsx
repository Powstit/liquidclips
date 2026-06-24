"use client";

// HQ Agent 5 · Recovery form (IP-aware: fast path = PIN only when caller's
// IP is in ADMIN_ALLOWED_IPS; strict path = 5 emails + 6-digit PIN +
// 8-char auth code from unknown IPs).
//
// On mount, calls /api/admin/recovery/status to learn whether the caller's
// IP is allowlisted. Renders the compact form OR the full form accordingly.
//
// Submits to /api/admin/recovery/verify. On 200+ok=true swaps the form for
// SuccessPanel with the freshly minted TOTP seed + backup codes. On 200+
// ok=false shows the failure copy with attempts_remaining; on 429 shows
// the "wait 24h" copy. Network errors fall back to a generic retry message.

import { useEffect, useState, type FormEvent } from "react";
import { SuccessPanel } from "./SuccessPanel";

const EMAIL_SLOTS = 5;

type VerifyOk = {
  ok: true;
  totp_seed: string;
  totp_provisioning_uri: string;
  backup_codes: string[];
};

type VerifyFail = {
  ok: false;
  attempts_remaining: number;
  detail?: string;
};

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "fail"; remaining: number }
  | { kind: "rate_limited" }
  | { kind: "success"; payload: VerifyOk };

type StatusBody = {
  ip_allowlisted: boolean;
  pin_configured: boolean;
  auth_code_configured: boolean;
  totp_configured: boolean;
};

export function RecoveryForm() {
  const [emails, setEmails] = useState<string[]>(
    Array.from({ length: EMAIL_SLOTS }, () => ""),
  );
  const [pin, setPin] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [fastPath, setFastPath] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/recovery/status", {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setFastPath(false);
          return;
        }
        const body = (await res.json()) as StatusBody;
        if (!cancelled) setFastPath(Boolean(body.ip_allowlisted));
      } catch {
        if (!cancelled) setFastPath(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2026-06-25 — Daniel removed the PIN gate. Primary 2FA is Clerk TOTP
  // (Authenticator app + Clerk-issued backup codes). Recovery now requires:
  //   - fast path (IP allowlisted): no proof beyond reaching this surface
  //     (rate limit + IP + email allowlist are still the gate)
  //   - strict path (unknown IP): 5 emails + auth code
  const allFilled =
    fastPath === true
      ? true
      : emails.every((e) => e.trim().length > 0) &&
        /^[A-Z0-9]{8}$/.test(authCode.trim().toUpperCase());

  function updateEmail(i: number, value: string) {
    setEmails((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!allFilled || state.kind === "submitting") return;

    setState({ kind: "submitting" });

    // PIN gate removed 2026-06-25 — body shape now just emails + auth_code
    // (strict path only); fast path sends nothing extra. Backend accepts
    // body.pin for backward compat but no longer checks it.
    const payload: Record<string, unknown> = {};
    if (fastPath !== true) {
      payload.emails = emails.map((e) => e.trim());
      payload.auth_code = authCode.trim().toUpperCase();
    }

    try {
      const res = await fetch("/api/admin/recovery/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });

      if (res.status === 429) {
        setState({ kind: "rate_limited" });
        return;
      }

      if (!res.ok && res.status !== 200) {
        setState({
          kind: "error",
          message: `Recovery request failed (${res.status}). Try again or contact the on-call engineer.`,
        });
        return;
      }

      const body = (await res.json()) as VerifyOk | VerifyFail;

      if (body.ok === true) {
        // Wipe the form values from memory before swapping panels.
        setPin("");
        setAuthCode("");
        setEmails(Array.from({ length: EMAIL_SLOTS }, () => ""));
        setState({ kind: "success", payload: body });
        return;
      }

      setState({ kind: "fail", remaining: body.attempts_remaining ?? 0 });
    } catch {
      setState({
        kind: "error",
        message:
          "Could not reach the recovery service. Check your connection and try again.",
      });
    }
  }

  if (state.kind === "success") {
    return (
      <SuccessPanel
        totpSeed={state.payload.totp_seed}
        totpProvisioningUri={state.payload.totp_provisioning_uri}
        backupCodes={state.payload.backup_codes}
      />
    );
  }

  if (fastPath === null) {
    return (
      <div className="rounded-xl border border-line bg-paper-elev p-5 text-sm text-text-secondary">
        Checking your network…
      </div>
    );
  }

  const submitting = state.kind === "submitting";

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {fastPath ? (
        <div className="rounded-xl border border-fuchsia/30 bg-fuchsia-soft p-4 text-sm text-fuchsia-deep">
          <p className="font-semibold">Your network is recognised.</p>
          <p className="mt-1">
            Fast path enabled — only the 6-digit PIN is required to re-issue
            your TOTP. Gates stop aliens, not you.
          </p>
        </div>
      ) : (
        <fieldset className="rounded-xl border border-line bg-paper-elev p-5">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Five master emails
          </legend>
          <p className="mb-4 text-sm text-text-secondary">
            Network not recognised — strict path. Order doesn&apos;t matter;
            you need at least 3 correct. Lower-case and whitespace are
            normalised.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {emails.map((value, i) => (
              <label key={i} className="block">
                <span className="mb-1 block text-xs uppercase text-text-tertiary">
                  Email {i + 1}
                </span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={value}
                  onChange={(e) => updateEmail(i, e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
                  required
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* 2026-06-25 — PIN field removed. Primary 2FA is Clerk TOTP
          (Authenticator app + Clerk-issued backup codes). Recovery now
          asks for 5 emails + auth code on the strict path; fast path
          (allowlisted IP) needs nothing beyond reaching this surface. */}
      {!fastPath && (
        <div className="grid grid-cols-1 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              8-character auth code
            </span>
            <input
              type="password"
              autoComplete="off"
              value={authCode}
              onChange={(e) => {
                const cleaned = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 8);
                setAuthCode(cleaned);
              }}
              placeholder="A1B2C3D4"
              maxLength={8}
              pattern="[A-Z0-9]{8}"
              className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm uppercase tracking-[0.2em] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
              required
            />
          </label>
        </div>
      )}

      {state.kind === "fail" && (
        <div
          role="alert"
          className="rounded-md border border-fuchsia/40 bg-fuchsia-soft p-4 text-sm text-fuchsia-deep"
        >
          <p className="font-semibold">Verification failed.</p>
          <p className="mt-1">
            Attempts remaining: <strong>{state.remaining}</strong> of 3. After
            3 failures from this IP, recovery is locked for 24 hours.
          </p>
        </div>
      )}

      {state.kind === "rate_limited" && (
        <div
          role="alert"
          className="rounded-md border border-fuchsia/40 bg-fuchsia-soft p-4 text-sm text-fuchsia-deep"
        >
          <p className="font-semibold">Too many attempts.</p>
          <p className="mt-1">
            Recovery from this IP is locked for 24 hours. Try from a different
            network or wait the cooldown out.
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-line bg-paper-elev p-4 text-sm text-ink"
        >
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={!allFilled || submitting}
        className="inline-flex w-full items-center justify-center rounded-md bg-fuchsia px-4 py-3 text-sm font-semibold text-paper transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-paper-warm disabled:text-text-tertiary"
      >
        {submitting ? "Verifying…" : "Verify and re-issue TOTP"}
      </button>

      <p className="text-xs text-text-tertiary">
        {fastPath
          ? "Your IP is on the allowlist (ADMIN_ALLOWED_IPS). We only check the PIN. Failure category + IP are logged — never the values you typed."
          : "This form attempts identity proof against the master allowlist + the stored PIN/auth-code hashes. We log only the failure category and your IP — never the values you typed."}
      </p>
    </form>
  );
}
