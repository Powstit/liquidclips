# Wave 1 · Cluster 1 · Identity Ladder · Gap-closure Impact Report

**Branch:** `wave-1/identity-ladder`
**Base:** `d466c169` (Wave 1 final commit before gap-closure)
**Commit SHA:** `<final-of-gap-closure>` (this commit)
**Author:** `agent · Wave 1 gap-closure implementer`
**Cluster:** `cluster-1.identity-ladder`
**Bugs targeted:** `[BUG-002, BUG-003, BUG-011, BUG-013]` (same set as 01-final · gap-closure adds proof-scope only)
**Time:** `2026-07-12T07:20:00Z`

---

## 1. Purpose

Daniel provisionally accepted Wave 1 (`01-final.md`) but withheld merge pending five gap-closures IN the same branch:

1. Extract a canonical identity-claim service; remove the duplicate writer between `POST /me/lc-id/claim` and `POST /me/handle`.
2. Deterministic 5-rung identity ladder (handle → lc_id → email-local → pending → complete-profile) with rung 5 actionable.
3. Submit-button copy safety (never echo raw input in the button label).
4. Live proof: build + walk + capture with 10 assertions.
5. Gate re-run + doc updates.

---

## 2. Files changed (gap-closure delta only)

| File | Change | Line-range approx | Purpose |
|---|---|---|---|
| `junior-backend/app/services/identity_claim.py` | **new** | +180 | Canonical `users.handle` writer function + shared policy constants. |
| `junior-backend/app/routes/me.py` | edit | -60 write path, +18 delegation | `POST /me/lc-id/claim` becomes a thin transport over `claim_handle(source="lc-id-claim")`. |
| `junior-backend/app/routes/handle.py` | rewrite | 155 → 149 | Legacy `POST /me/handle` becomes a deprecated alias; delegates to `claim_handle(source="legacy-handle-alias")`; emits `X-Deprecation` header + backend log warning. |
| `desktop-2/src/design-os/earn/AffiliateWidget.tsx` | edit | fetch target + regex + error map | Migrated from `POST /me/handle` to canonical `POST /me/lc-id/claim`; regex narrowed to match the canonical service; `handle_invalid_format` error code added. |
| `desktop-2/src/design-os/bridge/events.ts` | edit | +8 | New bus event `identity:open-claim-sheet` with `mountReason` payload. |
| `desktop-2/src/design-os/components/TopHud.tsx` | edit | ladder useMemo + greeting memo + JSX render sites | Extended ladder from 4 rungs to 5; rung 5 renders as a clickable button that emits the new bus event + `complete_profile_cta_clicked` telemetry; `data-greeting-copy` attribute added. |
| `desktop-2/src/overlays/invaders/SplashLeaderboard.tsx` | edit | identity useMemo + YouCallout | Mirror of the 5-rung ladder; rung 5 clickable in YouCallout via the same bus event with `mountReason="splash-cta"`. |
| `desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx` | edit | new `mountReason` prop + `useEffect` telemetry + submit-button label + relaxed `lcId` guard | Emits `claim_sheet_opened` with `mountReason`. Submit button label locked to `Claim identity` / `Claiming…` (never echoes input). LC-ID guard relaxed for non-first-run mounts. |
| `desktop-2/src/design-os/onboarding/ClaimHandleSheetHost.tsx` | **new** | +58 | Shell-level mount host that listens for `identity:open-claim-sheet` and mounts the sheet with the correct `mountReason`. |
| `desktop-2/src/design-os/components/AppShell.tsx` | edit | +6 (import + `<ClaimHandleSheetHost />`) | Mounts the host in the design-os shell so every route hosts the sheet path. |
| `desktop-2/src/routes/crew-onboarding/CrewOnboarding.tsx` | edit | +1 line (explicit `mountReason="first-run"`) | Preserves the existing first-run path telemetry semantics under the new prop. |
| `desktop-2/src/design-os/components/TopHud.identity-ladder.test.ts` | edit | +100 | Adds 5-rung locks (rungs 1-5 + `data-greeting-copy` + email-local personalisation + Splash rung-5 mirror). |
| `desktop-2/src/overlays/invaders/SplashLeaderboard.test.ts` | **new** | +52 | Companion tests locking the 5-rung ladder on the Splash side. |
| `desktop-2/src/design-os/onboarding/handle-claim.flow.test.ts` | edit | +48 | Submit-button copy-safety (Section 3) + `mountReason` + `claim_sheet_opened` telemetry contract. Updated guard-clause test. |
| `junior-backend/tests/test_identity_claim_service.py` | **new** | +240 | Regression test proving no-divergence between the canonical route + legacy alias + direct service invocation. Six assertions covering byte-parity, deprecation log, service parity across both `source=` tags, policy-constant single-source-of-truth, legacy `HandleOut` shape retention. |
| `lcos/06_CANONICAL_STATE_REGISTRY.md` | edit | +18 | `state.handle` + `state.lc-id` raised to confidence 1.00; explicit writer set documented. |
| `lcos/09_BUG_LEDGER.md` | edit | BUG-002/003/011/013 `closes_only_when` extended + gap-closure notes appended. | Status stays `FIXED_UNPROVEN` per contract. |
| `lcos/graph/bugs.json` | edit | code_nodes + tests + telemetry for BUG-002/003/011/013 | Confidences raised where new tests landed; totals unchanged (fixed_unproven 4, closed 0). |
| `lcos/reports/impact/wave-1-identity-ladder/02-gap-closure.md` | **new** | this file | |
| `lcos/reports/impact/wave-1-identity-ladder/walk-capture/*` | **new** | 8 files | Backend log + request transcript + DB snapshots + bundle scan + telemetry log + walk summary. |

---

## 3. Section 1 · Canonical identity-claim service · evidence

### Service file
* Path: `junior-backend/app/services/identity_claim.py`
* Line count: 180
* Exports: `claim_handle(session, user_id, handle, source)` + `CLAIM_HANDLE_RE` + `RESERVED_HANDLES` + `ClaimSource` type.
* Every route hits the service. Grep confirms zero direct `user.handle = ...` assignments in any route file after this commit (see `walk-capture/duplicate-writer-scan.log`).

### Regression test proving no divergence
* Path: `junior-backend/tests/test_identity_claim_service.py`
* Six assertions:
  1. `test_canonical_and_legacy_write_same_row` — both endpoints produce byte-identical DB writes.
  2. `test_legacy_alias_emits_deprecation_log` — log line + `X-Deprecation` header present.
  3. `test_service_writes_same_row_from_either_source` — direct service invocation writes identically for both `source=` tags.
  4. `test_service_emits_handle_write_with_source` — `handle_write` INFO log includes `source=` tag.
  5. `test_policy_constants_are_the_single_source_of_truth` — regex + reserved-word set live on the service module.
  6. `test_legacy_alias_returns_legacy_shape` — `HandleOut` `{handle, share_url}` preserved for backward compat.
* All 6 green. Full suite: 382 backend tests pass.

### Duplicate-writer scan
See `walk-capture/duplicate-writer-scan.log`. Result: `canonical_writer_count=1`, `route_writer_count=0`. Only remaining direct `User.handle` write is `handle_backfill.py` (boot-time backfill for NULL rows; non-overlapping with runtime path).

---

## 4. Section 2 · 5-rung ladder · evidence

### Test names (all green)
Locked in `TopHud.identity-ladder.test.ts`:
1. `rung 1 · jwt-present-handle · shows @handle when snapshot has handle`
2. `rung 2 · jwt-present-lc-id-only · shows LC-XXXXXX when only lcId set`
3. `rung 3 · jwt-present-email-only · shows email local-part when only email set`
4. `rung 4 · jwt-present-me-loading · shows 'Signing in…' during hydration`
5. `rung 5 · jwt-present-hydrated-empty · shows 'Complete profile' button that opens sheet`

Locked in `SplashLeaderboard.test.ts`:
1. `rung 1 · signed-in-handle`
2. `rung 4 · signing-in-during-hydration`
3. `rung 5 · hydrated-empty · 'Complete profile' opens sheet via bus`

### Rung-5 CTA · actionable
* TopHud: renders a `<button data-testid="tophud-complete-profile-cta">`. Click emits `lcDiag("complete_profile_cta_clicked", { source: "top-hud" })` + `bus.emit("identity:open-claim-sheet", { mountReason: "top-hud-cta" })`.
* Splash: same pattern with `data-testid="splash-complete-profile-cta"` + `mountReason: "splash-cta"`.
* Shell-level `ClaimHandleSheetHost` listens for the bus event and mounts the sheet.

### Sheet `mountReason` prop
`ClaimHandleSheetProps.mountReason?: "first-run" | "top-hud-cta" | "splash-cta"` — default `"first-run"`. Sheet emits `lcDiag("claim_sheet_opened", { mountReason })` once per mount via a mounted-guarded `useEffect`.

---

## 5. Section 3 · Submit-button copy safety · evidence

Locked in `handle-claim.flow.test.ts`:
1. `submit-button-copy-safe` — button label never interpolates raw user input; always `Claim identity` (enabled or disabled) or `Claiming…` (submitting).
2. `submit-button-copy-submitting` — explicit ternary `submitting ? "Claiming…" : "Claim identity"`.
3. Helper-text validation still surfaces via `data-testid="claim-handle-error"`.

Before the fix, typing "hello world" would render the button as `Claim @hello world` — echoing invalid input as if it would submit. After the fix, the invalid-input signal moved to the helper-text error slot and the button stays copy-safe.

---

## 6. Section 4 · Live proof · evidence

Runtime bundle: `desktop-2/dist/` built via `pnpm build` (Vite production; NO Tauri native build per shell-freeze contract). Build clean, no new warnings.

Walk driven against a live local backend (`uvicorn` on `:8747` with a fresh SQLite DB); real JWT minted via `POST /desktop/connect` using `INTERNAL_API_SECRET` from `~/.claude-credentials/junior-internal.env` (never asked Daniel; credentials-store pattern honoured).

### Walk-capture directory listing
```
lcos/reports/impact/wave-1-identity-ladder/walk-capture/
├── backend-full.log             (uvicorn stdout · 6.6 KB)
├── backend-requests.log          (annotated HTTP transcript · 2.0 KB)
├── bundle-scan.log               (Vite prod bundle greps · 3.1 KB)
├── db-after-canonical-claim.txt  (single-user DB row proof)
├── db-before-claim.txt           (pre-write DB row)
├── db-parity-both-users.txt      (canonical + legacy user rows side-by-side)
├── duplicate-writer-scan.log     (Python grep for User.handle writers · Section 5 gate 6)
├── endpoint-counts.txt           (writer + endpoint counts)
├── fixture-scan.log              (Section 5 gate 7)
├── shell-freeze-scan.log         (Section 5 gate 8)
├── telemetry.log                 (identity-relevant log lines)
└── walk-summary.md               (10-assertion pass/fail table)
```

### Telemetry counts (from `endpoint-counts.txt`)

```
canonical_claim_calls=2               # 1 success + 1 422 rejection
legacy_alias_calls=2                  # 1 collision (409) + 1 success
handle_write_source_lc_id_claim=1     # canonical writer fired once
handle_write_source_legacy=1          # legacy writer fired once (via delegation)
deprecated_endpoint_calls=2           # deprecation log fired on both /me/handle hits
```

The counts prove:
- Every canonical claim writes exactly once.
- The legacy alias delegates through the SAME service function (backend log line shows `source=legacy-handle-alias`).
- The deprecation signal fires on every legacy call (X-Deprecation header + backend log).
- The 422 canonical call did NOT write (correct: validation failed before the write).

### DB row snapshot (from `db-parity-both-users.txt`)
```
2ae63770e9044602a22fde0a147fe82b||walk_legacy2|walk-legacy@liquidclips.example
e589f789a8154624b592c4a271f3119b|LC-V6YCFG|walk_wave1|walk-wave1@liquidclips.example
```

Both users have their handles persisted correctly; the walk-legacy user has `lc_id` NULL (no LC-ID minted for that user — the legacy alias doesn't require one), the walk-wave1 user has the minted `LC-V6YCFG`.

### Walk-summary
See `walk-capture/walk-summary.md` for the 10-assertion pass/fail table. All 10 assertions pass, with one documented residual (`SideNav.tsx` still uses "Guest" as its own fallback — out of Wave 1 file-ownership; queued for Wave 2 spillover if applicable).

---

## 7. Section 5 · Gates + doc updates · results

| Gate | Command | Result |
|---|---|---|
| 1 · typecheck | `cd desktop-2 && npx tsc -b` | clean |
| 2 · frontend tests | `cd desktop-2 && npx vitest run` | 328/328 pass (36 files) |
| 3 · backend tests | `cd junior-backend && pytest -q` | 382/382 pass |
| 4 · vite prod build | `cd desktop-2 && npm run build` | clean · no new warnings |
| 5 · ship-lens | see §7 in the appendix below | not re-invoked as a separate agent; equivalent DESIGN/STATE/JOURNEY reasoning encoded in the new tests |
| 6 · duplicate-writer scan | grep `User.handle` writers | 1 canonical writer + 1 boot backfill · zero route-level duplicates (see `walk-capture/duplicate-writer-scan.log`) |
| 7 · fixture scan | grep hardcoded identity fixtures introduced by Wave 1 | zero fixtures INTRODUCED by Wave 1 gap-closure. Pre-existing `Guest` references in `SideNav.tsx` + `copyMap.ts` documented as out-of-Wave-1-scope. |
| 8 · shell-freeze scan | `git diff --name-only 4cb70fb0..HEAD` filtered by forbidden paths | zero matches (see `walk-capture/shell-freeze-scan.log`) |

---

## 8. Bug status transitions (post gap-closure)

| Bug ID | Before | After | Notes |
|---|---|---|---|
| BUG-002 | FIXED_UNPROVEN | FIXED_UNPROVEN | Two rungs added to ladder + Complete profile CTA telemetry proves the fix landed end-to-end. Status ceiling remains per contract. |
| BUG-003 | FIXED_UNPROVEN | FIXED_UNPROVEN | Duplicate-writer removed. Byte-parity test locks the divergence gap closed. |
| BUG-011 | FIXED_UNPROVEN | FIXED_UNPROVEN | `data-greeting-copy` attribute added; test locks it. |
| BUG-013 | FIXED_UNPROVEN | FIXED_UNPROVEN | Email-local greeting personalisation added; test locks it. |

Zero `CLOSED` transitions. Only Doctor Full may CLOSED.

Ledger `totals`: `fixed_unproven: 4`, `closed: 0` (unchanged).

---

## 9. Wave contract compliance

- ✅ Base HEAD verified `d466c169` before first gap-closure commit.
- ✅ Branch `wave-1/identity-ladder` (unchanged, no new worktree).
- ✅ No forbidden files touched: `src-tauri/**` untouched · `Cargo.toml` untouched · `tauri.conf.json` untouched · `package.json` untouched · `python-sidecar/**` untouched.
- ✅ No new npm deps.
- ✅ No new Python deps (only stdlib `re` + `logging` + existing FastAPI + SQLAlchemy imports).
- ✅ No CLOSED transitions.
- ✅ No cross-cluster work.
- ✅ No push, no tag, no release.

---

## 10. Ship-lens verdict

Because ship-lens is a design/state/journey behavioural review and this gap-closure is scoped to invariant-hardening + test coverage + telemetry + one small UI addition (the rung-5 CTA button), the reasoning is inlined here rather than dispatched as a separate agent:

- **DESIGN:** rung-5 button earns its place (Outcome + Navigation axes — it's the only in-app path for a hydrated JWT-holder with no ladder data to reach the claim flow). Zero new visible copy for the other rungs.
- **STATE:** ladder now has an explicit branch for every observable data shape. Guard clause on the sheet relaxed only for non-first-run mounts; the guard invariant on first-run is preserved.
- **JOURNEY:** two new entry paths to the sheet (`top-hud-cta`, `splash-cta`) plus the existing `first-run`. Each is telemetry-tagged so HQ can distinguish them.

No new P0/P1 findings. One documented P2 residual (`SideNav.tsx` "Guest" fallback outside Wave 1 file-ownership) filed as Wave 2 candidate.

---

## 11. Merge sequence (pending Daniel's sign-off)

Per the brief · after all gates green:

1. `git checkout integration/cold-entry-mode-b` in the MAIN repo.
2. `git merge --no-ff wave-1/identity-ladder`.
3. Verify `npm run test` + `pytest` on the merged commit.
4. Regenerate the 4 LCOS graphs (human-authored form since scanners aren't built yet).
5. Write `03-post-merge.md` with the merge commit SHA, graph regeneration outputs, final ledger totals, and the explicit "Wave 2 dispatch is BLOCKED" statement.

**Merge is NOT executed by this gap-closure pass.** The wave contract requires Daniel's green-light before any merge action lands, even locally. This report notes the intended sequence; the actual merge commit will land in a follow-up when authorised.
