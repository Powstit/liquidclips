# RC1 Release Train · Train C · File Ownership Matrix

**Base commit:** after Phase-0 commit (BC-006 + guard + BUG-012 update + this matrix)
**Dispatched:** 2026-07-12 (post-Barrier-2)
**Integration lead:** Claude (does not implement · reviews + merges only)

**Dispatch pre-flight:** `lcos/scripts/dispatch-guard.sh` must return 0 immediately before every `Agent()` call. Enforced by BC-006.

Path lessons from Trains A + B baked in.

---

## Agent C1 · Native / external proof preparation (docs + scripts · no production code)

**Branch:** `wave-c1/native-walk-prep`

### Goal

For every native-required or external-dependency journey, produce **executable proof scripts** + **manual step-by-step scripts** so beta gate can be verified end-to-end. Zero production code changes. Only Playwright specs (that document manual steps as `test.skip` blocks) and shell scripts.

### OWNED (may create/edit)

- NEW `lcos/reports/rc1-sprint/native-walk-prep/j004-whop-oauth.md` (manual steps + expected artifacts)
- NEW `lcos/reports/rc1-sprint/native-walk-prep/j005-upload.md`
- NEW `lcos/reports/rc1-sprint/native-walk-prep/j006-clip-generation.md`
- NEW `lcos/reports/rc1-sprint/native-walk-prep/j007-publish.md`
- NEW `lcos/reports/rc1-sprint/native-walk-prep/j015-runtime-update.md` (includes explicit BUG-012 relaunch-required note per Barrier 2 disposition)
- NEW `desktop-2/tests/native-walk-prep/*.spec.ts` — 5 Playwright specs that automate as much as possible + document manual gaps as `test.skip(reason)` blocks
- NEW `scripts/rc1-beta/**` — shell scripts to seed a fresh test user, mint JWT, prep Whop test account (documentation), tear down after run

### FORBIDDEN

- Any production code
- Shell freeze paths
- New npm deps
- Any file OWNED by C2 or C3

### Deliverable

10 files (5 manual doc · 5 spec) + 2-3 shell helpers. Each doc includes: prerequisites · step-by-step · expected capture artifacts · pass/fail criteria · known gaps.

---

## Agent C2 · Money journey (Wallet · Affiliate · Referral · Payout · Cancellation)

**Branch:** `wave-c2/money-journey`

### Class-elimination targets

BC-004 (multiple money journeys unowned) · BC-002 (fixture drift risk).

### OWNED (verified paths post-A2/A3)

- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` — cancellation UI + wallet summary sections ONLY (referral block is A3 territory, DO NOT touch)
- `desktop-2/src/routes/affiliate/**` OR wherever affiliate dashboard lives (grep to verify)
- `desktop-2/src/routes/settings/**` — cancellation modal flow
- Backend: `junior-backend/app/routes/wallet.py` (or equivalent) · `payouts.py` · `affiliate.py` · `cancellation.py` — verify actual paths
- NEW `desktop-2/src/routes/wallet-detail/money-rollup.test.ts`
- NEW `desktop-2/src/routes/affiliate/affiliate.journey.test.ts`
- NEW `desktop-2/src/routes/settings/cancellation.6-state.test.ts`
- NEW `junior-backend/tests/test_money_rollup_consistency.py`
- NEW LCOS journey files:
  - `lcos/04_JOURNEY_BIBLE/j008-wallet.md`
  - `lcos/04_JOURNEY_BIBLE/j009-affiliate.md`
  - `lcos/04_JOURNEY_BIBLE/j011-payout.md` (RENAME conflict check: B2 used j011 for campaigns-navigation · rename this to j012-payout OR update B2's · pick j012-payout to avoid churn)
  - `lcos/04_JOURNEY_BIBLE/j013-cancellation.md`

### READ-ONLY

- `desktop-2/src/design-os/state/useMe.ts`
- `desktop-2/src/lib/useAuth.ts`
- `WalletDetail.tsx` referral block (A3 territory)

### FORBIDDEN

- Shell freeze paths
- Referral block in WalletDetail (A3 owner)
- Any file OWNED by C1 or C3
- **No fixture values.** Any test that reads canonical money data reads from real backend (SQLite dev) · NOT hardcoded test data.

### Requirements per Daniel's brief

- **One canonical financial rollup.** All money surfaces read from the same authoritative source. Wallet summary total = Affiliate + Referral + Wallet Ledger. Backend GET `/me/money-rollup` (create or verify existing endpoint).
- **Customer UI values match HQ values.** Test: mint a wallet ledger row via backend, POST to a canonical `/hq/verify-money-rollup` endpoint, assert same number appears in Wallet UI. Both queries return byte-identical.
- **Withdraw disabled unless eligible** (INV-004 verified). Test: 6-state cancellation matrix per L5.
- **Referral attribution recorded** at backend (unblocks BUG-017's `gap:j010-attribution-persistence`).

---

## Agent C3 · Clipping journey (Upload · Ingest · Whisper · Anthropic · ffmpeg · My Clips · Campaign submit)

**Branch:** `wave-c3/clipping-journey`

### Class-elimination targets

BC-004 (clip journey unowned) · BC-005 (clip state observability gaps).

### OWNED

- `desktop-2/src/routes/upload/**` — verify path (may be `desktop-2/src/routes/library/**`)
- `desktop-2/src/routes/my-clips/**` OR wherever My Clips route lives
- `desktop-2/src/routes/campaigns/**` — campaign submit surface
- Backend: `junior-backend/app/routes/ingest.py` · `clip_run.py` · `campaigns.py` — verify paths
- NEW `desktop-2/src/routes/upload/upload.journey.test.ts`
- NEW `desktop-2/src/routes/my-clips/my-clips.journey.test.ts`
- NEW `desktop-2/src/routes/campaigns/campaign-submit.real-id.test.ts`
- NEW `junior-backend/tests/test_clip_run_endtoend.py`
- NEW LCOS journey files:
  - `lcos/04_JOURNEY_BIBLE/j005-upload.md`
  - `lcos/04_JOURNEY_BIBLE/j006-clip-generation.md`
  - `lcos/04_JOURNEY_BIBLE/j007-my-clips.md`

### READ-ONLY

- Python sidecar (shell freeze)
- Anthropic API integration (existing)
- ffmpeg wrapper (existing)

### FORBIDDEN

- Shell freeze paths (including sidecar rebuild)
- Any file OWNED by C1 or C2
- **No fake completion.** If the test needs a real video file, use a checked-in tiny fixture video (add to `desktop-2/tests/fixtures/`).
- **No preview-campaign fallback.** Real campaign IDs only. If no real ID available in test env, `test.skip` with explicit reason.
- **No zero-clip fake success.** A "successful" clip run must produce ≥1 real clip file on disk.

### Requirements per Daniel's brief

- **Local file upload proven** with a checked-in fixture video + native file picker documented as C1 gap
- **URL ingest proven** end-to-end (backend ingest → sidecar → Whisper → clips)
- **Local Whisper** actually runs (verify by grep for `whisper` invocation + hashed model file present)
- **Anthropic judgment** produces titles + timestamps (mock in test · document real-API gap)
- **ffmpeg output** creates real MP4 files on disk with valid duration
- **My Clips shows the real clip** with reveal/open/copy affordances working
- **Campaign submit uses a real campaign ID** (not preview_campaign_id or similar). If no real ID in test env, skip with explicit gap doc.

---

## Collision-free matrix (verified paths)

| Agent | wallet-detail | affiliate | settings/cancellation | upload | my-clips | campaigns | backend money | backend clip | LCOS journeys |
|---|---|---|---|---|---|---|---|---|---|
| C1 | — | — | — | — | — | — | — | — | native-walk-prep/ |
| C2 | summary+cancellation | OWNED | OWNED | — | — | — | OWNED | — | j008/j009/j012/j013 |
| C3 | — | — | — | OWNED | OWNED | OWNED | — | OWNED | j005/j006/j007 |

## Dispatch rules

Same as prior trains. Every agent:
- Verifies base commit
- Works in isolation:worktree
- Emits Impact Report per commit (Impact Report template + §15-17)
- Bug status ceiling `FIXED_UNPROVEN`
- STOP if native rebuild required
- STOP if new npm dep needed
- No push · no tag · no deploy · no shell touches

**Additional discipline this train:**

- Every fix/instrumentation must have a live-DB proof (no fixture values in production code)
- Every money journey must produce a canonical rollup test that confirms UI = HQ = backend byte-identical
- Every clipping journey must produce a real-file proof (MP4 exists on disk with valid duration)

## Barrier 3 · integration lead work (after all 3 C agents complete)

1. Run dispatch-guard (state check)
2. Merge C1 → C2 → C3 into integration
3. Full test sweep (pytest + vitest + tsc)
4. Regen LCOS graphs (final)
5. Run full live beta walk (Playwright + manual native-walk-prep scripts from C1)
6. Beta gate: 0 P0 · 0 P1 · every visible CTA works or hidden · beta golden paths pass · real upload → clips proven · Whop refresh no-reload · Wallet/Affiliate/Payout agree · real campaign ID · no auth Guest · no keychain prompt · runtime update **with documented relaunch** · HQ persistent proof · ship-lens PASS · tests green · prod build green · rollback pack saved
7. RC1 proof pack · SHIP or DO NOT SHIP verdict
8. Return to BUG-012 decision with full picture
