/**
 * StatePuppeteerTab · Lane B · Chapter 5 (2026-07-10).
 *
 * Admin HQ panel that flips any user's `wallet-detail` /
 * `sync-mail-money-drop` / `catalog-carousel` / `cancellation-intercept`
 * surface into one of six documented data states without touching real
 * ledgers. Reads/writes flow through the /api/admin proxy so the
 * internal secret + admin gate live server-side.
 *
 * Perf contract
 *   - no `backdrop-filter: blur()`
 *   - no infinite CSS animations
 *   - transitions ≤ 100ms
 *   - no polling · manual refresh only
 *   - `contain: layout paint style` on the outer shell
 *   - transform / opacity only for interactive state feedback
 *
 * Behavioural HQ events (fired via the same `/api/admin/telemetry`
 * ingest as every other admin tab — see `emitAdminEvent`):
 *   - `state_puppet_activated { admin_id, target_user_id, surface, state }`
 *   - `state_puppet_cleared   { admin_id, target_user_id }`
 *
 * NO `*_rendered` events.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types (loose · backend is source of truth) ──────────────────────
type Surface =
  | "wallet-detail"
  | "sync-mail-money-drop"
  | "catalog-carousel"
  | "cancellation-intercept";

type StateKey =
  | "fresh_install"
  | "populated"
  | "paid_normal"
  | "paid_streak"
  | "grace"
  | "cancelled";

interface UserRow {
  backend_user_id: string;
  email_masked: string;
  tier: string;
}

interface StateOverrideRow {
  id: number;
  user_id: string;
  surface: Surface | string;
  state: StateKey | string;
  applied_by_admin_email: string;
  applied_at: string;
  expires_at: string;
  cleared_at: string | null;
  active: boolean;
}

const SURFACES: Surface[] = [
  "wallet-detail",
  "sync-mail-money-drop",
  "catalog-carousel",
  "cancellation-intercept",
];

const STATES: StateKey[] = [
  "fresh_install",
  "populated",
  "paid_normal",
  "paid_streak",
  "grace",
  "cancelled",
];

// ─── Telemetry helpers ───────────────────────────────────────────────
// Account-app doesn't yet own a client-side diag rail — but the console
// pattern matches desktop-2's `[LC-DIAG][topic]` so a browser-tab tail
// captures both apps' behavioural events uniformly. When account-app
// gains its own diagnosticLogger, swap this for that import. The write
// audit log (backend admin_audit_log row) is the durable source of
// truth; this client-side emit is HQ-only observability.
function emitAdminEvent(topic: string, data: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[LC-DIAG][${topic}]`, data);
  } catch {
    /* diag is best-effort — never break the panel on emit failure */
  }
}

// ─── Component ───────────────────────────────────────────────────────
export function StatePuppeteerTab(): React.ReactElement {
  const [userQuery, setUserQuery] = useState<string>("");
  const [userResults, setUserResults] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [surface, setSurface] = useState<Surface>("wallet-detail");
  const [stateKey, setStateKey] = useState<StateKey>("populated");
  const [ttlMinutes, setTtlMinutes] = useState<number>(30);

  const [overrides, setOverrides] = useState<StateOverrideRow[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // ─── Search users ────────────────────────────────────────────────
  const searchUsers = useCallback(async (q: string) => {
    if (!q.trim()) {
      setUserResults([]);
      return;
    }
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/users?query=${encodeURIComponent(q.trim())}&limit=20`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(`search failed · ${r.status}`);
      const data = (await r.json()) as { results?: UserRow[] };
      setUserResults(data.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "search failed");
      setUserResults([]);
    }
  }, []);

  // ─── Load overrides for the selected user ───────────────────────
  const loadOverrides = useCallback(async (userId: string) => {
    setError(null);
    try {
      const r = await fetch(`/api/admin/user/${encodeURIComponent(userId)}/state-overrides`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`list failed · ${r.status}`);
      const data = (await r.json()) as { overrides?: StateOverrideRow[] };
      setOverrides(data.overrides ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "list failed");
      setOverrides([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      setOverrides([]);
      return;
    }
    void loadOverrides(selectedUser.backend_user_id);
  }, [selectedUser, loadOverrides]);

  // ─── Submit an override ──────────────────────────────────────────
  const submitOverride = useCallback(async () => {
    if (!selectedUser) {
      setError("pick a user first");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      const r = await fetch(
        `/api/admin/user/${encodeURIComponent(selectedUser.backend_user_id)}/state-override`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ surface, state: stateKey, expires_at: expiresAt }),
        },
      );
      if (!r.ok) throw new Error(`apply failed · ${r.status}`);
      await r.json();
      emitAdminEvent("state_puppet_activated", {
        target_user_id: selectedUser.backend_user_id,
        surface,
        state: stateKey,
      });
      setStatus(`applied ${stateKey} · ${surface} · ${ttlMinutes}min TTL`);
      await loadOverrides(selectedUser.backend_user_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "apply failed");
    } finally {
      setBusy(false);
    }
  }, [selectedUser, surface, stateKey, ttlMinutes, loadOverrides]);

  // ─── Clear one override ─────────────────────────────────────────
  const clearOverride = useCallback(async (targetSurface: string | null) => {
    if (!selectedUser) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const params = targetSurface ? `?surface=${encodeURIComponent(targetSurface)}` : "";
      const r = await fetch(
        `/api/admin/user/${encodeURIComponent(selectedUser.backend_user_id)}/state-override${params}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(`clear failed · ${r.status}`);
      await r.json();
      emitAdminEvent("state_puppet_cleared", {
        target_user_id: selectedUser.backend_user_id,
        surface: targetSurface,
      });
      setStatus(`cleared ${targetSurface ?? "all surfaces"}`);
      await loadOverrides(selectedUser.backend_user_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "clear failed");
    } finally {
      setBusy(false);
    }
  }, [selectedUser, loadOverrides]);

  const activeCount = useMemo(
    () => overrides.filter((o) => o.active).length,
    [overrides],
  );

  return (
    <section
      className="lc-state-puppeteer"
      data-testid="state-puppeteer-tab"
      style={{
        contain: "layout paint style",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "16px 0",
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>State Puppeteer</h2>
        <p style={{ margin: "4px 0 0", color: "var(--text-tertiary, #999)", fontSize: 12 }}>
          Flip a user surface into a fixture state. 30-min TTL by default. Never
          touches real ledger data. Every apply / clear writes an admin_audit_log
          row + fires a behavioural HQ event.
        </p>
      </header>

      {/* Step 1 · Pick a user */}
      <div
        style={{
          border: "1px solid var(--color-line, #ddd)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>1 · Pick user</h3>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            data-testid="state-puppeteer-user-search"
            type="search"
            value={userQuery}
            onChange={(e) => {
              setUserQuery(e.target.value);
              void searchUsers(e.target.value);
            }}
            placeholder="email, backend id, clerk id, whop id, affiliate code…"
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid var(--color-line, #ddd)",
              borderRadius: 8,
              fontSize: 13,
              transition: "border-color 80ms ease",
            }}
          />
          {selectedUser && (
            <button
              type="button"
              onClick={() => setSelectedUser(null)}
              style={{
                padding: "8px 14px",
                border: "1px solid var(--color-line, #ddd)",
                background: "transparent",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              clear
            </button>
          )}
        </div>

        {selectedUser ? (
          <div
            data-testid="state-puppeteer-selected-user"
            style={{
              marginTop: 12,
              padding: 10,
              background: "var(--color-fuchsia-soft, #ffe4f4)",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            selected: {selectedUser.email_masked} · id {selectedUser.backend_user_id.slice(0, 12)}…
          </div>
        ) : (
          userResults.length > 0 && (
            <ul
              data-testid="state-puppeteer-user-results"
              style={{ marginTop: 12, padding: 0, listStyle: "none", maxHeight: 180, overflow: "auto" }}
            >
              {userResults.map((u) => (
                <li key={u.backend_user_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(u)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--color-line, #eee)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "monospace",
                    }}
                  >
                    {u.email_masked} · {u.tier} · {u.backend_user_id.slice(0, 12)}…
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* Step 2 · Pick surface + state + TTL */}
      <div
        style={{
          border: "1px solid var(--color-line, #ddd)",
          borderRadius: 12,
          padding: 16,
          opacity: selectedUser ? 1 : 0.4,
          pointerEvents: selectedUser ? "auto" : "none",
          transition: "opacity 80ms ease",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          2 · Pick surface + state
        </h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr auto", marginTop: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
            surface
            <select
              data-testid="state-puppeteer-surface"
              value={surface}
              onChange={(e) => setSurface(e.target.value as Surface)}
              style={{ padding: "8px", borderRadius: 8, border: "1px solid var(--color-line, #ddd)", fontSize: 13 }}
            >
              {SURFACES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
            state
            <select
              data-testid="state-puppeteer-state"
              value={stateKey}
              onChange={(e) => setStateKey(e.target.value as StateKey)}
              style={{ padding: "8px", borderRadius: 8, border: "1px solid var(--color-line, #ddd)", fontSize: 13 }}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
            TTL (min)
            <input
              data-testid="state-puppeteer-ttl"
              type="number"
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(Math.max(1, Math.min(240, Number(e.target.value) || 30)))}
              min={1}
              max={240}
              style={{ padding: "8px", borderRadius: 8, border: "1px solid var(--color-line, #ddd)", width: 80, fontSize: 13 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            data-testid="state-puppeteer-apply"
            type="button"
            disabled={busy || !selectedUser}
            onClick={() => void submitOverride()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              background: "var(--color-fuchsia, #ff1a8c)",
              color: "white",
              border: "none",
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? "wait" : "pointer",
              transition: "opacity 80ms ease",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? "applying…" : "apply override"}
          </button>
          <button
            type="button"
            disabled={busy || !selectedUser}
            onClick={() => void clearOverride(null)}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid var(--color-line, #ddd)",
              fontSize: 13,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            clear all for user
          </button>
        </div>
      </div>

      {/* Step 3 · Active overrides */}
      <div
        style={{
          border: "1px solid var(--color-line, #ddd)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            3 · Active overrides {selectedUser && `· ${activeCount}`}
          </h3>
          {selectedUser && (
            <button
              type="button"
              onClick={() => selectedUser && void loadOverrides(selectedUser.backend_user_id)}
              style={{
                fontSize: 11,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-tertiary, #999)",
              }}
            >
              refresh
            </button>
          )}
        </div>
        {!selectedUser && (
          <p style={{ margin: "10px 0 0", color: "var(--text-tertiary, #999)", fontSize: 12 }}>
            pick a user to see their active overrides.
          </p>
        )}
        {selectedUser && overrides.length === 0 && (
          <p style={{ margin: "10px 0 0", color: "var(--text-tertiary, #999)", fontSize: 12 }}>
            no overrides on this user right now.
          </p>
        )}
        {overrides.length > 0 && (
          <table
            data-testid="state-puppeteer-overrides-table"
            style={{
              marginTop: 12,
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-line, #ddd)", textAlign: "left" }}>
                <th style={{ padding: "6px 4px" }}>surface</th>
                <th style={{ padding: "6px 4px" }}>state</th>
                <th style={{ padding: "6px 4px" }}>expires</th>
                <th style={{ padding: "6px 4px" }}>applied by</th>
                <th style={{ padding: "6px 4px" }}>active</th>
                <th style={{ padding: "6px 4px" }}></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((row) => (
                <tr key={row.id} style={{ borderBottom: "1px solid var(--color-line, #eee)" }}>
                  <td style={{ padding: "6px 4px" }}>{row.surface}</td>
                  <td style={{ padding: "6px 4px" }}>{row.state}</td>
                  <td style={{ padding: "6px 4px" }}>{new Date(row.expires_at).toLocaleString()}</td>
                  <td style={{ padding: "6px 4px" }}>{row.applied_by_admin_email}</td>
                  <td style={{ padding: "6px 4px" }}>{row.active ? "yes" : "no"}</td>
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    {row.active && (
                      <button
                        type="button"
                        onClick={() => void clearOverride(row.surface)}
                        disabled={busy}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          background: "transparent",
                          border: "1px solid var(--color-line, #ddd)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        clear
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Status / error line */}
      {error && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 8,
            background: "var(--color-fuchsia-soft, #ffe4f4)",
            color: "var(--color-fuchsia-deep, #b00c66)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      {status && !error && (
        <div
          role="status"
          style={{
            padding: 10,
            borderRadius: 8,
            background: "rgba(77, 198, 168, 0.10)",
            color: "var(--lc-ok, #268e7b)",
            fontSize: 12,
          }}
        >
          {status}
        </div>
      )}
    </section>
  );
}
