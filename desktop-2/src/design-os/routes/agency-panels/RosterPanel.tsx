// Sprint C · Agency Roster panel — replaces the "not supported" placeholder
// at Settings.tsx:658-692. Calls the shipped RPC wrappers in lib/agency.ts.
//
// Renders four states honestly:
//   · loading   — first fetch in flight
//   · forbidden — 401/403 from backend (non-owner opened the settings tab)
//   · offline   — network unreachable
//   · ready     — members + pending invites + invite form
//
// Owner discipline: `agencyId === currentUser.userId` per the backend
// invariant (agencies are User rows). We do not accept a different agencyId
// prop; the panel is only useful for the currently signed-in owner.

import { useCallback, useEffect, useState } from "react";
import type { AgencyMember, AgencyInvite, MemberRole, Roster } from "../../../lib/agency";
import {
  deleteMember,
  fetchRoster,
  postChangeRole,
  postInvite,
  postRevokeInvite,
} from "../../../lib/agency";
// ag-02 (2026-07-06) · Sovereign-Operator Protocol · panel body wrap
// so a mid-render crash lands in KadeRepairScreen instead of taking the
// Settings tab down. Roster is the agency owner's day-1 surface.
import { Watchdog } from "../../../lib/watchdog";

interface Props {
  agencyId: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; roster: Roster }
  | { kind: "forbidden"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

export function RosterPanel({ agencyId }: Props): JSX.Element {
  return (
    <Watchdog
      id="agency/ag-02/roster-view"
      label="Agency roster panel"
      cluster="agency"
      source="src/design-os/routes/agency-panels/RosterPanel.tsx:43"
    >
      <RosterPanelBody agencyId={agencyId} />
    </Watchdog>
  );
}

function RosterPanelBody({ agencyId }: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    const r = await fetchRoster(agencyId);
    if (r.data && r.state === "ready") {
      setState({ kind: "ready", roster: r.data });
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
    setState({ kind: "error", message: r.error ?? "Roster failed to load." });
  }, [agencyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleInvite = useCallback(async (): Promise<void> => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) {
      setInviteError("Enter a valid email.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    const r = await postInvite(agencyId, { email, role: inviteRole });
    setInviteBusy(false);
    if (r.data && r.state === "ready") {
      setInviteEmail("");
      setInviteRole("member");
      void reload();
      return;
    }
    setInviteError(r.error ?? "Invite failed.");
  }, [agencyId, inviteEmail, inviteRole, reload]);

  const handleRevoke = useCallback(async (inviteId: string): Promise<void> => {
    setRowBusy(inviteId);
    await postRevokeInvite(agencyId, inviteId);
    setRowBusy(null);
    void reload();
  }, [agencyId, reload]);

  const handleRemove = useCallback(async (memberUserId: string): Promise<void> => {
    if (!window.confirm("Remove this member from the roster?")) return;
    setRowBusy(memberUserId);
    await deleteMember(agencyId, memberUserId);
    setRowBusy(null);
    void reload();
  }, [agencyId, reload]);

  const handleRoleChange = useCallback(async (memberUserId: string, role: MemberRole): Promise<void> => {
    setRowBusy(memberUserId);
    await postChangeRole(agencyId, memberUserId, role);
    setRowBusy(null);
    void reload();
  }, [agencyId, reload]);

  return (
    <section className="lc-settings-card lc-settings-capability is-agency" data-tab="roster">
      <span className="lc-settings-card-eb">Agency roster</span>

      {state.kind === "loading" && (
        <p className="lc-settings-hint">Loading roster…</p>
      )}

      {/* Ship-lens Batch 4 P1-BATCH4-003 fix (2026-07-06) · every
       *  failure-branch <p> renders dynamic state.message · needed
       *  role="alert" so AT users get notified. Assertive on hard
       *  access-denial · polite on recoverable offline/error. */}
      {state.kind === "forbidden" && (
        <>
          <strong>Owner access required.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="assertive">{state.message}</p>
        </>
      )}

      {state.kind === "offline" && (
        <>
          <strong>Roster offline.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
          <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
        </>
      )}

      {state.kind === "error" && (
        <>
          <strong>Roster couldn&rsquo;t load.</strong>
          <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
          <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
        </>
      )}

      {state.kind === "ready" && (
        <>
          <MemberList
            members={state.roster.members}
            rowBusy={rowBusy}
            onChangeRole={handleRoleChange}
            onRemove={handleRemove}
          />
          <PendingInviteList
            invites={state.roster.pending_invites}
            rowBusy={rowBusy}
            onRevoke={handleRevoke}
          />
          <InviteForm
            email={inviteEmail}
            role={inviteRole}
            busy={inviteBusy}
            error={inviteError}
            onEmail={setInviteEmail}
            onRole={setInviteRole}
            onSubmit={handleInvite}
          />
        </>
      )}
    </section>
  );
}

interface MemberListProps {
  members: AgencyMember[];
  rowBusy: string | null;
  onChangeRole: (memberUserId: string, role: MemberRole) => void;
  onRemove: (memberUserId: string) => void;
}

function MemberList(p: MemberListProps): JSX.Element {
  if (p.members.length === 0) {
    return <p className="lc-settings-hint">No members yet — invite your first roster member below.</p>;
  }
  return (
    <div className="lc-settings-rows">
      <div className="lc-settings-hint" style={{ fontWeight: 600 }}>Members ({p.members.length})</div>
      {p.members.map((m) => (
        <div
          key={m.user_id}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}
        >
          <span style={{ flex: 1 }}>{m.email ?? m.handle ?? m.user_id}</span>
          <select
            value={m.role}
            disabled={p.rowBusy === m.user_id || m.status !== "active"}
            onChange={(e) => p.onChangeRole(m.user_id, e.target.value as MemberRole)}
          >
            <option value="member">member</option>
            <option value="mod">mod</option>
            <option value="manager">manager</option>
          </select>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{m.status}</span>
          <button
            type="button"
            className="lc-btn"
            disabled={p.rowBusy === m.user_id}
            onClick={() => p.onRemove(m.user_id)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

interface PendingInviteListProps {
  invites: AgencyInvite[];
  rowBusy: string | null;
  onRevoke: (inviteId: string) => void;
}

function PendingInviteList(p: PendingInviteListProps): JSX.Element | null {
  if (p.invites.length === 0) return null;
  return (
    <div className="lc-settings-rows" style={{ marginTop: 12 }}>
      <div className="lc-settings-hint" style={{ fontWeight: 600 }}>
        Pending invites ({p.invites.length})
      </div>
      {p.invites.map((inv) => (
        <div
          key={inv.id}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}
        >
          <span style={{ flex: 1 }}>{inv.email}</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>{inv.role}</span>
          <button
            type="button"
            className="lc-btn"
            disabled={p.rowBusy === inv.id}
            onClick={() => p.onRevoke(inv.id)}
          >
            Revoke
          </button>
        </div>
      ))}
    </div>
  );
}

interface InviteFormProps {
  email: string;
  role: MemberRole;
  busy: boolean;
  error: string | null;
  onEmail: (v: string) => void;
  onRole: (v: MemberRole) => void;
  onSubmit: () => void;
}

function InviteForm(p: InviteFormProps): JSX.Element {
  return (
    <div className="lc-settings-rows" style={{ marginTop: 16, gap: 8 }}>
      <div className="lc-settings-hint" style={{ fontWeight: 600 }}>Invite to roster</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          value={p.email}
          onChange={(e) => p.onEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && p.onSubmit()}
          placeholder="name@example.com"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          disabled={p.busy}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          value={p.role}
          onChange={(e) => p.onRole(e.target.value as MemberRole)}
          disabled={p.busy}
        >
          <option value="member">member · clipper</option>
          <option value="mod">mod · clipper + moderation</option>
          <option value="manager">manager · full campaign access</option>
        </select>
        <button
          type="button"
          className="lc-btn"
          data-variant="primary"
          disabled={p.busy || !p.email.trim()}
          onClick={p.onSubmit}
        >
          {p.busy ? "Sending…" : "Send invite"}
        </button>
      </div>
      {p.error && (
        <p className="lc-settings-hint" role="alert" aria-live="assertive" style={{ color: "var(--color-alert, #d33)" }}>
          {p.error}
        </p>
      )}
      <p className="lc-settings-hint">
        The invitee gets an email link to accept · 14-day expiry. Member/mod earn a payout
        split as clippers. Manager gets full campaign access — they need their own Agency
        subscription to use it, same as you.
      </p>
    </div>
  );
}
