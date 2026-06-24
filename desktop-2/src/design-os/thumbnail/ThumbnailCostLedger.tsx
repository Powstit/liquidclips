/**
 * ThumbnailCostLedger · Phase 6F
 *
 * Lifetime cost panel + per-gen JSONL ledger rows. Reads via
 * `thumbnail.ledger()` (stub returns the fixture). Includes:
 *   - lifetime total (DSEG MetricBoard)
 *   - generation count
 *   - runtime mode (Studio preview vs Live engine)
 *   - per-quality cost estimate strip
 *   - batch estimate (X variants × Y quality)
 *   - row table (date · model · cost · title)
 */

import { useEffect, useState } from "react";
import { GlassCard, MetricBoard } from "../components";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { thumbnail } from "../engine/sidecar-stub";
import {
  type LedgerRow, type ThumbnailQuality,
  COST_USD,
} from "./types";
import "./ThumbnailCostLedger.css";

export interface ThumbnailCostLedgerProps {
  /** Defaults · used by the batch estimate. */
  batchSize?: number;
  batchQuality?: ThumbnailQuality;
}

export function ThumbnailCostLedger({
  batchSize = 8, batchQuality = "medium",
}: ThumbnailCostLedgerProps) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const runtime = useRuntimeInfo();

  useEffect(() => {
    let cancelled = false;
    void thumbnail.ledger().then((r) => {
      if (cancelled) return;
      setRows(r.rows);
      setTotal(r.total_usd);
    });
    return () => { cancelled = true; };
  }, []);

  const batchEstimate = batchSize * COST_USD[batchQuality];
  const totalCents = Math.round(total * 100);

  return (
    <GlassCard density="default" className="lc-tcl">
      <header className="lc-tcl-head">
        <div>
          <span className="lc-tcl-eb">Cost ledger</span>
          <span className="lc-tcl-sub">
            {rows.length} gens · {runtime.mode === "mock" ? "Studio preview" : "Live engine"}
          </span>
        </div>
        <MetricBoard
          label="Lifetime"
          value={totalCents > 0 ? `$${total.toFixed(2)}` : "$0.00"}
          tone="fx"
          ghost="$0.00"
        />
      </header>

      {/* Per-quality cost strip */}
      <section className="lc-tcl-quality">
        {(["low", "medium", "high"] as const).map((q) => (
          <div key={q} className={`lc-tcl-q lc-tcl-q-${q}`}>
            <span className="lc-tcl-q-label">{q}</span>
            <span className="lc-tcl-q-cost">${COST_USD[q].toFixed(2)}</span>
            <span className="lc-tcl-q-per">per variant</span>
          </div>
        ))}
      </section>

      {/* Batch estimate */}
      <section className="lc-tcl-batch">
        <span className="lc-tcl-eb">Batch estimate</span>
        <div className="lc-tcl-batch-row">
          <span><strong>{batchSize}</strong> variants</span>
          <span className="lc-tcl-batch-x">×</span>
          <span>${COST_USD[batchQuality].toFixed(2)} ({batchQuality})</span>
          <span className="lc-tcl-batch-eq">=</span>
          <span className="lc-tcl-batch-total">${batchEstimate.toFixed(2)}</span>
        </div>
        <p className="lc-tcl-batch-note">
          Mock mode runs free — no real OpenAI call. Real cost lands when the
          sidecar runtime is installed.
        </p>
      </section>

      {/* Rows */}
      <section className="lc-tcl-rows">
        <header className="lc-tcl-row-head">
          <span className="lc-tcl-eb">Recent gens</span>
          <span className="lc-tcl-sub">{rows.length}</span>
        </header>
        {rows.length === 0 ? (
          <p className="lc-tcl-empty">No generations yet.</p>
        ) : (
          <ul className="lc-tcl-list">
            {rows.slice(0, 8).map((r, i) => (
              <li key={`${r.ts}-${i}`} className="lc-tcl-row">
                <span className="lc-tcl-row-date">{shortDate(r.ts)}</span>
                <span className="lc-tcl-row-model">{r.model}</span>
                <span className="lc-tcl-row-title" title={r.title}>{r.title}</span>
                <span className="lc-tcl-row-cost">${r.cost_usd.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </GlassCard>
  );
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 16);
  }
}
