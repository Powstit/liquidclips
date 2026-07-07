// Sprint C · Agency Rules panel — replaces the "not supported" placeholder
// at Settings.tsx:658-692. Calls fetchRules + putRule + deleteRule.
//
// Rules are agency-scoped key/value JSON blobs. The backend accepts any
// RuleValue (null · boolean · number · string · array · object). This UI
// exposes a JSON textarea for the value so an owner can set a policy
// like {"min_lc_score": 75, "watermark_required": true} without a
// dedicated typed form per rule.

import { useCallback, useEffect, useState } from "react";
import type { RulesList, RuleValue } from "../../../lib/agency";
import { deleteRule, fetchRules, putRule } from "../../../lib/agency";

interface Props {
  agencyId: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; list: RulesList }
  | { kind: "forbidden"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

function stringifyValue(v: RuleValue): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? "");
  }
}

function parseValue(raw: string): { ok: true; value: RuleValue } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) as RuleValue };
  } catch {
    // Fall back to raw string if it's not JSON — a bare "true" is JSON,
    // but "hello" without quotes is not; treat as string literal.
    return { ok: true, value: trimmed };
  }
}

export function RulesPanel({ agencyId }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowValueDraft, setRowValueDraft] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    const r = await fetchRules(agencyId);
    if (r.data && r.state === "ready") {
      setState({ kind: "ready", list: r.data });
      // Seed the row-drafts with the loaded values.
      const seed: Record<string, string> = {};
      r.data.rules.forEach((rule) => {
        seed[rule.key] = stringifyValue(rule.value);
      });
      setRowValueDraft(seed);
      return;
    }
    if (r.state === "forbidden") {
      setState({ kind: "forbidden", message: r.error ?? "Not authorised." });
      return;
    }
    if (r.state === "offline") {
      setState({ kind: "offline", message: r.error ?? "Offline." });
      return;
    }
    setState({ kind: "error", message: r.error ?? "Rules failed to load." });
  }, [agencyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = useCallback(async (): Promise<void> => {
    const key = newKey.trim();
    if (!key || !/^[a-z0-9_.-]{1,80}$/i.test(key)) {
      setAddError("Key must be 1-80 chars of letters/digits/_-./");
      return;
    }
    const parsed = parseValue(newValue);
    if (!parsed.ok) {
      setAddError(parsed.error);
      return;
    }
    setAddBusy(true);
    setAddError(null);
    const r = await putRule(agencyId, key, parsed.value);
    setAddBusy(false);
    if (r.data && r.state === "ready") {
      setNewKey("");
      setNewValue("");
      void reload();
      return;
    }
    setAddError(r.error ?? "Save failed.");
  }, [agencyId, newKey, newValue, reload]);

  const handleSaveRow = useCallback(async (key: string): Promise<void> => {
    const raw = rowValueDraft[key] ?? "";
    const parsed = parseValue(raw);
    if (!parsed.ok) return;
    setRowBusy(key);
    await putRule(agencyId, key, parsed.value);
    setRowBusy(null);
    void reload();
  }, [agencyId, rowValueDraft, reload]);

  const handleDelete = useCallback(async (key: string): Promise<void> => {
    if (!window.confirm(`Delete rule "${key}"?`)) return;
    setRowBusy(key);
    await deleteRule(agencyId, key);
    setRowBusy(null);
    void reload();
  }, [agencyId, reload]);

  return (
    <section className="lc-settings-card lc-settings-capability is-agency" data-tab="rules">
      <span className="lc-settings-card-eb">Agency rules</span>

      {state.kind === "loading" && <p className="lc-settings-hint">Loading rules…</p>}

      {/* Ship-lens Batch 4 P1-BATCH4-003 fix (2026-07-06) · every
       *  failure-branch <p> gets role="alert" so AT users get
       *  notified when rules fail to load. Same aria-live tuning
       *  as sibling RosterPanel / WhopSyncPanel. */}
      {state.kind === "forbidden" && (
        <>
          <strong>Owner access required.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="assertive">{state.message}</p>
        </>
      )}

      {state.kind === "offline" && (
        <>
          <strong>Rules offline.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
          <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
        </>
      )}

      {state.kind === "error" && (
        <>
          <strong>Rules couldn&rsquo;t load.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
          <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
        </>
      )}

      {state.kind === "ready" && (
        <>
          {state.list.rules.length === 0 ? (
            <p className="lc-settings-hint">
              No rules yet. Add a policy key + JSON value below (or a bare string).
            </p>
          ) : (
            <div className="lc-settings-rows">
              {state.list.rules.map((rule) => (
                <div key={rule.key} style={{ padding: "8px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ flex: 1, fontWeight: 600 }}>{rule.key}</code>
                    <button
                      type="button"
                      className="lc-btn"
                      data-variant="primary"
                      disabled={rowBusy === rule.key}
                      onClick={() => void handleSaveRow(rule.key)}
                    >
                      {rowBusy === rule.key ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="lc-btn"
                      disabled={rowBusy === rule.key}
                      onClick={() => void handleDelete(rule.key)}
                    >
                      Delete
                    </button>
                  </div>
                  <textarea
                    value={rowValueDraft[rule.key] ?? ""}
                    onChange={(e) =>
                      setRowValueDraft((prev) => ({ ...prev, [rule.key]: e.target.value }))
                    }
                    rows={3}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      marginTop: 6,
                      fontFamily: "var(--font-mono, ui-monospace, monospace)",
                      fontSize: 12,
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div
            className="lc-settings-rows"
            style={{ marginTop: 16, gap: 6, paddingTop: 12, borderTop: "1px solid var(--color-line, rgba(255,255,255,0.08))" }}
          >
            <div className="lc-settings-hint" style={{ fontWeight: 600 }}>Add rule</div>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="rule_key"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              disabled={addBusy}
            />
            <textarea
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              rows={3}
              placeholder='JSON value · e.g. {"min_lc_score": 75}'
              spellCheck={false}
              disabled={addBusy}
              style={{
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: 12,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="lc-btn"
                data-variant="primary"
                disabled={addBusy || !newKey.trim()}
                onClick={handleAdd}
              >
                {addBusy ? "Adding…" : "Add rule"}
              </button>
            </div>
            {addError && (
              <p className="lc-settings-hint" role="alert" aria-live="assertive" style={{ color: "var(--color-alert, #d33)" }}>
                {addError}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
