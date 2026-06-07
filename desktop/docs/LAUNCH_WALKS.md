# Launch Walks — v0.7.13

Six live walks blocking v0.7.13 ship. Each walk has:

1. **What I CAN verify from here** — terminal/curl/filesystem assertions an
   agent can run without Daniel touching a keyboard.
2. **What needs Daniel's keyboard** — literal click steps in plain English.
3. **Assertions for each step** — precise observable claims.
4. **Where things could go wrong silently** — lens-flagged failure modes that
   slip past a green tsc/cargo check.

Conventions:

- All curl commands use public endpoints unless a token source is noted.
- Backend root: `https://api.jnremployee.com` (env: `BACKEND_BASE`).
- Embed root: `https://account.liquidclips.app` (env: `EMBED_BASE`).
- Desktop deep-link scheme: `junior://` and `liquidclips://` (both registered
  in `src-tauri/tauri.conf.json` → `plugins.deep-link.desktop.schemes`).
- Keychain service: `video.junior.desktop`, account: `JUNIOR_LICENSE_JWT`.
- Tick PASS/FAIL inline. A walk is shippable only when all assertions pass.

---

## Walk 1 — Clean first-run profile (no `~/LiquidClips` state)

Goal: a brand-new user installs Liquid Clips, opens it, and lands somewhere
sane. Empty `~/LiquidClips` + empty localStorage + no JWT in keychain. The
audit cares about empty-state behaviour, intro cinematic firing, and the
Workbench staying out of the way until the user does something.

### What I CAN verify from here

```bash
# Backup current state so this walk doesn't trash live projects.
mv ~/LiquidClips ~/LiquidClips.backup.$(date +%s)

# Wipe any stored JWT.
security delete-generic-password -s video.junior.desktop -a JUNIOR_LICENSE_JWT 2>/dev/null || true

# Wipe the desktop's webview localStorage so the intro re-plays.
rm -rf "$HOME/Library/Application Support/app.liquidclips.desktop/EBWebView/Default/Local Storage"

# Verify the wipe took.
ls -la ~/LiquidClips 2>&1 | grep -q "No such file" && echo "✓ projects gone"
security find-generic-password -s video.junior.desktop -a JUNIOR_LICENSE_JWT 2>&1 \
  | grep -q "could not be found" && echo "✓ JWT gone"

# Backend healthcheck — confirms api.jnremployee.com is up before launching the app.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/healthcheck

# Embed root — first-run signed-out users land here for activation.
curl -fsSL --max-time 10 https://account.liquidclips.app/embed/earn \
  | grep -c "Link your account"   # expect >= 1
```

### What needs Daniel's keyboard

1. Quit Liquid Clips (Cmd-Q). Wait until the dock icon disappears.
2. Run the wipe block above.
3. Launch Liquid Clips from `/Applications/Liquid Clips.app`.

### Assertions for each step

- **Intro cinematic plays on launch.** Splash + Invaders glass overlay show
  with the v0.7.4 intro firing fix (#55). Skip button reachable.
- **After skip / completion: app lands on Workbench empty state.** No leftover
  view from a previous session (because localStorage was wiped).
- **OnboardingOverlay shows** (T1.2 gate: `view.kind === "empty"` AND zero
  projects on disk — both true here).
- **Nav labels are single-word** ("Build / Earn / Clips / Settings") per the
  Liquid Clips nav-naming memory.
- **No "you're signed in" badge** in Earn or Settings — meStatus discriminated
  union (Fix #9) should render the signed-out CTA path.
- **No console errors** (open `Help → Toggle DevTools` once visible, check
  Console pane).

### Where things could go wrong silently

- **OnboardingOverlay shows on a non-empty Workbench** (T1.2 regression) — if
  the gate condition gets weakened, a returning user sees the overlay after a
  view glitch.
- **Intro cinematic silently skipped because localStorage flag persisted** — wipe
  did not include the EBWebView path the bundle actually uses (check
  `app.liquidclips.desktop` not `junior-desktop`).
- **Empty Library shows a stale "imported pack" badge.** Fix #2a only applies
  when project metadata says imported — if the badge is hardcoded into the
  empty placeholder card, it'll show on a clean install too.
- **Backend was up but webview can't reach it.** App may show Earn CTA but
  clicking through fails because the desktop is rendering a cached error
  page. Inspect Network tab during step 3.
- **JWT silently re-populated from a 1Password sync** — if Daniel's password
  manager auto-fills the keychain item, the "clean" state isn't clean. Re-run
  the `security delete-generic-password` step after launch and confirm.

---

## Walk 2 — Clerk sign-in → activation → LICENSE_JWT deep-link

Goal: from signed-out state, complete Clerk sign-in on the satellite domain,
hit the activation bridge, receive the `junior://` deep-link, and confirm
the desktop minted + stored the LICENSE_JWT.

### What I CAN verify from here

```bash
# Clerk satellite resolves and serves a sign-in page.
curl -fsSL --max-time 10 https://account.liquidclips.app/sign-in \
  | grep -ci "clerk\|sign in"   # expect >= 1

# Activation bridge endpoint exists. Anonymous GET should 401/403, not 404.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/desktop/connect

# Confirm keychain entry was created post-walk:
security find-generic-password -s video.junior.desktop \
  -a JUNIOR_LICENSE_JWT -w 2>/dev/null | head -c 40

# Decode the JWT header + payload (no signature check — we just want the
# claims surface so we can prove it's the right shape):
JWT=$(security find-generic-password -s video.junior.desktop \
  -a JUNIOR_LICENSE_JWT -w 2>/dev/null)
if [[ -n "$JWT" ]]; then
  python3 -c "
import base64, json, sys
jwt = '''$JWT'''
parts = jwt.split('.')
def pad(s): return s + '=' * (-len(s) % 4)
print('header:', json.loads(base64.urlsafe_b64decode(pad(parts[0]))))
print('claims:', json.loads(base64.urlsafe_b64decode(pad(parts[1]))))
"
fi

# Verify deep-link scheme is registered with LaunchServices:
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -dump | grep -A2 "junior:\|liquidclips:" | head -20
```

### What needs Daniel's keyboard

1. From signed-out Workbench, click `Sign in` (Earn or Settings entry point).
2. Browser opens to `https://account.liquidclips.app/sign-in`. Complete Clerk
   sign-in with the test account.
3. After Clerk redirects back, click `Activate this Mac` in account-app.
4. macOS prompts: "Allow this page to open Liquid Clips?" — click Allow.
5. Desktop foregrounds, shows "Activated — welcome back, Daniel" toast.

### Assertions for each step

- **Step 1 assert:** Clicking Sign in opens the system default browser, NOT a
  webview inside the app. (Apple sign-in guideline + the Activation Bridge
  memory: webview-Clerk has rejection precedent.)
- **Step 2 assert:** Browser URL bar reads `https://account.liquidclips.app/sign-in`
  exactly. No third-party redirect chain.
- **Step 3 assert:** Activation CTA fires a `junior://activate?challenge=...`
  link via window.location, not a postMessage hop.
- **Step 4 assert:** macOS prompt names "Liquid Clips" (not "junior-desktop").
  If it names junior-desktop, the bundle metadata didn't pick up the rebrand.
- **Step 5 assert:** `security find-generic-password -s video.junior.desktop`
  returns a JWT. Decoded payload has `sub` (Clerk user id), `tier`, `exp` in
  the future.

### Where things could go wrong silently

- **Webview-instead-of-browser fallback.** If the deep-link button calls
  `window.open` instead of `window.location.href`, Tauri may eat it inside the
  webview — Clerk sign-in succeeds in the embedded view but the deep-link back
  never fires.
- **Challenge expired.** Activation Bridge memory: the challenge is server-
  signed with a short TTL. If Daniel sits on the Activate screen for >5min,
  the link silently 401s. Backend must show a "challenge expired, try again"
  not a generic activation error.
- **JWT written but not picked up.** Desktop reads the keychain on boot — if
  the read happens before the deep-link handler writes, the app shows the
  signed-out UI even though the JWT exists. Symptom: kill + relaunch the
  desktop and it suddenly shows signed-in.
- **Wrong scheme registered.** `lsregister -dump | grep junior:` must include
  `app.liquidclips.desktop`. If a stale dev build owns the scheme handler,
  the deep-link opens an OLD Liquid Clips.
- **Tier downgrade.** Decoded JWT `tier` should match what the Clerk org
  reports. If Stripe billing rolled back a subscription mid-walk, the JWT
  reflects the old tier — Earn will gate features the user thinks they have.

---

## Walk 3 — Full clip-gen → remix/enhance → publish loop

Goal: paste a URL, run lift transcript, generate clips, open one in the
remix/enhance workflow, edit captions, publish to Ayrshare. The full
end-to-end product loop.

### What I CAN verify from here

```bash
# Sidecar binaries (ffmpeg/ffprobe + face detector) reachable.
SC=/Users/dipdip/Desktop/jnr/desktop/python-sidecar/bin
$SC/ffmpeg -version | head -1
$SC/ffprobe -version | head -1
ls -lh $SC/junior-face-detect

# Faster-whisper tiny model is present.
ls -lh /Users/dipdip/Desktop/jnr/desktop/python-sidecar/models/faster-whisper-tiny/ 2>&1 | head -5

# Cancel marker not stuck from a previous run.
ls ~/LiquidClips/.lift_cancel 2>&1 | grep -q "No such" && echo "✓ no stale cancel"

# OpenAI key (BYO Free, hosted Pro+) reachable from keychain.
security find-generic-password -s video.junior.desktop -a OPENAI_API_KEY -w \
  2>/dev/null | head -c 8

# Backend proxy_llm reachable (Pro+ hosted path).
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/proxy_llm/healthcheck
```

### What needs Daniel's keyboard

1. From signed-in Workbench, paste a known YouTube URL (≤2 min for fast walk).
2. Click Script → confirm transcript renders.
3. Click Generate Clips → wait for the cut + reframe + thumbnail pipeline.
4. Open the first clip → Captions Drawer → edit one line → re-bake.
5. Click Publish → select connected Ayrshare channel → schedule for +5min.

### Assertions for each step

- **Step 1 assert:** Paste validation accepts the URL (no "invalid URL" toast).
  Workbench transitions to a "lifting" state with a single Cancel button.
- **Step 1 assert:** `ls ~/LiquidClips/projects/` gains exactly one new dir.
- **Step 2 assert:** Transcript pane fills with whisper output within ~5× the
  source-video duration (CPU). Heartbeat updates every ~1s.
- **Step 3 assert:** ResultsGrid renders the LLM-picked clips, each with a
  thumbnail file on disk. Verify:
  ```bash
  LATEST=$(ls -t ~/LiquidClips/projects/ | head -1)
  ls ~/LiquidClips/projects/$LATEST/clips/      # mp4s
  ls ~/LiquidClips/projects/$LATEST/thumbnails/ # jpgs
  ```
- **Step 4 assert:** Re-bake updates the `.ass` file + the `vertical_path` mp4
  mtime. Original YouTube download stays untouched (T2.6 invariant).
- **Step 5 assert:** Publish modal status-branched summary (Fix #4) — shows
  "Scheduled for HH:MM" not the legacy "Publishing..." spinner forever.

### Where things could go wrong silently

- **Generation guard fires on cancel but project dir survives.** Stale half-
  built project leaks into Library. Verify Library doesn't render zombies.
- **Heartbeat suppression breaks under high CPU.** Two updates fire per
  segment, doubling progress visually. Look for jitter in the progress bar
  during transcribe.
- **Pipeline reports done but Captions chip is grey on the card.** Caption
  bake is decoupled from reframe (Phase 1) but the card chip may not poll
  the new state. Fix #6 caption chip should turn pink immediately after
  re-bake.
- **Publish ChannelPicker shows "no channels" when one is actually paused.**
  Fix #7 should render error/paused state, not silent empty.
- **Hosted LLM proxy 401s for a Free-tier user.** BYO key fallback should
  kick in, but if the OpenAI key validation (Fix #6) regressed, Workbench
  silently freezes at "thinking..." without a humanError surface.

---

## Walk 4 — Ayrshare connect + publish private test

Goal: from Settings → Ayrshare panel, kick off connection, complete the
external Ayrshare flow, return to the desktop, and publish a private test
post to a connected channel.

### What I CAN verify from here

```bash
# Backend Ayrshare panel endpoints.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/ayrshare/profile_status

# Connected accounts list (requires LICENSE_JWT auth).
JWT=$(security find-generic-password -s video.junior.desktop \
  -a JUNIOR_LICENSE_JWT -w 2>/dev/null)
if [[ -n "$JWT" ]]; then
  curl -sS -H "Authorization: Bearer $JWT" --max-time 10 \
    https://api.jnremployee.com/ayrshare/channels | head -200
fi

# Confirm the public app.ayrshare.com URL used by AyrshareConnectionPanel
# resolves (the panel opens an external browser; no in-app webview).
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  "https://app.ayrshare.com/social-accounts?profileKey=preview"
```

### What needs Daniel's keyboard

1. Settings → Ayrshare → click `Connect a channel`.
2. External browser opens to `app.ayrshare.com/social-accounts?profileKey=…`.
3. Complete platform connect (e.g. Instagram). Return to the desktop.
4. Click Refresh in the Ayrshare panel.
5. Pick a clip from Library → Publish → schedule a private test post for
   the just-connected channel.

### Assertions for each step

- **Step 1 assert:** Panel copy reads "opens your browser · no ayrshare
  signup · come back and refresh" (the literal AyrshareConnectionPanel
  string). No "sign up with Ayrshare" wording — Daniel's onboarding is
  hidden under the seller key.
- **Step 2 assert:** URL bar host is `app.ayrshare.com`. Profile key in the
  query string matches the one returned by `/ayrshare/profile_status`.
- **Step 3 assert:** Curl `/ayrshare/channels` now lists the new platform.
- **Step 4 assert:** ConnectionBadge in Earn embed flips to "connected" via
  Fix #8 (real state, not always-green placeholder).
- **Step 5 assert:** Publish goes through. Ayrshare returns a postId. Backend
  stores it for analytics polling.

### Where things could go wrong silently

- **Profile key cached wrong.** If `profileKey=preview` leaks into prod (the
  AyrshareConnectionPanel comment shows this as the fallback), the connect
  attaches to a shared sandbox, not the user's profile.
- **Browser-back into the app brings stale data.** Panel needs a fresh fetch
  on focus, not just on mount. Symptom: connection succeeds upstream but
  panel still says "no channels".
- **Publish "succeeds" but Ayrshare rejected the asset.** Modal shows
  scheduled state but Ayrshare's API actually returned an error inside the
  response body. Fix #4 status-branched summary should surface this.
- **Rate limit silently swallowed.** Ayrshare hourly cap returns 200 with an
  error inside the body — backend must propagate the error string up, not
  treat any 200 as success.
- **Wrong tier publishes through hosted path.** Free-tier user should be
  blocked from hosted publishing per the feature flag in `features.py`. If
  the check uses an old tier name, free users silently consume Pro budget.

---

## Walk 5 — Stripe Connect affiliate onboarding

Goal: from Earn tab, complete Stripe Connect Express onboarding so the user
can receive affiliate payouts.

### What I CAN verify from here

```bash
# Affiliate state endpoint exists.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/affiliate/me

# Stripe Connect onboarding link endpoint exists.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/affiliate/stripe/onboarding_link

# Webhook endpoint registered (Stripe POSTs here on connect.updated).
curl -sS -o /dev/null -w "%{http_code}\n" -X POST --max-time 10 \
  https://api.jnremployee.com/webhooks/stripe \
  -H "Content-Type: application/json" -d '{}'
# Expect 400/401/403 (signature mismatch), NOT 404 or 500.

# Stripe Express dashboard URL host is reachable.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://connect.stripe.com/setup/v1/test  # 404 acceptable, 200/301 ideal
```

### What needs Daniel's keyboard

1. Earn tab → `Get paid` → choose Stripe Connect.
2. External browser opens to a Stripe Express onboarding URL.
3. Complete Stripe form (test mode: use Stripe test data; live mode: real KYC).
4. Stripe redirects back to `account.liquidclips.app/embed/earn` or app deep-link.
5. Desktop Earn tab updates to show "Payouts enabled, next payout: …".

### Assertions for each step

- **Step 1 assert:** Earn tab shows the affiliate provider picker only when
  meStatus is signed-in. Fix #9 discriminated union should hide the picker on
  expired sessions and show a re-auth CTA.
- **Step 2 assert:** URL bar host is `connect.stripe.com`. Account id in the
  URL matches the one Settings.tsx renders (line 1012:
  `aff.payout_provider === "stripe_connect"`).
- **Step 3 assert:** Stripe form pre-fills the email Clerk has on file. If
  not, the backend isn't forwarding email to the create-account call.
- **Step 4 assert:** Redirect lands inside the embed earn page, NOT a Stripe
  thank-you page that strands the user.
- **Step 5 assert:** `curl /affiliate/me` (with JWT) returns `payouts_enabled
  = true`, `payout_provider = "stripe_connect"`.

### Where things could go wrong silently

- **`/setup` link reused across users.** Stripe Connect onboarding links are
  single-use. If the backend caches one, two users in a row see the same
  prefilled form. Cache must be keyed on user id.
- **Webhook signed with wrong secret in prod.** Stripe POSTs `connect.updated`
  → backend rejects with 400 because the local-dev webhook secret leaked to
  prod env. Desktop never sees `payouts_enabled` flip. Verify the webhook
  endpoint accepts a signed payload from Stripe CLI listen.
- **Express onboarding completes but Stripe webhook lags.** Desktop shows
  "Pending — refresh in a minute" if the panel doesn't subscribe to backend
  push. If it doesn't, the user thinks the flow broke.
- **Wrong region.** Stripe Connect Express requires a country. If the backend
  hardcodes `US` but Daniel's onboarding a UK creator, the form rejects
  silently with a generic "couldn't onboard" message.
- **Affiliate ledger row not created.** Stripe Connect succeeds but the
  affiliate row is still missing — Earn renders "no earnings yet" even after
  a payout. Verify by hitting `/affiliate/me` and checking for a non-null
  `connect_account_id`.

---

## Walk 6 — Whop OAuth callback after real Whop login

Goal: from Earn → Whop bounty submission, complete Whop OAuth so the user
can submit bounty proof + receive Whop payouts (alternate to Stripe).

### What I CAN verify from here

```bash
# Whop OAuth start endpoint (returns authorize URL).
curl -sS --max-time 10 https://api.jnremployee.com/whop/oauth/start | head -200

# Whop OAuth status endpoint.
JWT=$(security find-generic-password -s video.junior.desktop \
  -a JUNIOR_LICENSE_JWT -w 2>/dev/null)
if [[ -n "$JWT" ]]; then
  curl -sS -H "Authorization: Bearer $JWT" --max-time 10 \
    https://api.jnremployee.com/whop/oauth/status
fi

# Backend proxy /whop/* (App API Key gated — must NOT be reachable without
# a valid LICENSE_JWT; this assertion validates the Earn-tab gate from the
# Junior Earn / Whop bounty proxy memory).
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://api.jnremployee.com/whop/bounties
# Expect 401/403, NOT 200 (proxy must require LICENSE_JWT).

# Whop OAuth callback host reachable.
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 \
  https://whop.com/oauth   # 200 or 301 acceptable
```

### What needs Daniel's keyboard

1. Earn → Connect Whop → click `Connect Whop`.
2. External browser opens to `whop.com/oauth/...`.
3. Sign in to Whop with the test creator account.
4. Approve the Liquid Clips OAuth app scopes.
5. Whop redirects back to `account.liquidclips.app/embed/earn?whop=ok` or
   the `junior://whop-oauth-callback` deep-link.
6. Desktop Earn tab shows "Whop connected" and the bounty submit CTA enables.

### Assertions for each step

- **Step 1 assert:** Connect CTA opens system browser, not webview (same
  Apple guideline as Clerk).
- **Step 2 assert:** URL bar host is `whop.com`. State parameter present and
  matches what `/whop/oauth/start` returned.
- **Step 3 assert:** Whop login page shows. Profile avatar comes from
  `profilePicture { sourceUrl }`, not the legacy `image` field (Junior Earn
  memory — Whop API gotcha).
- **Step 4 assert:** Scopes list includes bounty-related permissions only,
  not full account read.
- **Step 5 assert:** Redirect succeeds. Desktop foregrounds (if deep-link
  path) within 2s. `/whop/oauth/status` returns `connected: true`.
- **Step 6 assert:** Earn ConnectionBadge flips to connected (Fix #8). Bounty
  submission via JWT-bridge postMessage (Fix #10) works on first click.

### Where things could go wrong silently

- **State mismatch silently rejected.** Backend `/whop/oauth/callback` 401s
  but the embed page renders a generic "couldn't connect" without specifics.
  Hard to debug — log the state mismatch on the backend.
- **Affiliate-vs-license-vs-bounty Whop confusion.** Three different Whop
  surfaces in this product (Junior Whop checkout, Junior Earn bounty proxy,
  affiliate Whop campaign). Token from one MUST NOT auth another. Verify
  `/whop/oauth/status` keys on the LICENSE_JWT user, not a stale OAuth
  cookie.
- **Avatar broken.** If the public profile RPC returns null `sourceUrl`,
  the Earn tab silently falls back to an initials avatar — looks broken,
  no error.
- **Bounty submit returns 200 but Whop didn't store it.** JWT-bridge
  postMessage path (Fix #10) needs the desktop to receive an ack from Whop,
  not just from the embed page. If the embed proxies optimistically without
  awaiting Whop, "submitted" can be a lie.
- **Wrong account linked.** OAuth completes on a Whop creator that isn't
  Daniel's seller account — bounty submissions earn for the wrong wallet.
  `/whop/oauth/status` should return the Whop user id; Daniel must confirm
  it matches the expected seller account.

---

## Composite ship-gate

A v0.7.13 ship requires:

- Walk 1 PASS (clean first-run sane).
- Walk 2 PASS (Clerk activation working end-to-end).
- Walk 3 PASS (full clip-gen + publish loop working).
- Walk 4 PASS (Ayrshare channel connect + publish).
- Walk 5 PASS (Stripe Connect onboarding green).
- Walk 6 PASS (Whop OAuth callback green).
- `bash scripts/walk-import.sh` exits 0.
- `bash scripts/walk-import.md` 15-step manual walk all green.

Any FAIL blocks ship. Restoring the backed-up `~/LiquidClips.backup.<ts>`
after the walks is part of cleanup — do not leave the user's projects
wiped.
