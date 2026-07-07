# MAX REPORT · Sprint-final Playwright split · 2026-07-07

Handoff: `MAX_HANDOFF_SPRINT_FINAL_SPLIT_2026-07-07.md`
Repo: `/Users/dipdip/code/jnr/desktop-2/`
Branch state: NOT pushed, NOT committed (per handoff rule "Don't commit / Don't push · Daniel bundles")
Ship-lens: run + all P0/P1 findings addressed (see §Ship-lens follow-up).

---

## Verdict per spec

| # | Spec | Verdict | Notes |
|---|---|---|---|
| 1 | `agency-campaign-syndicate.spec.ts` | ✅ passes | wired test hook + fixed URL + event contract + surfaced a real product bug in `useMe` adapter |
| 2 | `url-clip-export.spec.ts` | 🅿️ `test.fixme` | testid contract landed · runtime clip render needs Tauri invoke shim (documented) |
| 2 | `file-drop-export.spec.ts` | 🅿️ `test.fixme` | same |
| 3 | `publish-reward-mint.spec.ts` | ✅ passes | fetch route + envelope shape + JWT key + force-http seam |
| 4 | `thumbnail-identity.spec.ts` | 🅿️ `test.fixme` | setInputFiles path fixed · downstream ref-count assertion needs Tauri invoke shim (initialImages seed made the previous "passing" assertion vacuous) |
| 5 | `cold-start-returning.spec.ts` | ✅ passes | warm-then-measure + hard assertion + single-source SLA constant |

Run: `./node_modules/.bin/playwright test <spec>.spec.ts --reporter=line` · all 6 clean (3 pass + 3 skip via `fixme`).

---

## Files touched

### Spec files
- `tests/e2e/agency-campaign-syndicate.spec.ts`
- `tests/e2e/publish-reward-mint.spec.ts`
- `tests/e2e/cold-start-returning.spec.ts`
- `tests/e2e/thumbnail-identity.spec.ts`
- `tests/e2e/url-clip-export.spec.ts`
- `tests/e2e/file-drop-export.spec.ts`

### Frontend product code
- `src/design-os/state/useMe.ts` — added `whop_company_id` → `whopCompanyId` mapping (real bug · lane-2 P10 backend wired the field but the frontend adapter never read it; button `canPostToWhop` in `CampaignPageShell.tsx:240` could not have rendered for real agency users).

### New dev-only test seams
- `src/components/paywall/CampaignShellTestHook.tsx` (NEW) — mounts `CampaignPageShell` with a synthetic Campaign when `test:open-campaign-shell` fires. Guarded by `import.meta.env.DEV` + also exposes `window.__lc_test_open_campaign_shell` as a race-safe seam (matches `AssetRansomPaywallTestHook` pattern).
- `src/App.tsx` — imports + mounts `CampaignShellTestHook` alongside `AssetRansomPaywallTestHook` inside `AuthGate`.
- `src/design-os/bridge/events.ts` — declared `test:open-campaign-shell` payload shape.

Prod tree-shake **verified** by ship-lens: `dist/assets/*.js` contains zero occurrences of `test:open-ransom-paywall` or `test:open-campaign-shell` after `npm run build`.

---

## Ship-lens follow-up (all findings addressed)

Reviewer ran + wrote `docs/ship-lens-review.json`. Verdict was BLOCK on P0-001 + three P1s. All fixed:

- **P0-001** — thumbnail-identity's `References · N` assertion was passing on `initialImages` seed (drawer's demo identity has 3 references before upload); browser mode can never verify a real upload because `invoke("stash_upload")` requires Tauri. Fix: `test.fixme` with same Tauri-invoke-shim follow-up as P4/P5.
- **P1-001** — added canonical `lc.license.jwt.v1` seed to the two `fixme`'d specs so they don't silently repeat the loadMe-bail failure when the invoke shim eventually lands.
- **P1-002** — added race-safe `window.__lc_test_open_campaign_shell` seam to `CampaignShellTestHook`; the P10 spec now `waitForFunction`s on it instead of `waitForTimeout(200)`.
- **P1-003** — cold-start uses a hard `expect()` (not `expect.soft`) + single-source `COLD_START_SLA_MS = 8000` constant that the docstring, test name, and assertion all interpolate from.

---

## Known scope-limits (documented in each spec's fixme comment)

The three `test.fixme` specs share one root cause: **no Playwright ↔ Tauri invoke harness exists**. Their runtime assertions need one of:
1. `window.__TAURI_INTERNALS__` shim mounted via `addInitScript` that routes `stash_upload` / `get_project` / `method_export_clip` to canned JSON fixtures.
2. Sidecar HTTP fixtures wired to `installBackendStubs` for the endpoints those invokes fall back to.

Both belong in a follow-up sprint that owns `tests/e2e/fixtures/backendFixtures.ts`. When that lands, the specs remove their `.fixme` and inherit correct auth seed + canonical JWT key already staged.

---

## What did NOT change (out of scope · claude-app lane)
- `login-whop-authorization.spec.ts`
- `login-lc-id-email.spec.ts`
- `ransom-paywall-flow.spec.ts`
- Anything in `junior-backend/`
- Any marketing / account-app surface
