"use client";
import { useState } from "react";

type Currency = "USD" | "GBP" | "EUR";
const SYMBOLS: Record<Currency, string> = { USD: "$", GBP: "£", EUR: "€" };
const RATES_FROM_USD: Record<Currency, number> = { USD: 1, GBP: 0.79, EUR: 0.92 };

export function StatTiles({
  activeMrrUsd,
  pendingPayoutUsd,
  lifetimeEarnedUsd,
}: {
  activeMrrUsd: number;
  pendingPayoutUsd: number;
  lifetimeEarnedUsd: number;
}) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const fmt = (usd: number) => {
    const v = usd * RATES_FROM_USD[currency];
    return `${SYMBOLS[currency]}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };
  const empty = activeMrrUsd === 0 && pendingPayoutUsd === 0 && lifetimeEarnedUsd === 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {empty ? "When someone signs up, this fills in" : "Your earnings"}
        </div>
        <div className="flex gap-1 rounded-full border border-line bg-paper p-1 font-mono text-[11px]">
          {(["USD", "GBP", "EUR"] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`rounded-full px-3 py-1 transition-colors ${
                currency === c ? "bg-ink text-paper" : "text-text-tertiary hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-4 grid grid-cols-3 gap-3 sm:gap-5 ${empty ? "opacity-50" : ""}`}>
        <Tile label="Active MRR" value={fmt(activeMrrUsd)} />
        <Tile label="This month" value={fmt(pendingPayoutUsd)} />
        <Tile label="Total earned" value={fmt(lifetimeEarnedUsd)} />
      </div>

      {currency !== "USD" && !empty && (
        <div className="mt-3 text-right font-mono text-[10px] text-text-tertiary">
          Conversion rates approx.
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{value}</div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">{label}</div>
    </div>
  );
}
