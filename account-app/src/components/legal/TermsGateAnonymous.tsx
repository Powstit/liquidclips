"use client";

// Pre-launch blocker #1 — anonymous variant of TermsGate for the public
// /checkout acquisition page, reached before any Liquid Clips account
// (Clerk session) exists. There is no user row yet to attach a server-
// side receipt to, so this is a client-side-only gate: the checkbox
// must be checked before the Whop embed renders at all. The signed-in
// TermsGate (src/components/legal/TermsGate.tsx) is the one that
// persists a real receipt, for every surface reached after signup.

import { useEffect, useState } from "react";

interface TermsDocument {
  version: string;
  title: string;
  body: string;
}

export function TermsGateAnonymous({ children }: { children: React.ReactNode }) {
  const [doc, setDoc] = useState<TermsDocument | null>(null);
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms/document", { cache: "no-store" })
      .then((res) => res.json())
      .then((json: TermsDocument) => {
        if (!cancelled) setDoc(json);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the Terms & Conditions. Please refresh.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (revealed) {
    return <>{children}</>;
  }

  if (!doc) {
    return (
      <div className="grid h-[420px] place-items-center rounded-3xl border border-line bg-paper-elev/40 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        {error ?? "loading…"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-line bg-paper-elev/40 p-6">
      <h2 className="font-display text-[18px] font-semibold text-ink">{doc.title}</h2>
      <div className="max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-line/60 bg-paper/60 p-4 font-sans text-[13px] leading-relaxed text-text-secondary">
        {doc.body}
      </div>
      <label className="flex items-start gap-3 font-sans text-[13px] text-text-secondary">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        I have read and agree to the Terms &amp; Conditions above.
      </label>
      <button
        type="button"
        disabled={!checked}
        onClick={() => setRevealed(true)}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        Agree & Continue to Payment
      </button>
    </div>
  );
}
