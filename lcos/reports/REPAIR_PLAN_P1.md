# Repair Plan · P1

**Generated:** 2026-07-12 · from `lcos/graph/bugs.json` v1.1.0.

**Purpose:** Group 14 bugs by shared root cause and canonical owner. Identify multi-bug closures. Produce ranked repair plan with file-ownership matrix. Enforce DECISION-0006 — bugs don't fix in isolation; canonical-state clusters fix together.

---

## Root-cause clusters (5)

### Cluster 1 · Identity ladder missing
**Canonical owners:** `hook.useMe` · `hook.useAuth` · backend `/me` projection
**Members:** BUG-002 (P0), BUG-003 (P1), BUG-011 (P2), BUG-013 (P2)
**Shared root cause:** No first-class user identifier surface exists. `me.snapshot.email` is treated as identity, but the app was designed around LC-ID + handle. Every consequence downstream — "Guest" fallback, no claim UI, static greeting, opaque pill copy — flows from this one missing feature.
**Multi-bug closure opportunity:** Fixing BUG-003 (backend lc_id + handle projection + frontend adapter + first-run claim UI) closes:
- BUG-002 · the ladder can now render `handle → LC-ID → "Signing in…"` (not "Guest")
- BUG-013 · greeting can interpolate `handle` or `LC-ID`
- BUG-011 · adding a `data-identity-copy` attribute in the same TopHud pass unblocks visual QA
**Wave:** 1 · single implementer branch · 4 tests closed together
**Risk:** MEDIUM · touches backend + frontend + new UI surface (claim modal)

### Cluster 2 · Whop CTA visibility
**Canonical owners:** `hook.useMe.snapshot.whopUserId`
**Members:** BUG-004 (P1), BUG-014 (P1)
**Shared root cause:** No persistent Whop CTA in primary chrome. Identity pill is overloaded and doesn't show Whop except in one state. Home hero doesn't have a Whop tile.
**Multi-bug closure opportunity:** One branch adds:
- `WhopStatusChip` component in TopHud strip
- Conditional Home hero CTA in `CommandRoom.HomeContent`
- HQ event `whop_connect_cta_clicked` from every mount site
Closes BUG-004 + BUG-014.
**Wave:** 2 · single implementer branch · 2 tests closed together
**Risk:** LOW-MEDIUM · pure UI addition, no backend, no state model change

### Cluster 3 · Tier propagation
**Canonical owner:** `hook.useTierCaps`
**Members:** BUG-008 (P1)
**Shared root cause:** Prop-based tier defaults survived state-drift trifecta in three components.
**Multi-bug closure opportunity:** Single sweep · same pattern as state-drift-fixed (P1-B) applied to `ExportPanel`, `OverlayTemplateGallery`, `ReactionControls`.
**Wave:** 2 (piggyback with Cluster 2 or standalone) · 1 test
**Risk:** LOW · localized refactor

### Cluster 4 · Runtime version drift
**Canonical owner:** `hook.useRuntimeVersion` → Tauri `runtime_info`
**Members:** BUG-006 (P1), BUG-007 (P2)
**Shared root cause:** Rust `runtime_info` returns shell version, not runtime bundle version. Three additional surfaces render `__APP_VERSION__` directly.
**Multi-bug closure opportunity:** Fixing the source of truth (either native Rust patch or runtime-only workaround via `@tauri-apps/plugin-fs` reading `current.json`) closes BUG-006 immediately + BUG-007 after a 3-file sweep to use the hook.
**Wave:** 3 · requires a Daniel decision on native vs runtime path (DECISION-0003 exemption)
**Risk:** LOW (runtime workaround) · MEDIUM (native change under shell freeze)

### Cluster 5 · Runtime observability
**Canonical owner:** `state.runtime-version` (visibility of "which bundle is running")
**Members:** BUG-001 (P1), BUG-012 (P1)
**Shared root cause:** No boot signal proves which runtime bundle actually rendered. `nav_click_performance` didn't emit because either the app was on a stale bundle OR the diag buffer never flushed — cannot tell which without a boot event.
**Multi-bug closure opportunity:** Add `lcDiag("boot", { runtime_version, source_sha, bundle_index_html_sha256 })` synchronously on first paint. Investigate Cmd+R vs quit+relaunch parity. One branch closes BUG-001 diagnostic path + BUG-012 investigation gate.
**Wave:** 4 · single branch · 2 tests · potentially requires shell unlock for Cmd+R parity investigation
**Risk:** MEDIUM · Cmd+R behavior may need native investigation (blocked by DECISION-0003)

### Standalone (no cluster)
- BUG-005 (P2) · Notifications badge drift · needs product decision (a or b) before scoping
- BUG-009 (P2) · UpdateBeacon 404-poll · backend + frontend patch · low urgency
- BUG-010 (P2) · Learn nav visibility · needs Doctor Mode to confirm or dismiss (P8 dependency)

---

## Ranked repair plan

Ranking criteria (weighted):
1. **Golden paths unblocked** (mission fingerprint restored)
2. **Customer impact** (business consequence composite)
3. **Revenue / trust / support impact** (severity of specific dimension)
4. **Recurrence risk** (drift-prone areas)
5. **Implementation risk** (blast radius)

### 🟢 Rank 1 · Cluster 1 · Identity ladder · Wave 1

**Rationale:**
- Contains the **P0 · Definition-of-Complete target** (BUG-002).
- Unblocks 4 bugs including the two P2s that are direct symptoms (BUG-011, BUG-013).
- Fingerprint M3 (Trust) currently DEGRADED · fixing lifts it.
- Fingerprint M1 (Reach) improves · new users get a real identifier from OTP → Home.
- Business consequence peak: `Trust HIGH · Support HIGH` on BUG-002.
- Recurrence risk: HIGH if left · every future auth-adjacent change re-exposes the "Guest" leak.
- Implementation risk: MEDIUM · backend endpoint + frontend adapter + new claim UI + 4 tests.

**Branch:** `wave-1/identity-ladder`
**Estimated size:** ~800-1000 lines · 6-8 files · 4 tests · 1 backend endpoint · 1 new UI component
**Blocked-on:** none

---

### 🟢 Rank 2 · Cluster 2 · Whop CTA visibility · Wave 2

**Rationale:**
- Fingerprint M2 (Revenue) currently DEGRADED · fixing lifts it directly.
- Both bugs have `Revenue HIGH · Conversion HIGH`.
- Blocks funnel: unlinked user → Whop → MRR.
- Recurrence risk: LOW · UI addition to specific mount sites.
- Implementation risk: LOW-MEDIUM · component design + 2 mount sites + 2 tests.

**Branch:** `wave-2/whop-cta-visibility`
**Estimated size:** ~400 lines · 3 files touched · 1 new component · 2 tests
**Blocked-on:** none (parallelizable with Wave 1 if file ownership disjoint · which it is)

---

### 🟢 Rank 3 · Cluster 3 · Tier propagation sweep · Wave 2 (piggyback)

**Rationale:**
- Bundle with Wave 2 to keep monetisation cluster fixes together.
- Fingerprint M2 (Revenue) improved · agency users get correct preset unlocks.
- Recurrence risk: MEDIUM · same pattern will resurface without regression test.
- Implementation risk: LOW · localized · same pattern as state-drift-fixed P1-B.

**Branch:** `wave-2/tier-propagation` (or fold into wave-2/whop-cta-visibility if the reviewer prefers atomic monetisation branch)
**Estimated size:** ~150 lines · 3 files · 1 test
**Blocked-on:** none

---

### 🟡 Rank 4 · Cluster 4 · Runtime version drift · Wave 3

**Rationale:**
- Fingerprint M3 (Trust) affected · every promoted bundle shows wrong version.
- Support consequence HIGH · customer reports can't be triaged by version.
- **Blocked on Daniel's Path A/B decision** (runtime-only workaround vs native Rust fix).
- Recurrence risk: LOW once source of truth fixed.
- Implementation risk: LOW (runtime workaround) · MEDIUM (native under freeze).

**Branch:** `wave-3/runtime-version-truth`
**Estimated size:** ~200 lines · 4 files (1 hook, 3 render sites) · 1 test
**Blocked-on:** Daniel decision on Path A vs Path B for shell exemption

---

### 🟡 Rank 5 · Cluster 5 · Runtime observability · Wave 4

**Rationale:**
- No customer impact directly, but blocks Phase 2 optimizer + all future runtime debugging.
- Fingerprint M3 (Trust) internal · doesn't lift a customer surface.
- Blocked on cluster 4 partially (need runtime version to be correct for boot event to be useful).
- Recurrence risk: HIGH · this is a recurring source of confusion (three thread instances).
- Implementation risk: MEDIUM · Cmd+R behavior may need native investigation.

**Branch:** `wave-4/runtime-observability`
**Estimated size:** ~150 lines diag · unknown for Cmd+R fix
**Blocked-on:** Cluster 4 · potentially DECISION-0003 exemption

---

### 🟠 Rank 6 · Standalone bugs · later

- **BUG-005** — Product decision required (a wire `/notifications` or b explicit `Local · not synced` chip). Not scheduled until decision.
- **BUG-009** — Backend + frontend patch · low priority · schedule after Wave 4.
- **BUG-010** — Verification only · run in Wave 5 Journey QA walk.

---

## File ownership matrix · Wave 1

**Branch:** `wave-1/identity-ladder`
**Agent:** Wave 1 Agent 1 (Identity/account truth)
**Scope:** BUG-002, BUG-003, BUG-011, BUG-013

### Files touched (planned)

| File | Change | Owner (LCOS) | Existing | Reviewer gate |
|---|---|---|---|---|
| `junior-backend/app/routes/me.py` | Add `lc_id` + `handle` to `MeResponse`; add `POST /me/lc-id/claim` | `capability.identity-trust` | Yes | Ship-lens P0 · backend contract test |
| `junior-backend/app/models.py` | Verify `users.lc_id` column already exists (Block 1 migration); consider default lc_id generator | `capability.identity-trust` | Yes (:258) | Migration review |
| `desktop-2/src/design-os/state/useMe.ts` | Extend `MeSnapshot` with `lcId` + `handle`; adapter reads both | `capability.identity-trust` | Yes | Ship-lens P0 · reactive to activation:complete (already exists) |
| `desktop-2/src/design-os/components/TopHud.tsx` | Replace `handleFromEmail ?? 'Guest'` with priority ladder; add `data-identity-copy` attribute; personalise `greetingEyebrow` | `capability.identity-trust` | Yes (:75, :205, :372, :377, :544, :560) | Ship-lens · pill.test.ts + identity-ladder.test.ts pass |
| `desktop-2/src/overlays/invaders/SplashLeaderboard.tsx` | Same ladder; no props | `capability.identity-trust` | Yes | Same test suite |
| `desktop-2/src/design-os/state/useAuth.ts` | Verify sync with new hydration semantics | `capability.identity-trust` | Yes (recently added) | Regression test |
| **NEW** `desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx` | First-run bottom-sheet · claim handle · confirm LC-ID | `capability.identity-trust` | No · new | Component contract + a11y |
| `desktop-2/src/routes/crew-onboarding/CrewOnboarding.tsx` | Mount `ClaimHandleSheet` post-Crew if handle == null | `capability.creator-onboarding` | Yes | Journey walk |

### Files NOT touched (forbidden this wave · shell freeze)

- `desktop-2/src-tauri/**`
- `desktop-2/Cargo.toml` · `desktop-2/tauri.conf.json`
- `desktop-2/package.json` · new npm deps
- `desktop/python-sidecar/**`

### New tests authored this wave (4)

1. `desktop-2/src/design-os/components/TopHud.identity-ladder.test.ts::signed-in-never-guest`
2. `desktop-2/src/design-os/components/TopHud.identity-ladder.test.ts::signing-in-during-hydration`
3. `desktop-2/src/design-os/state/useMe.lc-id.test.ts`
4. `desktop-2/src/design-os/onboarding/handle-claim.flow.test.ts`

### Telemetry topics introduced (2)

1. `me_snapshot_hydrated` — fires when `useMe.source` transitions to `real-http` or `session-cache`
2. `handle_claimed` — fires when user submits handle via `ClaimHandleSheet`

Both must persist to Railway HQ for BUG-002 close condition #4 · flagged as gap (see `GAP_ANALYSIS_P1.md`).

### Regression tests re-run

- `TopHud.pill.test.ts` (existing · must not regress)
- `TopHud.identity.test.ts` (existing · must not regress)
- `useAuth.test.ts` (existing · must not regress)
- `useMe.test.ts` (existing · must not regress · will gain new cases from this wave)
- `SplashLeaderboard.test.ts` (if exists · else authored)

### Bugs that flip status via this branch

| Bug | Post-merge status | Blocks CLOSED on |
|---|---|---|
| BUG-002 | FIXED_UNPROVEN | Doctor Mode + live journey walk + HQ event persistence |
| BUG-003 | FIXED_UNPROVEN | Doctor Mode + live claim ceremony walk |
| BUG-011 | FIXED_UNPROVEN | Doctor Mode query returns `data-identity-copy` literal |
| BUG-013 | FIXED_UNPROVEN | Test suite green across 4×3 matrix |

**Definition of Complete (P10 target · BUG-002):** achievable after this wave lands AND Doctor Mode (P8) is available. Until Doctor exists, BUG-002 sits at FIXED_UNPROVEN.

---

## Sequencing recommendation

```
┌────────────────────────────────────────────┐
│ Rank 1 · Cluster 1 · Identity ladder       │  ← START
│ Wave 1 · wave-1/identity-ladder            │
│ Contains P0 · closes 4 bugs                │
└────────────┬───────────────────────────────┘
             │
             ├───────────────────────────────┐
             │                               │
             ▼                               ▼
┌───────────────────────┐    ┌──────────────────────────┐
│ Rank 2 · Whop CTA     │    │ Rank 3 · Tier propagation │
│ Wave 2 · Cluster 2    │    │ Wave 2 · Cluster 3        │
│ Closes BUG-004+014    │    │ Closes BUG-008           │
└───────────────────────┘    └──────────────────────────┘

Files disjoint · Waves 2 sub-branches can run in parallel or bundled

             ┌───────────────────────┐
             │ Rank 4 · Cluster 4    │  ← Blocked on Daniel decision A/B
             │ Wave 3                │
             │ Runtime version truth │
             └───────────────────────┘

             ┌───────────────────────┐
             │ Rank 5 · Cluster 5    │  ← Depends on Cluster 4
             │ Wave 4                │
             │ Runtime observability │
             └───────────────────────┘

             ┌───────────────────────┐
             │ Standalones · later   │
             │ BUG-005, BUG-009      │
             │ + BUG-010 Wave 5 QA   │
             └───────────────────────┘
```

**Parallelisation rule (DECISION-0006 compliant):**
Waves 1 and 2 have DISJOINT file ownership (Wave 1: `useMe`, `TopHud`, `SplashLeaderboard`, backend `me.py`; Wave 2: `WhopStatusChip` (new), `CommandRoom`, `WalletDetail`, `Settings`, `AffiliateWidget`, `ExportPanel`, `OverlayTemplateGallery`, `ReactionControls`). They can run in parallel worktrees IF Daniel greenlights.

Waves 3 and 4 share `useRuntimeVersion.ts` + Rust · must be sequential.

## Stop gates before Wave 1 dispatch

Per DECISION-0006, dispatch requires:

- [x] `graph/bugs.json` written · linked to full chain
- [x] Dependency-gap report published (`GAP_ANALYSIS_P1.md`)
- [x] Shared-root-cause groupings identified (this file · 5 clusters)
- [x] Ranked repair plan produced (this file)
- [x] File-ownership matrix for first repair wave (this file · Cluster 1)
- [ ] **Daniel ✓ on the ranking + Wave 1 scope + Path A vs Path B for LCOS scanner sequencing**

Awaiting the final ✓.
