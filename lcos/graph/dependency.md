# Dependency Graph · human-authored form

**Regenerated:** 2026-07-12 post-Wave-1 merge (`cc6784c7`).
**Format:** human-authored until P5 scanners produce `edges.json`. Every edge tagged with confidence + source-file citation. Refuse queries beyond this scope until P5.
**Purpose:** answer `/brain impact <symbol>` questions across the seven-layer chain for Wave-1-touched nodes.

---

## Wave-1 identity-ladder graph delta

### New nodes added

| Node ID | Type | File | Confidence | Purpose |
|---|---|---|---|---|
| `service.identity_claim` | backend service | `junior-backend/app/services/identity_claim.py` | 1.00 | Single canonical writer for `state.handle` |
| `endpoint.post_me_lc_id_claim` | http endpoint | `junior-backend/app/routes/me.py` | 1.00 | Primary handle claim route · delegates to `service.identity_claim` |
| `endpoint.post_me_handle_deprecated` | http endpoint | `junior-backend/app/routes/handle.py` | 1.00 | Legacy alias · delegates to `service.identity_claim` · emits `X-Deprecation` header + warn log |
| `hook.useMe.snapshot.lcId` | canonical state field | `desktop-2/src/design-os/state/useMe.ts` | 1.00 | Adds `lcId` axis to `state.current-user` |
| `hook.useMe.snapshot.handle` | canonical state field | `desktop-2/src/design-os/state/useMe.ts` | 1.00 | Adds `handle` axis |
| `hook.useMe.identityLadder` | derived selector | `desktop-2/src/design-os/state/useMe.ts` | 1.00 | 5-rung ladder (handle → LC-ID → email local → Signing in… → Complete profile) |
| `component.ClaimHandleSheet` | ui component | `desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx` | 1.00 | First-run + rung-5 CTA claim modal |
| `component.ClaimHandleSheetHost` | ui host | `desktop-2/src/design-os/onboarding/ClaimHandleSheetHost.tsx` | 1.00 | Bus listener for `identity:open-claim-sheet` |
| `event.identity_open_claim_sheet` | bus event | `desktop-2/src/design-os/bridge/events.ts` | 1.00 | Emitted by rung-5 CTA; consumed by ClaimHandleSheetHost |
| `event.identity_claim_submitted` | bus event | same | 1.00 | Emitted after successful POST |

### New edges (subset of DECISION-0007 · 18 minimum types)

| Source | Predicate | Target | Confidence | Citation |
|---|---|---|---|---|
| `endpoint.post_me_lc_id_claim` | delegates to | `service.identity_claim.claim_handle` | 1.00 | `me.py` |
| `endpoint.post_me_handle_deprecated` | delegates to | `service.identity_claim.claim_handle` | 1.00 | `handle.py` |
| `service.identity_claim.claim_handle` | writes | `state.handle` | 1.00 | direct SQL UPDATE on `users.handle` |
| `hook.useMe` | reads | `endpoint.get_me` | 1.00 | fetch call |
| `hook.useMe` | emits | `telemetry.me_snapshot_hydrated` | 1.00 | source transition subscriber |
| `component.TopHud` | reads | `hook.useMe.identityLadder` | 1.00 | via `identityLadder` selector |
| `component.SplashLeaderboard` | reads | `hook.useMe.identityLadder` | 1.00 | mirror ladder |
| `component.TopHud [rung-5-cta]` | emits | `event.identity_open_claim_sheet` | 1.00 | click handler |
| `component.SplashLeaderboard [rung-5-cta]` | emits | `event.identity_open_claim_sheet` | 1.00 | click handler |
| `component.ClaimHandleSheetHost` | invalidates | `hook.useMe` (via optimistic reload) | 1.00 | after successful POST |
| `component.ClaimHandleSheet` | calls | `endpoint.post_me_lc_id_claim` | 1.00 | via authedFetch |
| `component.AffiliateWidget` | calls | `endpoint.post_me_lc_id_claim` | 1.00 | migrated from legacy |
| `test.TopHud.identity-ladder.test.ts` | protects | `hook.useMe.identityLadder` + `component.TopHud` render | 1.00 | 5 assertions |
| `test.SplashLeaderboard.test.ts` | protects | `component.SplashLeaderboard` render | 1.00 | 3 assertions |
| `test.handle-claim.flow.test.ts` | protects | `component.ClaimHandleSheet` submit flow | 1.00 | 13 assertions |
| `test.test_me_lc_id_claim.py` | protects | `endpoint.post_me_lc_id_claim` behaviour | 1.00 | 15 backend assertions |
| `test.test_identity_claim_service.py` | protects | `service.identity_claim.claim_handle` divergence-free | 1.00 | 6 assertions |
| `decision.DECISION-0008` | constrains | `hook.useMe`, `state.handle`, `state.lc-id` (writer count) | 1.00 | DOCTOR-LITE cannot flip closed |
| `invariant.INV-006` | constrains | `state.handle` writer set | 1.00 | one writer only |
| `invariant.INV-007` | constrains | `component.TopHud` props | 1.00 | canonical state via selector, not prop |
| `invariant.INV-010` | constrains | `component.TopHud` render | 1.00 | one selector per axis |
| `invariant.INV-011` | constrains | every write to `state.handle` | 1.00 | transition-proof owed |

### Auth-hardening graph delta (BC-003 elimination · commit c2421921)

| Node | Change | Confidence | Citation |
|---|---|---|---|
| `endpoint.post_desktop_auth_verify` | consume UPDATE routed through Session instead of `engine.begin()` | 1.00 | `desktop_auth.py:242-260` |
| `endpoint.post_desktop_auth_start` | ISO-string TIMESTAMP handled defensively (SQLite cross-DB) | 1.00 | `desktop_auth.py:108-113` |
| `test.test_desktop_auth_hardening.py` | 9 gate assertions · 4 dynamic + 5 static route-source | 1.00 | new file |
| `invariant.INV-008` | constrains | `endpoint.post_desktop_auth_*` (no alternate auth behaviour) | 1.00 | tests enforce |

## What can be answered

- Any query about the identity pipeline (auth → me → handle → LC-ID → TopHud/Splash render)
- Any query about the OTP verify path hardening
- Any query about which tests protect which node in the two flows above

## What still cannot be answered (gaps)

- **Journey queries** — `journey.j001-fresh-user-otp-identity` station chain is not authored (P6 owed)
- **Feature contracts** — `feature.session-lifecycle`, `feature.lc-id`, `feature.handle` contracts not written (P6 owed)
- **Full application dependency graph** — only Wave-1 + auth-hardening nodes have edges; other 200+ nodes await P5 scanner
- **Impact of code outside Wave 1** — grep-based only until P5

Doctor Lite refuses out-of-scope impact queries with cited gap flags.
