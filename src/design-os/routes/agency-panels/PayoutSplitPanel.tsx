// Sprint C · Payout Split panel — replaces the "not supported" placeholder
// at Settings.tsx:658-692. Calls fetchPayoutSplits + putPayoutSplits.
//
// The backend stores percent share in BASIS POINTS (10_000 = 100%) and
// rejects a batch whose sum != 10_000. This UI exposes a friendly
// percentage input (0.00 – 100.00) and converts to bps on submit.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftSplit, MemberSplit, PayoutSplitList, Roster } from "../../../lib/agency";
import { fetchPayoutSplits, fetchRoster, putPayoutSplits } from "../../../lib/agency";
// ag-08 / ag-09 (2026-07-06) · Sovereign-Operator Protocol · one wrap
// covers both define-splits (ag-08) and reload-on-approval (ag-09) since
// they share the same component. This is a MONEY MOMENT — mis-rendering
// or a mid-save crash costs clippers real revenue attribution.
import { Watchdog } from "../../../lib/watchdog";

interface Props {
  agencyId: string;
}

interface DraftRow {
  memberUserId: string;
  percent: number; // 0.00 – 100.00
  label: string;
}

const BPS_TOTAL = 10_000;
const EPSILON = 0.005; // rounded to 2 decimal places

function bpsToPercent(bps: number): number {
  return Math.round(bps / 100 * 100) / 100;
}
function percentToBps(pct: number): number {
  return Math.round(pct * 100);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; list: PayoutSplitList }
  | { kind: "forbidden"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

export function PayoutSplitPanel({ agencyId }: Props): JSX.Element {
  return (
    <Watchdog
      id="agency/ag-08/payout-splits-define"
      label="Payout splits panel"
      cluster="agency"
      source="src/design-os/routes/agency-panels/PayoutSplitPanel.tsx:117"
    >
      <PayoutSplitPanelBody agencyId={agencyId} />
    </Watchdog>
  );
}

function PayoutSplitPanelBody({ agencyId }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    setSaveOk(false);
    setSaveError(null);
    // Roster fetch gives us member_user_id → label mapping so the
    // payout-split rows read as clipper@example.com instead of raw ids.
    // A best-effort — if roster fails, fall back to raw ids so the
    // panel still renders.
    const [splitsRes, rosterRes] = await Promise.all([
      fetchPayoutSplits(agencyId),
      fetchRoster(agencyId),
    ]);
    if (splitsRes.data && splitsRes.state === "ready") {
      setState({ kind: "ready", list: splitsRes.data });
      const labelByMember: Record<string, string> = {};
      const roster: Roster | null = rosterRes.data;
      if (roster) {
        roster.members.forEach((m) => {
          labelByMember[m.user_id] = m.email ?? m.handle ?? m.user_id;
        });
      }
      setDraft(
        splitsRes.data.splits.map((s: MemberSplit) => ({
          memberUserId: s.member_user_id,
          percent: bpsToPercent(s.percent_bps),
          label: labelByMember[s.member_user_id] ?? s.member_user_id,
        })),
      );
      return;
    }
    const r = splitsRes;
    if (r.state === "forbidden") {
      setState({ kind: "forbidden", message: r.error ?? "Not authorised." });
      return;
    }
    if (r.state === "offline") {
      setState({ kind: "offline", message: r.error ?? "Offline." });
      return;
    }
    setState({ kind: "error", message: r.error ?? "Splits failed to load." });
  }, [agencyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totalPercent = useMemo(
    () => draft.reduce((sum, r) => sum + (Number.isFinite(r.percent) ? r.percent : 0), 0),
    [draft],
  );

  const totalBpsExact = useMemo(
    () => draft.reduce((sum, r) => sum + percentToBps(r.percent), 0),
    [draft],
  );

  const canSave = !saving && Math.abs(totalPercent - 100) < EPSILON && totalBpsExact === BPS_TOTAL;

  const handleChange = useCallback((memberUserId: string, next: string): void => {
    const pct = Number.parseFloat(next);
    setDraft((prev) =>
      prev.map((row) =>
        row.memberUserId === memberUserId
          ? { ...row, percent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0 }
          : row,
      ),
    );
    setSaveOk(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const splits: DraftSplit[] = draft.map((row) => ({
      member_user_id: row.memberUserId,
      percent_bps: percentToBps(row.percent),
    }));
    const r = await putPayoutSplits(agencyId, splits);
    setSaving(false);
    if (r.data && r.state === "ready") {
      setSaveOk(true);
      void reload();
      return;
    }
    setSaveError(r.error ?? "Save failed.");
  }, [agencyId, canSave, draft, reload]);

  return (
    <section className="lc-settings-card lc-settings-capability is-agency" data-tab="payout-split">
      <span className="lc-settings-card-eb">Payout split</span>

      {state.kind === "loading" && <p className="lc-settings-hint">Loading splits…</p>}

      {/* Ship-lens Batch 4 P1-BATCH4-004 fix (2026-07-06) · same
       *  role="alert" treatment as sibling RosterPanel + RulesPanel
       *  + WhopSyncPanel. Payout splits touch clipper income · AT
       *  users need immediate notification when the panel fails. */}
      {state.kind === "forbidden" && (
        <>
          <strong>Owner access required.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="assertive">{state.message}</p>
        </>
      )}

      {state.kind === "offline" && (
        <>
          <strong>Payout splits offline.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
          <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
        </>
      )}

      {state.kind === "error" && (
        <>
          <strong>Payout splits couldn&rsquo;t load.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
          <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
        </>
      )}

      {state.kind === "ready" && (
        <>
          {draft.length === 0 ? (
            <p className="lc-settings-hint">
              No active members to split — invite clippers in the Roster tab first.
            </p>
          ) : (
            <div className="lc-settings-rows">
              {draft.map((row) => (
                <div
                  key={row.memberUserId}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}
                >
                  <span style={{ flex: 1 }}>{row.label}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    value={row.percent}
                    onChange={(e) => handleChange(row.memberUserId, e.target.value)}
                    style={{ width: 88, textAlign: "right" }}
                  />
                  <span style={{ width: 16 }}>%</span>
                </div>
              ))}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0 0",
                  borderTop: "1px solid var(--color-line, rgba(255,255,255,0.08))",
                }}
              >
                <span style={{ flex: 1, fontWeight: 600 }}>Total</span>
                <span
                  style={{
                    width: 88,
                    textAlign: "right",
                    fontWeight: 600,
                    color: Math.abs(totalPercent - 100) < EPSILON
                      ? undefined
                      : "var(--color-alert, #d33)",
                  }}
                >
                  {totalPercent.toFixed(2)}
                </span>
                <span style={{ width: 16 }}>%</span>
              </div>

              {Math.abs(totalPercent - 100) >= EPSILON && (
                <p className="lc-settings-hint" role="alert" aria-live="polite" style={{ color: "var(--color-alert, #d33)" }}>
                  Splits must sum to exactly 100%. Currently {totalPercent.toFixed(2)}%.
                </p>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="lc-btn"
                  data-variant="primary"
                  disabled={!canSave}
                  onClick={handleSave}
                >
                  {saving ? "Saving…" : "Save splits"}
                </button>
                <button
                  type="button"
                  className="lc-btn"
                  onClick={() => void reload()}
                  disabled={saving}
                >
                  Discard
                </button>
              </div>

              {saveOk && <p className="lc-settings-hint" role="status" aria-live="polite" style={{ color: "var(--color-ok, #4a9)" }}>Splits saved.</p>}
              {saveError && (
                <p className="lc-settings-hint" role="alert" aria-live="assertive" style={{ color: "var(--color-alert, #d33)" }}>
                  {saveError}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
