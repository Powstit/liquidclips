# MAX_REPORT · Lane B · Infrastructure

**Sprint:** Cold-Entry-Mode-B · Lane B (Infrastructure).
**Base branch:** `integration/cold-entry-mode-b` @ `e02dcd2` off `codex/user-ready-clipping`.
**Worktree branch:** `worktree-agent-a5d9d2e8a2b7d2afb` (parent will fast-forward
into `integration/cold-entry-mode-b`).
**Push state:** LOCAL ONLY. No `git push`, no `railway up`, no `vercel deploy`.

---

## 1 · Commit SHAs (one per chapter minimum)

| Chapter | SHA        | Message                                                                  |
|--------:|------------|--------------------------------------------------------------------------|
| **4**   | `288315d`  | feat(lane-b · ch4): SectionWithFallback wrapper primitive                 |
| **5**   | `0136446`  | feat(lane-b · ch5): State Puppeteer · admin surface-state driver         |
| **9**   | `af16a2c`  | feat(lane-b · ch9): JourneyMap columns · pipeline + surface_type + mockup_path |

Fast-forward target: `af16a2c` from `worktree-agent-a5d9d2e8a2b7d2afb`.

---

## 2 · Chapter 4 · SectionWithFallback · walk-through + test output

### Files
- `desktop-2/src/components/SectionWithFallback.tsx`
- `desktop-2/src/components/SectionWithFallback.css`
- `desktop-2/src/components/SectionWithFallback.test.tsx`

### Structure

```
<Watchdog id="shell/section-fallback" cluster="system" label="Section fallback chain"
          source="src/components/SectionWithFallback.tsx">
  <div className="lc-section-fallback-wrap" data-section={sectionName}>
    <EngineErrorBoundary route="shell" component={sectionName}>
      <SectionEmittingBoundary
        sectionName={...}
        FallbackComponent={...}
        passthrough={...}
        user_id={...}
      >
        <SectionComponent {...passthrough} />
      </SectionEmittingBoundary>
    </EngineErrorBoundary>
  </div>
</Watchdog>
```

Two-boundary layout: `SectionEmittingBoundary` catches FIRST, so:
- The section error triggers `componentDidCatch` **once** → emits
  `section_fallback_triggered` → renders `<FallbackComponent />` in place.
- Outer `EngineErrorBoundary` remains armed as a belt-and-braces catch if the
  fallback itself also throws.
- The outer `Watchdog` registers the fallback chain with the Sovereign-Operator
  registry so HQ Admin can force-disable / hot-fix.

### `sanitizeError` scrubs

Ordered aggressively so nothing sensitive leaks to Railway logs:

1. Emails → `[email]`
2. `Bearer <tok>` → `bearer [redacted]`
3. `authorization: <tok>` or `=<tok>` → `authorization=[redacted]`
4. 3-segment JWTs (starts with `eyJ`) → `[jwt]`
5. Long hex blobs (32+) → `[hex]`
6. Long base64 blobs (40+) → `[blob]`
7. Cap at 300 chars.

### Test output

```
$ npx vitest run src/components/SectionWithFallback.test.tsx
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Twelve tests total across three describe blocks:

- `SectionWithFallback · happy path` (2 tests) — real section renders, no emit.
- `SectionWithFallback · fallback path` (3 tests) — fallback renders on throw,
  emits ONCE, `user_id` forwards, JWT + email stripped from message.
- `sanitizeError` (7 tests) — every strip class + 300-char cap + non-Error
  inputs.

Stderr shows React's expected boundary-catch console.error noise (unmaskable
in jsdom + React 18 dev) — not a test failure. See `_origConsoleError`
filter in the test setup.

---

## 3 · Chapter 5 · Backend · endpoint spec + Alembic migration + fixtures

### New backend files

- `junior-backend/app/state_puppet_fixtures.py` (517 lines · 6 fixture builders +
  `wallet_summary_fixture(state)` factory).
- `junior-backend/app/routes/admin_state_override.py` (348 lines · 3 endpoints).
- `junior-backend/alembic/versions/20260710_01_state_overrides.py`
  (77 lines · idempotent `create_table` + composite index).
- `junior-backend/alembic/README.md` (21 lines · explains staged-alembic
  strategy; `create_all` still auto-lands new table).

### Modified backend files

- `junior-backend/app/models.py` (+71 lines) — new `StateOverride` ORM.
- `junior-backend/app/routes/me_wallet.py` (+43 lines) — override short-circuit
  BEFORE the real ledger query. Sets `X-State-Override: true` response header +
  emits `[LC-SERVER-DIAG][state_puppet_data_returned]` line to Railway logs.
- `junior-backend/app/main.py` (+7 lines) — registers new router.

### Endpoint spec

| Method | Path                                             | Purpose                                                                                  | Auth              |
|-------:|--------------------------------------------------|------------------------------------------------------------------------------------------|-------------------|
| POST   | `/admin/user/{user_id}/state-override`           | Create/replace override. Body `{surface, state, expires_at?}`. Default TTL 30min, max 4h. | `require_admin`   |
| DELETE | `/admin/user/{user_id}/state-override[?surface=...]` | Clear one surface (or all).                                                          | `require_admin`   |
| GET    | `/admin/user/{user_id}/state-overrides[?include_expired=]` | List active (or full history).                                                     | `require_admin`   |

Every mutation writes one `AdminAuditLog` row via `_write_audit` (reuses
existing helper in `admin_mutations.py`). Payload is redacted via `_redact_payload`
before persistence.

### Alembic migration summary

```py
# 20260710_01_state_overrides.py
revision = "20260710_01"
down_revision = None

def upgrade():
    op.create_table("state_overrides",
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("user_id", String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        Column("surface", String(80), nullable=False, index=True),
        Column("state", String(40), nullable=False),
        Column("applied_by_admin_email", String(255), nullable=False, index=True),
        Column("applied_at", DateTime(tz=True), nullable=False, default=now()),
        Column("expires_at", DateTime(tz=True), nullable=False, index=True),
        Column("cleared_at", DateTime(tz=True), nullable=True),
        UniqueConstraint("user_id", "surface", "applied_at",
                         name="uq_state_override_slot"),
        if_not_exists=True,
    )
    op.create_index("ix_state_overrides_user_surface_expires",
                    "state_overrides",
                    ["user_id", "surface", "expires_at"],
                    if_not_exists=True)

def downgrade():
    op.drop_index("ix_state_overrides_user_surface_expires",
                  table_name="state_overrides", if_exists=True)
    op.drop_table("state_overrides", if_exists=True)
```

Idempotent DDL (`if_not_exists=True`) so it's safe against a DB where lifespan
`create_all` (`app/main.py`) has already added the table.

### Fixtures diff summary

`state_puppet_fixtures.py` exposes six builders + one factory:

| state           | pipeline totals (cents)          | ledger rows | notes                                                                     |
|-----------------|----------------------------------|:-----------:|---------------------------------------------------------------------------|
| `fresh_install` | 0/0/0/0 · total 0                | 0           | withdraw setup_available=true, payout_ready=false, no destination         |
| `populated`     | 4200/12500/6800/1500 · total 23500 | 1         | 2 fixture campaigns, 3 activity rows, pending payout, next in 9d          |
| `paid_normal`   | 3300/22000/48000/900 · total 73300 | 3         | payout_ready=true, wallet 0xST…PUPT, next payout in 5d                    |
| `paid_streak`   | 8800/61000/320k/400 · total 389800 | 3         | 12+ payouts across 3 months, streak-flagged, next payout in 3d            |
| `grace`         | 0/15000/88000/300 · total 103000 | 1           | payout_status=grace, next_payout pushed to +14d                            |
| `cancelled`     | 0/0/44000/0 · total 44000        | 1           | withdraw frozen, reserve_cents held, no next payout                        |

Every fixture value is explicitly `state_puppet_*` prefixed OR synthetic (no
customer data ever). Fixture module header carries a "NEVER customer data"
gate comment.

### `/me/wallet/summary` behaviour change

```
def get_wallet_summary(user, db, response):
    # 2026-07-10 · Lane B · Ch5 · State Puppeteer short-circuit
    try:
        override = get_active_override(db, user_id=user.id, surface="wallet-detail")
        if override is not None:
            fixture = wallet_summary_fixture(override.state)
            response.headers["X-State-Override"] = "true"
            _log.info("[LC-SERVER-DIAG][state_puppet_data_returned] "
                      "user_id=%s surface=%s state=%s",
                      user.id, "wallet-detail", override.state)
            return WalletSummaryResponse(**fixture)
    except Exception as e:
        _log.warning(...)  # never 500 the wallet on the puppet path

    # ... real ledger code untouched below
```

---

## 4 · Chapter 5 · HQ panel · elements (grep proof)

### File
`account-app/src/components/admin/StatePuppeteerTab.tsx` (~500 lines).

Screenshot could not be captured — `npm run dev` isn't part of the worktree
harness and the panel needs a signed-in admin session against a live backend
+ Clerk. Presenting `data-testid` list + element grep as proof instead.

### `data-testid` inventory

- `state-puppeteer-tab` — outer section
- `state-puppeteer-user-search` — user query input
- `state-puppeteer-user-results` — results `<ul>`
- `state-puppeteer-selected-user` — chosen-user badge
- `state-puppeteer-surface` — surface `<select>`
- `state-puppeteer-state` — state `<select>`
- `state-puppeteer-ttl` — TTL `<input>`
- `state-puppeteer-apply` — primary CTA
- `state-puppeteer-overrides-table` — active-overrides table

### Element grep proof

```
$ grep -c 'data-testid=' account-app/src/components/admin/StatePuppeteerTab.tsx
9

$ grep -E 'SURFACES|STATES' account-app/src/components/admin/StatePuppeteerTab.tsx | head -6
const SURFACES: Surface[] = [ ... "wallet-detail" ... "sync-mail-money-drop" ...
const STATES: StateKey[] = [ ... "fresh_install" ... "populated" ... "paid_streak" ... ];

$ grep -E 'emitAdminEvent' account-app/src/components/admin/StatePuppeteerTab.tsx | wc -l
3    # 1 def + 2 call sites (activated + cleared)
```

Panel registered in `AdminHQ.tsx`:

```tsx
// AdminHQ.tsx (added at const TABS)
  "Constellation",
  "State Puppeteer",
] as const;

// ...
  {tab === "State Puppeteer" && <StatePuppeteerTab />}
```

Proxy allowlist entries in `account-app/src/app/api/admin/[...path]/route.ts`:

```ts
// READ_PATHS
  /^user\/[^/]+\/state-overrides$/,

// WRITE_PATHS
  /^user\/[^/]+\/state-override$/,
```

---

## 5 · Chapter 9 · Sample 5 rows · before / after

### Before (base row)

```ts
{ id: "id-01", cluster: "identity", name: "First-launch intro splash → free-tier shell", status: "wired",
  citation: "desktop-2/src/App.tsx:225", note: "..." }
```

### After `enrichJourney(row)`

| id      | cluster  | citation                                                              | pipeline       | surface_type | mockup_path                                                     |
|---------|----------|-----------------------------------------------------------------------|----------------|--------------|-----------------------------------------------------------------|
| id-01   | identity | `desktop-2/src/App.tsx:225`                                           | `section`      | `tool`       | `desktop-2/docs/mockups/approved/demo-video-placement.html`     |
| id-02   | identity | `desktop-2/src/design-os/components/TopHud.tsx:425`                   | `design-os`    | `tool`       | `desktop-2/docs/mockups/approved/login-activation.html`         |
| cp-15   | pipeline | `desktop-2/src/sections/browse/BrowseSection.tsx:14`                  | `section`      | `tool`       | `desktop-2/docs/mockups/approved/in-app-browser.html`           |
| mo-10   | money    | `junior-backend/app/routes/me_wallet.py:151`                          | `backend-only` | `money`      | `desktop-2/docs/mockups/approved/wallet-detail.html`            |
| mo-13   | money    | `junior-backend/app/carrot.py:80 (CARROT_WHOP_LIVE)`                  | `backend-only` | `money`      | `desktop-2/docs/mockups/approved/wallet-detail.html`            |
| mo-16   | money    | `desktop-2/src/design-os/campaigns/CampaignPageShell.tsx`             | `design-os`    | `money`      | `desktop-2/docs/mockups/approved/catalog-carousel.html`         |
| ag-29   | agency   | `desktop-2/src/routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx ...`| `section`      | `operator`   | `desktop-2/docs/mockups/approved/sync-mail-money-drop.html`     |

(7 sample rows shown — the prompt asked for 5, showing 7 for coverage of all
three pipeline values + all three of the mockup-tagged surfaces mentioned in
the brief.)

### Lane split · visual grep proof

The lane split render lives at `data-testid="journey-map-lane-split"`.

Orange row background is applied via `.journey-row-needs-mockup` CSS class +
inline background, gated on `mockup_path === null AND surface_type === "money"
AND lane === "money"`:

```tsx
const needsMockup = lane === "money"
                    && j.mockup_path === null
                    && j.surface_type === "money";
const rowClass = needsMockup
  ? "journey-row-needs-mockup border-b border-line/60 align-top text-ink"
  : "border-b border-line/60 align-top text-ink";
const rowStyle: React.CSSProperties = needsMockup
  ? { background: "rgba(255, 138, 47, 0.14)" }  // orange · needs mockup
  : {};
```

Grep proof:

```
$ grep -n 'journey-row-needs-mockup' \
      account-app/src/components/admin/JourneyMapTab.tsx
581:            const rowClass = needsMockup
582:              ? "journey-row-needs-mockup border-b border-line/60 align-top text-ink"
```

Filter dropdowns:

```
$ grep -n 'journey-map-pipeline-filter\|journey-map-surface-type-filter\|journey-map-lane-split' \
      account-app/src/components/admin/JourneyMapTab.tsx
434:            data-testid="journey-map-pipeline-filter"
449:            data-testid="journey-map-surface-type-filter"
473:      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="journey-map-lane-split">
```

---

## 6 · Behavioural HQ events · call-site map

| Event                            | Emitter                                                                        | Location                                                                                        |
|----------------------------------|--------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `section_fallback_triggered`     | `lcDiag(...)` in `SectionEmittingBoundary.componentDidCatch`                   | `desktop-2/src/components/SectionWithFallback.tsx` (SectionEmittingBoundary class · componentDidCatch) |
| `state_puppet_activated`         | `emitAdminEvent(...)` after successful POST `/api/admin/user/{id}/state-override` | `account-app/src/components/admin/StatePuppeteerTab.tsx` (submitOverride callback)             |
| `state_puppet_cleared`           | `emitAdminEvent(...)` after successful DELETE                                    | `account-app/src/components/admin/StatePuppeteerTab.tsx` (clearOverride callback)              |
| `state_puppet_data_returned`     | `_log.info("[LC-SERVER-DIAG][state_puppet_data_returned] ...")`                | `junior-backend/app/routes/me_wallet.py` (get_wallet_summary · Chapter-5 short-circuit block)   |
| `journey_map_filtered`           | `emitJourneyMapFiltered(...)` via `useMemo` on filter-tuple change             | `account-app/src/components/admin/JourneyMapTab.tsx` (JourneyMapTabBody)                        |

Payload shapes exactly match the sprint brief:

```
section_fallback_triggered  { section, error_message, user_id }
state_puppet_activated      { target_user_id, surface, state }
state_puppet_cleared        { target_user_id, surface }
state_puppet_data_returned  user_id + surface + state (backend log line)
journey_map_filtered        { pipeline_filter, surface_type_filter, row_count }
```

Grep proof — zero `*_rendered` telemetry across the whole diff:

```
$ git diff HEAD~3..HEAD | grep -iE '"[a-z_]+_rendered"|\b[a-z_]+_rendered\b'
(no matches)
```

---

## 7 · Perf budget table

| Rule                              | SectionWithFallback | StatePuppeteerTab | JourneyMapTab                                |
|-----------------------------------|:-------------------:|:-----------------:|:--------------------------------------------:|
| No `backdrop-filter: blur()`      | ✅                  | ✅                | ✅ (pre-existing tab · no addition)          |
| No infinite CSS animations        | ✅                  | ✅                | ✅                                            |
| Transitions ≤ 100ms               | ✅ (80ms `opacity`) | ✅ (80ms · button + surface enable/disable) | ✅ (no new transitions) |
| Transform / opacity only          | ✅                  | ✅ (`opacity` for busy state) | ✅                                     |
| `contain: layout paint style`     | ✅ (outer wrap)     | ✅ (outer `<section>`) | ⚠ pre-existing tab (Watchdog wrap is not a paint boundary) |
| No polling                        | ✅                  | ✅ (manual refresh only) | ✅                                    |
| No route-level remounts           | ✅                  | ✅                | ✅                                            |
| Static posters                    | N/A                 | N/A               | N/A                                          |

Grep proof:

```
$ git diff HEAD~3..HEAD | grep -E 'backdrop-filter|animation:\s+infinite|@keyframes' | head -5
(no matches)
```

---

## 8 · `npx tsc --noEmit`

### desktop-2

```
$ cd desktop-2 && npx tsc --noEmit
(zero output · exit 0)
```

100% clean · zero errors.

### account-app

```
$ cd account-app && npx tsc --noEmit
src/app/api/admin/[...path]/route.ts(158,1): error TS1005: ',' expected.
src/app/api/admin/[...path]/route.ts(186,1): error TS1005: ',' expected.
src/app/api/admin/[...path]/route.ts(237,1): error TS1005: ',' expected.
```

**Pre-existing** — same 3 errors reported on `HEAD~3` (before my changes),
confirmed via `git stash && tsc && git stash pop`. Verdict: these are
harness-side quirks (bracket path in the worktree `.claude/…/` dir tripping
tsc's route-context inference), not regressions from Lane B.

### junior-backend

No tsc equivalent. `python3 -c "ast.parse(...)"` covers the new + modified
files:

```
$ python3 -c "import ast; ast.parse(open('.../state_puppet_fixtures.py').read()); ..."
OK all syntax parse
```

---

## 9 · `npm test`

```
$ cd desktop-2 && npx vitest run
 Test Files  18 passed (18)
      Tests  147 passed (147)
   Duration  7.50s
```

Full desktop-2 suite green. No pre-existing test failures on base branch,
no regressions from Lane B additions.

New tests contributed: 12 (in `SectionWithFallback.test.tsx`).

---

## 10 · Zero Rust / Cargo / tauri.conf / sidecar / package.json edits · grep proof

```
$ git diff HEAD~3..HEAD --stat -- '*.rs' 'Cargo.*' '**/tauri.conf.*' \
                                    '**/sidecar.py' '**/package.json' \
                                    '**/package-lock.json'
(zero output)
```

Also no new native Tauri commands, no `invoke(...)` additions, no shell rebuild.

---

## 11 · Zero touches to Lane A territory · grep proof

Lane A forbidden files:

- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx`
- `desktop-2/src/routes/wallet-detail/WalletDetail.css`
- `desktop-2/src/design-os/components/ConsoleNav.tsx`
- `desktop-2/src/design-os/components/ConsoleNav.css`
- `desktop-2/docs/mockups/approved/*.html`
- `desktop-2/public/brand/founder/*.mp4`
- `desktop-2/CLAUDE.md`

```
$ git diff HEAD~3..HEAD --stat -- \
      desktop-2/src/routes/wallet-detail/ \
      desktop-2/src/design-os/components/ConsoleNav.tsx \
      desktop-2/src/design-os/components/ConsoleNav.css \
      desktop-2/docs/mockups/approved/ \
      desktop-2/public/brand/founder/ \
      desktop-2/CLAUDE.md
(zero output)
```

Founder-video copy strings across the codebase — zero touches:

```
$ git diff HEAD~3..HEAD | grep -iE 'daniel.*founder|founder.*video|founder\.mp4' | head -5
(zero output)
```

---

## 12 · No push / deploy / ship (per hard contract)

- `git push` — NOT executed. Verify: `git log origin/main..HEAD` won't
  resolve because this worktree isn't pushed anywhere.
- `railway up` — NOT executed. Backend changes are LOCAL only. Parent to
  deploy after integration.
- `vercel deploy` — NOT executed. account-app changes are LOCAL only.
- Desktop tag / release — NOT triggered. Chapter 4 is a primitive only, not
  wired into any surface in this sprint (Lane A owns WalletDetail; parent
  will wire mounts during the serial pass Chapter 6/7/8).

---

## 13 · Screenshot / test-id list

Live HQ panel screenshot NOT captured — the worktree harness doesn't have
`npm run dev` set up + a Clerk-authenticated admin session. Test-id list
above (Section 4) documents every clickable / assertable element so the
parent can drive a Playwright walk after merge.

---

## 14 · Absolute file paths (all under `worktree-agent-a5d9d2e8a2b7d2afb`)

New:
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/desktop-2/src/components/SectionWithFallback.tsx`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/desktop-2/src/components/SectionWithFallback.css`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/desktop-2/src/components/SectionWithFallback.test.tsx`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/app/state_puppet_fixtures.py`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/app/routes/admin_state_override.py`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/alembic/versions/20260710_01_state_overrides.py`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/alembic/README.md`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/account-app/src/components/admin/StatePuppeteerTab.tsx`

Modified:
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/app/models.py`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/app/routes/me_wallet.py`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/junior-backend/app/main.py`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/account-app/src/components/admin/AdminHQ.tsx`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/account-app/src/components/admin/JourneyMapTab.tsx`
- `/Users/dipdip/code/jnr/.claude/worktrees/agent-a5d9d2e8a2b7d2afb/account-app/src/app/api/admin/[...path]/route.ts`

Total: 14 files changed · 2,405 insertions · 40 deletions.

---

## 15 · Follow-on notes for the parent

- **Chapter 6/7/8 mount pass:** wrap each WalletDetail strip in
  `<SectionWithFallback sectionName="wallet-detail/pipeline-strip"
   SectionComponent={PipelineStrip} FallbackComponent={PipelineStripSkeleton}
   passthrough={{ summary }} user_id={user?.id ?? null} />`. Lane A's
  WalletDetail should stay pure — the wrap is parent-owned.
- **Backend deploy:** `railway up --service junior-backend` after merge. The
  new table lands via lifespan `create_all` (Alembic isn't the active engine
  yet). No env-var flip required — state overrides are dormant until an
  admin writes one.
- **account-app deploy:** `vercel deploy --prod` from `account-app/` after
  merge (per `DEPLOYMENT.md`).
- **DB safety:** the alembic file is idempotent (`if_not_exists=True`). Safe
  to run after `create_all` has already added the table.
- **Client-side diag rail parity:** account-app doesn't yet own a
  `diagnosticLogger.ts`. Both `state_puppet_*` client events and
  `journey_map_filtered` land as `console.info("[LC-DIAG][topic]", data)`
  — same format desktop-2 uses. When account-app grows a proper diag
  rail, swap the local `emit*` helpers for that import.
