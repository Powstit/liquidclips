# Liquid Clips · Readiness Audit · 2026-06-25

**Auditor:** Readiness Audit Agent (worktree `agent-a526811c30068850c`)
**Canonical repo:** `/Users/dipdip/code/jnr`
**Branch base:** `5d82cc6` (origin/main HEAD) — note: spec said `8f6ca01` but that commit is a local-only WIP on canonical main, never reached origin
**Audit window:** live probes + local file state on 2026-06-25
**Scope:** scope-only. No code changes.

---

## TL;DR

Liquid Clips is **NOT ship-ready to onboard 100 paying clippers next week** — but it is closer than the bug list reads, because two of its "P0 open" items (Wallet panel · BUG-002 and Settings page · BUG-003) actually shipped to local main in commits `bfd8af6` and `Settings.tsx`-real-replacement, and the bug list was never updated. The single biggest blocker is the **gap between local main and what's deployed**: 4 of the 5 HQ-build merges, the wallet endpoint, the wallet panel, the recovery flow, and 12 days of bug fixes all sit local-only on the canonical repo while `liquidclips.app` + `account.liquidclips.app` + `api.liquidclips.app` still serve the v0.7.55-era stack (last desktop release tag 2026-06-12). The recommended next move is: **(1) deploy the current local main to all three Vercel/Railway surfaces, (2) ship desktop v0.7.63 via `desktop/scripts/ship.sh`, (3) seed the 4 missing onboarding rooms, (4) set the recovery PIN + 2FA via the HQ UI, then (5) hand the build to 5–10 friendly clippers FIRST before opening to 100.** Desktop-2 (LC 2.2 redesign) is NOT a shipping candidate this week and should be removed from the launch path entirely; ship legacy `desktop/` v0.7.63.

---

## Surface-by-surface assessment

### 1. Marketing site (`liquidclips.app`)

**Status:** 🟡 FRICTION
**Evidence:** `curl -sI https://liquidclips.app/` → 200, deploy `dpl_GwvD7KwQXuViVa3fCirpsxt2Ggfj`. Home page renders the approved Kade workstation funnel (HeroStage → KadeScansWindow → ClipVaultWindow → WorkbenchWindow → FinalCta) per `src/app/page.tsx`. BUT: the task brief asked about `/agencies` and `/clippers` — both return **404**. The only persona-funnel page that exists is `/founding` (200). `/help`, `/help/getting-started`, `/help/publishing`, `/help/billing-and-plans`, `/help/troubleshooting`, `/support`, `/privacy`, `/terms`, `/eula`, `/account-deletion`, `/refunds`, `/cookies`, `/refer` (307 redirect), `/start`, `/connect-desktop`, `/clips/[id]`, `/generate/[id]`, `/lift/minecraft-challenge`, `/sign-in`, `/sign-up`, `/download` are all wired. No `/pricing` page (pricing is embedded inside the homepage `#pricing` anchor + the `FeaturesPanel` console panel). Brand consistency is solid — `/founding` shares the funnel.css tokens.
**Fix:** Either ship dedicated `/clippers` + `/agencies` persona-funnel pages (the audit brief expected them), or kill the assumption and document that the home page IS the clipper funnel and the agency story lives inside the `BookDemoPanel` + `FeaturesPanel` consoles. The minimum: add nav-level links so an agency visitor knows where to go.
**Time to fix:** 1 day for two real persona pages with a unique angle each. 30 min for nav-only stopgap.
**Owner:** code (marketing repo) + Daniel decision on persona-page priority.

---

### 2. Sign-up flow (Clerk via marketing)

**Status:** 🟢 SHIP-READY (mechanically) / 🟡 FRICTION (UX)
**Evidence:** Marketing has `/sign-up/[[...sign-up]]/page.tsx` wired to Clerk. Account-app uses Clerk `pk_live_Y2xlcmsubGlxdWlkY2xpcHMuYXBwJA` (live key, confirmed in HTML source). `/admin` correctly redirects unauthenticated requests to `/sign-in` (`http-equiv="refresh" content="1;url=/sign-in"` in HTML). Clerk webhooks live at `/webhooks/clerk` on backend (visible in OpenAPI). The `allowedRedirectOrigins` cover both liquidclips.app + account.liquidclips.app.
**Fix:** Sign-up itself works. UX friction: a stranger landing on `liquidclips.app` is funneled to download-first, not sign-up-first. That's the intended journey for the clipper persona but is wrong for the affiliate / agency persona — they have no on-ramp.
**Time to fix:** none for mechanics. 2h to wire affiliate sign-up CTA paths.
**Owner:** Daniel decision (which persona signs up vs downloads first).

---

### 3. Checkout (Stripe via Clerk Billing)

**Status:** 🟡 FRICTION — verification deferred
**Evidence:** `/upgrade/UpgradeCheckout.tsx` + `/upgrade/page.tsx` exist in account-app. `/checkout/page.tsx` + `/checkout/complete/page.tsx` wired. Backend has `/webhooks/stripe` + `/webhooks/stripe-connect` in OpenAPI. `me_affiliate/stripe-connect/onboarding` + `me_affiliate/stripe-connect/status` are live. Per `DEPLOYMENT.md` §6 the smoke-test list specifically requires "Upgrade opens the Whop checkout embed at /upgrade. Requires NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID env var on Vercel account-app project." Per memory `liquid_clips_whop_lead_decision`: Whop is PRIMARY, Clerk is fallback — so the live checkout topology is BOTH Stripe (via Clerk Billing) AND Whop. Recent commits `tasks #96-98` fixed accountpack quantity, Solo/Whop return URL, legacy "pro" Clerk slug fallback.
**Fix:** Verification deferred — needs Daniel to run a £1 test card end-to-end on production today. The plumbing reads correct in code, but neither a real successful Stripe `checkout.session.completed` nor a Whop `payment_succeeded` is documented as "tested live against current deploys."
**Time to fix:** 30 min to run + screenshot a real test charge per checkout path (Stripe and Whop).
**Owner:** Daniel-action.

---

### 4. Customer dashboard (`account.liquidclips.app/`)

**Status:** 🟡 FRICTION
**Evidence:** `curl -sI https://account.liquidclips.app/dashboard` → 200. Page exists at `account-app/src/app/dashboard/page.tsx`. Live HTML shows Liquid Clips brand tokens (`bg-paper text-ink`, fuchsia, ink) and Clerk avatar widget. Memory notes a "brand pass" landed on the admin side (Agent 2 → commit `50fd707`) but the user-facing `/dashboard` was already on Liquid Clips tokens. `/embed/earn` is correctly framed (no CSP frame-deny header — `DEPLOYMENT.md` §1 covers this). Real data sources: per `liquid_clips_marketing_site` memory the surface is brand-consistent and live. Bonus ledger, banners, announcements, channels admin endpoints exist (`/admin/bonus-ledger`, `/admin/banners`, `/admin/announcements`, `/admin/community/channels`).
**Fix:** Verification deferred — needs Daniel to log in with a real test account today and confirm the dashboard shows the right tier, real lifetime-view count, real Whop status, and the Wallet panel renders (the wallet panel is in local-main commit `bfd8af6` but NOT deployed to production yet).
**Time to fix:** 30 min for Daniel smoke-test + 5 min `vercel deploy --prod` to push the wallet panel live.
**Owner:** Daniel-action + code-deploy.

---

### 5. Desktop download + install

**Status:** 🟡 FRICTION
**Evidence:** Live release: `https://api.github.com/repos/Powstit/liquidclips/releases/latest` → `v0.7.55`, published `2026-06-12T15:51:15Z` (12 days ago). Assets: `Liquid.Clips_0.7.55_aarch64.dmg` (140 MB), `Liquid.Clips_0.7.55_x86_64.dmg` (140 MB), `Liquid.Clips.app.tar.gz` (136 MB) + `.sig`. Local desktop `package.json` is at `v0.7.78` — so there are **23 patch versions between what's released and what's on disk**. Mac DMGs are Apple-signed + notarised + stapled per IG-013 + `desktop/scripts/notarize.sh`. `/download` page on liquidclips.app dynamically fetches the latest GH release via `src/lib/latest-release.ts` (10-min ISR cache) — so the moment a new desktop tag publishes, the download surface updates automatically. **No Windows build at all** — `.github/workflows/release.yml` matrix is `macos-latest` aarch64 + x86_64 only. Memory note `liquid_clips_notarisation_pipeline` confirms 2-track release (cloud-ship for review + CI for staple).
**Fix:** (a) Cut a real `v0.7.78` (or whatever the next patch is) tag and run `desktop/scripts/ship.sh` — this is the morning blocker. (b) Windows is a strategic decision: ship Mac-only at launch (current state, accept the loss of ~50% of clipper audience) OR scope a Windows port (3+ weeks). Past memory `liquid_clips_demo_stage1` shows the bundle target is `"all"` in tauri.conf.json but only Mac runners build. SmartScreen friction is irrelevant because there's no Windows artifact.
**Time to fix:** ship Mac v0.7.78 = 1h once Daniel says go. Windows = NOT in scope this week.
**Owner:** Daniel-action (ship gate per `feedback_build_gate` memory).

---

### 6. Desktop app — legacy `desktop/` shell

**Status:** 🟢 SHIP-READY (call it v0.7.63 / .78 stable)
**Evidence:** Per `desktop/CLAUDE.md` all major surfaces are live: Workspace (drop video → clips), Lift Transcript, Clip pipeline (cut + reframe + thumbnail), Publishing (Ayrshare wired), Earn tab + AffiliateHero + Stripe Connect, Settings + API keys, Invaders mini-game, Browse Rewards in-app panel. 14 active iron gates (IG-001 to IG-014) lock the contracts. Memory `HQ_SESSION_RESUME.md` reports legacy `desktop/` is ~82% end-to-end. The 12 paying-customer journey gaps in `FLAWLESS_CUSTOMER_JOURNEY_SCOPE.md` (11 P0 / 45 P1 / 27 P2) are NOT all fixed — that scope was authored 2026-06-09 and is partly out of date, but the unresolved core is real (per `desktop/CLAUDE.md`: legacy Postiz publishing tiles still in Settings; PublishModal still uses legacy per-platform model; AskFix sprint #2 captions partial; Settings → Ayrshare panel works but the sprint #3 refactor is in flight).
**Fix:** Choose to ship v0.7.78 AS-IS, accept the FLAWLESS_CUSTOMER_JOURNEY P1s as "v0.7.x → v0.8.x sprint." The legacy app DOES generate real clips, real captions, real exports, real publishes today — that's the ship bar.
**Time to fix:** No fix needed for ship-ready. Polish sprint = 1 week.
**Owner:** Daniel decision + ship gate.

---

### 7. Desktop app — new `desktop-2/` shell

**Status:** 🔴 BLOCKER (if it's on the launch path) / 🟢 fine (if it's not)
**Evidence:** `desktop-2/package.json` version `0.8.0-shell`. Per `HQ_SESSION_RESUME.md`: "~55%". Sidecar wire-up: `desktop-2/src/design-os/engine/sidecar-stub.ts` has **77 method declarations** but only **5 real RPC entrypoints** wired via `sidecarCall` (ingest_url, ingest_file → start_run, get_project, run_stage, export_clip). The remaining ~72 methods (regenerate_clip, get_captions, edit_captions, add_clip, thumbnails, agency campaigns, etc.) drop through to `driveMockPipeline()` — a 6-second fake progress emitter. Tauri Rust shell DOES register `sidecar_call` (`src-tauri/src/lib.rs:133` + `:442`), so the wiring path exists; the engine layer just hasn't been ported. Settings.tsx IS real (replaces SimPage stub, P1-2 beta-honest surface). Wallet panel landed today (commit `bfd8af6`) at `desktop-2/src/design-os/earn/Wallet*.tsx`. SimPage stubs still in use for: CreateClips.tsx, ClipperJourney.tsx (read via grep). Bug list BUG-001 says "~2-week focused sprint to bring desktop-2 to parity."
**Fix:** **Do not put desktop-2 on the public ship list this week.** Either commit to a 2-week wire-up sprint OR explicitly fork it as "LC 2.2 preview, opt-in only" with a feature flag. Pick one in the same turn this audit is read.
**Time to fix:** 2 weeks of focused sprint (per BUG-001).
**Owner:** Daniel decision + code.

---

### 8. HQ admin (`account.liquidclips.app/admin`)

**Status:** 🟡 FRICTION (live but partially un-protected + un-configured)
**Evidence:** `/admin` redirects to `/sign-in` (Clerk gate works → 307). BUT: the IP allowlist gate was **removed** in commit `5d82cc6` ("too much friction") on 2026-06-25 — middleware comments confirm. Protection now stands on: Clerk session + admin email allowlist (`JUNIOR_ADMIN_EMAILS` env) + Clerk 2FA + recovery flow. **Recovery is fully unconfigured in production**: `curl https://api.liquidclips.app/admin/recovery/status` → `{"pin_configured":false,"auth_code_configured":false,"totp_configured":false,"pin_set":false,"auth_code_set":false,"ip_allowlisted":false}`. The 5 HQ-build agents (Security, Brand, Mgmt Gaps, AI Terminal, Recovery) are merged on local main but **not yet deployed** — admin in production is the pre-HQ build. 44 admin routes registered in backend (`/admin/mutations/*`, `/admin/community/channels`, `/admin/banners`, `/admin/announcements`, `/admin/bonus-ledger`, `/admin/users`, `/admin/whop-agents`, etc.).
**Fix:** Three actions in order. (a) Deploy account-app + backend to push the HQ build live (`vercel deploy --prod` + `railway up`). (b) Set `JUNIOR_ADMIN_EMAILS` env var on both Vercel projects (per `HQ_SESSION_RESUME.md`: `danieldiyepriye@gmail.com,mrddokubo@gmail.com,crazycatjackkids@gmail.com,thedoks2019@gmail.com`). (c) Visit `/admin/_security/PinSetup` + `/admin/_security/AuthCodeSetup` (post-deploy) to set PIN + auth code; enable Clerk 2FA on Daniel's account.
**Time to fix:** 1h total (deploy + env-var set + PIN setup).
**Owner:** Daniel-action + code-deploy.

---

### 9. Backend (`api.liquidclips.app`)

**Status:** 🟢 SHIP-READY
**Evidence:** Healthcheck `curl -s https://api.liquidclips.app/healthcheck` → `{"status":"ok","service":"junior-backend","version":"0.1.0","ayrshare_configured":true,"ayrshare_jwt_configured":true,"ayrshare_webhook_secured":true}`. 140 routes registered in openapi.json. All key surfaces live: 44 admin endpoints, 11 carrot/payout/Whop/Stripe endpoints, 16 community/channel/banner endpoints, 11 agency endpoints. Auto-seed of 9 community channels + 10 campaigns confirmed live (`/community/channels` returns 9, `/campaigns` returns 10). Webhooks live: `/webhooks/clerk`, `/webhooks/whop`, `/webhooks/stripe`, `/webhooks/stripe-connect`, `/webhooks/ayrshare`. Auto-deploy: **disabled** per `DEPLOYMENT.md` §3 — GitHub source disconnected on Railway intentionally; manual `railway up --service junior-backend` is the only deploy path. APScheduler in-process (numReplicas pinned at 1).
**Fix:** Backend itself is healthy. What is NOT live: `/me/wallet/summary` route (`curl https://api.liquidclips.app/me/wallet/summary` → 404) because the wallet code shipped locally in commit `bfd8af6` but the backend hasn't been re-deployed. Also missing in prod: all 11 admin_mutations endpoints, the admin_recovery endpoints, the agent_personas table.
**Fix:** `cd junior-backend && railway up --service junior-backend --detach` — 60–120 seconds.
**Time to fix:** 5 min.
**Owner:** Daniel-action (greenlit per memory `railway_deploys_authorized`).

---

### 10. Payments / payouts

**Status:** 🔴 BLOCKER (real money has not moved)
**Evidence:** `app/whop_payments.py` gates everything on `CARROT_WHOP_LIVE` env var defaulting to FALSE. Bug list BUG-006: "Backend rail is built (task #108). Blocked on: onboard Whop sub-merchant master account · fund master USDC wallet · test with $1 carrot first." `/me/carrot`, `/me/carrot/claim`, `/me/carrot/onboard` endpoints exist live and respond `{"detail":"missing bearer token"}` (correctly auth-gated). Stripe Connect Express for affiliates: `/me/affiliate/stripe-connect/onboarding` + `/me/affiliate/stripe-connect/status` live (mirror gate). Whop content-rewards proxy live: `/whop/bounties`, `/whop/bounties/public`, `/whop/submissions/{id}`. NO real Whop sub-merchant has been onboarded; NO USDC has been funded to a master wallet; NO clipper has received a real payout (only "mock" mode runs end-to-end).
**Fix:** Three serial actions. (a) Onboard Whop sub-merchant via Whop dashboard. (b) Fund master USDC wallet via Sui or Whop native rail (per memory `liquid_clips_whop_lead_decision`: Sui USDC second, Whop native first). (c) Flip `CARROT_WHOP_LIVE=true` on Railway. (d) Test with $1 carrot send to Daniel's own clipper account end-to-end. Until (d) passes, do not advertise the carrot flow to customers — it will look like a silent-success lie.
**Time to fix:** 1 day if Whop sub-merchant onboarding is straightforward. Unknown if Whop has KYC delays. Could be a week if KYC waits.
**Owner:** Daniel-action + waiting-on-Whop.

---

### 11. Onboarding + first-run

**Status:** 🔴 BLOCKER
**Evidence:** Bug list BUG-005 (still open): 4 onboarding community rooms missing from `junior-backend/scripts/seed_community_channels.py` — verified: the 9 seeded slugs (announcements, free-clipper-lobby, premium-rewards-hq, affiliate-growth-room, uncle-daniel-clips, viral-reaction-missions, ddb-beauty-clips, ddb-fashion-clips, sponsor-campaigns) do NOT include `start-here`, `install-help`, `first-clip-help`, `wins`. A new clipper installs the app and has nowhere structured to land. Bug list BUG-004: "First-run onboarding is SimPage stub" (`desktop-2/src/design-os/onboarding/`) — but if shipping legacy `desktop/`, this is irrelevant. Legacy desktop has the splash/intro cinematic + Invaders mini-game first-run flow but no "tile-tour." `docs/ONBOARDING_ROOMS_SCOPE.md` exists; bug list says ~45 min to add 4 entries.
**Fix:** Add the 4 seed rows to `junior-backend/scripts/seed_community_channels.py`, redeploy backend (lifespan auto-upserts). For first-run tile-tour: explicitly defer; ship without it and add a launch-day Loom video walkthrough instead.
**Time to fix:** 1 hour (45 min seed + 15 min redeploy + smoke).
**Owner:** code + Daniel-deploy.

---

### 12. Support / docs / community

**Status:** 🟡 FRICTION
**Evidence:** `/help` is live with 4 sub-pages (getting-started, publishing, billing-and-plans, troubleshooting). `/support` is live (returns 200). `mailto:hello@liquidclips.app` link in help-page footer is the support contact. Community channels: 9 seeded (see surface 11) — covering announcements + 5 clipper-niche channels + 1 affiliate + 1 sponsor + 1 premium rewards HQ. Per `DEPLOYMENT.md` §6: rooms with no `whop_channel_id` show "Room coming soon" non-clickable pill (free) or fall back to `https://whop.com/liquidclips/` (paid). Memory note: `whop_channel_id` values are pasted via Admin HQ → Community Channels and survive every redeploy (idempotent upsert). **It is unverified which of the 9 channels have real Whop chat_feed IDs pasted in production.**
**Fix:** (a) Verify (or paste) Whop `chat_feed_*` IDs for all 9 rooms via Admin HQ — without these, half the community surface is dead. (b) Add the 4 onboarding rooms (see surface 11). (c) Seed the 4 onboarding rooms with at least 1 pinned welcome post per room before public launch. (d) Decide if `hello@liquidclips.app` mailbox is actively monitored (likely Daniel's personal inbox via a forward — confirm + add a SLA promise on the help page).
**Time to fix:** 2h (Whop channel ID paste + welcome posts + mailbox forward confirmation).
**Owner:** Daniel-action + waiting-on-Whop (for chat_feed IDs).

---

## Top-10 shipping checklist · "What it takes to ship to 100 real clippers next week"

Ordered by must-do-first → nice-to-have. Each item gates the next one or runs in parallel where noted.

1. **[BLOCKER · 30 min] Push local main to origin + deploy three surfaces.** `git push origin main` (after Daniel-greenlit), then `vercel deploy --prod` on account-app, `vercel deploy --prod` on liquidclips-marketing, `railway up --service junior-backend --detach`. Confirms the 13 commits from today (HQ build + wallet + remediation) land in production. Owner: Daniel-action + code-deploy.

2. **[BLOCKER · 15 min] Set HQ env vars on Vercel + Railway.** `JUNIOR_ADMIN_EMAILS` on both Vercel projects + Railway. `CLAUDE_ADMIN_API_KEY` on Vercel account-app (for AI Terminal). Without these, `/admin` is wide-open to any signed-in Clerk user, or fails entirely. Owner: Daniel-action.

3. **[BLOCKER · 15 min] Set recovery PIN + auth code via HQ UI + enable Clerk 2FA on Daniel's account.** Visit `/admin/_security/PinSetup` and `/admin/_security/AuthCodeSetup` post-deploy. Recovery is the break-glass; with no PIN set, a Clerk lockout = total HQ lockout. Owner: Daniel-action.

4. **[BLOCKER · 1h] Cut desktop v0.7.78 release via `desktop/scripts/ship.sh`.** Local desktop is 23 patch versions ahead of the public v0.7.55 (2026-06-12). Tag-triggered CI signs + notarises + staples + uploads to draft GH release. `/download` page auto-fetches latest via 10-min ISR cache. Owner: Daniel-action (ship gate).

5. **[BLOCKER · 1h] Seed 4 onboarding rooms + paste Whop chat_feed IDs for all 13 rooms.** Add `start-here`, `install-help`, `first-clip-help`, `wins` to `junior-backend/scripts/seed_community_channels.py`; redeploy; paste IDs via Admin HQ. Without this a first-run clipper has nowhere to ask for help. Owner: code + Daniel-action + waiting-on-Whop.

6. **[BLOCKER · 30 min] Run a real £1 Stripe-via-Clerk-Billing test charge AND a real Whop checkout end-to-end, on production.** Confirm: card charges, webhook fires, user.tier flips, dashboard reflects new tier, desktop `lc:tier-refresh` event clears the sidecar watermark cache, exported MP4 is watermark-free. This is `DEPLOYMENT.md` §6 smoke-test #4 — must be done by a human, not deferred. Owner: Daniel-action.

7. **[BLOCKER · 1 day to 1 week] Onboard Whop sub-merchant + fund USDC wallet + flip `CARROT_WHOP_LIVE=true` + test $1 carrot to Daniel's own clipper account end-to-end.** Until this passes, the Earn tab + Wallet panel are an honest "your money is in pipeline but withdraw is beta" display — do NOT advertise paid carrots to customers. If Whop KYC delays, ship Wallet in beta-honest mode AND defer carrots to v0.7.79. Owner: Daniel-action + waiting-on-Whop.

8. **[FRICTION · 4h] Hand the build to 5–10 friendly clippers BEFORE opening to 100.** Cold-launching to 100 with un-verified Stripe checkout + un-tested onboarding rooms is the recipe for the silent-success-lie bug Daniel has been guarding against. Recruit 5 clippers from the existing DDB / Uncle Daniel audience, run them through install → sign-up → first clip → first publish → first carrot. Owner: Daniel-action.

9. **[FRICTION · 4h] Rotate the 7 chat-exposed credentials.** Per `DEPLOYMENT.md` §7: OpenAI API key, Vercel personal access tokens (mrddokubo + liquidclips team), `INTERNAL_API_SECRET`, Clerk Secret Key. Sync to `~/.claude-credentials/` mirrors AND Vercel/Railway env vars. Memory hard rule: secrets that have surfaced in a chat are compromised — rotate before a public launch broadens the attack surface. Owner: Daniel-action.

10. **[FRICTION · 4h] Decide desktop-2 launch posture: defer or feature-flag.** Currently desktop-2 is 55% wired (5 of 77 sidecar methods real). Putting it anywhere a clipper can reach is a regression vs legacy desktop. Two clean options: (a) defer entirely — keep building, no public exposure; (b) ship behind an explicit `LC_CHANNEL=2.2-preview` opt-in flag with a "preview, things may break" header. Don't ship desktop-2 as default. Owner: Daniel decision.

---

## Risks not covered above

- **Trademark / brand:** "Liquid Clips" — no public IP search documented in repo. If a `liquidclips.*` mark is held by someone else, a public launch lights the legal fuse. ~£200 + 1h via UK IPO trademark search before launch.
- **GDPR / data deletion:** `/account-deletion` page is live on marketing. Backend has no documented data-deletion endpoint that I can see (no `/me/delete` route in 140-route openapi.json). EU customers can demand erasure under GDPR Article 17; without a wire, every request becomes a manual DB query. ~1 day to wire + 1h to document SLA.
- **Tax / VAT:** Stripe handles US sales tax for US customers via Stripe Tax (if enabled). Whop handles its own. UK VAT registration threshold (£90k turnover) is not immediate but will hit fast if launch goes well; HMRC registration takes ~30 days. Daniel-action to verify the Stripe Tax toggle is on for Liquid Clips Stripe account.
- **Abuse / Whop content rewards:** The carrot flow lets clippers earn USDC for posting clips. Without a duplicate-submission / sock-puppet / botnet defence, the launch is an open faucet. Per memory `liquid_clips_sponsored_rewards`: "defer dupe-detection to Whop." If Whop's dupe-detection has not been verified against a real attack, $X disappears in week 1. Mitigation: cap CARROT per user per day to a small number ($5/day) for the first 30 days, monitor manually via HQ Bonus Ledger tab.
- **AI Terminal cost guardrails:** AI Terminal cost cap was REMOVED in HQ ship-lens remediation (per `HQ_SESSION_RESUME.md` task #115). Without a per-run hard cap, a single admin session can run up an unbounded Anthropic bill. Even though it's admin-only, a stolen Clerk session = stolen Claude API budget. Re-add a hard per-run + per-day budget on `CLAUDE_ADMIN_API_KEY` before enabling AI Terminal in prod.
- **Auto-updater rehearsal:** Per `desktop/CLAUDE.md`, the v0.4.99 auto-updater live rehearsal "still needs one live rehearsal" before v0.5.0. We are at v0.7.55 public / v0.7.78 local — the rehearsal note never came down. Either the rehearsal was done and undocumented, or every public release since v0.5.0 was a fresh install + uninstall dance. Confirm or run the rehearsal now (memory `feedback_memory_completeness`: don't re-ask, but the doc is the source).
- **Apple receipt validation:** The desktop ship path is direct DMG, not Mac App Store — no Apple receipt path. Stripe + Whop own the subscription truth. This is fine, but App Store guideline 3.1.1 ("If you want to unlock features or functionality within your app, you must use IAP") only applies inside the Mac App Store; direct DMG bypasses it. Browse Rewards panel has the App Store guideline 3.1.1 commerce-redirect filter per `desktop/CLAUDE.md` — but that's defensive for a hypothetical future App Store submission, not load-bearing today.
- **iCloud Drive codesign quirk:** Per memory `icloud_codesign_workaround`, local builds from a Desktop/jnr-style iCloud-managed path fail at codesign. Canonical repo `/Users/dipdip/code/jnr` is not under iCloud File Provider — but if any future contributor opens the project from a synced path, the build silently fails. Document in `desktop/CLAUDE.md` Build section.

---

## Bottom line for Daniel

**Today's plumbing is mostly right; today's deploys are stale.** Items 1–4 of the top-10 list are pure shipping muscle — they could all be done by lunch. Items 5–7 are the customer-facing truths that determine whether the launch is honest or a silent-success lie. Items 8–10 are the difference between a controlled-rollout launch and a "we'll patch it in week 2" launch.

**Suggested order for the first half of today:** (1) deploy local main everywhere → (2) set HQ env vars + PIN + 2FA → (3) cut desktop v0.7.78 → (4) seed onboarding rooms + paste Whop IDs → (5) run a real Stripe + Whop test charge. That's a 4-hour block and lands you with: live HQ, live wallet endpoint, live latest desktop, real onboarding rooms, verified checkout. **Everything else (carrot live, 100-clipper push, desktop-2 decision) is afternoon and tomorrow.**
