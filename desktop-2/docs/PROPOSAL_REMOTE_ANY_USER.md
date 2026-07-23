# Proposal · Remote-control-any-user (Support Impersonation)

**Owner:** Claude · **Approver:** Daniel · **Status:** DESIGN · not built yet
**Date:** 2026-07-22

## Question we're answering

"I want to control any user's machine for big fixes or the unlikely case something breaks." — with consent, audit trail, and time-boxed sessions per SaaS industry standard.

## Existing infrastructure (from repo scan)

| Wired now | Owning file |
|---|---|
| Remote control channel (SSE) | `junior-backend/app/routes/user_remote.py` |
| Admin enqueue (staff-side) | `junior-backend/app/routes/admin_remote.py` |
| Frontend dispatch | `desktop-2/src/lib/remoteControlDispatch.ts` |
| Founder-only gate | `desktop-2/src/lib/useRemoteControl.ts` line 79 (`isFounder` check) |
| Kill switch ⌘⇧K | `useRemoteControl.ts` `killSwitch` |
| RemoteCommand table | `junior-backend/app/models.py::RemoteCommand` |
| Iron-gate IG-REMOTE-CONTROL-STAFF-ONLY · 12 guards | `scripts/lint-remote-control-staff-only.sh` |

**Net:** channel + auth + audit exist for FOUNDER-only. To extend to any-user we need consent flow + time-boxed impersonation sessions + audit-per-session.

## SaaS industry standard (from research)

Per SaaS support impersonation best practices 2026:
1. **User consent required** — GDPR + SOC 2 gate
2. **Explicit opt-in per session** · never blanket allow
3. **Time-boxed** · sessions auto-expire (30-60 min typical)
4. **Full audit trail** · every command logged with staff_user_id + reason
5. **User kill switch** · user can revoke access anytime
6. **Approval logs** · who approved, when, why · surfaced for compliance
7. **Reduces avg resolution time 60-70%** when done right

## What to build

### A · New `remote_support_sessions` table (backend migration)

```sql
CREATE TABLE remote_support_sessions (
  id                TEXT PRIMARY KEY,
  target_user_id    TEXT NOT NULL REFERENCES users(id),
  staff_user_id     TEXT NOT NULL REFERENCES users(id),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason            TEXT NOT NULL,
  granted_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_by        TEXT, -- user | staff | auto-expire
  command_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ON remote_support_sessions(target_user_id, granted_at)
  WHERE revoked_at IS NULL;
```

### B · Three new backend endpoints

```
POST /support/impersonate/request  (staff)
  · body: { target_user_id, reason }
  · creates row · pushes SSE notification to target user's app
POST /support/impersonate/approve  (user)
  · body: { session_id }
  · sets granted_at + expires_at = granted_at + 30min
POST /support/impersonate/revoke   (user or staff)
  · body: { session_id, by }
```

### C · Frontend consent toast (user-side)

Persistent modal (fires on SSE `support:impersonate-requested` event):

```
🛠 Support wants to help
Reason: "Fix a stuck upload from 2h ago"
Approve for 30 minutes?
[Approve] [Deny]
Any active session shows a top-bar banner: "Support is helping · ends in 27:34 · Revoke"
```

### D · Extend `useRemoteControl` gate

Change `isFounder` check to `isFounder || hasActiveSupportSession`:

```typescript
const activeSupportSession = useMe()?.snapshot?.support_session_active === true;
const canReceiveCommands = isFounder || activeSupportSession;
```

### E · Extend admin_remote enqueue

`/admin/remote/enqueue` currently requires `x-internal-secret`. Add optional
`x-support-session-id` header · when present, validate the session is active
+ not expired · commands still write staff_user_id to RemoteCommand.notes.

### F · HQ dashboard (accountapp)

- Active support sessions table
- Command log per session
- Force-revoke button per session
- Reason audit trail exportable to CSV for SOC 2

## Iron-gate

- IG-REMOTE-SUPPORT-CONSENT · lint that the frontend gate reads `hasActiveSupportSession` · vitest that a session without `granted_at` is rejected · pytest that expired sessions are auto-revoked · vitest that user kill switch immediately revokes even active session

## What's NEW vs existing

- Existing: founder-only channel · always-on
- New: user-approved · time-boxed · reason-required · auto-expiring · per-session audit

## Total scope

- Backend migration + 3 endpoints: ~90 min
- Frontend consent toast: ~40 min
- HQ admin surface: ~60 min
- Iron-gate + vitest + pytest: ~40 min
- Total: ~4 hours

## Safety guardrails

- Support session cannot elevate to founder actions (billing, admin, etc.)
- Same kill switch (⌘⇧K) revokes support session as founder session
- Every command in support session logged with staff_user_id
- 30 minute hard cap · no extension without re-request
- User-visible top banner during active session · always visible · cannot be dismissed

## Sources

- [User impersonation for SaaS support teams · Yaro Labs](https://yaro-labs.com/blog/user-impersonation-tool-saas)
- [SaaS audit trails · tamper-resistant logs · Agnite Studio](https://agnitestudio.com/blog/designing-tamper-resistant-audit-trails-compliance-systems/)
- [Audit trail for agent auth in B2B SaaS · Scalekit](https://www.scalekit.com/blog/audit-trail-agent-auth)
- [Cross-IdP impersonation risks · Push Security](https://pushsecurity.com/blog/cross-idp-impersonation/)
