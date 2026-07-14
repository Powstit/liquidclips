# RC1 Release Train · Train B · File Ownership Matrix

**Base commit:** after Barrier 1 reconciliation commit on `integration/cold-entry-mode-b`
**Dispatched:** 2026-07-12 (post-Barrier-1)
**Integration lead:** Claude (does not implement · reviews + merges only)

Learned from Train A: matrix paths must reflect **canonical current-repo layout** (see `BARRIER_1_REPORT.md` · Path-deviation learnings). Every path here has been verified.

---

## Agent B1 · Runtime version + update truth (BUG-006 + BUG-007 + BUG-009 + BUG-012)

**Branch:** `wave-b1/runtime-truth`

### Class-elimination target

BC-002 for BUG-006/007 (single source of truth for "which bundle is rendering") · potentially BC-005 for BUG-012.

### OWNED (may edit)
- `desktop-2/src/lib/useRuntimeVersion.ts` (create if missing · single canonical hook)
- `desktop-2/src/design-os/components/TopHud.tsx` (version pill mount site only · not identity ladder)
- `desktop-2/src/design-os/settings/Settings.tsx` OR `desktop-2/src/routes/settings/**` (verify exact path first)
- `desktop-2/src/design-os/onboarding/IntroSplash.tsx` OR wherever intro splash lives
- `desktop-2/src/design-os/settings/DiagnosticsSection.tsx` OR equivalent
- `desktop-2/src/design-os/update/UpdateBeacon.tsx` OR wherever update-beacon lives
- `junior-backend/app/routes/runtime.py` (fix 204 return · avoid 404 polling)
- NEW `desktop-2/src/lib/useRuntimeVersion.test.ts`
- NEW `desktop-2/src/design-os/update/UpdateBeacon.test.ts`

### READ-ONLY
- Any file with `__APP_VERSION__` reference (identify all render sites; sweep is OWNED)
- `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY only — shell freeze)

### FORBIDDEN
- Shell freeze paths: `desktop-2/src-tauri/**`, `Cargo.toml`, `tauri.conf.json`, `package.json`
- If native Rust patch required, **STOP + write STOP_REPORT + propose runtime workaround**
- Any file OWNED by B2 or B3

### Bugs
- BUG-006 · version pill shows shell version → FIXED_UNPROVEN
- BUG-007 · `__APP_VERSION__` hardcoded in 3 places → FIXED_UNPROVEN
- BUG-009 · UpdateBeacon 404 polling → FIXED_UNPROVEN
- BUG-012 · hot-swap requires quit+relaunch → **investigate + document + STOP if native**

### Regression tests
- `useRuntimeVersion.test.ts` · asserts hook returns runtime bundle version, not shell version
- `UpdateBeacon.test.ts` · asserts no 404 poll · asserts new-version detection surface
- Grep guard: `__APP_VERSION__` count in `src/**` == 1 (only the hook reads it)

---

## Agent B2 · Nav telemetry + performance (BUG-001 + BUG-010)

**Branch:** `wave-b2/nav-telemetry-perf`

### Class-elimination target

BC-005 (route events unobservable) · potentially BC-004 (nav journey unowned).

### OWNED (may edit)
- `desktop-2/src/lib/navPerf.ts` (add `boot` telemetry topic)
- `desktop-2/src/design-os/routes/CampaignsRoute.tsx` OR wherever campaigns live (verify path)
- `desktop-2/src/design-os/components/SideNav.tsx` (Learn nav item visibility)
- NEW `desktop-2/src/lib/navPerf.boot-emit.test.ts`
- NEW `desktop-2/src/design-os/components/SideNav.learn-visibility.test.ts`
- LCOS: `lcos/04_JOURNEY_BIBLE/j011-campaigns-navigation.md` (author if you get time · else document gap)

### READ-ONLY
- `desktop-2/src/design-os/state/useMe.ts` (auth state check for Learn visibility)
- `desktop-2/src-tauri/src/runtime.rs` (boot event source · READ ONLY)

### FORBIDDEN
- Shell freeze paths
- Blanket visual degradation (fix only measured causes per Daniel's brief)
- Any file OWNED by B1 or B3

### Bugs
- BUG-001 · Campaigns click telemetry not emitting → FIXED_UNPROVEN
- BUG-010 · Learn nav visibility on cold-boot → FIXED_UNPROVEN OR STOP+document

### Regression tests
- Emit `boot` topic on cold-boot · measure click → mount → content-ready
- Learn nav renders per auth state (documented in test)

---

## Agent B3 · HQ persistence for LCOS + golden-path telemetry

**Branch:** `wave-b3/hq-persistence`

### Class-elimination target

BC-005 (telemetry unobservable in HQ · stdout only).

### OWNED (may edit)
- `junior-backend/app/routes/telemetry_ingest.py` OR create `lcos_events.py` (add persistence receiver)
- `junior-backend/app/models.py` (add `lcos_event` table with idempotent lifespan migration in `app/main.py`)
- `junior-backend/app/main.py` (append `CREATE TABLE IF NOT EXISTS lcos_event` migration only · do not touch other migrations)
- `account-app/**` HQ views — read-only display of persisted events (verify exact paths · account-app path structure in account-app/CLAUDE.md)
- NEW `junior-backend/tests/test_lcos_event_persistence.py`

### READ-ONLY
- All frontend `lcDiag` call sites

### FORBIDDEN
- Shell freeze paths (no python-sidecar changes)
- Any file OWNED by B1 or B2
- Do NOT rename existing telemetry topics
- Do NOT change frontend `lcDiag` API

### Bugs
- No specific bug ID (cross-cutting infrastructure)
- Enables INV-011 transition proofs for real (previously stdout-only)

### Regression tests
- `test_lcos_event_persistence.py` · POST a topic + retrieve via HQ query · idempotency check

---

## Collision-free matrix (verified)

| Agent | useMe.ts | useAuth.ts | Settings.tsx | TopHud.tsx | Campaigns route | SideNav | UpdateBeacon | telemetry backend |
|---|---|---|---|---|---|---|---|---|
| B1 | RO | RO | OWNED | mount pill only | — | — | OWNED | — |
| B2 | RO | — | — | — | OWNED | OWNED | — | — |
| B3 | — | — | — | — | — | — | — | OWNED |

Frontend / backend / TopHud-pill mount vs Campaigns-route vs update beacon vs HQ persistence — all disjoint.

## Dispatch rules

Same as Train A. Every agent:
- Verifies base commit
- Works in isolation:worktree
- Emits Impact Report per commit
- Bug ceiling FIXED_UNPROVEN
- STOP if native rebuild required
- STOP if new npm dep needed
- No push · no tag · no deploy

## Barrier 2 · integration lead

1. Merge B1 → B2 → B3 into integration
2. Full test sweep (pytest + vitest + tsc)
3. Regen LCOS graphs
4. Verify HQ receives persistent events (curl test)
5. Perf waterfall on Campaigns click
6. If any gate red · STOP + report
7. If green · dispatch Train C
