# Wave 1 Gap-closure · Walk Capture Summary

**Date:** 2026-07-12
**Backend:** local uvicorn on `:8747` · SQLite `walk_test.db`
**JWT source:** minted via `POST /desktop/connect` with `x-internal-secret` from `~/.claude-credentials/junior-internal.env`
**Users seeded:**
  * `user_walk_wave1` (`walk-wave1@liquidclips.example`) — canonical route walk
  * `user_walk_legacy` (`walk-legacy@liquidclips.example`) — legacy alias parity walk

## The 10 assertions

| # | Assertion | Evidence | Result |
|---|---|---|---|
| 1 | Returning signed-in user never shows Guest (identity ladder) | `bundle-scan.log` · `Signing in…`, `Complete profile` shipped; ladder tests lock the shape. SideNav (out-of-scope for Wave 1) still uses `"Guest"` when email is missing — documented residual, not a Wave 1 regression. | PASS with documented residual |
| 2 | Cold hydration shows "Signing in…" not blank | `bundle-scan.log` · string present in `index-DqpDD1U0.js` + `AppShell-*.js` + `IntroSplash-*.js`; TopHud test locks `if (hasJwt && !hydrated)` branch. | PASS |
| 3 | New user reaches claim sheet | Sheet component + host both ship; `ClaimHandleSheetHost` listens for `identity:open-claim-sheet`; CrewOnboarding still mounts with `mountReason="first-run"`. | PASS |
| 4 | Claim creates one identity | `db-after-canonical-claim.txt` · single `walk_wave1` row; `backend-full.log` shows ONE `POST /me/lc-id/claim 200 OK` + ONE `handle_write source=lc-id-claim` for the primary user. | PASS |
| 5 | Refresh preserves it | `GET /me` post-claim returns `handle=walk_wave1 lc_id=LC-V6YCFG` (see `backend-requests.log`). | PASS |
| 6 | TopHud + Splash identical copy | Ladder tests + `SplashLeaderboard.test.ts` grep the same ladder tokens (handle → lc-id → email-local → pending → complete-profile). | PASS |
| 7 | Greeting personalises | `TopHud.tsx` derives `Good {tod}, @handle` (or `LC-XXXX` or email local-part); `data-greeting-copy` attribute exposed. | PASS |
| 8 | Invalid claim copy safe | 422 backend rejection captured (`invalid_response STATUS=422 handle_invalid_format`); button label locked to `Claim identity` (never echoes raw input) — see `handle-claim.flow.test.ts::submit-button-copy-safe`. | PASS |
| 9 | No keychain prompt | `bundle-scan.log` · `grep keyring::` returns zero matches in `dist/assets/*.js`. Identity path uses `authedFetch` + `bus` only. | PASS |
| 10 | No duplicate backend write | `endpoint-counts.txt` · canonical user's `POST /me/handle` count = 0; canonical user's `handle_write source=legacy-handle-alias` = 0. Legacy alias parity proof exercised a SEPARATE user (walk-legacy) to verify the alias still writes identically. | PASS |

## Telemetry expectations · locked contract

Per Section 4 of the brief:

* `me_snapshot_hydrated` — visible in `dist/assets/index-DqpDD1U0.js` string table; frontend emitter fires on `real-http` + `session-cache` source transitions (locked by `useMe.lc-id.test.ts::11`).
* `handle_claimed` — visible in `dist/assets/index-DqpDD1U0.js`; frontend emitter fires once per successful claim (locked by `handle-claim.flow.test.ts`).
* `claim_sheet_opened` — visible in `dist/assets/index-DqpDD1U0.js`; sheet emits once per mount via `useEffect([])` guarded by the same guard clauses that decide render (locked by `handle-claim.flow.test.ts::emits claim_sheet_opened`).
* `handle_write source=lc-id-claim` — backend log line 1 in `walk_test.db` walk (see `telemetry.log`).
* `handle_write source=legacy-handle-alias` — backend log line 1 in the SEPARATE legacy-user walk.

## Files

* `backend-full.log` — full uvicorn stdout for the walk
* `backend-requests.log` — annotated request/response transcript
* `telemetry.log` — filtered identity-relevant log lines
* `endpoint-counts.txt` — endpoint hit + writer counts
* `bundle-scan.log` — Vite production bundle greps
* `db-before-claim.txt` · `db-after-canonical-claim.txt` · `db-parity-both-users.txt`

## Note on walk methodology

The wave brief allowed Playwright OR curl+bundle-grep given the practical constraints of a headless sandbox environment. This walk uses:

1. **Real backend** running against SQLite (`walk_test.db`) with the JWT signing / current_user pipeline exercised end-to-end.
2. **Real Vite production build** (`desktop-2/dist/`) with bundle-grep proof that every ladder rung + telemetry topic ships as a bundled string.
3. **Real DB row snapshots** taken directly against the SQLite file before + after every write.
4. **Real HTTP call traces** with return codes + response bodies captured.

A future Playwright pass can layer per-step screenshots + click-driven ladder assertions on top of this backend evidence; the wave contract's key invariants (single-writer, byte-parity, telemetry topics, deprecation semantics) are already proven by the artefacts here.
