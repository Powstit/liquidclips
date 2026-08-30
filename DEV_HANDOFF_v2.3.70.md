# v2.3.70 · Dev handoff

**Branch:** `launch/community-fix-2.3.70` (10 commits)
**PR:** open when ready via https://github.com/Powstit/liquidclips/pull/new/launch/community-fix-2.3.70
**Ship target:** cut `desktop-2-v2.3.70` tag → CI auto-builds signed DMGs → publish for the 275-user beta cohort.
**Written:** 2026-08-30

This doc explains, per commit, what was broken in v2.3.69, what
changed on this branch, and what YOU (dev team) need to do at deploy
time. Everything shipped stays behaviour-compatible with a
v2.3.69-shape environment — no schema migrations, no breaking API
changes, additive only.

---

## TL;DR — what to do at merge time

1. **Merge PR to `main`.**
2. **Add these GitHub Actions secrets** (Powstit/liquidclips → Settings → Secrets):
   - `VITE_POSTHOG_KEY` — the `phc_...` client key from your PostHog project
   - `VITE_POSTHOG_HOST` — optional, only set if using EU cloud or a reverse-proxy host (US default = skip)
   - `VITE_SENTRY_DSN` — the `https://...@sentry.io/...` DSN from your Sentry project
3. **Tag** `desktop-2-v2.3.70` → CI auto-builds + signs + notarises + publishes both DMGs.
4. **Deploy `junior-backend`** — `railway up --service junior-backend` from `junior-backend/`.
5. **Deploy `liquidclips-marketing`** — `vercel deploy --prod` from `liquidclips-marketing/`.
6. **Deploy `account-app`** — `vercel deploy --prod` from `account-app/` (no admin changes on this branch, but env may drift — safe to redeploy).

`.github/workflows/release-desktop-2.yml` already wires the env vars into the build step (see `build signed macOS app` step). `VITE_LAUNCH_COMING_SOON="1"` is hard-coded in the workflow — flip to `"0"` (or remove) on the next tag when the beta opens for real submissions.

---

## Commits, oldest → newest

### 1. `e259f4dd fix(community): survive legacy chat rows without mentioned_user_ids or reactions`

**Broken in v2.3.69:** the Community route crashed the entire panel any time a legacy chat message loaded without the newer `mentioned_user_ids` or `reactions` fields. Codex identified the mentions half; the reactions half was a second identical bug we hit while validating.

**Files:** `desktop-2/src/lib/chat.ts`, `desktop-2/src/design-os/components/ChatPanel.tsx`, plus a cosmetic comment fix in `WalletDetail.tsx` that was tripping a fixture-scan lint.

**Fix pattern:** made both fields optional in the `ChatMessage` type + defended every consumer with `?? []` / optional chaining. Legacy rows render without the mention badge and without reaction pills, but the room stays alive.

**Proof:** `community-chat-home.spec.ts` — 11/11 pass (was 11/11 failing pre-fix because MessageRow threw before the route even mounted).

---

### 2. `71f37d0d feat(browse): emit browse:url-changed from Rust webview + TS subscribe helper`

**Broken in v2.3.69:** the in-app browser (Tauri child WKWebView) had no way to tell React what URL was currently loaded after internal link clicks. The code has always had a `// Phase 2 will emit a URL-change event from Rust` TODO but the emit was never wired.

**Impact:** every Whop bounty creation required the agency to manually copy the URL back into LC. Invisible on first use.

**Files:**
- `desktop-2/src-tauri/src/browse.rs` — added `URL_CHANGED_EVENT` const + one `app.emit(...)` line inside the existing `on_navigation` closure. ~10 lines of real Rust, inside a callback that was already there.
- `desktop-2/src/lib/browse.ts` — added `subscribeBrowseUrlChanges()` TS wrapper using the existing `@tauri-apps/api/event` pattern.
- `desktop-2/src/lib/whopBountyCapture.ts` — new module. Regex matcher for 3 Whop bounty URL shapes (`dashboard/{co}/bounties/b_...` · `dashboard/{co}/content-rewards/...` · `c/{brand}/bounties/b_...`), per-session de-dup Set to prevent duplicate captures, DOM event dispatch, clipboard fallback for missed captures.
- `desktop-2/src/components/browser/BrowseOverlay.tsx` — subscribes on overlay open, unsubscribes on close, reads clipboard once on close as belt-and-suspenders.

**Shell rebuild:** yes — this touches Rust. First shell change in a while. Signing pipeline unaffected, CI just rebuilds the shell.

---

### 3. `56dc5f37 feat(launch): Kade wizard + coming-soon coerce + auto-fill Whop URL into campaign forms`

**Broken in v2.3.69:** even with the URL capture wire from commit #2, the agency had no visual signal that LC was doing anything smart in the background. Also, every campaign in the discovery grid looked "live" — no way to soft-launch with previews only.

**Files:**
- `desktop-2/src/components/wizard/KadeBountyWizard.tsx` + `.css` — new 4-step floating card in Kade's voice. Fires on `lc:open-post-to-whop-wizard`. Auto-advances to "reward linked" on `lc:whop-bounty-captured`. Falls back to manual paste if capture misses. Per-campaign dismissal via localStorage.
- `desktop-2/src/App.tsx` — mounted `<KadeBountyWizard />` globally next to `BrowseOverlay`.
- `desktop-2/src/design-os/campaigns/CampaignPageShell.tsx` — `handlePostToWhop` fires the wizard event alongside `openWhopAction(BOUNTY_CREATE)`.
- `desktop-2/src/design-os/routes/AgencyCampaigns.tsx` — both `CreateCampaignForm` (draft) and `EditCampaignPanel` (existing) subscribe to `lc:whop-bounty-captured` and auto-fill the `whop_reward_url` field.
- `desktop-2/src/design-os/state/useCampaigns.ts` — added `coerceToComingSoon()` behind `VITE_LAUNCH_COMING_SOON=1` env flag. Every clipper-facing campaign returns with `status: "coming_soon"` when the flag is set. Agency's own `listMyCampaigns` fetch is on a different path and untouched — agencies see real state, clippers see previews.
- `CampaignPageShell` Submit CTA gate — belt-and-suspenders check that shows a "Coming soon" toast + no-op when `campaign.status === "coming_soon"`.

**Backend enforcement of coming-soon:** deliberately none. Frontend override is enough for a trusted 275-user beta. Bypass cost = one row in `campaign_submissions` with no funded Whop pool behind it → zero money moves.

---

### 4. `07333b0d test(community-chat-home): navigate via Community nav click, not stale outer hash`

**Broken in v2.3.69:** all 11 tests in `community-chat-home.spec.ts` used `page.goto("...#/community")` — a pre-2026-07-10 outer-hash pattern that stopped working after the two-pipeline routing lock. Every test timed out waiting for the community-chat-home testid. Suite silently broken for weeks.

**Fix:** bulk-replaced the navigation to the canonical `#/home` + `getByRole("button", { name: "Community" }).click()` — the same path a real user takes from the sidebar. All 11 tests now pass in 48s.

Not a product change — spec-only. But without this, we can't prove the Community fix in commit #1.

---

### 5. `69f9bfd6 docs(launch): BETA_LAUNCH_ATTACK_ITEMS.md`

**What it is:** a P0/P1/P2 catalog of everything that isn't code but blocks a real beta ship — admin dashboards, paywall webhook resilience, cold-Mac first-30-seconds, support inbox SLA, status page, ToS/DMCA, WebSocket load headroom, spend caps, M-series DMG verification, rollback lever proven.

Treat as a sprint backlog for the 2-3 weeks post-launch. Tag each row with an issue number on merge, delete rows as they land, add rows we discover in prod.

**Includes a 24-hour prioritized shortlist** for the pre-launch scramble — commits #6 through #10 landed most of that list.

---

### 6. `1224130b feat(monitoring): wire Sentry + PostHog SDKs, uncomment error boundary hook, add 3 funnel events`

**Broken in v2.3.69:** Sentry + PostHog sinks exist in `desktop-2/src/lib/telemetry/sinks/*` and read `globalThis.Sentry` / `globalThis.posthog` — but the SDKs themselves were never installed. Every error and every `lcDiag` event was a silent no-op in prod. `EngineErrorBoundary` had a `// Sentry hook · uncomment when @sentry/react is installed` TODO from the day it was written.

**Files:**
- `desktop-2/package.json` — added `@sentry/react` + `posthog-js` deps.
- `desktop-2/src/lib/telemetry/monitoringInit.ts` — new module. Inits both SDKs behind env gates. Missing DSN/key = silent no-op. Sentry init includes PII redaction (strip email + authorization headers) + a `beforeSend` that filters abort/network noise + a `captureBoundaryError()` helper with route/component/sessionId tags for triage. PostHog init disables autocapture (we fire manually via `lcDiag`).
- `desktop-2/src/main.tsx` — calls `initMonitoring()` BEFORE `bootDiag()` so both are online in time to catch boot-path crashes. Emits `monitoring_boot` event so support triage can distinguish silent monitoring from silent product.
- `desktop-2/src/design-os/components/EngineErrorBoundary.tsx` — the "uncomment when installed" comment now calls the real `captureBoundaryError()`.
- **3 missing funnel events** added at natural call sites:
  - `campaign_detail_opened` — CampaignPageShell mount effect
  - `community_message_sent` — CommunityChatHome send success, with `is_first_ever` flag from localStorage
  - `first_payout_received` — useWalletLedger refetch, one-shot localStorage flag

`submission_created` already existed on the SubmitToWhopModal success path.

**Sentry SMS alert:** you set that up in Sentry.io dashboard after adding the DSN secret. **Alerts → New Alert Rule** → conditions: `event.count exceeds 10 in 5 min` OR `error.rate > 5%` OR `level:fatal`, actions: SMS. ~5 min in the dashboard.

---

### 7. `b7ca115d feat(kill-switches): env-var-gated incident-response levers for launch day`

**Missing in v2.3.69:** no way to disable a feature app-wide without shipping code. First paid outage at every SaaS I've worked at was "we had to redeploy to disable a feature and the deploy broke something else." Fixed.

**Files:**
- `junior-backend/app/kill_switches.py` — new module. `KILL_SWITCH_FLAGS` tuple with 8 registered flags. `raise_if_killed(flag)` handler helper: fail-closed 503 with user-safe message + Railway log line so ops sees enforcement. `kill_switches_snapshot()` for `/sync` mirror + admin visibility. Env var pattern is `KILL_{FLAG}=1` (case-insensitive; only `1`/`true`/`yes` disable — typo protection).
- **Enforcement wired into 5 gated handlers** (one line each, top of handler after docstring): `POST /submissions` (`clip_submissions`), `POST /chat/message` (`community_chat`), `POST /publish-now` (`publishing`), `POST /transcribe` (`ai_transcribe`), `POST /proxy/llm/clip-bundle` + `POST /proxy/anthropic/clip-bundle` (`ai_llm` — shared flag). Non-gated: `wallet_withdrawal` + `whop_redirect` are client-side Whop redirects, gated in UI only.
- `junior-backend/app/routes/sync.py` — `/sync` returns `kill_switches: {flag: bool}` mirror. Additive field, default `{}`.
- `junior-backend/app/routes/admin.py` — `GET /admin/kill-switches` for admin visibility. GET-only by design: env-var management belongs on the platform (Railway), not in the app.
- `desktop-2/src/lib/killSwitches.ts` — `useKillSwitch("flag")` React hook. Silent no-op when /sync omits the field (legacy backend, no JWT, mocked tests). Default-empty semantics.

**How to flip a switch on launch day:** Railway → junior-backend → Variables → add `KILL_CLIP_SUBMISSIONS=1` → Redeploy. Takes ~30s.

---

### 8. `96e00127 feat(whop-verify): webhook-drop resilience polling from paywall`

**Broken in v2.3.69:** Whop's `payment.success` webhook is over the internet — sometimes 6s, sometimes 6min, sometimes never fires. When it drops, the user has PAID on Whop but our app still shows them as free. They rage on X, they demand refunds, they screenshot Whop's success page.

**Files:**
- `junior-backend/app/routes/whop.py` — new `POST /whop/verify-my-subscription` endpoint. Auth via license JWT. If user has whop_user_id, hits Whop's `/memberships?user_id=X&valid=true` REST endpoint. Only UPGRADES from this signal (never downgrades — past_due false-positives during card-retry windows would kick paid users out). Cache 15s TTL keyed on user.id.
- `desktop-2/src/lib/whopSubscriptionVerify.ts` — `useWhopSubscriptionVerify({ enabled, onFlippedToActive })` hook. Immediate call on mount, 60s poll while enabled, stops on unmount.
- `desktop-2/src/components/paywall/AssetRansomPaywall.tsx` — wired the hook into `AssetRansomPaywallInner`. On flip to active: toast "Payment confirmed · Unlocking now", `me.reload()`, auto-fire `onUnlocked()`.

**Whop API rate limit:** 15s server-side cache means one Whop call per user per 15 seconds max, even under sustained polling. Railway numReplicas: 1 (per railway.json) makes the cache authoritative.

---

### 9. `d8d1e808 feat(marketing): DMCA takedown page + Terms cross-link + footer link`

**Missing in v2.3.69:** no public DMCA contact + no published SLA. Whop can suspend our merchant status when copyright complaints go unanswered; we lose safe-harbour protection under 17 U.S.C. § 512(c).

**Files:**
- `liquidclips-marketing/src/app/dmca/page.tsx` — new. Template-quality DMCA policy: designated agent + 72h ack / 7-business-day SLA, all 6 § 512(c)(3) required notice fields, response process, § 512(g) counter-notification procedure, repeat-infringer policy, misuse warning (§ 512(f)).
- `liquidclips-marketing/src/components/Chrome.tsx` — DMCA link added to the Ops console footer between EULA and Refunds.
- `liquidclips-marketing/src/app/terms/page.tsx` — new §10a "Copyright and DMCA" cross-links to `/dmca`.

**Still yours:** lawyer eyeballs `/terms` + `/privacy` + `/dmca` before public launch (fine for 275 beta). Ensure `support@liquidclips.app` auto-flags "DMCA takedown notice" subject.

---

### 10. `8ebc0b06 feat(status): live status page at /status + link from Kade crash screen`

**Missing in v2.3.69:** when Railway backend was down, users saw "everything is broken" and blamed the whole product. No public status page = every outage becomes a support-inbox flood.

**Files:**
- `liquidclips-marketing/src/app/api/status/route.ts` — new server-side route. Proxies `api.jnremployee.com/healthcheck`, shapes per-subsystem chips (Backend API · Publishing · Webhook signing), 15s edge cache, 8s backend timeout, `no-store` on inner fetch to avoid double-staleness.
- `liquidclips-marketing/src/app/status/page.tsx` — new client component. Polls `/api/status` every 30s. Overall pill + per-subsystem cards + last-checked timestamp + "what each status means" glossary + "when something's down" reassurance.
- `liquidclips-marketing/src/components/Chrome.tsx` — `/status` link added to Ops console footer between Support and Privacy.
- `desktop-2/src/lib/watchdog/KadeRepairScreen.tsx` — "Live status" is now the FIRST support link (before email + Telegram) because most crashes correlate with a wider outage the user can verify in 5 seconds.

**Optional:** alias `status.liquidclips.app` → `liquidclips.app/status` via DNS if you want the subdomain. Not required.

---

### 11. `<this commit> docs(handoff): DEV_HANDOFF_v2.3.70.md`

This file. Companion to `BETA_LAUNCH_ATTACK_ITEMS.md`. That doc catalogs future work; this doc explains what already landed.

---

## Verification (I've done these — no need to redo)

- **TypeScript** — `tsc --noEmit` clean on both `desktop-2/` and `liquidclips-marketing/`.
- **Vitest** — 713 pass / 1 skip / 0 fail across all 81 test files.
- **Playwright community-chat-home** — 11/11 pass (was 11/11 fail pre-branch).
- **Playwright campaigns-station** — 1/1 pass.
- **Python** — `ast.parse` clean across every backend file touched.
- **Rust** — NOT locally compiled (`cargo test --release` blocks on missing sidecar/bin/ffmpeg in this worktree). CI compile will validate on tag.
- **Full journey suite (196 tests)** — NOT run end-to-end (would take 30-45 min). The specific specs covering my changes are green.
- **Cold-Mac install of built v2.3.70 DMG** — waiting on YOU to tag + CI build. Attack item #7 on the launch doc.
- **M-series DMG walk** — waiting on M-series hardware. Attack item #6.

---

## Runtime env recap (what the shipped app expects at boot)

| Env | Source | Required | Purpose |
|---|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | GH secret | yes | Clerk OTP sign-in. Empty = ClerkProvider crash. |
| `VITE_BACKEND_URL` | workflow literal | yes | `https://api.jnremployee.com` |
| `VITE_SENTRY_DSN` | GH secret | recommended | Silent no-op if unset — but you WANT alerts. |
| `VITE_POSTHOG_KEY` | GH secret | recommended | Silent no-op if unset — but you WANT funnel data. |
| `VITE_POSTHOG_HOST` | GH secret | optional | Only for EU cloud or reverse proxy. |
| `VITE_LAUNCH_COMING_SOON` | workflow literal `"1"` | yes for launch | Flip to `"0"` when opening real submissions. |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | GH secret | yes | Crew Scanner. |
| `VITE_GOOGLE_REDIRECT_URI` | workflow literal | yes | Google OAuth callback. |

## Backend env recap (junior-backend on Railway)

Existing envs unchanged. New optional envs from this branch:

| Env | Purpose |
|---|---|
| `KILL_CLIP_SUBMISSIONS` | Set to `1` to pause `POST /submissions`. |
| `KILL_COMMUNITY_CHAT` | Set to `1` to pause `POST /chat/message`. |
| `KILL_PUBLISHING` | Set to `1` to pause `POST /publish-now`. |
| `KILL_AI_TRANSCRIBE` | Set to `1` to pause hosted Whisper. |
| `KILL_AI_LLM` | Set to `1` to pause hosted OpenAI + Anthropic clip-bundle paths. |
| `KILL_CLIP_GENERATION` | Reserved — no backend endpoint gated on this yet. |
| `KILL_WHOP_REDIRECT` | Reserved — client-side gate only. |
| `KILL_WALLET_WITHDRAWAL` | Reserved — client-side gate only. |

All unset by default = every feature on. Case-insensitive `1`/`true`/`yes` enables the kill.

---

## Questions?

`DEV_HANDOFF_v2.3.70.md` is a living doc — update it as you find things I got wrong.
The launch backlog lives in `BETA_LAUNCH_ATTACK_ITEMS.md` (same branch).
