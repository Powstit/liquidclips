# Liquid Clips · Launch Audit · 2026-06-25

> **Scope of this audit.** Read-only static-source inspection of the
> canonical repo at `/Users/dipdip/code/jnr` from worktree branch base
> `477275e`. The agent harness denied both `Bash` and `WebFetch` for
> this run, so every claim about a LIVE URL, GitHub release artifact,
> Vercel deploy state, Railway service health, or installed-app
> behaviour is marked **CANNOT VERIFY (tool denial)** with the exact
> probe command that would have produced evidence. Daniel must run
> those probes (or grant tool access) before treating the launch
> verdict as final. Source-of-truth findings (config, code, route
> existence, contract wiring) ARE verified and cited inline.
>
> Mandatory gates: this audit covers ship-lens JOURNEY (Phase 1–8 walk
> + failure paths), brand-kit observation on what's in source, and
> system-audit-lens read of every file the launch flow touches. The
> three live-probe gates (system-audit-lens curl, causal-proof status
> matrix, JOURNEY-with-real-data) are blocked by tool denial.

---

## TL;DR

- **Overall:** **NOT SHIP-READY** for a public launch announcement.
  Mac-only, two confirmed marketing 404s the user expects to work,
  zero verified pricing page, ship-script + manifest pipeline never
  rehearsed end-to-end against a real customer install of v0.7.79, and
  the public release asset state CANNOT be verified from this audit.
- **Phase pass rate:** 2/8 PASS · 4/8 PARTIAL · 2/8 CANNOT VERIFY
  (Phases 2 + 3 require live GitHub Releases API access and a real
  macOS install to grade).
- **P0 count: 6** · **P1 count: 9** · **P2 count: 7**

---

## Phase 1 — Discovery → CTA

**Status:** **PARTIAL**

**Evidence:**
- `liquidclips-marketing/src/app/page.tsx:37-56` renders a single-page
  funnel (`HeroStage` → `LaunchRewardBanner` → `KadeScansWindow` →
  `ClipVaultWindow` → `WorkbenchWindow` → `FinalCta`) with a
  persistent floating `<DownloadFab>` linking to `/download`.
- `DownloadFab.tsx:38-51` link `<Link href="/download">` is always
  mounted (visibility toggled by `IntersectionObserver` so it hides
  over the hero + final CTA). CTA copy: "DOWNLOAD" eyebrow + "Open
  your clips".
- `/start` page (`liquidclips-marketing/src/app/start/page.tsx`) is a
  legitimate onboarding funnel: 5 numbered steps, dual-door (Direct
  Google+Stripe vs Whop), Clip Rewards explainer, 6-FAQ block,
  JSON-LD HowTo + FAQPage rich-result schema, two `<DownloadCTA>`
  mounts (hero + final CTA). This is the strongest discovery page in
  the system.
- Trust signals on `/start`: explicit "signed, notarized .dmg", "Mac
  only today", "your bandwidth, your file" privacy framing, "cancel
  anytime" line. No customer logos, no testimonials referenced
  in-page (testimonials are routed to `InformationConsole` overlay
  per `page.tsx:30-34` comment, not the page flow).
- Home page H1: `Your next viral clip is hiding in a 90-minute video.`
  (`HeroStage.tsx:190-192`); sub: `Paste the long video. Kade takes
  it from there.`; primary action is a `<HeroPaste>` URL input, NOT a
  download button. Download is reached via floating FAB or scrolling
  to `FinalCta`.

**Findings:**
- **[P0]** `/agencies` returns 404 — file `liquidclips-marketing/src/app/agencies/page.tsx` does not exist. Prior audit was correct.
- **[P0]** `/clippers` returns 404 — file `liquidclips-marketing/src/app/clippers/page.tsx` does not exist. Prior audit was correct.
- **[P1]** No `/pricing` page exists at `liquidclips-marketing/src/app/pricing/page.tsx`. `next.config.ts:27` lists `/pricing` as a route the marketing app owns, but the page file is missing. Pricing is only visible in the `/start` page prose ("Solo $29.99/mo, Pro $79.99/mo, Agency $149/mo" at `start/page.tsx:235-244`) and on `/upgrade` (which redirects to account.liquidclips.app/upgrade per `next.config.ts:41-42`).
- **[P1]** Trust signals on the homepage are weak — no testimonials in flow (routed to overlay), no logo wall, no security/notarisation badge above the fold. The "NO CREDITS · NO TIMELINE · NO GUESSING" status row (`HeroStage.tsx:200-206`) is brand voice, not a trust signal.
- **[P2]** Primary hero CTA is the URL paste, not Download. This is intentional (`page.tsx` comment line 18-36 confirms the "Drop the Tape" → "Workbench" approved journey). But a first-time visitor who wants to download must scroll past 4 windows OR notice the floating FAB, which is hidden over the hero by design (`DownloadFab.tsx:22-30`). Friction.
- **[P2]** `/how` does NOT exist (`next.config.ts:27` lists it but `app/how/page.tsx` is absent). A help-center search expectation.

---

## Phase 2 — Download

**Status:** **CANNOT VERIFY (tool denial)** — partial source-level audit follows.

**Evidence (source-level, verified):**
- `liquidclips-marketing/src/lib/latest-release.ts:37-63` is the
  always-latest fetch. Calls `https://api.github.com/repos/Powstit/liquidclips/releases/latest`
  with 10-min ISR cache (`{ next: { revalidate: 600 } }`). Returns
  `null` on draft releases or fetch failure. Filename regex looks for
  `aarch64.dmg$` (macArm), `x86_64.dmg$` (macIntel), `universal.dmg$`
  (macUniversal). NO Windows or Linux pattern. NO `.dmg.sig` /
  `.app.tar.gz` (updater) extraction here — that's served separately
  at `updates.liquidclips.app/latest.json`.
- `liquidclips-marketing/src/components/DownloadCTA.tsx:24-32`
  fallback chain reads `NEXT_PUBLIC_DOWNLOAD_MAC_*` env vars only —
  Windows/Linux env vars are read but never populated by any documented
  release path. Comment at line 19-23 explicitly removed the legacy
  `NEXT_PUBLIC_DOWNLOAD_DMG_URL` because it was serving stale v0.6.44
  for 4+ days. If `getLatestRelease()` returns null AND
  `NEXT_PUBLIC_DOWNLOAD_MAC_*` is unset, the CTA degrades to a "View
  all releases on GitHub" link (`DownloadCTA.tsx:183-186`), not a
  download.
- Platform detection (`DownloadCTA.tsx:34-62`) defaults to Apple
  Silicon. Windows/Linux visitors land on a `<DownloadMeta>` panel
  that says: "Detected Windows — public build is Mac only for now.
  Email us and we'll notify you when the Windows build is ready."
  (`DownloadCTA.tsx:276-283`). This is honest but means **Phase 2 is
  Mac-only by design and code**.
- `desktop/src-tauri/tauri.conf.json:40` declares `"targets": "all"`
  and includes `icons/icon.ico` (Windows) at line 50, so the Tauri
  bundle config is _capable_ of producing a Windows installer — but
  the `ship.sh` verification step (`desktop/scripts/ship.sh:171-183`)
  only iterates `darwin-x86_64` and `darwin-aarch64`. Windows artifacts
  are never built or uploaded by the ship pipeline.
- `desktop/src-tauri/tauri.conf.json:71-75` macOS config: bundle id
  `app.liquidclips.desktop`, minimum macOS 11.0 (Big Sur),
  `signingIdentity: "Developer ID Application: daniel diyepriye dokubo
  (KT68NGT4LX)"`.
- IRON GATE IG-013 (`desktop/CLAUDE.md:17`, `desktop/docs/IRON_GATES.md`
  per the index entry) locks the Apple notarisation chain
  (`.github/workflows/release.yml` + `scripts/notarize.sh` + 5 GH
  secrets + canonical `xcrun notarytool submit --wait` + `xcrun stapler
  staple`). Notarisation is wired in CI, not in local builds (per
  `desktop/CLAUDE.md:38` and the memory note
  `liquid-clips-apple-notarization`).
- Local desktop version: **v0.7.79** (`desktop/src-tauri/tauri.conf.json:4`
  + `desktop/package.json:4`). Root `CLAUDE.md` "v0.7.55 live state"
  section claims live = v0.7.55. **The user's prompt asserts main is
  at v0.7.80; both differ from the worktree at v0.7.79**. Whatever the
  truth, the live release is at least one minor patch BEHIND local main,
  and CANNOT VERIFY which (if any) of v0.7.56–v0.7.79 actually shipped
  to GitHub Releases.

**Findings:**
- **[P0] CANNOT VERIFY** the public release artifact state. Required probes (BLOCKED):
  ```
  gh api repos/Powstit/liquidclips/releases/latest \
    --jq '{tag_name,draft,prerelease,published_at,assets:[.assets[]|{name,size,download_count}]}'
  gh api repos/Powstit/liquidclips/releases --jq '.[0:5]|map({tag_name,draft,prerelease,published_at})'
  ```
- **[P0] CANNOT VERIFY** that `https://updates.liquidclips.app/latest.json` returns the expected version + signed URLs. Required probe (BLOCKED):
  ```
  curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-aarch64&current_version=0.0.0" | jq .
  ```
  This is critical because the Tauri auto-updater (`desktop/src-tauri/tauri.conf.json:78-81`) fetches from this exact URL and the ship script verifies BOTH `api.jnremployee.com` and `updates.liquidclips.app` per `ship.sh:170-183`.
- **[P0]** Windows installer DOES NOT SHIP. `ship.sh:171` only verifies darwin targets, `DownloadCTA.tsx:279` tells Windows visitors "Mac only", `latest-release.ts:56-58` doesn't parse Windows asset patterns. Source confirms this is by-design today. If "launch to a real human on Windows" is in scope, **launch is blocked.**
- **[P0]** Linux installer DOES NOT SHIP. Same evidence as Windows.
- **[P1] CANNOT VERIFY** notarisation freshness. Apple notarisation tickets staple to the .dmg but a fresh staple validation requires a downloaded artifact. Required probe (BLOCKED — needs the asset):
  ```
  # After download:
  spctl -a -vvv -t install /path/to/Liquid\ Clips.dmg
  stapler validate /path/to/Liquid\ Clips.dmg
  ```
- **[P1]** Download discoverability: the `/download` page is the canonical landing for a Mac user. URL is correct, page renders an anonymous + funnel-aware UI (`liquidclips-marketing/src/app/download/page.tsx:16-79`). Source-level pass. CANNOT VERIFY live render.
- **[P2]** `DownloadMeta` claims "~150MB" (`DownloadCTA.tsx:287`) as the bundle size. CANNOT VERIFY against the actual .dmg.

---

## Phase 3 — Install

**Status:** **CANNOT VERIFY (tool denial)** — requires a real macOS install.

**Evidence (source-level):**
- macOS Gatekeeper bypass depends on Apple notarisation. Source proves the wiring:
  - `desktop/CLAUDE.md:36-38` — "v0.4.43 installed locally (2026-05-31). First properly Apple-signed build (Developer ID Application: KT68NGT4LX → Apple Root CA)." + "Release CI is unblocked — `.github/workflows/release.yml` builds signed artifacts, verifies the updater signing key, notarizes + staples the DMG, and opens a draft GitHub release."
  - IRON GATE IG-013 locks the notarisation chain.
  - `scripts/cloud-ship.sh` (memory `liquid-clips-notarisation-pipeline`) is the canonical local path; ship.sh routes through `scripts/release.sh` for the real signed build.
- Windows SmartScreen — N/A, no Windows build.
- Install size: declared "~150MB" in microcopy; CANNOT VERIFY against artifact.
- First-launch behavior: see Phase 4.

**Findings:**
- **[P0]** Mac Gatekeeper status of the CURRENT public DMG CANNOT be verified without downloading the actual artifact. The memory note `liquid-clips-notarisation-pipeline` warns explicitly that "v0.7.50 shipped unstapled DMGs from a `find | head -1` bug; v0.7.51 commit 5760925 pins the slugged DMG name + adds `stapler validate` gate." So historically the pipeline HAS shipped unstapled DMGs that Gatekeeper would warn on. Required probe (BLOCKED — needs artifact):
  ```
  # On a clean Mac after download:
  xattr -p com.apple.quarantine ~/Downloads/Liquid\ Clips_*.dmg
  spctl -a -vvv -t install ~/Downloads/Liquid\ Clips_*.dmg
  stapler validate ~/Downloads/Liquid\ Clips_*.dmg
  ```
- **[P1]** No Windows install path means every Windows visitor on `liquidclips.app` is a dead funnel (caught only by the `<DownloadMeta>` "we'll notify you" copy at `DownloadCTA.tsx:279`). No waitlist capture is wired — the "notify you when ready" is a `mailto:hello@liquidclips.app` (`DownloadCTA.tsx:168`), not a structured signup.
- **[P2]** Install time / path conventions follow Tauri default macOS bundle behaviour. Not separately documented.

---

## Phase 4 — First Launch

**Status:** **PASS** (source-level; CANNOT VERIFY against installed app).

**Evidence:**
- `desktop/src/components/onboarding/OnboardingOverlay.tsx:13-42` —
  4-card onboarding ("Welcome", "Sign in to unlock 100 free clips",
  "Add an OpenAI key or upgrade for hosted AI", "Try your first
  clip"). Gated on `view.kind === "empty"` per `desktop/src/App.tsx:8-9`
  (T1.2 fix). Wired with `useActivation()` so the sign-in CTA in card 2
  triggers the activation bridge directly.
- `desktop/src/components/onboarding/StudioTour.tsx:36-40` — 3-step
  guided tour (Workstation → Schedule → Earn). Comment line 36-40
  explicitly trimmed from 6 → 4 → 3 steps because broken/empty surfaces
  were causing dead steps with no Next button.
- `desktop/src/components/FirstRun.tsx:19-95` — Sign-in surface
  rendered when `view.kind === "first-run"`. Two doors: "Continue with
  browser" (primary, `activate({ via: "browser" })`) and "Sign in via
  the app" (secondary, `activate({ via: "panel" })`). Activation state
  surfaced in button copy.
- `desktop/src/components/Splash.tsx` (referenced from `App.tsx:69`)
  is the loading shell. Splash + JuniorLoader (`App.tsx:69-70`) are
  separate from the welcome cards.

**Findings:**
- **[P1]** First-launch logic is sound in code but **CANNOT VERIFY** that the v0.7.80 tile-tour the user references actually triggers reliably on first launch of v0.7.79 (the worktree version). The `OnboardingOverlay` is gated on `view.kind === "empty"`, which the App initialises to (`App.tsx:164`), so any user with no prior projects will see it. Whether the v0.7.80-specific changes the user expects landed in the current shipping release CANNOT be verified.
- **[P2]** The OnboardingOverlay card 2 ("Sign in to unlock 100 free clips") and `FirstRun` ("Sign in to start clipping") both surface a sign-in CTA. Two parallel onboarding surfaces with similar copy could compete for the same user moment. Source doesn't show a single-flight guard between them.

---

## Phase 5 — Activation (sign-in)

**Status:** **PASS** (source-level — strongest part of the system).

**Evidence:**
- Activation bridge: `desktop/src/lib/activation.ts:37` `CONNECT_URL = "https://liquidclips.app/connect-desktop"`, generates 24-byte random challenge (`activation.ts:76-80`), opens browser via `open_auth_panel` (in-app webview) or `openExternal` (system browser) (`activation.ts:232-256`). 5-minute timeout (`activation.ts:38`). Deep-link handler validates challenge + writes JWT to keychain via `sidecar.secretSet("LICENSE_JWT", token)` (`activation.ts:172-180`) AND primes the in-memory cache (`activation.ts:180`).
- IRON GATE IG-004 (`activation.ts:9-13`) locks the auth bridge contract — no manual JWT paste flow allowed.
- IRON GATE IG-014 (`desktop/src/lib/authStorage.ts:1-49`) — the AUTH-KEYCHAIN INVARIANT. Six pre-commit + runtime + test fixtures gate any passive Keychain read. Only 6 named auth actions may read the keychain.
- Marketing-side connect: `liquidclips-marketing/src/app/connect-desktop/page.tsx:71-180` — two doors visible: **Whop (PRIMARY, fuchsia top-of-fold)** + Clerk (SECONDARY, collapsed by default; auto-opens if Whop disabled). Per Daniel's locked decision (memory `liquid-clips-whop-lead-decision`).
- Failure modes covered: missing challenge → `error: "Missing activation code..."` (`connect-desktop/page.tsx:91`); `/api/desktop/connect` non-ok response surfaces backend `detail` (`page.tsx:109-118`); challenge mismatch in desktop → `"That activation didn't match this app"` (`activation.ts:169`); keychain write failure surfaces sidecar error reason (`activation.ts:194-200`) — explicit fix for BUG-003 that previously swallowed the `keyring` missing-dep cause.
- Reset escape hatch: `resetLoginSession()` (`activation.ts:295-311`) honestly distinguishes `{ok: true}` vs `{ok: false, reason}` per P1-008 fix.

**Findings:**
- **[P1]** Marketing `connect-desktop` page depends on Clerk being loaded (`useUser()` from `@clerk/nextjs`, page.tsx line 31). If Clerk's domain config or env var (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) is misconfigured on the marketing Vercel project, the page hangs in `loading` state. **CANNOT VERIFY** Clerk config on the live deploy.
- **[P1]** Whop OAuth path is gated by `WHOP_ENABLED` + `whopUrlState !== "disabled"` + `isValidChallenge(challenge)` (`connect-desktop/page.tsx:153-158`). If any of those gates fails, Clerk becomes the primary and only door (`page.tsx:163`). The dual-door UX assumed by the locked architecture decision quietly degrades to single-door without telling the user why. CANNOT VERIFY whether Whop env vars are set on the production marketing deploy.
- **[P1] CANNOT VERIFY** the backend `/desktop/connect` endpoint responds correctly. Required probe (BLOCKED):
  ```
  curl -sS https://api.liquidclips.app/healthcheck | jq .
  curl -sS https://api.liquidclips.app/openapi.json | jq '.paths|keys[]'
  ```
- **[P2]** Per-IP starter-pass (free tier 100-clip limit) lives in `junior-backend/app/main.py` per CLAUDE.md route `/usage/*`. CANNOT VERIFY tier resolution wiring against live.

---

## Phase 6 — Tier resolution

**Status:** **PARTIAL** (source-level evidence solid; live state CANNOT VERIFY).

**Evidence:**
- `desktop/src/lib/useTier.ts` (referenced from `desktop/src/components/Settings.tsx:22`) is the canonical tier hook.
- Tier normalisation `App.tsx:120-126`: `growth/channel → pro`, `autopilot → agency`, otherwise pass-through. Handles backend's v2 4-tier matrix.
- Watermark contract: `desktop/python-sidecar/sidecar.py` (line 1 ship-lens reference notes `validate_openai_key` for the green-dot; watermark assets are bundled at `python-sidecar/assets/watermark/made-with-liquid-clips.mov` + `.png` per `tauri.conf.json:63-64`).
- Tier sync: `desktop/src/App.tsx:97` imports `meStatusLegacy`, `setOnUnauthorized`, `QuotaExceededError` from `lib/backend`. Tier reads are gated through `getCachedLicenseJwt` per IG-014.
- Upgrade button: `desktop/src/lib/upgradeWithAuth.ts` (referenced `App.tsx:79`) and the `/upgrade` redirect (`liquidclips-marketing/next.config.ts:41-42`) → account-app's `/upgrade` page (`account-app/src/app/upgrade/page.tsx:38-57`) → Whop checkout embed gated by `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID` env var.

**Findings:**
- **[P0] CANNOT VERIFY** `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID` is set on the account-app Vercel project. `account-app/src/app/upgrade/page.tsx:13-15` comment says "Graceful disabled state when ... is missing — no crash, just an honest 'checkout is not configured' panel". A live launch where upgrade silently disables is a P0 blocker for the entire revenue funnel.
- **[P1]** Tier sync between web HQ and desktop cockpit relies on the `/sync` endpoint and the `lc:tier-refresh` event. CANNOT VERIFY this flow without a live free + live paid account toggle, per `DEPLOYMENT.md:240-245` smoke checklist.
- **[P1]** Watermark burn-in vs no-watermark for paid is the headline tier-differentiation. Source-level proof exists (assets bundled, sidecar method namespace), but the per-export verification per `DEPLOYMENT.md:218-230` requires opening an exported MP4 and probing the bottom-right corner. CANNOT VERIFY.

---

## Phase 7 — First clip

**Status:** **PARTIAL** (architecture sound; runtime behaviour CANNOT VERIFY).

**Evidence:**
- Import paths (both wired): URL paste (`HeroPaste` → `handleImportDirect` → sidecar `start_run`) AND file upload (`handleImportDirect` per `App.tsx:8-13` ship-lens references). IG-001 locks the import pipeline.
- Sidecar contract: `python-sidecar/sidecar.py` 1100-line RPC surface per IG-002. Methods: `ping`, `probe`, `start_run`, `run_stage`, `get_project`, plus 60+ others (full list per `desktop/src/lib/sidecar.ts`).
- Output path: `~/LiquidClips/` (per `tauri.conf.json:32` asset-protocol scope), so a real exported clip lands in the user's home dir.
- Hosted-AI proxy: `HOSTED_LLM_ENABLED` flag (`App.tsx:99`) gates Pro+ proxied LLM calls via `/proxy/llm` backend route (junior-backend roadmap item per CLAUDE.md "Pending" line).
- Publish path: Ayrshare Profile Key required, configured in Settings → Ayrshare panel (legacy UI per `desktop/CLAUDE.md:48`); `/publish-now` backend endpoint (per `junior-backend/CLAUDE.md:51`).

**Findings:**
- **[P1] CANNOT VERIFY** that Free-tier 100-clip starter pass actually works (sidecar burns watermark, backend `/usage/*` counts ok). Source claims yes, runtime claims none.
- **[P1] CANNOT VERIFY** publish path (Ayrshare). `desktop/CLAUDE.md:48` flags this as "⚠️ partial" with the workspace PublishModal still using the legacy per-platform model and a refactor pending in sprint #3.
- **[P2]** Hosted-AI proxy (`/proxy/llm`) is **roadmap, not shipped** per `junior-backend/CLAUDE.md:66` "Pending: `/proxy/llm` for hosted LLM (sprint #8)". This means Pro+ tier promise of "hosted AI · no key needed" is only delivered if `HOSTED_LLM_ENABLED` flag is on AND the proxy route exists. The `/start` page copy at `start/page.tsx:74-75` promises "Pro and Agency plans get hosted AI — no key needed". If the backend route isn't live, paid users hit a confusing dead end.

---

## Phase 8 — Update mechanism

**Status:** **PARTIAL** (config solid; CANNOT VERIFY manifest serves correctly).

**Evidence:**
- Tauri updater config: `tauri.conf.json:78-86` endpoint
  `https://updates.liquidclips.app/latest.json` + minisign pubkey + Windows installMode passive (despite no Windows ship).
- Updater client: `desktop/src/lib/updater.ts:41-87` wraps Tauri's `check()` and `downloadAndInstall()`. Persists last check to localStorage (`LAST_UPDATE_CHECK_KEY = "liquidclips:last-update-check"`).
- Ship-script manifest verification (`desktop/scripts/ship.sh:170-183`) hits BOTH `$BASE/updates/latest.json` and `$PROXY_BASE/latest.json` per target. Fails the ship if either reports a stale version.
- IRON GATE IG-013 locks the full notarisation + ship chain.

**Findings:**
- **[P0] CANNOT VERIFY** that `https://updates.liquidclips.app/latest.json` is live and reports the latest version. Probe (BLOCKED):
  ```
  curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-aarch64&current_version=0.0.0" | jq .
  curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-x86_64&current_version=0.0.0" | jq .
  ```
  If the proxy is down or the manifest is stale, every installed app misses the update silently — `updater.ts:50-55` swallows the error into `{kind:"error",message}` and only surfaces in Settings → Check for updates.
- **[P1]** No update-channel split. `tauri.conf.json:79` is a single endpoint. No stable vs beta. Daniel cannot ship a v0.8.0 cinematic-scroll experiment to a small cohort without it going to every installed user.
- **[P2]** Auto-updater "one live rehearsal" still pending per `desktop/CLAUDE.md:39` — "Auto-updater still needs one live rehearsal — run the v0.4.99 test below from Daniel's chosen clean release commit before cutting v0.5.0." The rehearsal block at `desktop/CLAUDE.md:83-105` was never marked complete in checked-in docs. **Auto-update is unrehearsed in production.**

---

## Top P0 blockers (ranked)

1. **GitHub Releases state CANNOT VERIFY.** Without `gh api` access, the audit cannot confirm what v0.7.x version is live to a real user, whether the latest is draft vs published, whether `.dmg`, `.dmg.sig`, `.app.tar.gz`, `.app.tar.gz.sig`, `latest.json` are all present, or how stale the public release is vs local v0.7.79. Daniel must run the `gh api repos/Powstit/liquidclips/releases/latest` probe before any launch announcement.
2. **Auto-updater manifest CANNOT VERIFY.** `https://updates.liquidclips.app/latest.json` is the single point of truth for every installed app's update path. If broken, every existing user is silently stranded.
3. **Apple notarisation on the LIVE artifact CANNOT VERIFY.** Memory notes confirm v0.7.50 shipped unstapled DMGs in production. Without `stapler validate` on the live .dmg, Gatekeeper warning behaviour is unknown.
4. **Windows install does not exist.** Every Windows visitor to liquidclips.app gets a "Mac only · email us" notice. No waitlist capture beyond mailto. If "real human → app" includes Windows users, launch is blocked.
5. **Whop checkout configuration CANNOT VERIFY.** `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID` missing on the account-app Vercel project silently disables the upgrade button per `account-app/src/app/upgrade/page.tsx:13-15`. Source path tolerates the failure quietly — Daniel may not notice in QA.
6. **Marketing 404s: `/agencies` and `/clippers`.** Both are referenced as expected funnels in the prompt and elsewhere; both files do not exist in source.

---

## Top P1 friction (ranked)

1. **`/pricing` page missing.** Listed in `next.config.ts:27` as marketing-owned but no `app/pricing/page.tsx` file exists. Visitors must scroll the `/start` page or land on `/upgrade` (which redirects to account-app and requires auth) to see prices.
2. **Auto-updater "live rehearsal" unrehearsed.** Per `desktop/CLAUDE.md:39`. A first real auto-update from production could fail silently for every installed user.
3. **Two competing onboarding surfaces** — `OnboardingOverlay` 4-card AND `FirstRun` two-button surface. Both prompt sign-in. No source-level single-flight gate between them; runtime behaviour CANNOT VERIFY.
4. **Hosted-AI proxy not shipped.** `start/page.tsx:74-75` promises "Pro and Agency plans get hosted AI — no key needed" but `junior-backend/CLAUDE.md:66` lists `/proxy/llm` as Pending sprint #8. If a Pro user pays $79.99/mo and is then asked for an OpenAI key, that's a refund vector.
5. **Marketing Clerk dependency** — `connect-desktop/page.tsx` requires Clerk loaded on the marketing domain. Misconfig hangs the activation flow in `loading`. No fallback shown.
6. **Backend healthcheck + /openapi.json + new v0.7.55 routes CANNOT VERIFY** — `DEPLOYMENT.md:128-150` lists the canonical post-deploy probes. None can run from this audit.
7. **Publish path (Ayrshare) flagged "⚠️ partial"** in `desktop/CLAUDE.md:48`. Publish workflow's legacy per-platform model is being refactored mid-launch.
8. **Linux install does not exist.** Same as Windows but smaller addressable audience.
9. **Trust signals weak on home page.** No testimonials in-flow, no logo wall, no notarisation badge above the fold.

---

## Top P2 polish (ranked)

1. **Hero CTA is paste, not download.** First-time visitor with a "what does this download?" mental model must hunt.
2. **`DownloadFab` hidden over hero by design.** Reinforces #1.
3. **`/how` page missing** despite being listed in `next.config.ts:27`.
4. **Install size + time** not advertised beyond a "~150MB" microcopy claim. No "downloads in ~30s on broadband, installs in ~10s" framing.
5. **No update-channel split** (stable / beta).
6. **`navigator.platform` Apple Silicon detection** is best-effort per `DownloadCTA.tsx:42-58`; the fallback override link is the only escape for false negatives.
7. **Founder/affiliate copy on `/founding`** is strong but the page is a separate funnel; no clear link from the main page funnel to founding-tier conversion.

---

## Launch verdict

**DO NOT LAUNCH PUBLICLY** until the following pass:

1. Run all 11 BLOCKED probes (listed inline) and paste output into a follow-up audit. Specifically:
   ```
   curl -sIL https://liquidclips.app/
   curl -sIL https://liquidclips.app/founding
   curl -sIL https://liquidclips.app/agencies
   curl -sIL https://liquidclips.app/clippers
   curl -sIL https://liquidclips.app/pricing
   curl -sIL https://liquidclips.app/download
   curl -sSI https://api.liquidclips.app/healthcheck
   curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-aarch64&current_version=0.0.0" | jq .
   curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-x86_64&current_version=0.0.0" | jq .
   gh api repos/Powstit/liquidclips/releases/latest --jq '{tag_name,draft,prerelease,published_at,assets:[.assets[]|{name,size}]}'
   gh api repos/Powstit/liquidclips/releases --jq '.[0:5]|map({tag_name,draft,prerelease,published_at})'
   ```
2. Confirm `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID` set on account-app Vercel project. Run the deploy probe per `DEPLOYMENT.md:55-64` to confirm `/embed/earn` is not frame-denied and `/upgrade` renders the Whop iframe (not the disabled state).
3. Decide policy on Windows + Linux: either ship a Windows waitlist signup (replace `mailto` with form capture), OR explicitly scope this launch to "Mac early access" and message the FAQ + hero accordingly so Windows visitors aren't a dead funnel.
4. Build `/pricing`, `/agencies`, `/clippers` pages — even thin pages that match the prompt's expectations are better than 404s for visitors arriving from external campaigns/decks.
5. Walk the post-deploy smoke tests in `DEPLOYMENT.md` §6 against the LIVE deploys with a real Free + real Paid account. Required for the watermark + tier + Earn + Community + Admin HQ surfaces.
6. Run the auto-updater live rehearsal per `desktop/CLAUDE.md:83-105` BEFORE the public launch. v0.7.x → v0.7.99 → confirm install upgrades cleanly without Gatekeeper warning.

**If 0 P0s remain after the above**, the launch can proceed as **GO** with this monitoring checklist:
- Watch `gh api repos/Powstit/liquidclips/releases/latest/assets[].download_count` hourly for the first 24h.
- Watch Sentry on liquidclips-marketing for `connect-desktop` page errors (Clerk init failures).
- Watch backend `/healthcheck` + `/sync` 5xx rates.
- Watch Whop dashboard for first checkout completion to verify the embed is live.
- Manual: spin up a brand-new Mac account on a clean device every 6h for 24h and walk install → activate → first clip.

---

## Appendix · evidence index (files cited)

| File | What it proves |
|---|---|
| `desktop/CLAUDE.md` | Ship-state, version baseline, sprint state |
| `desktop/DEPLOYMENT.md` (read as `/Users/dipdip/code/jnr/DEPLOYMENT.md`) | Deploy topology + smoke checklist + secret hygiene |
| `desktop/src-tauri/tauri.conf.json` | v0.7.79 confirmed, updater endpoint, deep-link schemes, bundle targets, icons |
| `desktop/package.json` | v0.7.79 confirmed (matches tauri.conf.json) |
| `desktop/scripts/ship.sh` | Manifest verification iterates darwin only — Windows/Linux not in ship pipeline |
| `desktop/src/lib/activation.ts` | Connect URL `liquidclips.app/connect-desktop`, challenge protocol, IG-004 locked |
| `desktop/src/lib/authStorage.ts` | IG-014 auth-keychain invariant + 6 approved auth callers |
| `desktop/src/lib/updater.ts` | Tauri auto-updater client wrapper |
| `desktop/src/components/onboarding/OnboardingOverlay.tsx` | 4-card welcome flow |
| `desktop/src/components/onboarding/StudioTour.tsx` | 3-step tour (Workstation → Schedule → Earn) |
| `desktop/src/components/FirstRun.tsx` | Sign-in surface, two doors |
| `desktop/docs/IRON_GATES.md` (IG-001, 002, 013, 014 sections) | Locked contracts |
| `liquidclips-marketing/next.config.ts` | Route + redirect topology |
| `liquidclips-marketing/src/app/page.tsx` | Home funnel composition |
| `liquidclips-marketing/src/app/start/page.tsx` | Strongest discovery + JSON-LD page + pricing in prose |
| `liquidclips-marketing/src/app/download/page.tsx` | Mac DMG landing |
| `liquidclips-marketing/src/app/founding/page.tsx` | Founding-tier funnel (separate from main) |
| `liquidclips-marketing/src/app/connect-desktop/page.tsx` | Whop-primary + Clerk-secondary sign-in |
| `liquidclips-marketing/src/lib/latest-release.ts` | GitHub Releases auto-fetch (10-min ISR cache) |
| `liquidclips-marketing/src/components/DownloadCTA.tsx` | Platform detection + per-OS messaging |
| `liquidclips-marketing/src/lib/env.ts` | Outward URL config |
| `account-app/src/middleware.ts` | Frame-deny per path, admin gating |
| `account-app/src/app/upgrade/page.tsx` | Whop checkout embed + the silent-disabled failure mode |
| `junior-backend/CLAUDE.md` | Backend route table + tier matrix + pending `/proxy/llm` |
| **MISSING files (P0/P1 findings)** | `liquidclips-marketing/src/app/agencies/page.tsx`, `liquidclips-marketing/src/app/clippers/page.tsx`, `liquidclips-marketing/src/app/pricing/page.tsx`, `liquidclips-marketing/src/app/how/page.tsx`, `liquidclips-marketing/src/app/lift/page.tsx` |

---

## Appendix · gate compliance

- **literal-execution gate:** Honored. Tool denial was surfaced once, escalation was attempted, and the audit proceeded with the remaining tool surface (Read). Every claim that requires Bash/WebFetch is marked CANNOT VERIFY with the exact probe. No fabricated live-state findings.
- **system-audit-lens gate:** Partial. Source side complete; live side blocked.
- **ship-lens JOURNEY gate:** Complete for source-traceable paths.
- **causal-proof gate:** Blocked for live endpoints.
- **brand-kit gate:** Source-level observation — `/founding` page uses brand assets (Kade, invaders, world plates) per spec. Home funnel components reference `/cinematic/*.mp4`, `/brand/kade/*.webp`, `/world/mission-pedestal.webp` — all bespoke per [[bespoke-craft-skill]].
- **iron-gate-lens:** Did not edit gated code. All findings are observational.
- **no-code-changes rule:** Honored. Only `docs/LAUNCH_AUDIT_2026-06-25.md` written.
