"use client";

// Click-wrap Partner & Affiliate Agreement modal.
//
// Rules baked into this component (each one is a legal-defence lever):
//
//   * The scroll region contains an IntersectionObserver sentinel at the
//     very bottom. The submit button stays disabled until the sentinel
//     intersects the viewport at least once. This kills the "I didn't
//     see the terms" defence — the code proves the reader reached the
//     end of the body.
//
//   * The checkbox is aria-disabled until the sentinel fires. A user
//     tabbing through the DOM with a keyboard hits the same wall — they
//     cannot tick the box without physically (or programmatically)
//     scrolling to the end. If a scripted client submits anyway, the
//     backend rejects `scroll_completed: false`.
//
//   * A radio group above the checkbox forces a BUSINESS / INDIVIDUAL
//     capacity election. Selecting INDIVIDUAL renders the additional
//     Section 2 acknowledgment paragraph — a UK/EU consumer therefore
//     cannot claim they were not warned that the cooling-off waiver
//     applies to them.
//
//   * The client IP + user-agent are captured (server-side via the
//     proxy route reading NextRequest headers) so the receipt reflects
//     the browser making the click, not the Next.js server.
//
// The component is intentionally self-contained — no design-system
// dependency other than raw Tailwind classes so it renders identically
// inside a Tauri browse panel and a full desktop web browser.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CURRENT_CONTRACT_VERSION,
  INDIVIDUAL_CAPACITY_ACKNOWLEDGMENT,
  buildAgreementSections,
  type AgreementContext,
  type SigningCapacity,
} from "@/lib/legal/affiliateAgreement";

interface Props {
  context: AgreementContext;
  onSigned: (receiptSha256: string) => void;
  onError?: (message: string) => void;
}

type SubmitState = "idle" | "submitting" | "success" | "error";

export function AffiliateAgreementModal({ context, onSigned, onError }: Props): React.ReactElement {
  const [scrollCompleted, setScrollCompleted] = useState(false);
  const [capacity, setCapacity] = useState<SigningCapacity | null>(null);
  const [checked, setChecked] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);

  const sections = buildAgreementSections(context);

  // IntersectionObserver — fires ONCE when the sentinel becomes visible.
  // Root is the scroll container, not the viewport, so the sentinel
  // has to be actually scrolled to (not merely reachable if the modal
  // is small enough to fit on screen).
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (!scrollRegionRef.current) return;
    const target = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setScrollCompleted(true);
            observer.disconnect();
            break;
          }
        }
      },
      {
        root: scrollRegionRef.current,
        threshold: 0.5,
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const canCheck = scrollCompleted && capacity !== null;
  const canSubmit = canCheck && checked && submit === "idle";

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmit("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/affiliate/agreement/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contract_version: CURRENT_CONTRACT_VERSION,
          signing_capacity: capacity,
          scroll_completed: scrollCompleted,
          signature_action: "EXPLICIT_CLICK_TO_ACCEPT",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        receipt_sha256?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok || !data.receipt_sha256) {
        const msg = data.detail ?? data.error ?? `sign failed · HTTP ${res.status}`;
        setErrorMessage(msg);
        setSubmit("error");
        onError?.(msg);
        return;
      }
      setSubmit("success");
      onSigned(data.receipt_sha256);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setSubmit("error");
      onError?.(msg);
    }
  }, [canSubmit, capacity, scrollCompleted, onSigned, onError]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-2xl border border-white/10 bg-neutral-950 p-6 text-white shadow-2xl">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            Liquid Clips Partner &amp; Affiliate Agreement
          </h1>
          <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white/70">
            {CURRENT_CONTRACT_VERSION}
          </span>
        </div>
        <p className="text-sm text-white/60">
          One-time click-to-sign before your first payout releases. This receipt is bound to your Whop
          identity and used as chargeback-defence evidence.
        </p>
      </header>

      <div
        ref={scrollRegionRef}
        className="max-h-[52vh] overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-4"
        aria-label="Agreement text — scroll to the end to enable the checkbox"
      >
        <p className="mb-4 font-mono text-[11px] leading-relaxed text-white/80">
          <strong>Platform Operator:</strong> Liquidclips Ltd, a trading name of Company Number 15591903
          (registered in England &amp; Wales).
          <br />
          <strong>Effective Date:</strong> Date of Click-Acceptance.
          <br />
          <strong>Participant Profile:</strong> Whop User ID{" "}
          <code className="rounded bg-white/10 px-1 text-[10px]">{context.whopUserId ?? "(unbound)"}</code>{" "}
          &middot; Verified Payout Address{" "}
          <code className="rounded bg-white/10 px-1 text-[10px]">{context.payoutAddress ?? "(none)"}</code>.
        </p>

        {sections.map((section) => (
          <section key={section.heading} className="mb-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/80">
              {section.heading}
            </h2>
            {section.paragraphs.map((p, idx) => (
              <p key={idx} className="mb-2 font-mono text-[11px] leading-relaxed text-white/70">
                {p}
              </p>
            ))}
            {section.clauses ? (
              <ul className="mb-2 flex flex-col gap-1 pl-4">
                {section.clauses.map((c) => (
                  <li key={c.marker} className="font-mono text-[11px] leading-relaxed text-white/70">
                    <span className="font-semibold text-white/85">{c.marker}</span> {c.body}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        {capacity === "INDIVIDUAL" ? (
          <div className="mb-5 rounded-lg border border-yellow-400/40 bg-yellow-400/10 p-3">
            <p className="font-mono text-[11px] font-semibold leading-relaxed text-yellow-100">
              {INDIVIDUAL_CAPACITY_ACKNOWLEDGMENT}
            </p>
          </div>
        ) : null}

        {/* Scroll-completion sentinel — the IntersectionObserver root is
            the scroll region above; this element sits just below the
            last visible paragraph, so it only intersects once the user
            has scrolled the full body. */}
        <div ref={sentinelRef} aria-hidden="true" className="h-2 w-full" />
      </div>

      <fieldset className="rounded-xl border border-white/10 p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-widest text-white/60">
          Signing capacity
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm text-white/80">
            <input
              type="radio"
              name="signing_capacity"
              value="BUSINESS"
              checked={capacity === "BUSINESS"}
              onChange={() => setCapacity("BUSINESS")}
              className="mt-1"
            />
            <span>I am signing as an authorised representative of a business / commercial entity.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-white/80">
            <input
              type="radio"
              name="signing_capacity"
              value="INDIVIDUAL"
              checked={capacity === "INDIVIDUAL"}
              onChange={() => setCapacity("INDIVIDUAL")}
              className="mt-1"
            />
            <span>I am signing as a private individual.</span>
          </label>
        </div>
      </fieldset>

      <label
        className={`flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm text-white/85 ${
          canCheck ? "cursor-pointer" : "cursor-not-allowed opacity-60"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={!canCheck}
          aria-disabled={!canCheck}
          className="mt-1"
        />
        <span>
          I agree to the Commercial Terms above. I confirm my Whop-verified identity and consent to be bound
          by this receipt hash as an electronic signature.
        </span>
      </label>

      {!scrollCompleted ? (
        <p className="text-xs text-white/50">
          Scroll to the end of the agreement to enable the checkbox.
        </p>
      ) : capacity === null ? (
        <p className="text-xs text-white/50">
          Choose whether you are signing as a business or as a private individual.
        </p>
      ) : null}

      {errorMessage ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="rounded-xl bg-yellow-400 px-4 py-3 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
      >
        {submit === "submitting"
          ? "Signing…"
          : submit === "success"
          ? "Signed — you can close this window"
          : "Activate System Dashboard"}
      </button>
    </div>
  );
}
