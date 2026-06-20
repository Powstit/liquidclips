"use client";

import { useState } from "react";

/**
 * Founding Clippers signup form.
 *
 * Uses the locked brand-button primitives (lc-btn / lc-btn--primary /
 * lc-btn--secondary) and the dark-glass reticle style already in funnel.css.
 * Compact 3-step flow:
 *   1. role chips
 *   2. email
 *   3. submit
 * On success: show the success state with the user's referral link + a
 * "Now upvote on Product Hunt →" CTA (the optional second step the PH
 * flow chains into).
 *
 * The `source` prop is the channel bucket — the PH modal passes
 * "product_hunt", a plain-page mount passes "website", and the referral
 * landing passes "referral".
 */

type Role = "creator" | "clipper" | "agency";

const ROLES: { key: Role; label: string }[] = [
  { key: "creator",  label: "Creator"  },
  { key: "clipper",  label: "Clipper"  },
  { key: "agency",   label: "Agency"   },
];

export function FoundingClippersForm({
  source = "website",
  sourcePage,
  productHuntUrl,
  onJoined,
}: {
  source?: "product_hunt" | "website" | "referral" | "direct";
  sourcePage?: string;
  /** Shown as the secondary CTA in the success state when set. */
  productHuntUrl?: string;
  onJoined?: (payload: { referralCode: string | null; alreadyJoined: boolean }) => void;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{
    referralCode: string | null;
    alreadyJoined: boolean;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) { setError("Pick one — creator, clipper or agency."); return; }
    if (!email.includes("@")) { setError("Enter your email."); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          role,
          source,
          sourcePage: sourcePage ?? (typeof window !== "undefined" ? window.location.pathname : null),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save.");
      setJoined({
        referralCode: data.referralCode ?? null,
        alreadyJoined: Boolean(data.alreadyJoined),
      });
      onJoined?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── success state ────────────────────────────────────────────────────
  if (joined) {
    const code = joined.referralCode;
    const shareUrl = code
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${code}`
      : null;
    return (
      <div className="lc-fc-card lc-fc-success" aria-live="polite">
        <span className="lc-fc-bracket lc-fc-bracket--tl" aria-hidden="true" />
        <span className="lc-fc-bracket lc-fc-bracket--tr" aria-hidden="true" />
        <span className="lc-fc-bracket lc-fc-bracket--bl" aria-hidden="true" />
        <span className="lc-fc-bracket lc-fc-bracket--br" aria-hidden="true" />

        <span className="lc-fc-eb">
          <span className="lc-fc-eb-dot" />
          {joined.alreadyJoined ? "ALREADY IN" : "YOU'RE IN"}
        </span>

        <h3 className="lc-fc-h">
          {joined.alreadyJoined
            ? "Welcome back, Founding Clipper."
            : "You're a Founding Clipper."}
        </h3>

        <p className="lc-fc-sub">
          You'll keep launch pricing forever. Early access drops first.
          Here's your link — every friend who joins via this URL boosts your
          spot.
        </p>

        {shareUrl && (
          <div className="lc-fc-share">
            <span className="lc-fc-share-eb">YOUR REFERRAL LINK</span>
            <button
              type="button"
              className="lc-fc-share-pill"
              onClick={() => navigator.clipboard.writeText(shareUrl).catch(() => {})}
              aria-label="Copy referral link to clipboard"
            >
              <span className="lc-fc-share-url">{shareUrl}</span>
              <span className="lc-fc-share-copy">COPY</span>
            </button>
          </div>
        )}

        {productHuntUrl && (
          <a
            href={productHuntUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="lc-fc-ph lc-btn lc-btn--primary"
          >
            <span>Now upvote on Product Hunt</span>
            <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    );
  }

  // ── form state ───────────────────────────────────────────────────────
  return (
    <form className="lc-fc-card" onSubmit={submit} aria-label="Founding Clippers signup">
      <span className="lc-fc-bracket lc-fc-bracket--tl" aria-hidden="true" />
      <span className="lc-fc-bracket lc-fc-bracket--tr" aria-hidden="true" />
      <span className="lc-fc-bracket lc-fc-bracket--bl" aria-hidden="true" />
      <span className="lc-fc-bracket lc-fc-bracket--br" aria-hidden="true" />

      <span className="lc-fc-eb">
        <span className="lc-fc-eb-dot" /> FOUNDING CLIPPERS · JOIN BEFORE LAUNCH
      </span>

      <h3 className="lc-fc-h">
        Join before launch and lock in <em>launch pricing forever</em>.
      </h3>

      <ul className="lc-fc-perks">
        <li>Early access to the app, ahead of public launch</li>
        <li>Founding Member badge on your profile</li>
        <li>Launch pricing protected — your rate never goes up</li>
        <li>Priority on feature requests</li>
        <li>Founding community access</li>
      </ul>

      <fieldset className="lc-fc-roles" aria-label="Pick one">
        <legend className="lc-fc-roles-eb">I'M A …</legend>
        <div className="lc-fc-roles-row">
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`lc-fc-role ${role === r.key ? "is-on" : ""}`}
              onClick={() => setRole(r.key)}
              aria-pressed={role === r.key}
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="lc-fc-email">
        <span className="lc-fc-email-eb">YOUR EMAIL</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@somewhere.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
          disabled={submitting}
          className="lc-fc-email-input"
        />
      </label>

      {error && <p role="alert" className="lc-fc-error">{error}</p>}

      <button
        type="submit"
        className="lc-fc-submit lc-btn lc-btn--primary"
        disabled={submitting}
      >
        <span>{submitting ? "Saving you a spot…" : "Join the founding list"}</span>
        <span aria-hidden="true">→</span>
      </button>

      <p className="lc-fc-foot">
        No spam. We email twice: once when early access opens, once at launch.
      </p>
    </form>
  );
}
