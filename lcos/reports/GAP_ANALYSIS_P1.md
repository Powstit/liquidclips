# Dependency-Gap Report · P1

**Generated:** 2026-07-12 · from `lcos/graph/bugs.json` v1.1.0 · source commit `32fc9540`.

**Purpose:** For each ledger row, list the chain links LCOS cannot yet PROVE with high confidence, and which upstream LCOS phases must build the missing infrastructure. Prevents Wave 1 dispatch on unproven soil.

## Reading the report

Every ledger row cites: mission · capability · feature · journey · station · canonical state · code nodes · tests · telemetry · decisions · invariants.

Some of those citations point at LCOS assets that don't exist yet (feature contracts, journey files, scanner-derived edges). This report enumerates them so Doctor Mode + Anthropic Brain refuse stale answers and Daniel can decide whether to build the missing infrastructure before Wave 1 or accept named gaps.

**Confidence bands used:**
- **PROVEN** — file/line cited AND scanner would confirm (or human sign-off exists)
- **REACHABLE** — file/line cited but no scanner has run; can be lifted to PROVEN in P5
- **PENDING CONTRACT** — the link targets an LCOS asset that hasn't been human-authored yet (feature contract, journey file, station spec)
- **UNKNOWN** — genuinely uncertain; needs Doctor Mode to inspect the running app

---

## Global gaps · applies to every row

| Chain layer | Status today | Needed phase | Blocker for |
|---|---|---|---|
| `feature.*` contracts | 0 of 17 written | P6 | Anthropic Brain answering `/brain feature <name>` with citations |
| `journey.*` files | 0 of 15 written | P6 | Journey-status GREEN/AMBER/RED derivation |
| `station.*` registry entries | 0 populated | P6 | Doctor Mode identifying failed station |
| `code_nodes` scanner-verified | 0 (P0 scaffold state) | P5 | Confidence upgrade for every file:line cite in bugs.json |
| `test.*` names | 8 named as `to-be-authored` | Wave 1+ | Closes-only-when assertion #1 (test.passes:...) on every bug |
| `telemetry.expected` HQ persistence | Ephemeral stdout only | Later | Live journey proof for CLOSED transitions |
| `runtime_info` returns runtime bundle version | Returns shell version | Native OR runtime workaround | BUG-006, BUG-007, BUG-012 diagnostic |
| `hq event: me_snapshot_hydrated` | Topic doesn't exist yet | Wave 1 will add | BUG-002 close condition #4 |
| `POST /me/lc-id/claim` endpoint | Doesn't exist | Wave 1 will add | BUG-003 |
| `MeBackendResponse.lc_id` field | Missing | Wave 1 backend change | BUG-002, BUG-003, BUG-013 |
| `MeSnapshot.lcId + handle` adapter fields | Missing | Wave 1 frontend | BUG-002, BUG-003, BUG-013 |
| `WhopStatusChip` component | Doesn't exist | Wave 2 | BUG-004, BUG-014 |
| `boot` lcDiag topic | Doesn't exist | Wave 4 | BUG-001, BUG-012 |
| Scanner `edges.json` populated | Empty | P5 | Every `/brain impact` query |
| Doctor Mode runner | Not built | P8 | Every `closes_only_when.doctor.observes` clause |

**Bottom line:** without P5 (scanners) + P6 (feature/journey/station contracts) + P8 (Doctor), LCOS cannot promote any bug to CLOSED even if the code fix ships and tests pass.

## Per-bug gap table

### Category 1 · Identity and trust

| Bug | Missing link | Phase needed | Impact if not resolved before dispatch |
|---|---|---|---|
| BUG-002 | `feature.session-lifecycle.md` · `feature.lc-id.md` · `feature.handle.md` (3 contracts) | P6 | Cannot cite the intended behaviour when reviewing the fix diff |
| BUG-002 | `journey.j001-fresh-user-otp-identity` full station chain | P6 | Doctor cannot verify "avatar text ∈ {handle, lc-id, 'Signing in…'} never 'Guest'" against a defined journey |
| BUG-002 | `state.lc-id` canonical entry with confidence 1.00 (currently 0.30) | Wave 1 fixes this by adding the frontend read | Ownership isn't provable until the state exists |
| BUG-002 | HQ event `me_snapshot_hydrated` | Wave 1 emits · HQ persistence pending | Close condition #4 blocked |
| BUG-003 | Backend endpoint `POST /me/lc-id/claim` | Wave 1 backend | Cannot fix without the endpoint |
| BUG-003 | `feature.lc-id.md` + `feature.handle.md` contracts | P6 | Contract review of the endpoint shape |
| BUG-003 | Station `station.identity.claim-handle` · `station.identity.confirm-lc-id` | P6 | UX handoff points undefined |
| BUG-011 | Test-optional; needs `data-identity-copy` attribute | Wave 1 piggyback | None if attribute chosen; verification stays visual otherwise |
| BUG-013 | Depends on BUG-003 (handle/LC-ID must exist first for interpolation) | Wave 1 sequence | If BUG-003 delayed, BUG-013 defers |

### Category 2 · Monetisation and Whop

| Bug | Missing link | Phase needed | Impact |
|---|---|---|---|
| BUG-004 | `WhopStatusChip` component doesn't exist | Wave 2 | Component to design + build |
| BUG-004 | `feature.whop-connection.md` contract | P6 | State transitions undefined without contract |
| BUG-004 | `journey.j004-connect-whop.md` | P6 | Station handoff between chip → OAuth → return → useMe refresh undefined |
| BUG-004 | HQ event `whop_connect_cta_clicked` per mount site | Wave 2 emits | Doctor cannot prove parity across mount sites |
| BUG-008 | Line number for `ReactionControls.tsx:userTier` (currently 0.60 confidence) | Grep on live tree | Scanner will confirm |
| BUG-008 | `feature.export.md` contract | P6 | Preset gating rules undefined without contract |
| BUG-014 | Line-precise mount point in `CommandRoom.tsx:HomeContent` | Scanner or grep | Wave 2 authors precise location |
| BUG-014 | HQ event `whop_cta_home_impressions` | Wave 2 emits | Close condition #2 |

### Category 3 · Runtime and updates

| Bug | Missing link | Phase needed | Impact |
|---|---|---|---|
| BUG-006 | Decision on runtime-vs-native path | Product decision | Blocks BUG-007 sweep |
| BUG-006 | Verify `runtime_info` return semantics in `runtime.rs` | Rust read-only inspection | Confirms confidence 0.85 |
| BUG-007 | Follows BUG-006 fix decision | Cascade | Cannot fix independently |
| BUG-009 | Backend fix in `runtime.py` (return 204) | Backend | Straightforward · no upstream blocker |
| BUG-012 | Native investigation OR observability improvement | Wave 4 or shell unlock | Root cause remains 0.40 confidence until boot event lands |
| BUG-012 | `boot` telemetry topic | BUG-001 fix delivers | Same fix |

### Category 4 · Nav and performance

| Bug | Missing link | Phase needed | Impact |
|---|---|---|---|
| BUG-010 | Doctor Mode running against live app | P8 | Cannot resolve OPEN status without Doctor |
| BUG-010 | `station.consolenav.learn` registry entry | P6 | Test authoring blocked |
| BUG-010 | `journey.j001` station chain including Learn item | P6 | Journey status derivation |

### Category 5 · Observability and HQ

| Bug | Missing link | Phase needed | Impact |
|---|---|---|---|
| BUG-001 | `boot` telemetry topic definition | Wave 4 | New topic needs consumer + backend acceptance |
| BUG-001 | HQ persistence of `nav_click_performance` (currently stdout-only) | Later | Live proof for close condition #3 |
| BUG-005 | Product decision (a wire /notifications or b explicit local counter) | Product | Cannot draft fix without decision |
| BUG-005 | `feature.notifications.md` contract | P6 | Defines the (a) vs (b) semantics |

## What LCOS cannot answer today

Try `/brain impact <symbol>` on any of the following and LCOS will (correctly) say "I don't know · phase P5 required":

- `component.TopHud` — impact on WalletDetail, Settings, IntroSplash (needs edges.json)
- `hook.useMe` — full downstream consumer list (needs edges.json)
- `endpoint.get_me` — code-graph consumers (needs scanners)
- `state.tier` — all writers and readers (needs code graph + canonical state cross-check)
- `journey.j004-connect-whop` — station chain (needs journey files)
- `feature.wallet` — full 7-layer chain (needs feature contracts)

Everything above is on the P4-P8 build plan.

## Immediate recommendation

**Two paths to consider before Wave 1:**

### Path A · Build LCOS scanners first, then dispatch

Sequence: P4 (Canonical State Registry proofs) → P5 (Code Graph scanners) → Wave 1 dispatch with impact reports live.

Pro: Every Wave 1 diff comes with an auto-generated impact report grounded in the code graph. Doctor Mode partially available. Confidence on every close condition is 1.00 for AST-verified edges.

Con: Delays customer-facing fixes by ~1-2 build sessions.

### Path B · Wave 1 dispatch now, LCOS scanners chase

Sequence: Wave 1 dispatch (BUG-002 + BUG-003 + BUG-011 + BUG-013) → P4/P5 in parallel background → integration verified by human review + tests + live journey walk.

Pro: BUG-002 (P0 · Definition-of-Complete target) closes soonest. Ships identity ladder + LC-ID.

Con: Bug closure verification runs on tests + live walk only. Doctor Mode + Impact Reports catch up later. Higher risk of a shipped fix silently breaking a link we haven't yet mapped.

**Neither path violates DECISION-0006** (ledger is not the destination). Both paths keep the graph as target. They differ on when LCOS's own diagnostic layer becomes trustworthy.

**Recommendation for RC1 velocity:** **Path B, with a bright-line rule.** Wave 1 branches must include:
- The regression tests named in `closes_only_when` (mandatory)
- A live-journey walk transcript pasted into the ledger row (mandatory)
- HQ event listing (may be `expected · not-yet-persisted-to-Railway`)
- LCOS status flips to `FIXED_UNPROVEN` not `CLOSED` until Doctor Mode (P8) verifies

That way we ship customer value while LCOS itself hardens in parallel, and no bug closes without proof even if Doctor is late.

Awaiting Daniel's Path A vs Path B decision.
