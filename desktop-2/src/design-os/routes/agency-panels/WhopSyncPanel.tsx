// Path A follow-through · Whop-Sync panel · replaces the "requires an
// agency workspace endpoint" placeholder at Settings.tsx:661. The
// endpoint `POST /agency/{agency_id}/whop-sync` shipped in Stage 5;
// this panel calls it via the existing `postWhopSync` wrapper.
//
// Behaviour: on click, iterates the roster server-side and applies
// subscription-active vs lapsed → status = "active" / "disabled" (soft
// degrade). Never removes members · payout splits remain stable.

import { useCallback, useState } from "react";
import { postWhopSync, type WhopSyncResult } from "../../../lib/agency";

interface Props {
  agencyId: string;
}

type SyncState =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "ok"; result: WhopSyncResult }
  | { kind: "forbidden"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

export function WhopSyncPanel({ agencyId }: Props): JSX.Element {
  const [state, setState] = useState<SyncState>({ kind: "idle" });

  const runSync = useCallback(async () => {
    setState({ kind: "syncing" });
    const r = await postWhopSync(agencyId);
    if (r.data && r.state === "ready") {
      setState({ kind: "ok", result: r.data });
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
    setState({ kind: "error", message: r.error ?? "Sync failed." });
  }, [agencyId]);

  return (
    <section className="lc-settings-card lc-settings-capability is-agency" data-tab="whop-sync">
      <span className="lc-settings-card-eb">Whop Sync</span>
      <p className="lc-settings-hint">
        Reconciles every roster member&rsquo;s subscription state against Whop.
        Lapsed members are soft-disabled (payout splits stay intact); active
        members are re-enabled. Never removes anyone.
      </p>

      {state.kind === "idle" && (
        <button type="button" className="lc-btn" data-variant="primary" onClick={runSync}>
          Sync roster with Whop
        </button>
      )}

      {state.kind === "syncing" && (
        <p className="lc-settings-hint">Syncing…</p>
      )}

      {state.kind === "ok" && (
        <>
          <p className="lc-settings-hint" style={{ color: "var(--color-ok, #4a9)" }}>
            Sync complete · {state.result.items?.length ?? 0} members processed.
          </p>
          <button type="button" className="lc-btn" onClick={runSync}>
            Sync again
          </button>
        </>
      )}

      {state.kind === "forbidden" && (
        <>
          <strong>Owner access required.</strong>
          <p className="lc-settings-hint">{state.message}</p>
        </>
      )}

      {state.kind === "offline" && (
        <>
          <p className="lc-settings-hint">{state.message}</p>
          <button type="button" className="lc-btn" onClick={runSync}>Retry</button>
        </>
      )}

      {state.kind === "error" && (
        <>
          <p className="lc-settings-hint" style={{ color: "var(--color-alert, #d33)" }}>
            {state.message}
          </p>
          <button type="button" className="lc-btn" onClick={runSync}>Retry</button>
        </>
      )}
    </section>
  );
}
