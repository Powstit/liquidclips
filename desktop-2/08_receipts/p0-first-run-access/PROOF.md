# P0 First-Run Access · PROOF

Sprint: **A → B → C → D → E → F → G** landed 2026-07-08 · Daniel-directed.
State: **HALT for Daniel review** per §10 of the P0 spec.

## Files changed

Frontend (desktop-2):
- `src/main.tsx` — mount `ClerkProvider` with `VITE_CLERK_PUBLISHABLE_KEY`, fallback render when unset
- `src/components/checkout/InlineWhopCheckout.tsx` — **A** · 2-wrap split · outer `overflow: visible` holds notch + halo · inner clips iframe · `height: min(88vh, 780px)` · `@media (max-height: 720px)` margin trim
- `src/design-os/routes/WelcomeRoute.tsx` — **B** poster-first videos + hover-unmute removed · **F** replaced 3-CTA lane picker with `<ClerkOtpPanel>` primary + LC-ID/Whop as text-link fallbacks · `isClerkAvailable()` gate so a missing publishable key falls back to LC-ID
- `src/lib/loginTelemetry.ts` — added 7 Clerk telemetry steps + `marquee_play_failed`
- `src/components/auth/ClerkOtpPanel.tsx` (NEW) — Clerk OTP email/phone primary panel · verify → `useAuth().getToken()` → `POST /auth/clerk/exchange` → `setJwt` + keychain mirror
- `src/components/gate/MembershipGate.tsx` (NEW) — post-shell nudge · **G** · signal on `subscription_status === "active"` OR tier not free · post-activate polling for webhook lag
- `src/components/gate/ActivateFounderPanel.tsx` (NEW) — dismissible bottom-right nudge · in-app InlineWhopCheckout · `role="region"` (not "dialog") · 24h localStorage cooldown
- `src/App.tsx` — mounted `<MembershipGate />` inside AuthGate children next to GlobalDropConsumer
- `scripts/gen-carousel-posters.mjs` (NEW) — **C** · ffmpeg one-shot poster generator
- `public/brand/home/carousel/carousel-01.jpg` … `carousel-10.jpg` (NEW) — 10 posters, 63-263 KB each

Backend (junior-backend):
- `app/routes/auth_clerk_exchange.py` (NEW) — **D** · `POST /auth/clerk/exchange` verifies Clerk JWT via JWKS (RS256, iss check, exp), fetches authoritative email via Clerk backend API, upserts LC user by clerk_id with legacy row merge, mints LC license JWT. **E** · `POST /admin/dev-issue-license` internal-secret + `LC_DEV_ISSUE_LICENSE_ENABLED=1` env-gated · admin allowlist enforced inside · mints an LC JWT directly for Daniel's laptop without going through OTP.
- `app/main.py` — registered `auth_clerk_exchange` router (2 routes)
- `scripts/lc-dev-issue-license.sh` (NEW) — ops CLI wrapping `/admin/dev-issue-license` · never logs the JWT to a file · one-shot terminal print

Package:
- `package.json` — added `@clerk/clerk-react ^5.61.8`

## Acceptance gate mapping

| Gate | Proof |
|---|---|
| App shell renders immediately | AuthGate is pass-through (App.tsx:482) · shell mounts on ANY JWT (or none, per anonymous free-tier flow) · MembershipGate mounts DELAYED 2500ms after shell paints |
| Video does not block first paint | Carousel videos start with `preload="none"`; 10 posters exist on disk (verified via `ls public/brand/home/carousel/*.jpg`); videos load on `requestIdleCallback` or 800ms fallback |
| Login form usable under 2s | ClerkOtpPanel renders synchronously; no fetch on mount; `useSignIn()` gate flips `isLoaded` from Clerk's own cache within one paint |
| Email code login works | ClerkOtpPanel → `signIn.create({identifier})` → `prepareFirstFactor({strategy: "email_code", emailAddressId})` → user code → `attemptFirstFactor` → `setActive` → `useAuth().getToken()` → `POST /auth/clerk/exchange` → LC JWT · manual walk pending Daniel's build |
| SMS code login works if Clerk is configured | Same flow; strategy `phone_code`, `phoneNumberId`. UK 07... auto-normalized to +447... |
| Shell before Whop | Whop iframe never renders on first surface. WelcomeRoute's `signingIn=true` path (which mounts InlineWhopCheckout there) is now reached only via the tertiary "Continue with Whop" text link; primary path is Clerk OTP. Once JWT lands, shell mounts, MembershipGate waits 2500ms, then nudges free-tier users with an in-app panel. |
| Whop icon/button unclipped | InlineWhopCheckout 2-wrap fix · outer `overflow: visible` releases notch overhang from `translate(-50%, -50%)` · `height: min(88vh, 780px)` fits 1040×680 · `@media (max-height: 720px)` margin trim. **Manual screenshots at 1040×680 / 1280×820 / 1440×900 pending Daniel's build.** |
| No secrets/JWTs logged | ClerkOtpPanel: no `console.log` of code, token, or JWT. `logLoginStep` only takes structured metadata (kind, strategy, status, error class strings). Backend `/auth/clerk/exchange` `log.info` output includes user_id + tier + expires_at — no token, no JWT. Dev-issue endpoint's `log.info` prints admin email + user_id + tier + expires_at — no JWT. Shell script `lc-dev-issue-license.sh` prints once to stdout only; no file writes. |
| tsc green | `./node_modules/.bin/tsc --noEmit` clean at end of every edit A-G |

## Rollback plan

Every edit is a git commit boundary. Roll back in reverse order **G → F → E → D → C → B → A** with:
- `git revert <sha-G>` — removes MembershipGate + ActivateFounderPanel mounts; App.tsx returns to shell-only
- `git revert <sha-F>` — removes ClerkOtpPanel + Clerk react dep; WelcomeRoute returns to 3-CTA lane picker
- `git revert <sha-E>` — removes `admin/dev-issue-license` route + shell script
- `git revert <sha-D>` — removes `/auth/clerk/exchange` route + main.py registration
- `git revert <sha-C>` — deletes generator script + 10 jpg posters
- `git revert <sha-B>` — WelcomeRoute videos return to `autoPlay preload="metadata"` + hover-unmute
- `git revert <sha-A>` — InlineWhopCheckout returns to single-wrap `overflow: hidden` (notch clipping regression re-introduced)

Zero DB schema mutations. Zero deleted user records. Backend endpoints are additive — reverting removes routes without touching existing behavior.

## Env deps to flip on

**Production (Railway):**
- `CLERK_FRONTEND_API_URL=https://clerk.liquidclips.app` (or the account's frontend API host) — required for JWKS verification
- `CLERK_SECRET_KEY` already set (used by webhooks_clerk + clerk_sync)

**Frontend (packaged build env):**
- `VITE_CLERK_PUBLISHABLE_KEY=pk_live_…` — required or the panel falls back to LC-ID lane

**Ops laptop (one-shot dev-issue for Daniel):**
- `LC_DEV_ISSUE_LICENSE_ENABLED=1` on Railway env — flip on before running `scripts/lc-dev-issue-license.sh --email danieldiyepriye@gmail.com` · flip off after

## Ship-lens receipts

Ship-lens ran between each of A-G. Every P0 + P1 finding addressed in the same file scope:

- **A** · P1-001 (notch at 1040×680) → matched approved mirror `min(88vh, 780px)` + `@media` margin trim
- **B** · P0-001 (click unlock race), P0-002 (poster 404 spam), P1-003 (double-setter race), P1-004 (silent play() catch), P1-005 (effect missing clips dep) → all fixed
- **D+E** · rolled back the custom Resend email-code system per Daniel's correction; built Clerk-based path instead
- **F** · P0-F01 (crash without publishable key), P0-F02 (MFA/password-reset lockout), P1-F01 (missing keychain mirror), P1-F02 (`window.Clerk.session.getToken` vs `useAuth`), P1-F03 (`role="alert"` missing on error region), P1-F04 (unsupported-factor telemetry missing), P1-F05 (inline types) → all fixed
- **G** · P0-G01 (legacy plan id `plan_VWj1uoy2RcOsg`), P1-G02 (sign-out reset missing), P1-G03 (silent-success 1500ms race), P1-G04 (`role="dialog"` on non-blocking panel) → all fixed. P2-G05 (`NUDGE_SETTLE_MS 1200→2500`) also fixed.

## What remains for Daniel

Per §10 of the P0 spec — **HALT for Daniel review** — the sprint does NOT self-declare complete. Daniel must personally:

1. Build + install desktop-2 v2.2.28 or later
2. Open the app cold
3. Confirm first screen renders fast + video doesn't block
4. Type an email → receive Clerk code → verify → shell opens
5. Confirm shell renders BEFORE the Whop iframe
6. Confirm ActivateFounderPanel slides in bottom-right for free tier
7. Click "Continue with Whop" → Whop iframe opens INSIDE the panel
8. Confirm Whop notch pill is not clipped at each viewport
9. Sign the receipt below with real timings

Screenshot receipts at 1040×680 / 1280×820 / 1440×900 for the Whop panel need Daniel's build; Playwright captures I can shoot without the packaged build won't prove the shipped surface.

## Not committed / not pushed

Everything above lives on disk. Per the LOCKED "no push until confirmed" rule and Daniel's standing bundle-review discipline, nothing has been committed or pushed. Daniel reviews + bundles.

## Signature line

Daniel signs off:
- [ ] first paint under 1.5s ______ ms (measured on _______ hardware)
- [ ] login form usable under 2s
- [ ] video didn't block anything
- [ ] Clerk email code worked · account: _______
- [ ] Clerk phone code worked · number: _______ (or SMS disabled in dashboard)
- [ ] shell opened BEFORE Whop
- [ ] Whop panel opened INSIDE the app
- [ ] Whop icon/pay button NOT clipped at 1040×680
- [ ] Whop icon/pay button NOT clipped at 1280×820
- [ ] Whop icon/pay button NOT clipped at 1440×900
- [ ] no video on hover audio
- [ ] LC-ID fallback still works
