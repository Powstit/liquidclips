# Liquid Clips · Desktop-2 System State · 2026-07-08

**Version audited:** v2.2.35 (package.json + tauri.conf.json). Cargo.toml drifted to 2.2.31 (see BUG-RT-003).
**Repo path:** `/Users/dipdip/code/jnr/desktop-2/`
**Cross-boundary scope:** `junior-backend` and `account-app` included only where a bug crosses into desktop-2 (RPCs, auth, checkout, activation, updater, runtime bundle, API contracts).
**Legacy desktop/ excluded** unless referenced by desktop-2 (see BUG-C-020, BUG-S-012 for two residual imports).
**Method:** 6 parallel audit agents ran system-audit-lens + ship-lens across Customer, Agency, Revenue, Auth, Runtime, Operator, and Shared surfaces. Every finding verified against current file:line. MASTER_AUDIT_2026-07-05 claims re-verified — resolved items excluded from this doc's bug list (see reconciliation section at end).
**Audit only.** No code was edited. No version was bumped. No build was triggered. No push occurred.

---

## Executive summary

### Bug counts by severity

| Severity | Count | Meaning |
|---|---|---|
| **P0** | 18 | Cannot ship. Runtime crash / money-path lie / silent-mock success / auth bypass / trust-break user-visible defect. |
| **P1** | 34 | Fix within Cohort 0. Visible misbehavior, degraded flow, unwired-but-shown journey, cross-cutting error hygiene. |
| **P2** | 34 | Polish / hardening / dead-code / doc drift / defense-in-depth. Ship without blocking, sweep next patch. |
| **OK** | 4 | Verified healthy (TS clean, watchdog wired, telemetry wired, iron-gate sentinels intact). |

### Bug counts by surface

| Surface | P0 | P1 | P2 | Notes |
|---|---|---|---|---|
| Customer | 4 | 6 | 10 | Diagnostics fixture, Export mock fallback, sidecar-stub 20-site fixture fall-through, guest 10-clip client-only cap |
| Agency | 5 | 6 | 6 | Wrong price catalog ($500 vs $99.99), fixture campaign slug on submit, agency-mode Earn view missing |
| Revenue | 2 | 2 | 3 | Client-only 10-clip cap, checkout diverted out of app, cross-boundary mint bypass on `desktop.py:194` |
| Auth | 0 | 3 | 4 | Passive JWT death doesn't emit signed-out, sessionStorage challenge lost on cold launch |
| Runtime | 2 | 3 | 12 | Sidecar bundle NOT in tauri resources · entitlements missing for hardened runtime · updater has no rollback |
| Operator | 4 | 3 | 1 | Diagnostics fake data, Stripe Connect dev-language, Ayrshare surface still shipped, no admin gate |
| Shared | 2 | 5 | 5 | 53 silent RPC fixture fallbacks (higher than MASTER_AUDIT's 32), 27 media without onError, 51 raw String(e) leaks, useFeature dead code |

### The four bugs most likely to melt launch

1. **BUG-RT-001** — PyInstaller sidecar bundle NOT in `tauri.conf.json:bundle.resources`. Every installed customer's engine call falls through to mock. Real ingest / transcribe / clip never runs.
2. **BUG-RT-002** — Hardened-runtime entitlements missing `allow-unsigned-executable-memory` + `disable-library-validation`. Sidecar SIGKILL'd on first cold-launch of any notarised release.
3. **BUG-A-001** — Agency plan price is `$500/mo` in `PLAN_CATALOG.agency`. Every UI surface reads it. Whop charges $99.99. User sees $500, gets billed $99.99. Trust break + false-advertising exposure.
4. **BUG-A-008** — SubmitToWhopModal posts every submission against hardcoded `campaign_id: "preview-campaign"`. Every real clip submission is silently sent to a fixture slug. Zero real earn attribution reaches Whop.

---

# Customer Surface Bugs

### BUG-C-001 · Diagnostics panel titled "skeleton" in prod copy
- **File:** `src/sections/diagnostics/DiagnosticsSection.tsx`
- **Line/Function:** `134` (`<h3 className="lc-hud-title">Backend / sidecar / social skeleton</h3>`) and `138` ("Ayrshare key not wired in shell.")
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Diagnostics tile literally titled "skeleton"; body prose reads "Ayrshare key not wired in shell". Dev-language shipped to end users.
- **Why it matters:** Users copy this into support tickets and read the app as unfinished. Diagnostics is exactly where users go to check health.
- **Recommended fix:** Rename title to "Backend · sidecar · social status". Delete the Ayrshare line entirely (Ayrshare is deprecated — see BUG-O-004).
- **Confirmed / Suspected:** Confirmed.

### BUG-C-002 · Diagnostics renders `fakeBackendStatus` / `fakeSidecarStatus` / `fakePassiveKeychainStatus` as customer copy
- **File:** `src/sections/diagnostics/DiagnosticsSection.tsx`
- **Line/Function:** `36` (`events = recent.length > 0 ? recent : fakeDiagnosticsEvents`), `80` (fake keychain reads), `136-137` (fake backend URL + sidecar note).
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Four `fake*` imports from `fixtures/fakeDiagnostics.preview.ts` render live in the Diagnostics surface with no fallback to real `runHealthCheck()` output for those specific bullets.
- **Why it matters:** A user diagnosing a real incident copies fake `note` + fake keychain-reads into a support ticket, misleading themselves and support.
- **Recommended fix:** Delete `fakeBackendStatus` / `fakeSidecarStatus` / `fakePassiveKeychainStatus` imports; source those bullets from the same `runHealthCheck()` rows above. Show honest empty state when flowTrace buffer is empty.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-003 · Sidecar mock-fallback silently returns FIXTURE_PROJECT for 20 wrappers when Tauri unreachable
- **File:** `src/design-os/engine/sidecar-stub.ts` + `src/design-os/engine/sidecarCall.ts`
- **Line/Function:** 20 wrapper sites — `269, 301, 380, 396, 417, 438, 497, 555, 573, 586, 597, 615, 645, 661, 675, 987` in `sidecar-stub.ts`. Gated by `isSidecarUnavailable()` at `sidecarCall.ts:340-357` which returns `true` unconditionally when `__TAURI_INTERNALS__` missing.
- **Severity:** P0
- **Surface:** Customer
- **What is broken:** Every RPC wrapper falls through to `FIXTURE_PROJECT` / mock state when Tauri isn't available. `isSidecarUnavailable` is `true` in any dev/vite/preview build AND any Tauri build where the runtime handle isn't attached yet — briefly-failing sidecar makes the app pretend to succeed with FIXTURE data. Master audit P0#23 called this out; still present.
- **Why it matters:** Users see fake project data / fake success. Export "succeeds" writing a synthetic path `/projects/{slug}/clips/{idx}-export-...mp4` that doesn't exist. Toast says "Export complete".
- **Recommended fix:** Gate all mock-fallback branches behind `import.meta.env.DEV` explicitly. In production builds, throw a typed `SidecarUnavailable` error and let error boundaries + BakeErrorStrip render it. Add ESLint rule preventing new `return FIXTURE_*` in `catch`.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-004 · ExportRoute uses `FIXTURE_PROJECT` as activeProject when no session; mock export writes fake file path
- **File:** `src/design-os/routes/ExportRoute.tsx` + `src/design-os/engine/sidecar-stub.ts`
- **Line/Function:** `ExportRoute.tsx:67` (`activeProject = session.project ?? FIXTURE_PROJECT`) → `onExport` at `143-155` → `exportApi.exportClip` (`sidecar-stub.ts:976-1021`); mock branch at `991-1020` synthesises `jobId=ex-${Date.now()}`, `outputPath=/projects/${slug}/clips/{idx}-export-${format}.mp4`, pushes to `exportState.history`.
- **Severity:** P0
- **Surface:** Customer
- **What is broken:** Export CTA fires against fixture project when no bake exists. Mock success path emits `engine:complete` and returns fake `outputPath` that never resolves on disk.
- **Why it matters:** Export is the money-moment. Users get bogus success on a primary CTA.
- **Recommended fix:** When `usingPreview === true`, disable the Export CTA (not just show a "Preview data" badge). Remove the mock success path from `exportApi.exportClip` — throw `SidecarUnavailable` in prod.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-005 · Native file picker not wired; toasts "File picker not yet wired"
- **File:** `src/design-os/routes/CreateClips.tsx`
- **Line/Function:** `199-213` (`onPickFile` handler)
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Upload Portal's "Pick file" button toasts "File picker not yet wired" instead of opening a native Tauri dialog.
- **Why it matters:** Brand-new user landing in Create (primary entry) reads dev-language admission and abandons.
- **Recommended fix:** Wire `@tauri-apps/plugin-dialog` `open()` with mp4/mov filters. If the plugin can't land this sprint, hide the button rather than surface the "not yet wired" copy.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-006 · BrowseSection hardcoded tile copy "My channel · 142 vids" / "All my recordings" reads as if wired
- **File:** `src/sections/browse/BrowseSection.tsx`
- **Line/Function:** `78-92` (three `.lc-hud-card is-static` tiles)
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Three source tiles show fake counts / integrations. Tagged `is-static` to remove hover but copy still promises live data.
- **Why it matters:** User reads "142 vids" from their own channel and expects the browser overlay to open pre-scoped. It doesn't.
- **Recommended fix:** Rewrite as capability descriptions without invented counts, or delete (top CTA already covers it).
- **Confirmed / Suspected:** Confirmed.

### BUG-C-007 · LearnTab exposes "Thumbnail slot ready · Daniel to drop custom art" to end users
- **File:** `src/routes/learn/LearnTab.tsx`
- **Line/Function:** `174` (`<div className="lt-meta-hint">Thumbnail slot ready · Daniel to drop custom art</div>`)
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Every one of 7 Learn cards shows a hint line calling out the founder by first name saying art is missing.
- **Why it matters:** Immediately breaks the fourth wall — signals incomplete product on a primary onboarding surface.
- **Recommended fix:** Delete the `.lt-meta-hint` line or replace with a per-card demo caption ("60-sec demo").
- **Confirmed / Suspected:** Confirmed.

### BUG-C-008 · LearnTab `<video>` has no onError — mp4 404 leaves black tile
- **File:** `src/routes/learn/LearnTab.tsx`
- **Line/Function:** `154-166`
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** `<video>` element only handles `onPlaying`/`onPause`; no `onError`. Any `/demos/*.mp4` fail = silent black tile.
- **Why it matters:** Silent black tiles in a marketing-style onboarding surface.
- **Recommended fix:** Migrate to `src/components/safe/SafeVideo.tsx` (already exists with poster + onError fallback).
- **Confirmed / Suspected:** Confirmed.

### BUG-C-009 · WelcomeRoute marquee (10 `<video>` tiles) + wordmark `<img>` have no onError
- **File:** `src/design-os/routes/WelcomeRoute.tsx`
- **Line/Function:** `1003-1023` (marquee video), `762` (wordmark `<img src="/brand/assets/wordmark-text.png">`)
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Cold-open login carousel loads 10 mp4 tiles. Any single 404 = black gradient with no feedback.
- **Why it matters:** First screen a brand-new user sees. Broken tile undermines the whole hero pitch.
- **Recommended fix:** Wrap in SafeVideo / SafeImg or add explicit onError to gracefully drop the failed tile.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-010 · ClipperJourney chip `<img>` has no onError
- **File:** `src/design-os/routes/ClipperJourney.tsx`
- **Line/Function:** `121`
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Chip art `<img src={c.art}>` renders broken-image icon on 404.
- **Recommended fix:** Route through SafeImg with `fallback="hide"`.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-011 · SubmissionsReview avatar `<img>` has no onError
- **File:** `src/design-os/routes/SubmissionsReview.tsx`
- **Line/Function:** `236`
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Each submission row's avatar renders broken-image on 404.
- **Recommended fix:** Migrate to SafeImg.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-012 · CampaignBuilder EmbedPreviewCard has mixed onError coverage
- **File:** `src/routes/campaign-builder/EmbedPreviewCard.tsx`
- **Line/Function:** `249-254` uses onError; other `<img>` in same file need review
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Partial hardening — some images guarded, others may not be.
- **Recommended fix:** Sweep all `<img>` in the file through SafeImg.
- **Confirmed / Suspected:** Suspected (needs targeted read).

### BUG-C-013 · Settings leaks raw `String(e)` in 9 toast bodies
- **File:** `src/design-os/routes/Settings.tsx`
- **Line/Function:** `311, 344, 407, 433, 447, 490, 539, 1599, 1618` — `body: e instanceof Error ? e.message : String(e)`
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Every Settings mutation toasts raw `.message` on failure. Users see stack-flavored strings ("TypeError: NetworkError…").
- **Recommended fix:** Route all catches through `humanError(e)` (exported from `src/design-os/engine/sidecarCall.ts:135`).
- **Confirmed / Suspected:** Confirmed.

### BUG-C-014 · Publish RPC has no idempotency key — retry doubles the mint
- **File:** `src/design-os/engine/cockpit/PublishModule.tsx`
- **Line/Function:** `432-442` (`bridgeToBackend("POST", "/me/reward-clips", {…})` with no `Idempotency-Key` header)
- **Severity:** P1
- **Surface:** Customer
- **What is broken:** Network fail mid-request → user retries → backend receives duplicate `/me/reward-clips`.
- **Why it matters:** Duplicate reward-clip rows inflate Earn totals + get flagged by Whop.
- **Recommended fix:** Generate a UUID per attempt, attach as `Idempotency-Key` header. Backend persists key for 24h. Disable the Publish button while `publishAction.pending`.
- **Confirmed / Suspected:** Client absence confirmed; backend confirmation needed.

### BUG-C-015 · CampaignsSection preview surface creates `cmp_fx_00N` fixture IDs that leak to dead CTAs
- **File:** `src/sections/campaigns/CampaignsSection.tsx`
- **Line/Function:** `41` (`id: cmp_fx_${...}`), `140-149` (review-button leak paths)
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Legacy `#/campaign` route generates fixture ids. "Set rewards on Whop →" CTA opens a bogus Whop URL and 404s.
- **Recommended fix:** Delete legacy CampaignsSection or redirect to Design-OS `campaign-builder` route.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-016 · InlineCreatePanel / CreateClips leak raw `String(e.message)` into `engine:error`
- **File:** `src/design-os/components/InlineCreatePanel.tsx` + `src/design-os/routes/CreateClips.tsx`
- **Line/Function:** `InlineCreatePanel.tsx:344-348`; `CreateClips.tsx:98-110, 183-196`
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Ingest-fail path emits raw `.message` in `engine:error.error`. Downstream KadeRepairScreen surfaces the raw text; `SidecarError.human` was designed for this.
- **Recommended fix:** Read `.human` from typed sidecar errors before falling back to `.message`.
- **Confirmed / Suspected:** Confirmed.

### BUG-C-017 · Settings still displays "Connection status not checked yet" for Whop / Stripe Connect pills
- **File:** `src/design-os/routes/Settings.tsx`
- **Line/Function:** `970` and `1016`
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** Provider pills fall back to "Connection status not checked yet" when channels source is `mock`. MASTER_AUDIT P0#18; still shipped.
- **Recommended fix:** Trigger on-mount `channels.refresh()` so the pill always resolves. For Stripe Connect, drop the pill copy and lead with "Native payouts · coming soon".
- **Confirmed / Suspected:** Confirmed.

### BUG-C-018 · BUG-016 REFRAME residual: `stage_thumbs` failure marks whole pipeline failed after clips already landed
- **File:** `python-sidecar/stages.py` + `python-sidecar/build_sidecar.sh`
- **Line/Function:** `stage_thumbs` (see ledger `docs/BUGS_ERRORS_FIXES.md:850-949`)
- **Severity:** P1
- **Surface:** Customer (background pipeline visible via failed bakes)
- **What is broken:** Packaging fix landed (`--collect-data cv2` collects haarcascades), but `stage_thumbs` is still treated as blocking — any cv2 failure marks project failed even after `stage_reframe` already wrote the vertical MP4s. Also BUG-016b: sidecar refuses to launch under macOS 26+ Hardened Runtime unless manually deep-signed after every rebuild.
- **Why it matters:** Customer sees "engine failed" state when clips actually exist on disk.
- **Recommended fix:** Land Phase 1 of REFRAME plan: make `stage_thumbs` soft-fail, emit `clips_ready` on `stage_reframe` completion. Fold the deep-sign block into `build_sidecar.sh`.
- **Confirmed / Suspected:** Confirmed per BUGS_ERRORS_FIXES.md ledger status ACTIVE.

### BUG-C-019 · Cinematic intro has no error-boundary around SafeVideo mount
- **File:** `src/overlays/IntroSplash.tsx`
- **Line/Function:** `123-137` (`if (stage === "intro") { setTimeout(advanceFromIntro, autoplayBlocked ? 3_000 : INTRO_DURATION_MS) }`)
- **Severity:** P2
- **Surface:** Customer
- **What is broken:** MASTER_AUDIT P0#4 was RESOLVED (25s ceiling + `onEnded` + SafeVideo + tap-to-play). Residual: if SafeVideo fails to mount (Suspense chunk-load failure), user sees black scrim for the full 25s ceiling with no diagnostic. No `BootErrorBoundary` around the intro branch.
- **Recommended fix:** Wrap the intro branch in `BootErrorBoundary` (already imported).
- **Confirmed / Suspected:** Confirmed for code path; practical impact needs runtime probe.

### BUG-C-020 · Legacy `useAuthPanelBridge` referenced in TopHud/events.ts comments
- **File:** `src/design-os/components/TopHud.tsx` + `src/design-os/bridge/events.ts`
- **Line/Function:** `TopHud.tsx:287`, `events.ts:318`
- **Severity:** P2
- **Surface:** Customer (comment leak only)
- **What is broken:** `App.test.tsx:45` asserts app source must NOT contain `useAuthPanelBridge`. Comments still reference it. Actual code path uses `openInApp` / `openWhopFounderCheckout`.
- **Recommended fix:** Sweep comments; replace with the current openInApp anchor.
- **Confirmed / Suspected:** Confirmed (doc drift, not runtime).

---

# Agency Surface Bugs

### BUG-A-001 · Agency plan price is $500/mo in PLAN_CATALOG — contradicts LOCKED $99.99 pricing pivot
- **File:** `src/lib/billing/types.ts`
- **Line/Function:** `73-79` (`PLAN_CATALOG.agency`)
- **Severity:** P0
- **Surface:** Agency
- **What is broken:** `PLAN_CATALOG.agency.priceMonthlyUsd = 500`. Whop plan (`plan_NMKvKj8SVVKsY`) is correctly $99.99 at `whopCheckout.ts:57`. Every UI surface reading `PLAN_CATALOG.agency.priceMonthlyUsd` displays $500.
- **Why it matters:** AgencyPreviewBanner renders "Upgrade to Agency · $500/mo" but user gets billed $99.99 at Whop. False-advertising exposure. Violates LOCKED 2026-07-06 pricing pivot.
- **Recommended fix:** Set `PLAN_CATALOG.agency.priceMonthlyUsd = 99.99`. Remove/deprecate `pro` + `growth` per pricing pivot.
- **Confirmed / Suspected:** Confirmed — `AgencyPreviewBanner.tsx:96`, `PaywallGate.tsx:159`, `bannerRegistry.ts:299` all show pattern `` `$${agencyPlan.priceMonthlyUsd}/mo` ``.

### BUG-A-002 · Agency campaigns TierGateWall lists 3 defunct plans (Solo $50 / Agency $299 / White-Label $500)
- **File:** `src/design-os/routes/AgencyCampaigns.tsx`
- **Line/Function:** `128-134` (TierGateWall)
- **Severity:** P0
- **Surface:** Agency
- **What is broken:** Copy: "Solo Agency at $50/mo, Agency at $299/mo, or White-Label at $500/mo." All three contradict LOCKED pricing.
- **Why it matters:** Non-agency users hitting this wall (Campaign Builder route) see totally wrong pricing.
- **Recommended fix:** Rewrite to name only $99.99/mo Agency. Drop Solo/White-Label/50%-MRR framing.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-003 · AgencyWelcome overlay repeats "50% MRR on every clipper" — no accrual code exists
- **File:** `src/overlays/AgencyWelcome.tsx`
- **Line/Function:** `142-145`, `166`
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** First-run pitch: "earn 50% MRR on every clipper you bring in." No backend wire that pays 50% MRR — no ledger, no split accrual, no proof.
- **Why it matters:** Overpromises. Owner will ask "where's my 50% MRR share?" and there's no code path that computes it.
- **Recommended fix:** Rewrite to actual Agency deliverables (campaign builder + roster + payout-split panel + Whop-sync). Drop 50% MRR claim.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-004 · "Post one like this →" carrot missing on every Whop bounty card
- **File:** N/A — feature never landed
- **Line/Function:** N/A
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** LOCKED 2026-07-07 memo requires "Post one like this →" button on every Whop bounty card + ghost editor pre-fill + ransom paywall + first-bounty-free lever + 24h draft-abandonment email. Zero grep matches for "Post one", "remix", "ghostEditor", "prefill…bounty", "firstBountyFree".
- **Why it matters:** Agency conversion loop from Whop marketplace bounty → cloned in-app campaign draft is dead.
- **Recommended fix:** Wire once round-trip primitive is green (per memo timing). Nearest surface: `design-os/agency-creation/WhopRewardCard.tsx` — add secondary button that opens `AgencyCreationFlow` pre-populated.
- **Confirmed / Suspected:** Confirmed missing.

### BUG-A-005 · $1 Whop authorization plan (Gate 1) defined but no consumer wires it
- **File:** `src/lib/whopCheckout.ts`
- **Line/Function:** `90` (`WHOP_AUTHORIZATION_PLAN_ID = "plan_SMaXhQLXpSOaH"`)
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** Constant declared but no consumer. LoginScreen mounts `InlineWhopCheckout planId={WHOP_FOUNDER_PLAN_ID}` (the $99.99 Agency plan). Docstring at 62-89 describes two-gate architecture; only Gate 2 wired. Users hit $99.99 checkout on first sign-in, not $1 auth.
- **Recommended fix:** Either wire LoginScreen to `WHOP_AUTHORIZATION_PLAN_ID` for first pass, OR delete the unused constant + update docstring.
- **Confirmed / Suspected:** Confirmed — grep returns definition only, no consumer.

### BUG-A-006 · "Post to Whop marketplace" button silently hidden when `whop_company_id` is null
- **File:** `src/design-os/campaigns/CampaignPageShell.tsx`
- **Line/Function:** `238-252` (`canPostToWhop`, `handlePostToWhop`)
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** Gate is `tier.tier === "agency" && !!whopCompanyId`. Comment at 234-237 admits backend `MeSnapshot` doesn't populate the field. Agency user reaches screen with null `whop_company_id` → button never renders → no feedback, no "Connect your Whop company" prompt.
- **Why it matters:** LOCKED 2026-07-07 memo mandates Agency Earn tab must POST bounties. Silently gated on a backend field that likely isn't populated.
- **Recommended fix:** Always render the button; when null show "Connect your Whop company →" opening `openWhopAction(PAYOUT_SETTINGS)`. Also verify backend `/me` populates the column.
- **Confirmed / Suspected:** Client gate confirmed; backend suspect.

### BUG-A-007 · Agency "My campaigns" strip returns hardcoded empty list even when campaigns exist
- **File:** `src/design-os/routes/Campaigns.tsx`
- **Line/Function:** `61-131` (`AgencyManageStrip`), specifically `69` (`const items = []`)
- **Severity:** P0
- **Surface:** Agency
- **What is broken:** `items: [] = []` hardcoded. Inline comment admits backend doesn't expose `/me/campaigns` ownership filtering. Meanwhile sibling `AgencyCampaigns.tsx` DOES call `GET /agency/campaigns` (via `listMyCampaigns()` at `lib/agencyCampaigns.ts:214`).
- **Why it matters:** Agency user publishes a campaign in Campaign Builder → visits Campaigns tab → sees "You don't own any campaigns yet." Kills visible-earn-signal loop.
- **Recommended fix:** Replace hardcoded empty with `useAgencyMyCampaigns()` hook calling `listMyCampaigns()`. Map `CampaignBlock[]` → row shape.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-008 · SubmitToWhopModal posts every submission against hardcoded `preview-campaign` slug
- **File:** `src/design-os/components/SubmitToWhopModal.tsx`
- **Line/Function:** `47-51` (`FIXTURE_CAMPAIGN`), `166` (`campaign_id: FIXTURE_CAMPAIGN.slug`), `201` (`url: FIXTURE_CAMPAIGN.whopRewardUrl`)
- **Severity:** P0
- **Surface:** Agency
- **What is broken:** Module-level fixture `{ slug: "preview-campaign", label: "Preview campaign", whopRewardUrl: "https://whop.com/" }`. Every clip submitted POSTs `campaign_id: "preview-campaign"` to `/submissions`. "Open on Whop" button points at bare `https://whop.com/`.
- **Why it matters:** Primary route from finished clip → Whop content-reward submission is broken. Backend either 404s the fake slug or writes rows against a preview slug with no reward. Zero clippers can actually earn.
- **Recommended fix:** Wire `FIXTURE_CAMPAIGN` to the active campaign in `modeStore` (same `activeCampaignId` PublishModule uses at line 413). If no campaign active, disable submit + prompt.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-009 · SponsoredRewardModule pool remaining is hardcoded "$1M – $12,750 mock trickle"
- **File:** `src/design-os/earn/SponsoredRewardModule.tsx`
- **Line/Function:** `121-123` (`poolRemaining = SPONSORED_REWARD_POOL_NOTIONAL_USD - 12_750`)
- **Severity:** P1
- **Surface:** Agency (also clipper Earn)
- **What is broken:** Hardcoded subtraction; inline comment admits mock. No live wire to backend ledger sum.
- **Why it matters:** Pool appears "actively depleting" using a fake constant. Public trust break on screenshot.
- **Recommended fix:** Wire to real backend `/me/carrot` (or `/carrot/pool`), or delete meter until real data exists.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-010 · EarnRoute does not branch on `mode === "agency"` — Agency owners see clipper-personal view
- **File:** `src/design-os/routes/Earn.tsx`
- **Line/Function:** entire component (no `useMode` import)
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** Every widget renders identically for clipper and agency. No agency-scoped view (roster aggregated earnings, campaigns owned funded-vs-paidout, MRR from invited clippers).
- **Why it matters:** LOCKED 2026-07-07 memo requires "Agency Earn tab must READ Whop API + POST bounties." There's no agency-aggregation surface at all.
- **Recommended fix:** Add `mode === "agency"` branch in `EarnBody` swapping in `AgencyEarnDashboard` (roster roll-up + owned campaigns + Whop bounty POST CTA).
- **Confirmed / Suspected:** Confirmed.

### BUG-A-011 · Agency campaign create/patch silently falls through to in-memory mock on backend failure
- **File:** `src/design-os/engine/sidecar-stub.ts`
- **Line/Function:** `3678-3747` (`agencyCampaigns.create`, catch at `3701-3704`)
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** Every `agencyCampaigns.{create,patch,connectReward,publish,refreshReward}` wraps in `try { bridgeToBackend(...) } catch { /* fall through to mock */ }`. On any backend error, mock path silently succeeds with in-memory `cmpmock_<ts>` row.
- **Why it matters:** Campaign created during backend flake never persists but claims success. Refresh — gone.
- **Recommended fix:** Distinguish `BridgeError` from network-unreachable. Never silently mock on backend errors — surface toast + throw.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-012 · `useAgencyCampaignDraft` publish surface toasts success on mock rows
- **File:** `src/design-os/state/useAgencyCampaignDraft.ts`
- **Line/Function:** `46-55` (initialize), `97-117` (publish)
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** Hook calls `agencyCampaigns.create/patch/publish` (see BUG-A-011). Never checks whether returned block came from real backend or mock. `publish()` toasts "Published — is now live" at 105-109 on mock row.
- **Why it matters:** Compounds BUG-A-011: agencies see confetti + "Published" for campaigns that never left the browser.
- **Recommended fix:** Add `source: "real" | "mock"` field to returned block; fail publish action explicitly when source is mock and a real JWT is present.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-013 · AgencyPreviewBanner CTA opens account-app upgrade page instead of in-app InlineWhopCheckout
- **File:** `src/components/paywall/AgencyPreviewBanner.tsx`
- **Line/Function:** `122` (`billing.adapter.startCheckout("agency")` → `checkoutUrl` at `billing/adapter.ts:79-85`)
- **Severity:** P2
- **Surface:** Agency
- **What is broken:** `startCheckout("agency")` computes `https://account.liquidclips.app/upgrade?plan=agency` and opens via `openInApp`. LoginScreen already uses `WhopCheckoutEmbed` — banner path takes a different code path with its own catalog + copy.
- **Recommended fix:** Consolidate. Either open `InlineWhopCheckout` sheet with `planId={WHOP_FOUNDER_PLAN_ID}`, or ensure account-app upgrade page renders $99.99.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-014 · Free-tier 10-clip gate is client-side localStorage only — trivially bypassable
- **File:** `src/design-os/routes/WelcomeRoute.tsx`
- **Line/Function:** `75-192` (`LC_GUEST_CLIPS_REMAINING_KEY`, `readGuestClipsRemaining`, `decrementGuestClipsRemaining`, `isGuestQuotaExhausted`)
- **Severity:** P1
- **Surface:** Agency (LOCKED pricing pivot: "Free = 10 clips only")
- **What is broken:** Counter is `localStorage["lc:guest-clips-remaining"]`. `PublishModule.tsx:303` and `CampaignPageShell.tsx:260` decrement only when `tier.tier === "clipper"`. `localStorage.setItem("lc:guest-clips-remaining", "999")` = unlimited. Backend never checks.
- **Why it matters:** Entire pricing pivot rests on the 10-clip limit as the conversion trigger.
- **Recommended fix:** Move counter to backend `/me` snapshot (`guest_clips_remaining: number`). Client-side becomes display cache; export/publish API rejects when `<= 0`.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-015 · `?qa=1` URL param sticks and swaps checkout to $2 QA plan in production
- **File:** `src/lib/whopCheckout.ts`
- **Line/Function:** `118-168` (`LC_QA_MODE_KEY`, `initQaMode`, `resolveWhopFounderCheckoutUrl`)
- **Severity:** P2
- **Surface:** Agency (billing)
- **What is broken:** `initQaMode` reads `?qa=1` from any URL and stickies to `localStorage`. Sticky → `resolveWhopFounderCheckoutUrl()` returns the $2 QA test plan (`plan_kx90QwXvszCI7`) for every subsequent checkout — even in signed production. No build-time env check on URL path.
- **Why it matters:** Anyone with a `?qa=1` link activates a sub for $2 instead of $99.99. Revenue leak.
- **Recommended fix:** Gate `initQaMode` on `import.meta.env.MODE !== "production"` (or a `VITE_LIQUIDCLIPS_ALLOW_QA_URL` flag). Keep env-var path for QA workflows.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-016 · `sections/campaigns/CampaignsSection.tsx` is a dead preview surface still routed under `#/campaign`
- **File:** `src/sections/campaigns/CampaignsSection.tsx`
- **Line/Function:** entire file — `CreateCampaignModal` at 194
- **Severity:** P2
- **Surface:** Agency
- **What is broken:** Legacy section mounted at `#/campaign`. "Add to preview" modal writes local state only. Real Campaign Builder lives at Design-OS `campaign-builder`. Two surfaces coexist.
- **Recommended fix:** Delete section (and hash route) or redirect to `campaign-builder`.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-017 · Whop-marketplace bounty POST fires zero-gated — no ransom paywall per LOCKED memo
- **File:** `src/design-os/campaigns/CampaignPageShell.tsx`
- **Line/Function:** `241-252` (`handlePostToWhop`)
- **Severity:** P1
- **Surface:** Agency
- **What is broken:** LOCKED 2026-07-07 memo requires ransom paywall + first-bounty-free lever + 24h draft-abandonment email. `handlePostToWhop` fires `openWhopAction` immediately. No `bounty-post` trigger in `RansomTrigger` (`AssetRansomPaywall.tsx:32-38`).
- **Recommended fix:** Add `bounty-post-2` trigger; wire `handlePostToWhop` to check `firstBountyFreeConsumed` (backend field) + mount `AssetRansomPaywall` on 2nd attempt when tier below Agency.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-018 · Agency tier gate on `/agency/campaigns` publish relies on `adminOverride` OR-chain
- **File:** `src/design-os/routes/AgencyCampaigns.tsx`
- **Line/Function:** `85-88` (client gate), `176-178` (`writeAllowed`), `654-666` (`doPublish`)
- **Severity:** P2
- **Surface:** Agency
- **What is broken:** Client gate `hasCapability || tier === "agency" || tier.adminOverride`. Any debug-overridden tier can spoof. If backend doesn't equally strictly enforce agency-tier server-side, a free-tier with `admin_override=true` publishes as agency.
- **Recommended fix:** Verify `junior-backend/app/routes/agency_campaigns.py::_require_agency` rejects non-agency regardless of override. Remove `adminOverride` fallback on production builds.
- **Confirmed / Suspected:** Suspected (client confirmed; backend needs verify).

### BUG-A-019 · `WhopRewardCard` "copy rules" button emits `browse:open` — silent no-op with no listener
- **File:** `src/design-os/agency-creation/WhopRewardCard.tsx`
- **Line/Function:** `121` (`bus.emit("browse:open", ...)`)
- **Severity:** P2
- **Surface:** Agency
- **What is broken:** Unreachable/not-visible branch fires `browse:open`. If no subscriber is mounted, click silently no-ops.
- **Recommended fix:** Route through `openInApp(rewardUrl, { intent: "browse-campaign" })` which has an explicit fallback.
- **Confirmed / Suspected:** Confirmed.

### BUG-A-020 · Ransom paywall "earn-publish" copy repeats unimplemented "50% MRR" claim
- **File:** `src/components/paywall/AssetRansomPaywall.tsx`
- **Line/Function:** `61` (`COPY["earn-publish"].sub`)
- **Severity:** P2
- **Surface:** Agency
- **What is broken:** Copy: "50% MRR line stays yours." Same overpromise as BUG-A-003.
- **Recommended fix:** Pull the 50% MRR claim across ransom-paywall touchpoints.
- **Confirmed / Suspected:** Confirmed.

---

# Revenue Surface Bugs

### BUG-R-001 · Guest 10-clip cap enforced only client-side via localStorage
- **File:** `src/design-os/routes/WelcomeRoute.tsx` (write) · `src/design-os/engine/cockpit/PublishModule.tsx` (decrement)
- **Line/Function:** `WelcomeRoute.tsx:75,77` (`GUEST_CLIP_QUOTA = 10`); `PublishModule.tsx:303-305` (`decrementGuestClipsRemaining()`)
- **Severity:** P0
- **Surface:** Revenue
- **What is broken:** Client-only counter. Backend `junior-backend/app/routes/usage.py:50` still reads `STARTER_EXPORT_CAP = 100` while `app/features.py:47` says `clips_per_ip=10`. Backend serves 100 exports before its own paywall triggers, regardless of client counter.
- **Why it matters:** LOCKED 2026-07-06 pricing pivot depends on free=10-clips being a real wall.
- **Recommended fix:** Backend `usage.py:50` → drop `STARTER_EXPORT_CAP = 10` (or read `features.py`'s `clips_per_ip`). Add server-side check in `desktop.py` or a `/usage/consume` route the frontend calls PER export.
- **Confirmed / Suspected:** Confirmed (drift between features.py:47 and usage.py:50).

### BUG-R-002 · Cancel endpoint name `/me/trial/cancel` used for paid subs (naming drift)
- **File:** `src/sections/account/AccountSection.tsx`
- **Line/Function:** `97-101` (`bridgeToBackend("POST", "/me/trial/cancel", ...)`)
- **Severity:** P2
- **Surface:** Revenue
- **What is broken:** Endpoint name misleads — server code accepts trial or paid, but URL semantics suggest trial-only. MASTER_AUDIT claim 5 (toast-only fake cancel) is FIXED.
- **Recommended fix:** Rename to `/me/subscription/cancel` or accept naming with a comment.
- **Confirmed / Suspected:** Cosmetic drift.

### BUG-R-003 · Billing adapter checkout gets diverted to system browser by commerce filter (LOCKED persistent-cookie rule broken)
- **File:** `src/lib/billing/adapter.ts` + `src-tauri/src/browse.rs`
- **Line/Function:** `adapter.ts:76-84` (`ACCOUNT_APP_WHOP_UPGRADE = "https://account.liquidclips.app/upgrade"`) + `160` (`openInApp(checkoutUrl(planKey))`) → `browse.rs:124-136` (`BLOCKED_PATH_FRAGMENTS` includes `/upgrade` and `/checkout`)
- **Severity:** P1
- **Surface:** Revenue
- **What is broken:** `openInApp` sends URL to in-app BrowseOverlay. Rust commerce filter (`is_commerce_url`) diverts anything matching `/checkout|/pay|/billing|/upgrade|/subscribe|/purchase|/cart` to system browser. Billing adapter's checkout ALWAYS leaves the app.
- **Why it matters:** LOCKED 2026-07-07 memo: "$1 in-app · persistent-cookie webview, never leave app." Every `PaywallGate` upgrade CTA (default without `onUpgrade` prop) jumps out to Safari.
- **Recommended fix:** Retire account-app checkout URL flow. Use `<InlineWhopCheckout planId={...}>` mounted in modal from `PaywallGate.fireUpgrade` (matches ActivateFounderPanel pattern). Or use `openWhopFounderCheckout` (uses `openSmart`/native opener) to skip the commerce-filter double-hop.
- **Confirmed / Suspected:** Confirmed.

### BUG-R-004 · WelcomeRoute Gate 1 ($1 auth checkout) has no automatic activation — user told to check email
- **File:** `src/design-os/routes/WelcomeRoute.tsx`
- **Line/Function:** `569-587` (`onWhopCheckoutComplete`) with plan at `604-608` (`WHOP_AUTHORIZATION_PLAN_ID`, $1 one_time)
- **Severity:** P0
- **Surface:** Revenue
- **What is broken:** After the $1 InlineWhopCheckout iframe fires `onComplete`, frontend sets error asking user to check email for a sign-in ID and paste into "Have a discount code?" input. `/desktop/connect-from-checkout` backend requires `x-internal-secret` and can't be called from client (comment acknowledges). No `liquidclips://` deep link fires for $1 plan — that redirect only exists for FOUNDER_PLAN_IDS at `whop_checkout_success.py:171`.
- **Why it matters:** This is the primary sign-in flow per LOCKED 2026-07-06 pricing pivot. Funnels every free user through a 5-15 minute Resend email round-trip.
- **Recommended fix:** Add `WHOP_AUTHORIZATION_PLAN_IDS` handler in `whop_checkout_success.py` that mints `tier="free"` JWT via `apply_membership_tier` and 302s to `liquidclips://activate?token=<jwt>&source=whop-checkout`. Or add a public sibling of `/desktop/connect-from-checkout` that verifies receipt directly against Whop API.
- **Confirmed / Suspected:** Confirmed.

### BUG-R-005 · Founder-seat cap admin alert email hardcodes stale "2000"
- **File:** `junior-backend/app/routes/webhooks_whop.py`
- **Line/Function:** `972` (`note=f"founder seat #{_seat_count(db)} of 2000"`)
- **Severity:** P2
- **Surface:** Revenue
- **What is broken:** Admin alert hardcodes `"of 2000"` while `founder.py:50` sets `MAX_FOUNDER_SEATS = 12_000` (fixed elsewhere at line 943 using `MAX_FOUNDER_SEATS:,`).
- **Why it matters:** Admin visibility drift — Daniel's alert reports wrong denominator.
- **Recommended fix:** Replace `2000` with `{MAX_FOUNDER_SEATS:,}` using the import already present at line 935.
- **Confirmed / Suspected:** Confirmed.

### BUG-R-006 · `connect-from-checkout` skips `apply_membership_tier` when no pending row exists
- **File:** `junior-backend/app/routes/desktop.py`
- **Line/Function:** `194-276` (`connect_from_checkout`), specifically `258-269` when `pending is None`
- **Severity:** P1
- **Surface:** Revenue
- **What is broken:** When `PendingWhopMembership` isn't found (webhook race, cold email path, direct call), endpoint issues raw `issue_license_jwt` + `License` insert. Mirrors claim 1 & 8 already-closed defects — commission override, welcome email, admin alert, paid_until, analytics events all skipped.
- **Why it matters:** Third mint path still ships tokens without side-effects. Same class of bug flagged twice already.
- **Recommended fix:** Replace lines 262-269 with a single `apply_membership_tier(db, user, tier=effective_tier, founder=effective_founder, ...)` call matching `auth_whop.py:422` and `whop_checkout_success.py:208`.
- **Confirmed / Suspected:** Confirmed.

### BUG-R-007 · `connect-from-checkout` admin-founder bypass at `desktop.py:260`
- **File:** `junior-backend/app/routes/desktop.py`
- **Line/Function:** `260` (`effective_founder = True if is_admin else user.founder_flag`)
- **Severity:** P2
- **Surface:** Revenue
- **What is broken:** Similar shape to original claim 3. Current code is more constrained (admin → founder, everyone else → DB row) so it doesn't grant founder tier to non-admins. But never validates the caller passes a Founder plan; admin minting through this route auto-flips founder even for other tiers.
- **Why it matters:** Contract-lint; would become a hazard if internal ops onboarding is added.
- **Recommended fix:** Gate founder flag on plan id + seat cap same way `whop_checkout_success.py:171-193` does.
- **Confirmed / Suspected:** Confirmed (partial repro).

---

# Auth Surface Bugs

### BUG-AU-001 · `notifyAuthFailure` clears JWT but doesn't emit `auth:signed-out` bus event
- **File:** `src/lib/activation.ts`
- **Line/Function:** `335-352` (`notifyAuthFailure`)
- **Severity:** P1
- **Surface:** Auth
- **What is broken:** Backend 401/403 self-heal calls `clearJwt()` + `clearActivation()` but never `bus.emit("auth:signed-out", {})`. TopHud, MembershipGate, App.tsx AuthGate, Settings all subscribe to `auth:signed-out` to swap chrome. None get notified of mid-session token invalidation.
- **Why it matters:** MASTER_AUDIT claim 9 fixed for explicit sign-out click (TopHud:225-230). Passive token death revives the "stale Sign-in pill" and "still-mounted MembershipGate" symptoms.
- **Recommended fix:** Emit `auth:signed-out` inside `notifyAuthFailure` right after `emit({ status: "failed" })`. Use same lazy-import pattern already used at `activation.ts:518-522` for `activation:complete`.
- **Confirmed / Suspected:** Confirmed.

### BUG-AU-002 · Cold-boot Keychain resume can re-populate JWT after sign-out on some paths
- **File:** `src/lib/authStorage.ts` + `src/design-os/components/TopHud.tsx`
- **Line/Function:** `TopHud.tsx:257-280` (`doSignOut`), `authStorage.ts:137-166`
- **Severity:** P2
- **Surface:** Auth
- **What is broken:** `doSignOut` calls `clearJwtKeychainForAuthAction()` as fire-and-forget (`void`). If invoke rejects (permission denied, keychain busy), keychain survives while localStorage was cleared. Next cold boot `resumeJwtFromKeychainForAuthAction` re-hydrates stale JWT.
- **Recommended fix:** Await keychain clear before setting `hasJwt(false)` and toasting. If invoke rejects, surface error toast (do NOT lie about being signed out).
- **Confirmed / Suspected:** Confirmed.

### BUG-AU-003 · `notifyAuthFailure` dampener never resets on explicit sign-out
- **File:** `src/lib/activation.ts`
- **Line/Function:** `291-360` (`authDampenerFired`, `resetAuthDampener`)
- **Severity:** P2
- **Surface:** Auth
- **What is broken:** `authDampenerFired` reset only by `beginActivation()` and `clearActivation()`. User signing back in via cold-lead LC-ID paste (Settings input, not deep-link) will hit subsequent 401 with NO self-heal because the dampener is still armed.
- **Recommended fix:** Reset dampener inside `setJwt()` — any successful token write should re-arm self-heal.
- **Confirmed / Suspected:** Confirmed.

### BUG-AU-004 · Challenge mismatch on OAuth `whop` path if user quits desktop after clicking Sign in
- **File:** `src/lib/activation.ts`
- **Line/Function:** `87` (`PENDING_CHALLENGE_STORAGE_KEY` in `sessionStorage`), `389-398` (`bypassChallenge` gate)
- **Severity:** P1
- **Surface:** Auth
- **What is broken:** `pendingChallenge` lives in `sessionStorage` (cleared on Tauri window close). User clicks Sign in → quits app → OAuth completes → OS deep-link fires → `readPendingChallenge` returns null → "Activation challenge mismatch · re-start sign in."
- **Recommended fix:** Persist `pendingChallenge` in `localStorage` with explicit TTL matching `ACTIVATION_TIMEOUT_MS`. Trade-off documented.
- **Confirmed / Suspected:** Confirmed.

### BUG-AU-005 · `parseActivationUrl` accepts `challenge=null` for spoofable `source=whop-checkout`
- **File:** `src/lib/activation.ts`
- **Line/Function:** `65-67`, `230`
- **Severity:** P2
- **Surface:** Auth
- **What is broken:** `TRUSTED_CHALLENGELESS_SOURCES = { "whop-checkout" }`. Any deep-link URL can spoof `?source=whop-checkout` to skip challenge. Backend Ed25519 signature + 30-day expiry are the real defense — but a MITM'd valid JWT can be replayed within 30 days.
- **Recommended fix:** Require frontend to have set a boot-time flag (60s window after a Whop checkout was opened) before accepting challengeless activation. Or shorten Ed25519 JWT expiry to 24h for `whop-checkout` mints.
- **Confirmed / Suspected:** Suspected (defense-in-depth gap; JWT signature is primary gate).

### BUG-AU-006 · Deep-link double-route dedupe uses 10s window that drops legitimate retries
- **File:** `src/lib/deepLinkBoot.ts`
- **Line/Function:** `45-46,78-83`
- **Severity:** P2
- **Surface:** Auth
- **What is broken:** `RECENT_URL_TTL_MS = 10_000` dedupes deep-links. User's activation fails → immediately re-opens same URL → silently swallowed for 10s. No user signal.
- **Recommended fix:** Shorten TTL to ~2s OR reset dedupe entry when `handleActivationUrl` sets status to "failed".
- **Confirmed / Suspected:** Confirmed.

### BUG-AU-007 · `hasJwtKeychainPresence` guard never enforced in front of `resumeJwtFromKeychainForAuthAction`
- **File:** `src/lib/authStorage.ts`
- **Line/Function:** `137-166`
- **Severity:** P2
- **Surface:** Auth
- **What is broken:** Presence-file scheme was designed to skip macOS Keychain access prompts when JWT is known absent. Nothing checks `hasJwtKeychainPresence` before calling `resume…()` — any surface using it triggers the OS prompt even when presence file says false.
- **Recommended fix:** Move presence check inside the function so it's impossible to forget.
- **Confirmed / Suspected:** Confirmed.

---

# Runtime Surface Bugs

### BUG-RT-001 · PyInstaller sidecar bundle NOT in Tauri resources — production sidecar cannot spawn
- **File:** `src-tauri/tauri.conf.json`
- **Line/Function:** `bundle.resources` (52-66)
- **Severity:** P0
- **Surface:** Runtime
- **What is broken:** `resources[]` ships `python-sidecar/sidecar.py`, `requirements.txt`, `bin/{ffmpeg,ffprobe,junior-face-detect}`, models, assets — but does NOT include `python-sidecar/dist/sidecar-bundle/**` (the PyInstaller `--onedir` output containing the runnable `liquid-clips-sidecar` binary + `_internal/` with cv2 haarcascades, faster-whisper, ctranslate2). `sidecar.rs::find_sidecar_binding` (591-627) treats `Bundled { binary: <script_dir>/dist/sidecar-bundle/liquid-clips-sidecar }` as the ONLY production path — release builds cannot fall back to Dev. `strip-xattrs.sh:7` acknowledges: "Slimmed for desktop-2 · NO Python sidecar yet · re-add sidecar paths when one lands."
- **Why it matters:** Every installed customer's engine call hits `SidecarState not managed → mock`. Real ingest / transcribe / clip / thumbnail flows silently degrade to fake progress with no output.
- **Recommended fix:** Add `"../../python-sidecar/dist/sidecar-bundle/**/*"` to `bundle.resources` (or migrate to Tauri's `externalBin` with per-triple naming). Update `strip-xattrs.sh` to walk that tree pre-codesign. Verify `find_sidecar_binding` resolves the Bundled path from `<resource_dir>/{_up_/,}python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar`.
- **Confirmed / Suspected:** Confirmed — PyInstaller bundle exists on dev disk at `/Users/dipdip/code/jnr/python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar` (with cv2 XMLs); no `dist/` string appears in `tauri.conf.json`. `strip-xattrs.sh:7` marker comment is the smoking gun.

### BUG-RT-002 · Hardened-runtime entitlements missing library-validation + unsigned-memory relaxations
- **File:** `src-tauri/entitlements-direct.plist`
- **Line/Function:** commented-out blocks 22-27, 38-41, 43-47
- **Severity:** P0
- **Surface:** Runtime
- **What is broken:** Active entitlements are only `com.apple.security.cs.allow-jit` + `com.apple.security.network.client`. Comments say "IF/when a Python sidecar lands (numpy / faster-whisper / opencv), uncomment the two commented-out flags." But `sidecar.rs` + `lib.rs` already spawn the sidecar. Without `com.apple.security.cs.allow-unsigned-executable-memory` and `com.apple.security.cs.disable-library-validation`, macOS 12+ hardened runtime SIGKILLs the process on first dyld load (see BUG-016b in `docs/BUGS_ERRORS_FIXES.md`).
- **Why it matters:** Even if BUG-RT-001 is fixed, first-launch of any hardened + notarised release SIGKILLs the sidecar when it loads numpy `.so` or runs JIT inside faster-whisper's ctranslate2. Every customer sees "engine crashed" on cold open.
- **Recommended fix:** Uncomment the two `allow-unsigned-executable-memory` + `disable-library-validation` blocks.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-003 · Cargo.toml version drift — panic hook reports "2.2.31" while shipped app is "2.2.35"
- **File:** `src-tauri/Cargo.toml`
- **Line/Function:** `[package] version = "2.2.31"` line 3
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** `package.json:4` + `tauri.conf.json:4` are `2.2.35`; Cargo.toml is `2.2.31`. Panic hook writes `env!("CARGO_PKG_VERSION")` (`lib.rs:302`, `runtime.rs:198,265,275`) into `~/LiquidClips/.last-crash.json`, into runtime user-agent, and into sidecar startup log. Every crash report says "2.2.31". `scripts/bump_patch.sh` only bumps package.json + tauri.conf.json.
- **Recommended fix:** Extend `bump_patch.sh` to sed Cargo.toml `[package] version`. Bump to 2.2.35 now.
- **Confirmed / Suspected:** Confirmed. Ship-lens v2.2.35 explicitly flagged this as P3-F01.

### BUG-RT-004 · Runtime updater has no rollback / version-freshness protection — signed downgrade attack
- **File:** `src-tauri/src/runtime.rs`
- **Line/Function:** `check_and_stage_runtime` line 334
- **Severity:** P1
- **Surface:** Runtime
- **What is broken:** After minisign + sha256 verification, only version check is `if manifest.version == current_version { return already-active }`. No semver comparison — a validly-signed but LOWER version manifest will stage over current live bundle. `current.json` overwritten unconditionally. `bundles/<v>/` for old version wiped (line 463) before the atomic rename. No way back.
- **Why it matters:** A leaked+signed old tarball (say v2.1.0) becomes permanent regression vector for every install hitting the manifest URL.
- **Recommended fix:** Parse `manifest.version` + `current_version` as semver, refuse to stage if `manifest_version <= current_version` (unless a signed `force_downgrade: true` flag). Keep previous `bundles/<v>/` until new bundle boots successfully at least once (rolling N-1 retention).
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-005 · Runtime `Access-Control-Allow-Origin: *` on `runtime://` scheme handler
- **File:** `src-tauri/src/lib.rs`
- **Line/Function:** `register_uri_scheme_protocol("runtime", …)` line 453
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Runtime:// scheme handler unconditionally sets `Access-Control-Allow-Origin: *`. Combined with runtime bundle serving JS from local filesystem, widens trust surface.
- **Recommended fix:** Drop the header entirely (same-origin already works) or restrict to `runtime://` explicitly.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-006 · Production CSP `connect-src` includes `http://localhost:8000` — dev cruft leaks to release build
- **File:** `src-tauri/tauri.conf.json`
- **Line/Function:** `app.security.csp` line 28
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Release CSP allows XHR/fetch to `http://localhost:8000`. Shipped app should never dial plain-HTTP local server. Entry belongs in `tauri.dev.conf.json`, not prod.
- **Recommended fix:** Move `http://localhost:8000` to `tauri.dev.conf.json`; strip from `tauri.conf.json`.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-007 · `runtime.rs` ManifestEnvelope fields `channel`, `notes`, `pub_date` never read
- **File:** `src-tauri/src/runtime.rs`
- **Line/Function:** `struct ManifestEnvelope` fields at lines 221, 226, 228
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** `cargo check` emits `warning: fields 'channel', 'notes', and 'pub_date' are never read`. `channel` in particular is important — client hardcodes `const CHANNEL = "stable"` but never verifies the manifest's response matched.
- **Recommended fix:** Wire these fields: verify `channel == CHANNEL`, use `pub_date` as freshness guard, surface `notes` in Settings. Or `#[allow(dead_code)]` with documented reason.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-008 · `browse.rs on_navigation` spawns unbounded async task per navigation event
- **File:** `src-tauri/src/browse.rs`
- **Line/Function:** `open_browse_panel::on_navigation` lines 212-222
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Every navigation fires `tauri::async_runtime::spawn(async move { let _ = app.opener().open_url(target) })`. No rate limit / dedup. Malicious loop `location.href='/checkout?…'` = dozens of Safari tabs. Errors silently discarded.
- **Recommended fix:** Rate-limit via `AtomicBool` "commerce_redirect_in_flight" guard; log open_url failures.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-009 · `.expect("error while running Liquid Clips shell")` on Tauri run — bare panic on startup failure
- **File:** `src-tauri/src/lib.rs`
- **Line/Function:** `.run(tauri::generate_context!()).expect(…)` line 640
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** If `Builder::run` returns error (plugin init, context corruption, capabilities parse fail), app dies via `.expect`. Hardened runtime + `panic = "abort"` = instant process kill. No user-facing "shell failed to boot" dialog.
- **Recommended fix:** Match on `Err(e)` — call native NSAlert / MessageBoxW / `rfd::MessageDialog` before exiting. Write distinct `.last-boot-failure.json` so diagnostics knows this vs runtime panic.
- **Confirmed / Suspected:** Suspected (no test exercises this branch).

### BUG-RT-010 · `resolve_panel_or_crash` fires `browse:crashed` event storm on repeated calls
- **File:** `src-tauri/src/browse.rs`
- **Line/Function:** `resolve_panel_or_crash` 98-106 + `browse_health_check` 315
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Every failed panel lookup emits `browse:crashed`. React window-resize typically re-fires `update_browse_panel_bounds` at 60Hz. If panel actually crashed, every resize = 60 crash notifications per second until layout code stops calling. No debounce.
- **Recommended fix:** `HAS_EMITTED_CRASH: AtomicBool` gated by debounce or "one emission per panel lifecycle". Reset when `open_browse_panel` succeeds.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-011 · Sidecar exhaustion is one-way — `sidecar_repair` doesn't reset restart cap
- **File:** `src-tauri/src/sidecar.rs`
- **Line/Function:** `SIDECAR_RESTART_CAP: u32 = 3` line 46 + `exhausted.store(true, Ordering::Release)` 505, 525, 528
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Once sidecar hits 3 consecutive respawn failures, `exhausted` is set for lifetime of app session. Every subsequent `call()` short-circuits with `sidecar_exhausted`. `sidecar_repair` (lib.rs:242) only clears cache dirs — does NOT reset `exhausted`, does NOT rebind SidecarState, does NOT try to respawn. "Repair" button is a no-op for the actual crash surface.
- **Recommended fix:** Make `sidecar_repair` reset `exhausted = false`, reset `restart_count = 0`, trigger fresh `SidecarState::spawn`.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-012 · Cold-boot window: `sidecar_call` returns `state not managed` — mock stub is the only fallback
- **File:** `src-tauri/src/lib.rs`
- **Line/Function:** setup closure 511-610, `sidecar_call` 190
- **Severity:** P1
- **Surface:** Runtime
- **What is broken:** 2026-07-07 cold-start latency fix moved `SidecarState::spawn` into `async_runtime::spawn` inside setup. During the ~1-5s interval between webview mount and `app.manage(state)` firing, every `sidecar_call` returns Tauri's not-managed error. Frontend `isSidecarUnavailable` discriminator catches and falls back to MOCK stub (`sidecar-stub.ts:130`). No "sidecar booting" state emitted.
- **Why it matters:** Real user action (paste URL into Create) during first 1-5s of boot gets fake mock progress instead of real ingest. Customer sees fake completion, thinks app is broken.
- **Recommended fix:** Emit `sidecar:booting` Tauri event synchronously in setup before the spawn task; emit `sidecar:ready` when `app.manage(state)` lands. Frontend gates Create panel behind ready. Alternative: `sidecar_call` blocks briefly (~3s) waiting for state before erroring.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-013 · Runtime staging deletes prior version before new one verified bootable
- **File:** `src-tauri/src/runtime.rs`
- **Line/Function:** `check_and_stage_runtime` 463-464
- **Severity:** P1
- **Surface:** Runtime
- **What is broken:** `let _ = fs::remove_dir_all(&final_dir); fs::rename(&staging_dir, &final_dir)?;` blows away existing bundle before rename. Pointer at `current.json` written UNCONDITIONALLY at 476 even though new bundle never booted. First boot could hit missing/corrupt index.html — no fallback to previous bundle (deleted).
- **Recommended fix:** Retain N-1 previous version until at least one successful post-boot self-check ("boot verified" marker file after HardUpdateGate settles or user reaches home). Revert pointer to N-1 if self-check missing after 2 attempts.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-014 · Runtime manifest fetch has no auth — anyone can enumerate desktop versions
- **File:** `src-tauri/src/runtime.rs`
- **Line/Function:** `MANIFEST_URL` line 45
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** GET to `https://api.liquidclips.app/runtime/manifest.json?channel=…&current_version=…` is unauth'd. Public info leak. Combined with BUG-RT-004 = downgrade-attack recon channel.
- **Recommended fix:** Optionally gate manifest response behind per-install token. Low priority alone.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-015 · `openai_key_set` / `secret_set_jwt` presence-file can drift from Keychain on write failure
- **File:** `src-tauri/src/lib.rs`
- **Line/Function:** `openai_key_set` 129-138, `secret_set_jwt` 160-168
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** `entry.set_password(trimmed)?` writes Keychain. If subsequent `write_secret_presence(…, true)` fails (disk full, permission), Keychain has secret but presence.json says false. Frontend re-prompts even though key stored.
- **Recommended fix:** Two-phase: write presence first as tentative, then commit. Or boot-time reconciliation from actual keychain probes.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-016 · `bundled_dist_dir` fallback to `resource_dir.clone()` — path-traversal-adjacent
- **File:** `src-tauri/src/runtime.rs`
- **Line/Function:** `bundled_dist_dir` line 108
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Candidates array ends with `resource_dir.clone()`. If none of `_up_/dist`, `_up_/_up_/dist`, `dist` contains `index.html`, resolver returns raw Resources/ dir. Any stray `index.html` there = treated as runtime root. Combined with wildcard CORS (BUG-RT-005), compromised webview could exfiltrate arbitrary Resources/.
- **Recommended fix:** Drop `resource_dir.clone()` fallback. Return None if no explicit dist candidate matches.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-017 · `serve_runtime_uri` canonicalisation falls through to `full_path` on error
- **File:** `src-tauri/src/runtime.rs`
- **Line/Function:** `serve_runtime_uri` 534-546
- **Severity:** P1
- **Surface:** Runtime
- **What is broken:** Path-traversal guard: `match (full_path.canonicalize(), root.canonicalize()) { (Ok(fp), Ok(r)) => …, _ => full_path }`. If canonicalize errors, code proceeds with UN-canonicalized `full_path` — meaning `runtime://app/../../etc/passwd` may resolve outside root. Comment says "refuse anything that escapes root" but fallback silently un-refuses.
- **Recommended fix:** On canonicalize failure, treat as 404 unless missing-file case proved (check `.exists()` first, canonicalize parent). Never fall through to un-canonicalized path for read.
- **Confirmed / Suspected:** Confirmed.

### BUG-RT-018 · Runtime background staging panics propagate silently out of `async_runtime::spawn`
- **File:** `src-tauri/src/lib.rs`
- **Line/Function:** `runtime::check_and_stage_runtime` spawn line 480
- **Severity:** P2
- **Surface:** Runtime
- **What is broken:** Staging task fired via `tauri::async_runtime::spawn` in setup. Any panic in `check_and_stage_runtime` (reqwest failures, serde_json parse) does NOT surface to frontend, does NOT write `.last-crash.json`. Only shows up via `eprintln!` on outer catch.
- **Recommended fix:** Wrap spawn body in `std::panic::catch_unwind` (or use `tokio::spawn` + explicit `JoinHandle`) and route panics through `write_last_check` as "panic: {message}" so Settings surfaces them.
- **Confirmed / Suspected:** Suspected.

**Positive findings (verified healthy):**
- Sidecar restart cap + structured error envelope + `sidecar:restarted` / `sidecar:died` event surface well-designed.
- browse.rs commerce-URL filter passes App Store 3.1.1 test coverage.
- `identity_stash::stash_upload` has sound sanitization + size cap + defense-in-depth path check.
- `HardUpdateGate.tsx` handles Tauri absence, transient errors, demo-mode overrides correctly. IntroSplash timer is 25s ceiling + video.onEnded (not 28.5s — memory note out of date).
- `capabilities/default.json` is minimal; no `fs:allow-all` or `shell:allow-execute`.
- BUG-016 (haarcascade) closed at packaging level — `build_sidecar.sh:149 --collect-data cv2` collects XML files. Verified present in `python-sidecar/dist/sidecar-bundle/_internal/cv2/data/haarcascade_*.xml`.

---

# Operator Surface Bugs & Journey Map State

### Journey Map wire state (from `account-app/src/components/admin/JourneyMapTab.tsx`, 2026-07-08)

| Status | Count | Notes |
|---|---|---|
| Wired | 55 | Every wired row has grep-able file:line citation |
| Demo | 15 | Fake/mocked/half-wired flows; UI still renders |
| Missing | 10 | No endpoint or component |
| **Total** | **80** | 4 clusters: identity(12) · pipeline(19) · money(20) · agency(29) |
| Cohort 0 blockers | 1 | `mo-13` Withdraw (env-gated OFF) |

**Wire percentage is actually 69%, not 76%** — memory in `liquid_clips_wire_checklist.md` is stale. See BUG-O-008.

### Unwired journeys with customer-visible impact

| Journey | Surface | File | Blocker | Severity |
|---|---|---|---|---|
| id-11 · Offline license verify | Boot / cold-start | `src/lib/intro.ts` | Ed25519 pubkey bundled at build; single-device only, silent for user | P2 |
| cp-15 · Import via in-app browser | Browse tab | `src/sections/browse/BrowseSection.tsx:14` | Webview works but no auto-capture path — core "workbench browser" pitch unwired end-to-end | P1 |
| cp-16 · Overlay templates → MP4 bake | Editor | `src/design-os/studio/OverlayTemplateGallery.tsx:46` | 5 templates selectable; bake into export deferred | P1 |
| cp-17 · Export retry (UI) | Export | `sidecar.py:4940` | History readable; no retry affordance in drawer | P2 |
| cp-18 · Batch export | Editor / Export | not implemented | Post-Cohort 0 | P2 |
| cp-19 · Watch-folder import | Home | not implemented | No listener process | P2 |
| **mo-07 · Ayrshare Profile-Key paste** | Settings → Connections | `junior-backend/app/routes/social.py:191` | Surface still ships but rail DEPRECATED 2026-07-05. User paste does nothing. | **P0** |
| **mo-13 · Withdraw button** | Wallet / Earn | `junior-backend/app/carrot.py:80` | `CARROT_WHOP_LIVE` env-gated OFF; button hidden. Single Cohort 0 blocker per Journey Map. | **P0** |
| **mo-14 · Stripe Connect Express** | Settings → Payouts | `src/design-os/routes/Settings.tsx:1012-1040` | Backend `/stripe-connect/onboarding` alive; desktop CTA renders "Connection status not checked yet" + "coming soon" — **no `/stripe-connect/onboarding` call fires from any button**. | **P0** |
| mo-16 · Sponsored campaign submission | Campaigns | `src/design-os/campaigns/CampaignPageShell.tsx` | Opens Whop URL + polls; round-trip receipt not fully cited | P1 |
| mo-20 · Boost pack ($9 thumbnail) | Editor / Thumbnail | no `/boost-pack` route | Post-Cohort 0 | P2 |
| ag-18 · Community chat panel | Community | `junior-backend/app/agents/whop_chat.py` + `CommunityChatHome.tsx` | `WHOP_AGENT_ENABLED=false`. UI renders, send is dark. | P1 |
| ag-19 · Community post message | Community | same | Same wire as ag-18 | P1 |
| ag-20 · Notifications inbox UI | Inbox sheet | `src/shell/InboxSheet.tsx` + `/notifications` | `GET /notifications` works; InboxSheet reads local store — half-wired | P1 |
| ag-21 · Announcements | Announcement banner | `src/design-os/components/AnnouncementBanner.tsx` | Model+banner exist; inbound OK, no admin-post from LC | P2 |
| ag-22 · Agency dashboard analytics | Agency page | `account-app/src/app/agency/page.tsx:52` | Campaign list only; no unified analytics/payout dashboard | P1 |
| ag-23 · Agency-preview gate | Home / Agency | `src/components/paywall/AgencyPreviewBanner.tsx` | Banner exists; upgrade path inconsistent | P1 |
| ag-24 · Boost pack purchase gate | Schedule drawer | `src/design-os/schedule/ScheduleFromExportDrawer.tsx:338` | Dedicated boost-pack SKU missing; renders "upgrade-to-next-tier" CTA instead | P1 |
| ag-25 · Agency custom watermark | Settings / Studio | no upload route; `sidecar.py:4793` hardcoded | Agencies pay for tier and cannot brand exports | P1 |
| ag-26 · White-label domain | (not built) | — | Post-Cohort 0 | P2 |
| ag-27 · Roster-scoped analytics | Agency dashboard | no endpoint | Post-Cohort 0 | P2 |
| ag-28 · Sub-account management | Agency dashboard | `FEATURES_BY_TIER.sub_accounts` flag exists, no UI/endpoint | Backend flag ready; no wire | P2 |

### BUG-O-001 · Diagnostics renders fixture data + literal "skeleton" copy
- **File:** `src/sections/diagnostics/DiagnosticsSection.tsx`
- **Line/Function:** 6-11 (imports), 36, 80, 134-138 (renders `fakeBackendStatus.url`, `fakeSidecarStatus.note`, "Ayrshare not wired in shell")
- **Severity:** P0
- **Surface:** Operator
- **What is broken:** Imports 4 `fake*` symbols from `fixtures/fakeDiagnostics.preview.ts` + renders "skeleton" heading + hardcoded Ayrshare line.
- **Why it matters:** Any user deep-linking `#diagnostics` (route `diagnostics` in `sectionRegistry.ts:126`) sees dev-language copy + fixture data. Copy-report button pastes fake fixture events into support tickets.
- **Recommended fix:** Delete 4 fixture imports + "skeleton" card. Wire to real `healthCheck.ts` probes. Delete Ayrshare line entirely (see mo-07 / BUG-O-004).
- **Confirmed / Suspected:** Confirmed.

### BUG-O-002 · Health probes are hardcoded skeleton strings (`realProbe: false`)
- **File:** `src/lib/healthCheck.ts`
- **Line/Function:** `runHealthCheck()` 17-62; rows `sidecar.handshake` (26-32), `backend.ping` (33-39), `social.status` (40-46) all return `status: "warning"`, `detail: "Skeleton — no probe wired yet."`, `realProbe: false`.
- **Severity:** P0
- **Surface:** Operator
- **What is broken:** 3 of 6 health probes are literals. `rollUp()` returns `"warning"` on every mount. Copy-report writes `[warning] Python sidecar · Skeleton — no probe wired yet (real: false)` to clipboard.
- **Why it matters:** Support cannot distinguish "sidecar down" from "we never probed it." Operator triage neutered.
- **Recommended fix:** Wire `sidecar.handshake` → `sidecarStub.ping()`, `backend.ping` → `/health` on `api.liquidclips.app`. Delete/repurpose `social.status` (Ayrshare pulled).
- **Confirmed / Suspected:** Confirmed.

### BUG-O-003 · Stripe Connect surface renders dev-language + zero-wire CTAs
- **File:** `src/design-os/routes/Settings.tsx`
- **Line/Function:** 1007-1040 (Stripe Connect block); 970 "not checked yet"; 1145 comment "Native billing · coming soon"
- **Severity:** P0
- **Surface:** Operator + Customer (Settings → Payouts)
- **What is broken:** Provider row hardcodes "Connection status not checked yet" (1016) + "Reserved for native Liquid Clips payout rails · coming soon" (1021). Only CTA opens `whop.com/dashboard/`. No call to `/stripe-connect/onboarding` or `/stripe-connect/me` fires. Comment at 1007-1011 admits: `"DB has stripe_connect_* columns on User but /me doesn't expose them today · /stripe-connect/me endpoint exists but desktop-2 doesn't read it in v1."`
- **Why it matters:** Journey mo-14 is customer-facing on a monetary surface. Agency-tier users wanting native payouts see dev-language and cannot connect.
- **Recommended fix:** Wire `/stripe-connect/onboarding` behind CTA + poll `/stripe-connect/me` for status. Or remove the row until wired.
- **Confirmed / Suspected:** Confirmed.

### BUG-O-004 · Ayrshare provider row still rendered in Settings despite rail being pulled
- **File:** `src/design-os/routes/Settings.tsx` (Connections tab, id-06 wire) + `src/sections/diagnostics/DiagnosticsSection.tsx:138`
- **Severity:** P0
- **Surface:** Operator (Diagnostics) + Customer (Settings → Connections)
- **What is broken:** JourneyMapTab mo-07 note: "Surface still exists in code but Ayrshare rail is pulled 2026-07-05. Walk-around replaces this entirely. Remove in cleanup sprint." Diagnostics social skeleton line still says `"social → Ayrshare key not wired in shell."` Settings still renders Ayrshare connect row.
- **Why it matters:** Publish walk-around (mo-01/02/03/04) is real rail. Users pasting Ayrshare Profile-Key see nothing happen.
- **Recommended fix:** Delete Ayrshare Profile-Key paste UI from Settings Connections tab; delete `"social → Ayrshare..."` line from DiagnosticsSection.tsx:138; delete corresponding social provider from sidecar-stub connect path.
- **Confirmed / Suspected:** Confirmed for Diagnostics line 138; Settings connections list corroborated by mo-07 note.

### BUG-O-005 · Journey Map "Waiting on Daniel" strip advertises stale actions
- **File:** `account-app/src/components/admin/JourneyMapTab.tsx`
- **Line/Function:** 219-241
- **Severity:** P1
- **Surface:** Operator (Admin HQ Journey Map)
- **What is broken:** Strip claims "code side is done · session closed 2026-07-05" with 2 actions. But 12 demo rows + 10 missing rows still exist in the same dataset. Live surfaces (BUG-O-001, BUG-O-003, BUG-O-004) contradict the claim. Header sub-copy `"Cohort 0 blockers cleared"` conflicts with `mo-13 blocker: true` on line 83.
- **Why it matters:** This tab is primary state-of-truth per memory. If Daniel reads "code side is done" he skips wire audit — exactly the drift the memory rule prevents.
- **Recommended fix:** Reconcile "cleared" copy with `blocker: true` flag on mo-13. Either flip flag or drop copy.
- **Confirmed / Suspected:** Confirmed by internal contradiction.

### BUG-O-006 · Journey Map file citations reference legacy `desktop/` paths in MASTER_AUDIT
- **File:** `account-app/src/components/admin/JourneyMapTab.tsx` (correctly uses `desktop-2/`) + `desktop-2/docs/MASTER_AUDIT_2026-07-05.md` (uses `desktop/`)
- **Severity:** P2
- **Surface:** Operator (audit/reporting)
- **What is broken:** MASTER_AUDIT paths like `desktop/src/sections/diagnostics/DiagnosticsSection.tsx:78-79` — that repo is `desktop-2/` per LOCKED memory. Anyone grepping MASTER_AUDIT hits ENOENT.
- **Recommended fix:** Sweep MASTER_AUDIT_2026-07-05.md — rewrite `desktop/src/...` → `desktop-2/src/...`. Retire P0s that no longer reproduce.
- **Confirmed / Suspected:** Confirmed.

### BUG-O-007 · Operator surfaces (Diagnostics + HQ Bridge) have no admin/role gating
- **File:** `src/shell/sectionRegistry.ts`
- **Line/Function:** 126-142 — `navVisible: false` but no `requireAdmin`/`requireOperator` flag
- **Severity:** P1
- **Surface:** Operator
- **What is broken:** Any user typing `#diagnostics` or `#hq` reaches them. `capabilities.ts` at `desktop-2/src/lib/authz/capabilities.ts` exists but `sectionRegistry.ts` doesn't consult it.
- **Why it matters:** Diagnostics leaks internal skeleton copy + fixture data (BUG-O-001) to any curious user. HQ Bridge exposes full deep-link verb table publicly.
- **Recommended fix:** Add `requireCapability: "admin"` (or `"operator"`) to both entries; route unauthorized hash-hits back to `/home` with soft toast.
- **Confirmed / Suspected:** Confirmed.

### BUG-O-008 · Journey count drift: 55/80=69% actual vs memory says "76% wired"
- **File:** `account-app/src/components/admin/JourneyMapTab.tsx`
- **Line/Function:** JOURNEYS dataset 34-122 vs `MEMORY.md` "80 customer journeys · 76% wired"
- **Severity:** P2
- **Surface:** Operator (memory index)
- **What is broken:** Hand-count: 55 wired / 80 = 69%. LOCKED memory reads 76%. Either dataset drifted below 76 or memory is stale.
- **Recommended fix:** Update `liquid_clips_wire_checklist.md` memory line to `69% wired` OR flip 5 more demo→wired during next Cohort 0.
- **Confirmed / Suspected:** Confirmed by hand-count.

**HQ context (non-bug findings):**
- HQ Admin console lives in `account-app` (`src/components/admin/AdminHQ.tsx`), not desktop-2. Desktop-2 has only `HQBridgeSection.tsx` (static verb-table reference for `liquidclips://` deep-link scheme). All 12 HQ tabs (SystemMap, JourneyMap, Constellation, Surfaces, CarouselClips, ColdLeads, PromoCodes, SignInOps, HQCommand, BetaCohort, Canary) wired in AdminHQ.tsx.
- HQ Constellation Engine (memory 2026-07-05): Built at `account-app/src/components/admin/ConstellationTab.tsx`.
- HQ Crew Contract (memory 2026-07-07): Built per docs `HQ_APP_STATUS_CREW_CONTRACT_BUILT_2026-07-07.md`.

---

# Shared / Cross-cutting Bugs

### Cross-cutting counts
| Pattern | Count | Severity |
|---|---|---|
| TypeScript errors (`tsc --noEmit`) | 0 | ✅ |
| Raw `String(e)` leaks | 51 | P1 |
| `<img>` without `onError` | 21 | P1 |
| `<video>` without `onError` | 6 | P1 |
| Silent RPC fixture fallbacks (sidecar-stub) | 53 | P0 |
| `setState` after `await` with no dispose guard | ~32 awaits / 0 guards across 12 state hooks | P1 |
| Silent-swallow catches (`/* noop */`) | 106 | P2 |
| `console.log/info/debug` in shipped bundle | 7 (down from MASTER_AUDIT's 12) | P2 |
| Dead feature-flag hook (`useFeature`) | 7 keys / 0 call sites | P1 |
| Watchdog wire | 30 real sites (registered) | ✅ |
| Telemetry wire | bootstrapped @ `App.tsx:133` | ✅ |
| Iron-gate sentinels present in code | 32 sentinels | ⚠️ registry lives in legacy `desktop/docs/IRON_GATES.md` |

### BUG-S-001 · TypeScript compile is CLEAN
- **File:** aggregate (`tsc --noEmit` from `desktop-2/`)
- **Severity:** OK
- **What is broken:** Nothing. 0 errors returned in 2.5s.
- **Confirmed / Suspected:** Confirmed (exit 0).

### BUG-S-002 · 51 raw `String(e)` error leaks past `humanError()`
- **File:** aggregate; codemod target
- **Severity:** P1
- **Surface:** Shared (11 in `src/design-os/state/*`, 8 in `src/design-os/routes/Settings.tsx`, rest scattered)
- **What is broken:** `sidecarCall.ts:130` documents "callers should never `String(e)` — always pass through `humanError(e)`." 51 sites ignore that. Sidecar-classified errors (ModuleNotFoundError, HTTP 429, Video unavailable, login required, billing hard limit) surface as raw Python/network strings.
- **Recommended fix:** Codemod `e instanceof Error ? e.message : String(e)` → `humanError(e)` (exported from `src/design-os/engine/sidecarCall.ts:135`). Add ESLint rule `no-restricted-syntax` banning `String(e)` in catches outside `humanError()` itself.
- **Confirmed / Suspected:** Confirmed. Representative sample:
  - `src/design-os/state/useCampaigns.ts:98`
  - `src/design-os/state/useSchedule.ts:93,175,188,202,219` (5 in one hook)
  - `src/design-os/state/useCommunity.ts:123`
  - `src/design-os/routes/Settings.tsx:311,344,407,433,447,490,539,1599,1618`
  - `src/design-os/engine/ResultsGrid.tsx:159`

### BUG-S-003 · 21 `<img>` + 6 `<video>` render without `onError` (silent black tiles)
- **File:** aggregate; codemod target (`<SafeImg>` / `<SafeVideo>` exist at `src/components/safe/`)
- **Severity:** P1
- **What is broken:** 27 raw `<img>`/`<video>` sites in shipped user-facing components render without the wrapper. Missing asset / 404 poster / decoded-format failure = blank rectangle, no fallback.
- **Recommended fix:** Codemod raw `<img src=…>` → `<SafeImg src=…>` and `<video>` → `<SafeVideo>`. Add lint rule against `JSXOpeningElement[name.name=/img|video/]` without `onError=` (excluding `components/safe/*`).
- **Confirmed / Suspected:** Confirmed. Representative:
  - `src/design-os/earn/RewardClipDrawer.tsx:142`
  - `src/design-os/earn/WalletStatCard.tsx:43`
  - `src/design-os/community/CommunityBanner.tsx:55`
  - `src/design-os/routes/SubmissionsReview.tsx:236`
  - `src/design-os/components/SubmitToWhopModal.tsx:226`
  - `src/routes/cancellation-intercept/CancellationIntercept.tsx:180`

### BUG-S-004 · Sidecar-stub has 53 silent RPC → fixture fallback branches (P0 truthfulness)
- **File:** `src/design-os/engine/sidecar-stub.ts`
- **Line/Function:** 53 occurrences of `tryInvoke(...) → if (real) return real; ... return FIXTURE_*`
- **Severity:** P0
- **Surface:** Shared
- **What is broken:** `tryInvoke()` at 124 returns `null` for ANY throw (not just Tauri unavailable). Every wrapper using legacy `tryInvoke` (thumbnail_*, community.* channels, `set_clip_platforms`, `runStage`, `exportApi.cancel/list`) swallows real sidecar failures and returns fabricated FIXTURE data. User can't tell "engine crashed" from "engine returned this result."
  - `runStage` (392) additionally emits `engine:progress percent: 1` on failure — signals SUCCESS to downstream subscribers.
  - `setClipPlatforms` (462) returns FIXTURE_PROJECT on any error, wiping caller's clip metadata.
- **Why it matters:** Core "silent-empty-render" family (memory `feedback_data_state_inventory.md`). Users trust invalid data, submit fake clips to Whop bounties, lose real work. Master audit "~32" undercounted; actual is 53.
- **Recommended fix:** Migrate remaining `tryInvoke` wrappers to `sidecarCall + isSidecarUnavailable` pattern already used by ingest/startRun/runStage newer siblings. `tryInvoke` should hard-throw on non-availability errors. Ledger + export-history fixtures should return empty arrays.
- **Confirmed / Suspected:** Confirmed. Notable clusters:
  - Thumbnail RPCs: `716, 720, 729, 737, 747, 759, 764, 781, 798, 820, 859, 869, 899, 907, 918, 926` (16 methods)
  - Export: `1025, 1040, 1066, 1109` (4)
  - Community/campaign asset links: `3224, 3267, 3311, 3329, 2189` (5)
  - Wallet ledger row seed: `708-709` — `mockState` seeded with `FIXTURE_LEDGER_ROWS` at module load

### BUG-S-005 · `setState` after `await` with no disposal guard across 12 state hooks
- **File:** aggregate — `src/design-os/state/*.ts` (0 guards vs 32 awaits)
- **Severity:** P1
- **What is broken:** All 12 hooks (`useSchedule`, `useCampaigns`, `useChannels`, `useCommunity`, `useRewardClips`, `useCampaignAssetLinks`, etc.) run `try { const r = await api.list(); setX(r); }` inside `useEffect` with no `mounted`/`AbortController`/`signal` guard. Fast route switch = "Can't perform state update on unmounted component" + racing fetches overwrite each other.
- **Recommended fix:** Standard React pattern — `AbortController` in useEffect with `signal.aborted` gate before setState. Prefer AbortController so the fetch itself terminates.
- **Confirmed / Suspected:** Confirmed. Representative:
  - `src/design-os/state/useSchedule.ts:89-96`
  - `src/design-os/state/useCampaigns.ts:94-96`
  - `src/design-os/state/useChannels.ts:74-80`
  - `src/design-os/state/useCommunity.ts:129`
  - `src/design-os/state/useRewardClips.ts:65-73`

### BUG-S-006 · `useFeature` hook has ZERO call sites — canary rollout is dead code
- **File:** `src/lib/useFeature.ts`
- **Line/Function:** `useFeature()` at 74
- **Severity:** P1
- **What is broken:** Defines 7 canary flags (`ransom_paywall`, `crew_match`, `whop_bounty_syndicate`, `sui_payouts`, `wallet_dashboard_v2`, `referral_pipeline`, `gap_email_subject`), fetches `/me/canary` every 5 min. Zero code paths call `useFeature(...)`. HQ Admin canary dial does nothing.
- **Why it matters:** Shipping empty flag scaffolding = teams believe rollout is safe when it's uncontrolled. Every desktop client fetches `/me/canary` every 5 min for no effect.
- **Recommended fix:** Either (a) delete `useFeature.ts` + `/me/canary` polling until real gate lands, OR (b) wire `wallet_dashboard_v2` in `WalletPanel.tsx`, `ransom_paywall` in `AssetRansomPaywall.tsx`, etc.
- **Confirmed / Suspected:** Confirmed via `grep -rn 'useFeature(' src/` — only 2 hits (definition + docstring).

### BUG-S-007 · `publishStore.schedulePost` + `PublishModal.doSubmit` have no idempotency key (double-post)
- **File:** `src/state/publishStore.ts` + `src/components/publish/PublishModal.tsx`
- **Line/Function:** `publishStore.ts:102-108`, `PublishModal.tsx:200-297` (`doSubmit`)
- **Severity:** P0
- **What is broken:** `doSubmit` unconditionally calls `schedulePost(...)` + `upsertAssistedJobs(records)` + `startAssistedHandoff(record)`. `schedulePost` mints new `sch_lc_XXXX` per call. `submitting` boolean at 202 is racy — permission prompt awaits, user can retrigger. No server-side dedupe. Two clicks = two posts, two calendar records, two notifications. Also: `assistedSchedule.startAssistedHandoff` swallows failures inside its own try/catches (PublishModal.tsx:255-262 comment admits it), so failed-post is invisible.
- **Recommended fix:** Add `clientRequestId = crypto.randomUUID()` when modal opens; pass to `schedulePost` + `upsertAssistedJobs`. Disable submit button optimistically not just async guard. Fix swallowed handoff catches per in-code follow-up comment.
- **Confirmed / Suspected:** Confirmed.

### BUG-S-008 · 7 `console.log`/`.info` shipped in prod bundle
- **File:** aggregate
- **Severity:** P2
- **What is broken:** 7 remaining:
  - `src/lib/qa.ts:746,777,792` — 3 QA autoboot info logs
  - `src/lib/flowTrace.ts:30` — flow-trace log (dev-only flag missing)
  - `src/lib/deepLinkBoot.ts:65` — non-activation deep-link info log
  - `src/design-os/engine/sidecar-stub.ts:135` — one-off warn (design intent)
- **Recommended fix:** Gate `qa.ts` behind `if (window.__lcQA)`; wrap `flowTrace` in `if (import.meta.env.DEV)`; move `deepLinkBoot` warn to sentry-only; keep the sidecar-stub warn.
- **Confirmed / Suspected:** Confirmed.

### BUG-S-009 · 106 silent-swallow catches (`/* noop */`, `/* swallow */`)
- **File:** aggregate; codemod / triage target
- **Severity:** P2
- **What is broken:** 106 shape `catch { /* noop */ }` across `src/`. Some legitimate (event-bus listener isolation `eventBus.ts:44`); most are not (Tauri listener cleanup, best-effort clipboard, telemetry emit). None route through telemetry sink.
- **Recommended fix:** Add `swallow(err, tag: string)` helper that no-ops in prod but pushes to `diagBuffer` for HQ Admin support bundle. Codemod all `/* noop */` and `/* swallow */` sites.
- **Confirmed / Suspected:** Confirmed.

### BUG-S-010 · Watchdog wire is real (30 sites, not no-op) — OK
- **Severity:** OK
- **What is broken:** Nothing — MASTER_AUDIT premise verified negative. `<Watchdog>` mounts + `watchdogWrap` calls exist in 30 real sites (App.tsx, BrowseSection, AccountSection, InboxSheet, InlineWhopCheckout, PublishModal, AssetRansomPaywall, AgencyPreviewBanner, trial.ts, globalDropConsumer.tsx, agency.ts, SyncMailMoneyDrop, sidecar-stub RPCs via `watchdogWrap` import at 79).
- **Recommended fix:** None; consider extending to remaining ~12 state hooks that are unwrapped.
- **Confirmed / Suspected:** Confirmed.

### BUG-S-011 · Telemetry wire is real — OK
- **File:** `src/lib/telemetry/bootstrap.ts`, `src/App.tsx:133`
- **Severity:** OK
- **What is broken:** Nothing. `bootstrapTelemetry()` fires on App mount; registers `backendTelemetrySink`, `desktopErrorSink`, `posthogSink`, `sentrySink`. Closed event registry via `eventRegistry.ts`.
- **Recommended fix:** None. Consider surfacing telemetry health in HQ Admin.
- **Confirmed / Suspected:** Confirmed.

### BUG-S-012 · Iron-gate sentinels in code but registry doc lives in legacy `desktop/docs/IRON_GATES.md`
- **Severity:** P2
- **What is broken:** 32 sentinels present in desktop-2 code (IG-002, IG-003, IG-LC2-015…018, IG-SOV-2.2-001, IG-001, IG-010, IG-012). Referenced registry file lives in `/Users/dipdip/code/jnr/desktop/docs/IRON_GATES.md` (LEGACY repo), not `desktop-2/docs/`. Two sentinel comments reference `docs/lc2/IRON_GATES_LC2.md` inside desktop-2 — verify existence.
- **Recommended fix:** Copy `desktop/docs/IRON_GATES.md` into `desktop-2/docs/` + update sentinel comments to local path. Or consolidate into `desktop-2/docs/lc2/IRON_GATES_LC2.md`.
- **Confirmed / Suspected:** Confirmed absence in `desktop-2/docs/`.

### BUG-S-013 · Multiple user-visible "placeholder" strings
- **File:** aggregate
- **Severity:** P2
- **What is broken:** User-visible strings containing "placeholder"/"demo data":
  - `src/design-os/routes/ExportRoute.tsx:192`
  - `src/design-os/routes/Campaigns.tsx:249`
  - `src/design-os/routes/Analytics.tsx:72`
- **Recommended fix:** Rephrase — "This is sample data. Bake a clip first to export your own." Voice review (19yo clipper voice per memory).
- **Confirmed / Suspected:** Confirmed.

### BUG-S-014 · `sidecar.runStage` emits FALSE progress on error
- **File:** `src/design-os/engine/sidecar-stub.ts`
- **Line/Function:** `runStage` at 392-400
- **Severity:** P1
- **What is broken:** When real `sidecarCall("run_stage", ...)` throws and `isSidecarUnavailable(e)` matches, wrapper emits `bus.emit("engine:progress", { stage, percent: 1, slug })` — signals COMPLETION to every downstream subscriber — and returns FIXTURE_PROJECT. Subscribers (Workstation, ClippingEngine, CockpitContext) advance stage gate believing stage succeeded.
- **Why it matters:** Silent-lie failure mode. If sidecar drops mid-run in Batch A→C transition, UI locks into "stage complete" state and cannot recover.
- **Recommended fix:** Do NOT emit synthetic `percent: 1` on fallback path. Emit `engine:error` or throw so callers render real failure. Same audit needed on bus-emit fallback branches at 328-329, 419-421, 440-442.
- **Confirmed / Suspected:** Confirmed.

### BUG-S-015 · `f5/` folder is NOT feature-flag code — clarification only
- **File:** `src/lib/f5/`
- **Severity:** OK
- **What is broken:** `f5/scanner.ts:1-30` = "F5 Layer 2 top-level scanner state machine" for Gmail contacts + YouTube cross-ref (used by SyncMailMoneyDrop). Real flags are in `src/lib/useFeature.ts` (see BUG-S-006).
- **Recommended fix:** Consider renaming `f5/` → `contactScanner/` to avoid future auditor confusion.
- **Confirmed / Suspected:** Confirmed.

---

# MASTER_AUDIT_2026-07-05 resolution status

Every P0 claim from the 2026-07-05 audit re-verified against current desktop-2:

| # | Claim | Status | Notes |
|---|---|---|---|
| 1 | Editor 100% fixture clips | **RESOLVED** | `src/sections/editor/EditorSection.tsx:39-53, 187-200` uses real `useEngineSession` + persistence hydrate |
| 2 | Wallet hardcoded roster | **RESOLVED** | `src/routes/wallet-detail/WalletDetail.tsx:48-56` uses real `useWalletLedger()` with 5 states |
| 3 | Export silent mock | **REMAINS** | BUG-C-003 + BUG-C-004 |
| 4 | IntroSplash 28.5s hard timer | **RESOLVED** | 25s ceiling + `onEnded` + SafeVideo + tap-to-play. Residual edge in BUG-C-019 |
| 5 | Publish button doesn't mint | **RESOLVED** | `src/design-os/engine/cockpit/PublishModule.tsx:393-448` real `/me/reward-clips` POST. Idempotency gap = BUG-C-014 |
| 6 | whop_checkout_success mint bypass | **RESOLVED** | `whop_checkout_success.py:208` uses `apply_membership_tier` |
| 7 | PendingWhopMembership race | **PARTIAL** | New-buyer path redirects to `/connect-desktop`, but `desktop.py:194 connect_from_checkout` reintroduces mint-bypass — see BUG-R-006 |
| 8 | Founder-tier boolean bypass | **RESOLVED** for whop_checkout_success; **residue** at `desktop.py:260` (BUG-R-007) |
| 9 | `window.open` in whopCheckout.ts | **RESOLVED** — `openSmart` used. New failure mode where `openInApp` + commerce-filter defeats LOCKED in-app rule = BUG-R-003 |
| 10 | Agency campaigns mocked at sidecar | **REMAINS** | BUG-A-011 · silent mock fallback in agencyCampaigns.create/patch/publish |
| 11 | Wallet double-credit at `me_wallet.py:279,422` | **RESOLVED** | CM-T4 patch. Line 422 was misidentified (status update, not credit) |
| 12 | Founder seat drift 2000 vs 12000 | **PARTIAL** | Line 943 uses `MAX_FOUNDER_SEATS`; line 972 still `2000` (BUG-R-005) |
| 13 | auth_whop.py:411 mint bypass | **RESOLVED** | Line 422-431 now `apply_membership_tier` |
| 14 | IntroSplash hard timer no fallback | **RESOLVED** | Same as #4 |
| 15 | Cancel toast-only | **RESOLVED** | Real POST at `AccountSection.tsx:97-101` |
| 16 | Diagnostics "skeleton" labels | **REMAINS** | BUG-C-001 + BUG-O-001 + BUG-O-002 |
| 17 | Campaigns "UI skeleton" surfaced | **RESOLVED** at CampaignsSection.tsx; residual fixture-ID bug = BUG-C-015 |
| 18 | Settings "not checked yet" | **PARTIAL** | Only fires when `channels.source === "mock"` — see BUG-C-017. Stripe Connect still fully broken (BUG-O-003) |
| 19 | Cron silent-swallow | Backend — out of scope for this audit |
| 20 | Rate-bucket memory leak | Backend — out of scope for this audit |
| 21 | Raw String(e) leaks | **REMAINS** | BUG-S-002 (51 sites, 9 in Settings) |
| 22 | `<video>`/`<img>` missing onError | **PARTIAL** | SafeImg/SafeVideo primitives exist; 27 unmigrated sites remain (BUG-S-003) |
| 23 | Silent RPC mock fallback (~32) | **REMAINS** | BUG-S-004 (53 confirmed sites — higher than audit's 32) |
| 24 | setState after await | **REMAINS** | BUG-S-005 (12 hooks, 32 awaits, 0 guards) |
| 25 | Dev-language leaks (skeleton/wip/demo/placeholder) | **PARTIAL** | Some swept; residues in BUG-C-001, BUG-C-007, BUG-S-013 |
| 26 | TopHud auth events | **RESOLVED** | TopHud subscribes to `activation:complete` + `auth:signed-out` (225-230). Passive-death gap = BUG-AU-001 |
| 27 | Home tiles stale seed IDs | **RESOLVED** | `CommandRoom.tsx:70-73` uses `useEarnSummary`; `fakeEarn.ts` orphaned |
| 28 | Workstation empty-state → deleted useAuthPanelBridge | **RESOLVED** | Comment-leak residue only (BUG-C-020) |
| 29 | Community 9-room hardcoded fallback | **RESOLVED** | `sidecar-stub.ts:2161` seeds `channels: []`; renders "Studio preview · mock" |
| 30 | Channels detail 404 branch | Not verified this pass |
| 31 | Schedule writes to Postiz dev tenant | **RESOLVED** | No `Postiz` refs in desktop-2/src/ |
| 32 | Whop webhook signature replay | **RESOLVED** | svix `Webhook(secret).verify()` enforces timestamp/replay |
| 33 | Publish RPC no idempotency | **REMAINS** | BUG-C-014 + BUG-S-007 |
| 34 | Wallet cents/dollars 100× | **RESOLVED** | Backend returns `amount_cents`; `fmtUsdCents` divides correctly |
| 35 | `try_grant_founder_seat` not called | Backend — needs verification |

---

# Top-priority fix ranking (for direct handoff)

Ranked by "hours to fix × user impact if unfixed at launch":

1. **BUG-RT-001** — Add PyInstaller sidecar bundle to `tauri.conf.json:bundle.resources`. Without this, no production install runs anything real.
2. **BUG-RT-002** — Uncomment library-validation + unsigned-executable-memory entitlements. Without this, sidecar SIGKILLs on hardened runtime first-boot.
3. **BUG-A-001** — Change `PLAN_CATALOG.agency.priceMonthlyUsd = 99.99` (currently $500). One-line fix; kills a launch-day trust break.
4. **BUG-A-008** — Wire `SubmitToWhopModal.FIXTURE_CAMPAIGN` to `activeCampaignId`. Right now every clip submission goes to slug `"preview-campaign"`.
5. **BUG-A-002** — Rewrite `AgencyCampaigns.tsx:128-134` TierGateWall copy to $99.99. Same-day fix.
6. **BUG-O-001 + BUG-O-002** — Delete Diagnostics fixture imports + wire real health probes. Master audit's #16 finally closed.
7. **BUG-O-003 + BUG-O-004** — Delete Ayrshare provider row + fix Stripe Connect surface (either wire it or remove).
8. **BUG-C-003 + BUG-S-004** — Retire `tryInvoke → FIXTURE_*` pattern in `sidecar-stub.ts`. Truthfulness codemod.
9. **BUG-C-004** — Kill mock success path in `exportApi.exportClip`. Money-moment.
10. **BUG-C-014 + BUG-S-007** — Idempotency-Key on publish flows.
11. **BUG-A-014 + BUG-R-001** — Move 10-clip cap to backend. Client-only enforcement is bypassable + unenforced.
12. **BUG-R-003 + BUG-R-004** — Consolidate checkout on in-app InlineWhopCheckout; wire $1 Gate 1 activation.
13. **BUG-R-006** — Fix `desktop.py:194 connect_from_checkout` to route through `apply_membership_tier`.
14. **BUG-AU-001** — Emit `auth:signed-out` from `notifyAuthFailure`.
15. **BUG-AU-004** — Move `pendingChallenge` from sessionStorage → localStorage with TTL.
16. **BUG-RT-004 + BUG-RT-013** — Runtime updater rollback protection + retain N-1 bundle until boot-verified.
17. **BUG-RT-012** — Emit `sidecar:booting` / `sidecar:ready` events; frontend gates Create on ready.
18. **BUG-S-002 + BUG-C-013 + BUG-C-016** — `humanError()` codemod across 51 sites.
19. **BUG-S-003** — SafeImg/SafeVideo migration for 27 sites.
20. **BUG-S-005** — AbortController pattern across 12 state hooks.

---

**End of audit.** No files edited. No versions bumped. No builds run. No pushes. This document is the SYSTEM_STATE snapshot at commit HEAD as of 2026-07-08.
