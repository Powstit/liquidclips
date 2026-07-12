# RC1 D1 · Corrected Baseline (env-fix applied)

**Why a new baseline:** the prior D1 sweep at `../baseline-e702f14d/` ran
against `.env.local`'s `VITE_BACKEND_URL=http://localhost:8000` override
(Path 1 crew proof, 2026-07-10). Every `/me`, `/sync`, `/affiliate/me`,
`/me/money-rollup` fetch went to a dead localhost and generated CORS +
connection-refused errors — masking product signal.

**Fix:** `playwright.config.ts` gained a `webServer.env` block that forces
`VITE_BACKEND_URL=https://api.liquidclips.app` for the Playwright-owned
Vite instance only. Commit `59044e19`. `.env.local` untouched (Path 1
crew proof still works outside Playwright).

**Corrected baseline commit:** `59044e19dbbdcc1ad0e95fa8b4bc41b05a27ef39`
- Includes Phase 1 (TopHud polish merge · `30be2f77`)
- Includes Phase 2 Cluster A migration (`3141fe48`, 23 specs)
- Includes env override (`59044e19`)

## Artifacts

- `00-commit.txt` — full SHA anchor
- `01-cluster-a-rerun.log` — targeted rerun of 23 migrated Cluster-A specs
- `02-full-d1.log` — full 168-test sweep
- `03-cluster-map.md` — new cluster classification from corrected baseline

## Env verification (spot check)

`home-dashboard.spec.ts` re-run on env-corrected config:
- 0 `localhost:8000` references in error-context
- 0 CORS / connection-refused errors
- Same post-shell failure signature as under compromised env
  (`[data-testid="upload-coming-soon-copy"]` missing) — confirms the
  failure is a real product bug, not env noise.

Verification log: `../baseline-e702f14d/phase2-env-verify/home-dashboard-single.log`.
