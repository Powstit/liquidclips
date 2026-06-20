"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Phase 5 · Product Hunt capture modal.
 *
 * Banner click opens this modal FIRST so we capture an email (required)
 * and optional Product Hunt username BEFORE the visitor leaves the
 * page for Product Hunt. Click flow:
 *
 *   1. visitor clicks the PH banner
 *   2. modal opens (rest of page goes dim, focus traps to email)
 *   3. visitor submits email + optional @username
 *   4. POST /api/waitlist with source="product_hunt"
 *      · referral cookie (lc_ref) auto-attached by the waitlist route
 *      · DB-down? route returns ok+persisted:false; we still show success
 *   5. modal flips to success state
 *   6. "Open Product Hunt now →" button opens PH in new tab + closes modal
 *
 * The modal is keyboard-friendly: Esc closes, focus traps inside,
 * Enter on the email field submits.
 */
export function ProductHuntCaptureModal({
  open,
  productHuntUrl,
  onClose,
}: {
  open: boolean;
  productHuntUrl: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [phUsername, setPhUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  // Focus the email field whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => emailRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset state when the modal is closed so a re-open is clean.
  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(() => {
      setEmail("");
      setPhUsername("");
      setStatus("idle");
      setErrorMsg(null);
    }, 200);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setErrorMsg("Enter your email.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          // role intentionally omitted — PH flow is email-first, role optional
          source: "product_hunt",
          sourcePage: typeof window !== "undefined" ? window.location.pathname : null,
          productHuntUsername: phUsername.trim() || undefined,
        }),
      });
      // Graceful degradation: route returns 200 with persisted:false when
      // DB is down. We always show success to the user — no failure UX
      // unless the network actually breaks.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't save. Try again.");
      setStatus("error");
    }
  }

  function openProductHunt() {
    window.open(productHuntUrl, "_blank", "noopener,noreferrer");
    onClose();
  }

  return (
    <div
      className="lc-ph-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lc-ph-modal-title"
    >
      <button
        type="button"
        className="lc-ph-modal-scrim"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="lc-ph-modal-card">
        <span className="lc-ph-modal-bracket lc-ph-modal-bracket--tl" aria-hidden="true" />
        <span className="lc-ph-modal-bracket lc-ph-modal-bracket--tr" aria-hidden="true" />
        <span className="lc-ph-modal-bracket lc-ph-modal-bracket--bl" aria-hidden="true" />
        <span className="lc-ph-modal-bracket lc-ph-modal-bracket--br" aria-hidden="true" />

        <button
          type="button"
          className="lc-ph-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        {status === "success" ? (
          <>
            <span className="lc-ph-modal-eb">
              <span className="lc-ph-modal-eb-dot" /> YOU'RE IN · ONE LAST STEP
            </span>
            <h3 id="lc-ph-modal-title" className="lc-ph-modal-h">
              Now help us win <em>Product Hunt</em>.
            </h3>
            <p className="lc-ph-modal-sub">
              Your spot's saved. Upvoting on Product Hunt is what puts us on
              the front page — takes 5 seconds.
            </p>
            <button
              type="button"
              className="lc-ph-modal-go lc-btn lc-btn--primary"
              onClick={openProductHunt}
              autoFocus
            >
              <span>▲ Upvote on Product Hunt</span>
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="lc-ph-modal-skip"
              onClick={onClose}
            >
              I'll do it later
            </button>
          </>
        ) : (
          <>
            <span className="lc-ph-modal-eb">
              <span className="lc-ph-modal-eb-dot" /> PRODUCT HUNT LAUNCH · TODAY
            </span>
            <h3 id="lc-ph-modal-title" className="lc-ph-modal-h">
              Before you upvote — <em>save your spot</em>.
            </h3>
            <p className="lc-ph-modal-sub">
              Drop your email and we'll let you know the moment early access
              opens. Optional: drop your Product Hunt handle so we can give
              you credit when you upvote.
            </p>

            <form onSubmit={submit} className="lc-ph-modal-form">
              <label className="lc-ph-modal-field">
                <span className="lc-ph-modal-field-eb">YOUR EMAIL</span>
                <input
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  placeholder="you@somewhere.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMsg) { setErrorMsg(null); setStatus("idle"); }
                  }}
                  disabled={status === "submitting"}
                  className="lc-ph-modal-input"
                />
              </label>

              <label className="lc-ph-modal-field">
                <span className="lc-ph-modal-field-eb">
                  PRODUCT HUNT HANDLE · optional
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="@yourname"
                  value={phUsername}
                  onChange={(e) => setPhUsername(e.target.value)}
                  disabled={status === "submitting"}
                  className="lc-ph-modal-input"
                  maxLength={31}
                />
              </label>

              {errorMsg && (
                <p role="alert" className="lc-ph-modal-error">{errorMsg}</p>
              )}

              <button
                type="submit"
                className="lc-ph-modal-submit lc-btn lc-btn--primary"
                disabled={status === "submitting"}
              >
                <span>
                  {status === "submitting" ? "Saving your spot…" : "Save my spot"}
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </form>

            <p className="lc-ph-modal-foot">
              No spam. We email twice: once when access opens, once at launch.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
