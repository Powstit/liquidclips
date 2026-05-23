"use client";

import { useState } from "react";
import { PricingComparison } from "./PricingComparison";

// Reveal-style toggle for the comparison table. Pricing cards already say the
// gist; this lets users dig in only when they want it. Default collapsed so
// the page above the fold stays scannable.

export function ComparisonToggle({ currentSlug }: { currentSlug?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            see exactly what you get
          </div>
          <h2 className="mt-1 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            Full feature comparison.
          </h2>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-all hover:border-fuchsia hover:text-fuchsia-deep"
        >
          <span>{open ? "Hide comparison" : "Reveal what's in each plan"}</span>
          <span
            className={`font-mono text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            ▾
          </span>
        </button>
      </div>

      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ${
          open ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
        }`}
        aria-hidden={!open}
      >
        <PricingComparison currentSlug={currentSlug} />
      </div>
    </section>
  );
}
