"use client";
import { useState } from "react";

export function ReferralLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-[0_2px_12px_rgba(10,10,15,0.04)] sm:p-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">Your referral link</div>
      <div className="mt-3 flex items-center gap-3">
        <code className="flex-1 truncate rounded-lg bg-paper-warm px-3 py-3 font-mono text-sm text-ink sm:text-base">
          {url}
        </code>
        <button
          onClick={onCopy}
          className="shrink-0 rounded-full bg-ink px-5 py-3 font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
