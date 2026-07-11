# 06 · Canonical State Registry

**One owner per shared state.** Everyone else reads. Every duplicate writer = engineering finding.

Structure will be populated fully in P4. This file locks the schema and seeds the known canonical owners.

## Schema

```
state.<id>
Purpose:              <what the state represents>
Canonical owner:      <hook | store | endpoint>
Canonical persistence: <localStorage key | sessionStorage key | none | backend column>
Permitted cache:      <hook_cache | zustand | none>
Permitted writers:    [entity.id, ...]                  # anyone else writing = drift
Consumers:            [entity.id, ...]
Invalidation events:  [bus_event | http_event, ...]
Prohibited duplicates: [key, ...]                       # scanner blocks these
```

## Seed rows

| State | Canonical owner | Persistence | Confidence |
|---|---|---|---|
| `state.authenticated` | `hook.useAuth` | `localStorage.lc.license.jwt.v1` + native Keychain | 1.00 (P4) |
| `state.current-user` | `hook.useMe` | `hook_cache` (module-scope) | 1.00 (P4) |
| `state.tier` | `hook.useTierCaps` | derived from `useMe` | 1.00 (P4) |
| `state.mode` | `hook.useMode` | `localStorage.lc.mode` (ONLY) | 1.00 (P4) |
| `state.wallet-balance` | `hook.useWalletLedger` | `hook_cache` from `/me/wallet/summary` | 1.00 (P4) |
| `state.affiliate-mrr` | `hook.useEarnSummary` (lens on `useWalletLedger`) | derived | 1.00 (P4) |
| `state.whop-connection` | `hook.useMe.snapshot.whopUserId` | via `/me` | 1.00 (P4) |
| `state.handle` | `hook.useMe.snapshot.handle` (planned) | via `/me` + `PATCH /me/handle` | 0.60 (unbuilt) |
| `state.lc-id` | `hook.useMe.snapshot.lcId` (planned) | via `/me` (backend column exists) | 0.30 (unwired) |
| `state.unread-notifications` | `hook.useInbox` (partial) | `localStorage.lc.inbox.messages.v1` | 0.60 (drift · BUG-005) |
| `state.route` | `hook.useHashRoute` + `SimulatorRouter.route` | `window.location.hash` | 0.85 (dual writer risk) |
| `state.runtime-version` | `hook.useRuntimeVersion` | Tauri `invoke("runtime_info")` | 0.85 (BUG-006) |

## Prohibited duplicates (scanner-enforced)

Every entry here fails scanner Proof 05 if written by anyone other than the canonical owner:

- `localStorage.lc:user-mode:v1` — deprecated 2026-07-12 (RC1 state-drift trifecta) · must never be written again
- `useState(!!getJwt())` outside `hook.useAuth` — INV-001 violation
- Any hardcoded money literal in JSX — INV-002 violation
- Any hardcoded tier literal (e.g. `userTier="pro"`) — DECISION-0005-adjacent · scanner grep

## Populating P4

Scanner will walk every module in `desktop-2/src` and:
1. List every `useState`, module-scope `let`, zustand store, and localStorage key.
2. For each entry in the table above, flag any writer NOT in `Permitted writers`.
3. Return findings + confidence + fix suggestion.
4. Human confirms each row before it goes to `graph/sources-of-truth.json`.
