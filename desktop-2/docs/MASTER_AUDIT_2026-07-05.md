# Liquid Clips · Master Completion Audit · 2026-07-05

**Commit reviewed:** post v2.2.24 · master · desktop-2
**Prior audit:** `desktop-2/docs/ship-lens-review.json` (v2.2.24 sign-in flow · BLOCK · 15 findings)
**Audit scope:** every user-facing surface + every backend chain + every RPC contract + every end-to-end customer journey.

---

## Ship verdict

**BLOCK.** ~35 P0 findings across 6 lenses. Headline surfaces (Wallet, Editor, Earn, Campaigns) render fixture data in prod paths. Export, publish, and reward-clip mint are silently mocked at the sidecar. Whop cold-email → activation chain has a founder-tier bypass and a race window. Copy across Diagnostics / Campaigns / Settings still says "skeleton" / "not checked yet" to real users. No path to PASS without the Cohort 0 recovery sprint at the bottom.

---

## Lens agents run

1. **ship-lens** · primary user surfaces (Home, Workstation, Wallet, Editor, Earn)
2. **ship-lens** · secondary user surfaces (Campaigns, Settings, Community, Diagnostics, Channels, Schedule, IntroSplash)
3. **integration-lens** · backend chains (auth, wallet, publishing, webhooks, founder)
4. **bug-hunt-lens** · systematic bug patterns (error handling, media fallbacks, disposal flags)
5. **rpc-contract-lens** · desktop ↔ sidecar ↔ backend contract integrity
6. **customer-journey-lens** · end-to-end user journeys (cold-email buyer, direct buyer, returning clipper, cash-out)

---

## Ranked findings

### P0 · cannot ship (~35, ranked by user-facing impact for Cohort 0)

| # | Surface / chain | Finding | File · line |
|---|---|---|---|
| 1 | Editor | Editor renders 100% fixture clips in prod path — no real user footage ever hits the timeline | `desktop/src/sections/editor/EditorSection.tsx:47-50` |
| 2 | Wallet | Hardcoded CLIPPERS + DROPS roster shown as if live — every user sees the same fake names | `desktop/src/panels/WalletDetail.tsx:67-198` |
| 3 | Export flow | Export silently returns mock data — user clicks Export, sidecar stub short-circuits, no file lands | `desktop/src/lib/sidecar-stub.ts:957` |
| 4 | Earn tab | Reward clips list is fake fixture; summary numbers are fake | `desktop/src/lib/sidecar-stub.ts:2290, 2314` |
| 5 | Publish | Publish button doesn't mint a reward clip — the whole earn loop is dead on the primary CTA | `desktop/src/sections/campaigns/PublishModule.tsx:206-263` |
| 6 | Cold-email buyer | `whop_checkout_success` mints JWT bypassing `apply_membership_tier()` — no commission split, welcome email, PostHog identify, notification, admin alert, or `send_license_activated` | `junior-backend/app/routes/whop_checkout_success.py:221` → `desktop/src/lib/activation.ts:184` |
| 7 | Cold-email buyer | Race window: endpoint reads PendingWhopMembership before Whop webhook lands → `whop_missing_membership` for valid buyers | `whop_checkout_success.py` (P0-002 from prior audit) |
| 8 | Cold-email buyer | Founder-tier boolean bypass: `effective_founder = True if is_admin else True` — any Whop plan reuse mints founder JWT past seat cap | `whop_checkout_success.py:163` |
| 9 | Sign-in pill | `openWhopFounderCheckout` uses `window.open()` not `openInApp()` → Safari popup blocker silently kills the CTA, no fallback, no toast | `desktop/src/lib/whopCheckout.ts` |
| 10 | Agency campaigns | Create + publish path is mocked at the sidecar — agencies get success toasts on writes that never happened | `desktop/src/lib/sidecar-stub.ts:3389` |
| 11 | Wallet double-count | `me_wallet.py:279` and `me_wallet.py:422` both credit the same ledger event under different conditions | `junior-backend/app/routes/me_wallet.py:279, 422` |
| 12 | Founder seat copy DRIFT | Webhook says 2000 seats, founder route says 12000 — users read one, get another | `webhooks_whop.py:767` vs `founder.py:50` |
| 13 | Auth mint bypass | `auth_whop.py:411` mints tokens through a parallel path skipping `apply_membership_tier` (sister bug to P0-6) | `junior-backend/app/routes/auth_whop.py:411` |
| 14 | IntroSplash | 28.5 s hard timer with NO fallback — first launch stalls forever on any asset error | `desktop/src/sections/intro/IntroSplash.tsx:46` |
| 15 | Cancel subscription | Cancel button is toast-only — user thinks they cancelled, subscription keeps billing | `desktop/src/sections/account/AccountSection.tsx:71-79` |
| 16 | Diagnostics | Tile labels hardcoded to `"skeleton"` — real users see the placeholder string | `desktop/src/sections/diagnostics/DiagnosticsSection.tsx:78-79` |
| 17 | Campaigns copy | "This is a UI skeleton" string surfaced to end users | `desktop/src/sections/campaigns/*` |
| 18 | Settings copy | Whop pill hardcoded to `"not checked yet"` — never resolves | `desktop/src/sections/settings/Settings*.tsx` |
| 19 | Cron silent-swallow | 8 cron callsites swallow exceptions — failed webhook retries + failed billing checks never surface | `junior-backend/app/cron.py` |
| 20 | Rate-bucket memory leak | Unbounded dict on `app/routes/whop.py:278` — backend RSS grows until OOM | `junior-backend/app/routes/whop.py:278` |
| 21 | Raw error leaks | 116 FE + 56 BE catch sites throw raw `String(e)` / traceback past `humanError()` to users | codemod target (see below) |
| 22 | Media without onError | 19 `<video>` + 24 `<img>` with no `onError` fallback — silent black tiles on any CDN blip | codemod target |
| 23 | Silent RPC mock fallback | ~32 sidecar wrappers fall back to fixture data when the sidecar RPC returns non-2xx | `desktop/src/lib/sidecar-stub.ts` |
| 24 | setState after await | 9 confirmed sites do `setState()` after `await` with no disposal / abort flag → React "set on unmounted" + stale-write | codemod target |
| 25 | Dev-language leaks | 5 of 7 secondary surfaces contain `TODO` / `skeleton` / `wip` / `demo` / `placeholder` in prod copy | codemod target |
| 26 | TopHud auth events | `hasJwt` doesn't subscribe to `auth:signed-out` / `activation:complete` — Sign-in pill stays visible after successful activation until app restart | `desktop/src/design-os/components/TopHud.tsx` (P1-001 → escalated) |
| 27 | Home | Home tiles reference channels + campaigns from stale seed IDs not present in prod DB | Home surface report |
| 28 | Workstation | Workstation empty-state points at deleted `useAuthPanelBridge` flow — dead affordance | Workstation surface report |
| 29 | Community | Channel list falls back to hardcoded 9 rooms when RPC misses — user sees rooms that don't exist server-side | Community surface report |
| 30 | Channels | Channel-detail RPC has no 404 branch — deleted channel shows loading spinner forever | Channels surface report |
| 31 | Schedule | Schedule surface writes to Postiz tenant using dev tenant ID in prod path | Schedule surface report |
| 32 | Webhooks | Whop webhook signature verified but replay window not enforced — replay attack window | `junior-backend/app/routes/webhooks_whop.py` |
| 33 | Publishing chain | Publish RPC has no idempotency key — retry doubles the publish | Publishing chain report |
| 34 | Wallet RPC | `wallet.list_transactions` returns amount in cents on desktop, dollars on backend — display shows 100× | RPC contract report |
| 35 | Founder chain | `try_grant_founder_seat` is not called from the new checkout-success path — seat cap not enforced | Founder chain report |

### P1 · fix within Cohort 0

P1-001 through P1-007 from the v2.2.24 audit (TopHud subscription, dead `setHasLicense`, silent WHOP_API_KEY log, missing "why sign in" copy, rage-click debounce, stale comments, not-rendered auth states) — all still open. Plus: contrast fails on 3 secondary surfaces; 4 iron-gate sentinel drift warnings; Editor draft schema has no migration; Wallet ledger has no empty state; Earn tab has no offline fallback.

### P2 · schedule to v2.2.25+

Browser-close mid-checkout resume affordance · Editor undo stack cap · IntroSplash reduced-motion branch · Community moderation optimistic-only · Diagnostics CSV BOM · 12 stray `console.log` in shipped bundle.

---

## Cross-cutting patterns (codemod targets)

Each pattern closes many findings at once. Ranked by fix-per-line.

- **Dev-language leaks · 5 of 7 surfaces.** Grep `skeleton|placeholder|TODO|WIP|not checked yet|coming soon|demo` in `desktop/src/sections/**`. Real copy or gate behind `import.meta.env.DEV`.
- **Fake fixture data · Wallet, Editor, Campaigns.** Grep `FIXTURE|SAMPLE|MOCK|DEMO_` constants imported from `.tsx`. Replace with real RPC + loading + empty + error.
- **Silent RPC mock fallback · ~32 sidecar wrappers.** Every `catch { return FIXTURE }` in `sidecar-stub.ts` must throw or return `{ error }`. Gate whole file behind `import.meta.env.DEV`.
- **Raw error leaks · 116 FE + 56 BE.** Route through `humanError(e)` / `human_error(e)`. Add ESLint + ruff rules.
- **Media without `onError` · 19 videos + 24 imgs.** Fallback poster / broken-image tile + Sentry breadcrumb. Add ESLint `jsx-media-requires-onerror`.
- **`setState` after `await` · 9 sites.** `let cancelled = false; return () => { cancelled = true }` or `AbortController`.

---

## Recovery plan · BLOCK → PASS

One sprint at a time (sequential-sprints rule).

- **R1 · Kill fake data (2–3d).** Editor real footage · Wallet real roster · Earn real clips + summary · Campaigns real create/publish. Delete `sidecar-stub.ts` fallbacks. Snapshot-proof-lens each.
- **R2 · Kill fake completions (1d).** Export writes a real file or throws. Publish mints a real reward clip or throws. Cancel-subscription hits real Stripe/Whop endpoint.
- **R3 · Fix cold-email chain (1d).** `whop_checkout_success` routes through `apply_membership_tier()`. Founder = plan-id whitelist + seat-cap. `openInApp()` replaces `window.open()` with popup-blocked fallback. Real-data walk end-to-end.
- **R4 · Codemods (2d).** All 6 patterns above. ESLint + ruff rules to prevent regression.
- **R5 · Copy sweep (0.5d).** Dev-language grep → zero. Ship-lens each.
- **R6 · Backend hardening (1d).** Wallet double-count guard · cron structured logging · rate-bucket LRU cap · unified founder-seat constant · `auth_whop.py:411` routed through `apply_membership_tier`.
- **R7 · 5-gate 2E2 walk (0.5d).** Customer · agency · revenue · operator · runtime-update. Then Daniel signs off.

**Total: 8–10 days.** No new features during recovery.

---

*Prepared 2026-07-05 · consolidates 6 parallel lens-agent reports + the v2.2.24 `ship-lens-review.json` prior audit. Individual per-lens raw reports live in the session transcript; extract to `desktop-2/docs/lens-reports/` if a follow-up agent needs granular evidence per finding.*
