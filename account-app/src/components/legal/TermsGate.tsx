"use client";

// Pre-launch blocker #1 — payment-side Terms & Conditions acceptance
// gate. Wraps a checkout embed (children); renders the placeholder T&C
// text + checkbox instead until the signed-in user explicitly accepts,
// then reveals the real checkout. Acceptance is persisted server-side
// (junior-backend TermsAcceptance table) via /api/terms/accept so it's
// a real receipt, not just client-side UI state.
//
// Requires an active Clerk session — use TermsGateAnonymous instead for
// the pre-signup public /checkout page, where no user row exists yet
// to attach a receipt to.

import { useEffect, useState } from "react";

interface TermsDocument {
  version: string;
  title: string;
  body: string;
}

interface TermsStatus {
  accepted: boolean;
  document_version: string;
}

export function TermsGate({ children }: { children: React.ReactNode }) {
  const [doc, setDoc] = useState<TermsDocument | null>(null);
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [docRes, statusRes] = await Promise.all([
          fetch("/api/terms/document", { cache: "no-store" }),
          fetch("/api/terms/status", { cache: "no-store" }),
        ]);
        const docJson: TermsDocument = await docRes.json();
        if (cancelled) return;
        setDoc(docJson);
        if (statusRes.ok) {
          const statusJson: TermsStatus = await statusRes.json();
          if (!cancelled) setStatus(statusJson);
        } else {
          // Not signed in yet, or a transient backend error — treat as
          // not-accepted so the gate stays up rather than silently
          // skipping consent.
          if (!cancelled) {
            setStatus({ accepted: false, document_version: docJson?.version ?? "" });
          }
        }
      } catch {
        if (!cancelled) setError("Could not load the Terms & Conditions. Please refresh.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept() {
    if (!doc) return;
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch("/api/terms/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_version: doc.version }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json: TermsStatus = await res.json();
      setStatus(json);
    } catch {
      setError("Could not record your acceptance. Please try again.");
    } finally {
      setAccepting(false);
    }
  }

  if (status?.accepted) {
    return <>{children}</>;
  }

  if (!doc || !status) {
    return (
      <div className="grid h-[420px] place-items-center rounded-3xl border border-line bg-paper-elev/40 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        loading…
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
      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={!checked || accepting}
        onClick={() => void accept()}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {accepting ? "Saving…" : "Agree & Continue to Payment"}
      </button>
    </div>
  );
}
