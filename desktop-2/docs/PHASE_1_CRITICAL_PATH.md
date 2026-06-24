# Phase 1 · Critical Path Tracker
### Living source of truth · update at the end of every sub-unit

*Last update · 2026-06-19 · **P1-4-e release docs + ship-script SHIPPED** · Phase 1 critical-path code-side **CLOSED** · only remaining gates are Daniel's two manual rehearsals (local cert chain + live tag push) · author · Claude*

This is the single read for Phase 1 status. Cross-references every audit + closure report instead of re-stating them. If anything below disagrees with another doc, **this file wins** and the other should be re-aligned at the next sub-unit boundary.

---

## 0 · Headline

- **Phase 1 progress · ~70%** by sub-unit count · ~62% by beta-readiness weighting (per `beta-readiness-audit-2026-06-19.md`).
- **Current next action ·** **Daniel** · (1) run the P1-4-b local cert/notarisation rehearsal documented in `RELEASING.md` §1 + the P1-4-b report turn, (2) run `cd desktop-2 && ./scripts/ship.sh 0.8.0 "Phase 1 critical-path beta"` to fire the full chain. No further Claude work queued before either rehearsal returns.
- **Last verification run ·** `npx tsc --noEmit` EXIT 0 at the close of P1-3-c (2026-06-19).
- **3-agency readiness ·** **YES with manual `is_admin_email` bootstrap.** All B1/B2/B3 closed. Sign-in is system-browser + deep-link.
- **10-agency readiness ·** **YES** functionally (P1-1F + P1-1G complete · auth-hardening + source-aware tier gating live · no silent 401 cliff · fixture-fallback users cannot open agency write surfaces). Remaining: optional P1-4 installer polish for non-CI distribution.
- **100-clipper readiness ·** **all 3 hard blockers code-side cleared** · notarised installer wired (P1-4-b) + auto-updater pipeline wired (P1-4-d) + CI publish wired (P1-4-d `release-desktop-2.yml`) + ship-script + runbook + CHANGELOG wired (P1-4-e). Last gate · Daniel's two live rehearsals (cert chain + `./scripts/ship.sh 0.8.0`).

---

## 1 · Complete

| Sub-unit | Closure doc | Verified |
|---|---|---|
| **P0-1** · Locked-user Whop bypass (lens P0 in 6N-G) | inline in turn report 2026-06-19 | tsc green · ship-lens pass |
| **P0-2** · Submission CTA fallback ladder | inline | tsc green |
| **P0-3** · `payoutLine` zero-coerce guard | inline | tsc green |
| **P1-1B** · Auth storage + JWT bridge (`lib/authStorage.ts` 156 LOC + sidecar-stub rewire) | inline 2026-06-19 | tsc green |
| **P1-1C** · Activation + deep-link entry audit | `p1-1c-activation-deeplink-audit-2026-06-19.md` | n/a (audit) |
| **P1-1D-a** · `lib/activation.ts` state machine + parser (274 LOC) | inline | tsc green |
| **P1-1D-b** · `lib/deepLinkBoot.ts` Tauri subscriber (165 LOC) | inline | tsc green |
| **P1-1D-c** · Post-activation orchestrator try/catch hardening | inline | tsc green |
| **P1-1D-d** · App-root boot wiring (App.tsx +33 LOC) | inline | tsc green |
| **P1-1E** · LoginOnboarding UI (rebuilt from SimPage · 7 states + already-activated) | inline | tsc green |
| **P1-2** · Settings basics (6 sections) | inline | tsc green |
| **P1-2A** · Settings world wrap (cockpit-home + Kade helper-right + sim grammar) | inline | tsc green |
| **P1-2B-a** · Asset coverage audit (200+ files inventoried · no broken paths) | `p1-2b-a-asset-coverage-audit-2026-06-19.md` | n/a (audit) |
| **P1-2B-b** · Nav-hover Tier A fix (`position: fixed` + computed coords) | inline | tsc green |
| **P1-2B-c-i** · LoginOnboarding boot-sequence world wrap | inline | tsc green |
| **P1-2B-e** · Game / bug / FX asset usage addendum (50+ unwired flagged) | `p1-2b-addendum-game-fx-asset-audit-2026-06-19.md` | n/a (audit) |
| **P1-3-a** · Support contact card (B1 closure) | inline | tsc green |
| **P1-3-b** · Connected accounts card (B2 closure · 3-state vocab · real Ayrshare counts) | inline | tsc green |
| **P1-3-c** · Plan & access card (B3 closure · honest "Not checked yet" labels) | inline | tsc green |
| **P1-1F-a** · 401 self-heal in activation orchestrator · `FetchOutcome<T>` discriminated result · `notifyAuthFailure()` exported · session-scoped dampener · auto-reset on `beginActivation`/`clearActivation` | inline 2026-06-19 | tsc green |
| **P1-1F-b** · Tauri 2 native Keychain commands (`secret_get_jwt`/`secret_set_jwt`/`secret_delete_jwt`) via `keyring v3` crate · namespace `app.liquidclips.auth.v1` · `authStorage.setJwt`/`clearJwt` now fire best-effort native writes · `initAuthStorage` Tauri-prime already wired since P1-1B · `getAuthSource` reports `tauri-keychain` once a Tauri call succeeds | inline 2026-06-19 | tsc green · cargo check green |
| **P1-1F-b gap-patch** · 3-fix micro-patch inside `authStorage.ts` only · (1) localStorage→Keychain migration backfill in `initAuthStorage` for upgrading users · (2) stale-Keychain delete in `writeJwtToKeychain` catch to prevent next-boot revert · (3) `_resetAuthStorageForTests` clears native Keychain | inline 2026-06-19 | tsc green |
| **P1-1F-c** · Full verification sweep · tsc · cargo check · 6 auth-path traces · 6 activation-path traces · JWT-logging audit · authHeaders impact check · all green · P1-1F closed | inline 2026-06-19 | tsc green · cargo check green · 0 JWT logs |
| **P1-1G-a** · `useMe()` hook · single-flight `loadMe()` · reuses P1-1F-a `FetchOutcome<T>` + `notifyAuthFailure` · MeSnapshot with email · userId · clerkId · whopUserId · affiliateId · rawTier · effectiveTier · adminOverride · billingProvider · subscriptionStatus · paidUntil · degraded preserves last snapshot · session-cache vs real-http source labels | inline 2026-06-19 | tsc green |
| **P1-1G-b** · `useTierCaps()` reads `useMe()` first · debug-override > real-http > session-cache > fixture-fallback > unknown · `TierSource` + `loading` + `adminOverride` added to context · `mapBackendTier()` covers v1+v2 spellings · Settings Plan & Access wired to real /me · Account section tier pill wired · Refresh button now reloads /me too · zero consumer signature break | inline 2026-06-19 | tsc green |
| **P1-1G-c** · Boot/auth gate · `AuthGate` wraps `<AppShell />` · re-evaluates `hasJwt()` on every `activation.status/error/lastTokenSource` transition · network/500 preserves JWT so gate stays open · `notifyAuthFailure` flips gate to LoginOnboarding · agency action gate via `canUseAgencyActions({tier, source})` · helpers `isTrustedTierSource` + `canUseAgencyActions` exported from useTierCaps · `AgencyCreationFlow` mounts only when canWriteAgency · floating Create CTA has 3 states (enabled · locked-with-explanation · hidden) · clipper discovery untouched · no token logs | inline 2026-06-19 | tsc green |
| **P1-4-a** · Installer + updater pipeline audit · desktop-2 = zero-wired (no entitlements · no `.icns`/`.ico` · no updater plugin · `createUpdaterArtifacts: false` · no CI · no scripts · 0/10 GH secrets) · legacy `desktop/` ships proven IG-013 chain · ~80% ports verbatim · 3 hard 100-clipper blockers identified (notarised installer · auto-update · CI publish) · Windows defer to post-beta recommended · estimated 2-day clearance | `p1-4-installer-updater-audit-2026-06-19.md` | audit-only · no code |
| **P1-4-b** · macOS installer port · `tauri.conf.json` semver fix (`0.8.0-shell` → `0.8.0`) + full icon array + `bundle.macOS` block (signingIdentity · entitlements · minimumSystemVersion) · `entitlements-direct.plist` slim baseline (WebView JIT only · sidecar flags commented for later) · 8 icons copied from legacy (16-512 PNG + `.icns` + `.ico`) · 6 helper scripts ported with Python-sidecar steps removed + binary name swapped (`junior-desktop` → `liquid-clips-shell`) | inline 2026-06-19 | tsc green · cargo check green · `liquid-clips-shell v0.8.0` compiles clean in 4.9s · full `tauri build --bundles app` rehearsal requires Daniel's Apple Developer ID cert in login keychain (documented in P1-4-b report) |
| **P1-4-d** · Updater pipeline · `tauri-plugin-updater = "2"` + `tauri-plugin-process = "2"` added to `Cargo.toml` · plugins registered in `lib.rs` ahead of deep-link · `@tauri-apps/plugin-updater ^2.10.1` added to `package.json` · `plugins.updater` block in `tauri.conf.json` (endpoints + pubkey `B1E037066BFCE444` + windows.installMode passive) · `createUpdaterArtifacts: true` · CSP `connect-src` expanded for `updates.liquidclips.app`, `api.jnremployee.com`, `release-assets.githubusercontent.com` · slim JS wrapper at `src/lib/updater.ts` (97 LOC · check + apply + last-check memo · no telemetry/humanError deps) · new CI workflow `.github/workflows/release-desktop-2.yml` (port of legacy IG-013 chain · drops Python-sidecar fetch/sign steps · trigger `desktop-2-v*.*.*` so legacy `v*.*.*` keeps running until cutover) · all 6 GH secrets confirmed present on Powstit/Jnr-employee · manifest endpoint `https://updates.liquidclips.app/latest.json` LIVE (HTTP 200 · currently serves v0.7.51 from legacy) | inline 2026-06-19 | tsc green · cargo check green (9m 35s clean · downloaded + compiled updater + process plugin trees) · YAML parses · pubkey fingerprint round-trips · npm install added 1 package |
| **P1-4-e** · Release docs + ship-script · `desktop-2/RELEASING.md` (full chain runbook · 8 sections · pre-reqs · what-a-ship-is · quick command · step-by-step narration · post-ship checklist · rollback path · troubleshooting · hard rules) · `desktop-2/CHANGELOG.md` (Keep-a-Changelog format · 0.8.0-beta entry honest about scope · explicit Known-limits block · Security + Infrastructure sections) · `desktop-2/scripts/ship.sh` 11 KB CI-first port (preflight 7 tools + clean tree + branch + tag-not-shipped + INTERNAL_API_SECRET + gh auth · bumps both version files · frontend build fail-fast · commits + tags + pushes · resolves CI run ID via `gh run list --workflow release-desktop-2.yml` keyed on HEAD sha · `gh run watch --exit-status` blocks until terminal · `gh release download` pulls .app.tar.gz + .sig · `POST /updates/upload` × 2 targets with content-length checked · verifies manifest × 2 hosts × 2 arches) · Settings Check-for-updates button DEFERRED per directive (UI churn risk) | inline 2026-06-19 | bash -n clean · shellcheck clean (warning+) · 3 files written · ship.sh executable · no live commands run |
| Banner audit · Browser Capture audit · Beta readiness audit · Visual debt log | various `.md` in `desktop-2/docs/` | n/a (audit) |

---

## 2 · In progress

(none · Phase 1 critical-path code-side is closed · awaiting Daniel rehearsals before next phase)

---

## 3 · Blocked

(none today)

---

## 4 · Deferred (per Daniel's mall directive + lock decisions)

| Item | Reason | Lock source |
|---|---|---|
| P1-3-d · Profile card | mall · painting | this turn |
| P1-3-e · `useMe()` hook + Account polish | mall · painting · low ROI vs P1-1F + P1-1G | this turn |
| P1-3-f · Diagnostics expansion + Copy markdown | mall · painting | this turn |
| P1-3-g · Preferences + Desktop behavior | mall · painting | this turn |
| P1-3-h · audit close | rolled into P1-4 close | this turn |
| **All P2-1 / world-feel polish** · 50+ unwired loaders/particles/bugs/FX | visual debt | `visual-debt-log-2026-06-19.md` |
| **Native LC reward engine** | locked | Final Product Lock + ROADMAP_LOCK Phase 6P framing |
| **Whop bounty:create OAuth** | locked | Final Product Lock |
| **Browser Capture (6P)** | approved future · DO NOT BUILD YET | `browser-capture-reconciliation-audit-2026-06-19.md` |
| **Asset ingestion (Drive · Dropbox)** | post-beta | asset-source-foundation-audit |
| **Wall of clippers** | scope decision pending | beta readiness audit §C |
| **Banner generation (6N-H)** | future capability · locked at marketplace rectangle | `campaign-banner-generation-audit-2026-06-19.md` |

---

## 5 · Beta readiness gates

### 5.1 · 3 agencies (next week)

**STATUS · YES with manual provisioning.**

Required to ship:
- ✅ Sign in via system browser + deep-link (P1-1D + P1-1E)
- ✅ Admin allowlist bootstrap (Daniel adds emails to `JUNIOR_ADMIN_EMAILS` Railway env var)
- ✅ Support contact card (B1)
- ✅ Connected accounts honest surface (B2)
- ✅ Plan & access honest surface (B3)
- ⏸ Tolerable: 4× "Not checked yet" labels in Settings until P1-3-e lands · not a blocker
- ⏸ Tolerable: silent 401 cliff during /sync · low likelihood in week-1 beta · P1-1F closes within days

Gaps · acceptable for 3-agency soft beta:
- No notarised installer · agencies download from CI artifacts or local builds
- Tier UI gating fixture-only (P1-1G open) · agencies are admin-bootstrap'd as "agency" so they pass every gate trivially

### 5.2 · 10 agencies (this month)

**STATUS · NO until P1-1F + P1-1G + at least P1-4 audit complete.**

Required to ship at 10:
- All "3 agencies" requirements +
- ❌ P1-1F · 401 self-heal so server-side token rotation doesn't strand agencies
- ❌ P1-1F · Native Keychain so the JWT is protected (audit cliff: localStorage-only at 10 agencies is "fine but flag-able")
- ❌ P1-1G · Tier enforcement so the agency mode doesn't depend on admin-bootstrap
- ❌ P1-4-a · Installer audit + at least the manual-build install instructions documented
- ⚠️ Recommended: P1-3-e `useMe()` to flip "Not checked yet" labels to real state (nice-to-have, not blocker)

### 5.3 · 100 clippers (this month)

**STATUS · NO until P1-4 (full installer + updater chain) lands.**

Required to ship at 100:
- All "10 agencies" requirements +
- ❌ P1-4-b · macOS notarised installer + signed DMG
- ❌ P1-4-c · Windows installer (if Windows in beta scope · TBD)
- ❌ P1-4-d · Auto-update pipeline live + first rehearsal version published
- ❌ P1-4-e · Release docs published
- ⚠️ Recommended: Library route fill (currently SimPage placeholder · clippers WILL look for "my clips")
- ⚠️ Recommended: Loader assets wired (P2-1 polish · 8 unwired loaders identified in `p1-2b-addendum-game-fx-asset-audit`)
- ⚠️ Recommended: Notarisation pipeline rehearsal per `liquid_clips_notarisation_pipeline.md` memory

---

## 6 · Current next action

**P1-1F-a · 401 self-heal in activation orchestrator.**

Scope:
- Replace `safeGet<T>()` in `lib/activation.ts` with a 401-aware variant that distinguishes auth failures from network/500 failures
- On 401/403 · clear JWT + emit `"failed"` state with `"session expired"` error · ONCE per session via dampener flag
- On network error / 500 / other non-auth 4xx · preserve JWT · mark `degraded` only
- Existing valid JWT remains unless backend explicitly rejects it
- No UI changes · no Rust · no Cargo.toml edit · no new endpoint

---

## 7 · Last verification run

`npx tsc --noEmit` · EXIT 0 · 2026-06-19 at the close of P1-3-c · across:
- `desktop-2/src/lib/authStorage.ts` (P1-1B)
- `desktop-2/src/lib/activation.ts` (P1-1D-a/c)
- `desktop-2/src/lib/deepLinkBoot.ts` (P1-1D-b)
- `desktop-2/src/App.tsx` (P1-1D-d)
- `desktop-2/src/design-os/routes/LoginOnboarding.tsx` (P1-1E + P1-2B-c-i)
- `desktop-2/src/design-os/routes/Settings.tsx` (P1-2 + P1-2A + P1-3-a/b/c)
- `desktop-2/src/design-os/components/ConsoleNav.tsx` + `.css` (P1-2B-b)
- `desktop-2/src/design-os/campaigns/*` (6N-G + lens P0 fixes)

Backend import smoke · `from app.main import app` · OK at 2026-06-19 close of 6N-G.

Live walks + screenshots + `__lcRunLeakTest()` · NOT executed from Claude side this session · same live-runtime constraint that has held throughout (Daniel-owned verification).

---

## 8 · Closure / reference index

| Doc | Phase | Purpose |
|---|---|---|
| `whop-clipping-rewards-honesty-pre-6n-e-correction.md` | 6N-E | URL-first correction · §8 patch source |
| `phase-6n-e-truth.md` | 6N-E | Truth report (shipped) |
| `phase-6n-e-implementation-plan.md` | 6N-E | Build plan |
| `browser-capture-reconciliation-audit-2026-06-19.md` | 6P | Future capability lock |
| `campaign-banner-generation-audit-2026-06-19.md` | 6N-H | Marketplace rectangle lock |
| `beta-readiness-audit-2026-06-19.md` | Phase 1 | Beta-line scope freeze (62%) |
| `p1-1a-loginonboarding-auth-preflight-2026-06-19.md` | P1-1 | Auth preflight |
| `p1-1c-activation-deeplink-audit-2026-06-19.md` | P1-1 | Activation pipeline trace |
| `p1-2b-a-asset-coverage-audit-2026-06-19.md` | P1-2B | Asset inventory |
| `p1-2b-addendum-game-fx-asset-audit-2026-06-19.md` | P1-2B | Game/FX usage (50+ unwired) |
| `p1-3-settings-completion-audit-2026-06-19.md` | P1-3 | Settings build plan |
| `p1-4-installer-updater-audit-2026-06-19.md` | P1-4 | Installer/updater state · macOS port plan · 100-clipper blockers |
| `visual-debt-log-2026-06-19.md` | (cross-cutting) | Deferred polish backlog |
| `PHASE_1_CRITICAL_PATH.md` | (this file) | Living status |

---

*Update at the close of every P1-1F sub-unit. If a status line stops matching reality, the file is stale · fix it.*
