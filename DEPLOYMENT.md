# Liquid Clips — deployment runbook

Authoritative guide for shipping any v0.7.5x release across the four
surfaces. Replaces any prior assumptions that pushing to `main`
auto-deploys everything — most of it does not.

**Source-of-truth rule:** this file. If a memory file, a CLAUDE.md, or
an in-session report conflicts with this, **this file wins**. Update
this file when the deployment topology changes; never the other way.

---

## Surfaces at a glance

| Surface | Auto-deploys on push? | How to deploy | Production URL |
|---|---|---|---|
| `account-app` | **No** | Vercel CLI from `account-app/` | https://account.liquidclips.app |
| `liquidclips-marketing` | **No** | Vercel CLI from `liquidclips-marketing/` | https://liquidclips.app |
| `junior-backend` | **No** (GH source disconnected on Railway) | Railway CLI from `junior-backend/` | https://api.liquidclips.app |
| Desktop (`Liquid Clips.app`) | **No** | Tag + `desktop/scripts/ship.sh` (CI signs/notarises) | GitHub Releases on tag push |

---

## 1. account-app

* **Deploys manually** through the Vercel CLI. GitHub push does **not**
  reliably auto-deploy this project (the Vercel project is not git-
  linked — confirmed via `/v9/projects/...` API: `link: None`).
* **Production alias:** https://account.liquidclips.app
  Also serves `https://account.jnremployee.com` via the satellite
  cookie path (legacy primary — see `account-app/src/middleware.ts`).

### Deploy command

```bash
source ~/.claude-credentials/vercel-junior.env
cd ~/Desktop/jnr/account-app
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

The CLI prints a `*.vercel.app` URL and a `Aliased` line that maps the
new build behind `account.liquidclips.app` once the deploy reaches
`READY` state.

### Required check after every deploy

`/embed/earn` **must not** carry the frame-deny headers — the desktop
hosts that surface inside a Tauri child webview and `frame-ancestors
'none'` breaks the rendering. The middleware at
`account-app/src/middleware.ts` owns the policy; every non-`/embed/*`
path still gets the strict deny.

```bash
# Pass = NO content-security-policy + NO x-frame-options on this path.
curl -sI https://account.liquidclips.app/embed/earn \
  | grep -iE 'content-security|x-frame'

# Contrast — every other path SHOULD still deny:
curl -sI https://account.liquidclips.app/dashboard \
  | grep -iE 'content-security|x-frame'
# Expected on /dashboard:
#   content-security-policy: frame-ancestors 'none'
#   x-frame-options: DENY
```

---

## 2. liquidclips-marketing

* **Deploys manually** through the Vercel CLI. Same git-link gap as
  account-app.
* **Production URL:** https://liquidclips.app

### Deploy command

```bash
source ~/.claude-credentials/vercel-junior.env
cd ~/Desktop/jnr/liquidclips-marketing
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

### Required check after every deploy

* Deployment reports `readyState: READY`.
* Production alias responds 200:

  ```bash
  curl -sI https://liquidclips.app/ | head -3
  ```

* `/download` route resolves the latest GitHub Release asset (this
  marketing route auto-picks the most recent desktop release; verify
  whenever you cut a new desktop tag).

---

## 3. junior-backend

* **Deploys manually** with Railway. The Railway service's GitHub
  source is **disconnected** intentionally — see
  `junior-backend/CLAUDE.md`: a prior reconnection attempt was 31
  commits behind local `main` and would have rolled production back.
* **Healthcheck:** https://api.liquidclips.app/healthcheck
* **Production seed:** community channels and Uncle Daniel campaigns
  **auto-seed idempotently on lifespan startup** (since `d849b69`).
  Re-runs are no-ops — the seeds upsert by slug. Pre-existing rows are
  not clobbered (e.g. `whop_channel_id` values pasted via Admin HQ
  survive every redeploy).

### Deploy command

```bash
cd ~/Desktop/jnr/junior-backend
railway up --service junior-backend --detach
```

The `--detach` flag returns immediately and prints the Railway build URL.
Poll healthcheck until it returns 200 (typical: 60–120s):

```bash
until curl -s -o /dev/null -w "%{http_code}" https://api.liquidclips.app/healthcheck | grep -q "200"; do sleep 5; done
```

### Required checks after every deploy

```bash
# 1. Healthcheck
curl -s https://api.liquidclips.app/healthcheck | python3 -m json.tool

# 2. New v0.7.55+ routes registered
curl -s https://api.liquidclips.app/openapi.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
paths=sorted(d.get('paths',{}).keys())
expected = ['/bonus-ledger/me','/community/channels','/banners','/announcements',
            '/admin/community/channels','/admin/banners','/admin/announcements',
            '/admin/bonus-ledger']
for p in expected:
    print('OK' if p in paths else 'MISS', p)
"

# 3. Seeds landed
curl -s https://api.liquidclips.app/community/channels \
  | python3 -c "import json,sys; print('community count:', len(json.load(sys.stdin)['channels']))"
# expected: community count: 9

curl -s https://api.liquidclips.app/campaigns \
  | python3 -c "import json,sys; print('campaigns count:', len(json.load(sys.stdin)['campaigns']))"
# expected: campaigns count: 10 (7 legacy + 3 Uncle Daniel funnel rows)
```

### Hard rule — local DB seeding

**Do not** attempt to seed against production from a local shell using
the Railway environment. The `DATABASE_URL` Railway exposes uses
`postgres.railway.internal`, which only resolves **inside** the Railway
private network. Local `psql` / `railway run ... -m scripts.seed_*`
calls will fail with:

```
could not translate host name "postgres.railway.internal" to address
```

The seed runs **automatically during lifespan startup** since `d849b69`.
That's the only supported path for the v0.7.55 release. If you ever
need to re-seed mid-deploy, hit `/admin/community/channels` (CRUD via
Admin HQ) instead of bypassing the lifespan.

---

## 4. Desktop release

* **Main push does not release desktop.** GitHub Actions `release.yml`
  is tag-triggered (`on: push: tags: ['v*']`), not branch-triggered.
* **Desktop release is tag/ship-script based.**
* **Do not run** until the manual smoke tests in §6 pass against the
  account-app + backend deploys.

### Command (when approved)

```bash
bash desktop/scripts/ship.sh 0.7.55 "release notes"
```

`ship.sh` enforces:
* clean working tree
* on `main`
* version not already shipped
* signs + notarises + staples the DMG
* uploads to a draft GitHub Release
* verifies the live manifest before claiming success

Local builds are **not shipped to users** — never bypass `ship.sh` to
hand a DMG out manually.

---

## 5. v0.7.55 live state (as of the last deploy in this batch)

| Surface | Status | Detail |
|---|---|---|
| account-app | **READY** | `dpl_HxDB6kvxEvYpPuNkXWdJTtcDBqUn` aliased to account.liquidclips.app |
| marketing | **READY** | `dpl_AZkoNijBPQMNgCd4axE3e1k2uQ2w` |
| backend | **HEALTHY** | `/healthcheck` 200 · lifespan seeds completed twice ("seed complete." in logs) |
| community seed | **9 channels** | announcements · free-clipper-lobby · uncle-daniel-clips · viral-reaction-missions · ddb-beauty-clips · ddb-fashion-clips · sponsor-campaigns · premium-rewards-hq · affiliate-growth-room |
| campaigns | **10 campaigns** | 7 legacy + 3 Uncle Daniel funnel (clip-uncle-daniel-content · viral-reaction-clips · liquid-clips-proof-clips) |
| desktop | **Not yet released** | Awaiting smoke-test pass |

---

## 6. Required post-deploy smoke tests

Walk these before approving a desktop release. Use a real free account
on one device + a real paid account on another (or one account toggled
via the `JUNIOR_FREE_WATERMARK` env override).

* [ ] **Free dashboard** shows `X / 100 clips remaining` copy (not the
  legacy "free exports left" copy).
* [ ] **Paid dashboard** shows `Premium · no watermark` pill on the
  same surface — no countdown.
* [ ] **Free export** burns the animated watermark into the final MP4
  bytes. Probe with:

  ```bash
  ffmpeg -i /path/to/exported.mp4 -ss 5 -frames:v 1 /tmp/wm-check.png
  open /tmp/wm-check.png
  ```

  Pass = pixel-invader bug + `MADE WITH / LIQUID/CLIPS` wordmark
  visible in the bottom-right corner.
* [ ] **Paid export** has no watermark. Probe the same way; pass = no
  fuchsia pixel in the bottom-right corner.
* [ ] **Captions toggle ON** burns captions into the MP4. Probe frame
  during a speech beat; pass = caption text visible.
* [ ] **Captions toggle OFF** skips captions. Probe same beat; pass =
  no caption text.
* [ ] **Earn page** shows the `$1 free / $5 premium` ladder via the
  PayoutLadder component, mission filter chips with live counts, and
  the BonusEarnings panel (free → upsell tile; paid → 4 totals).
* [ ] **Upgrade** opens the Whop checkout embed at `/upgrade`.
  Requires `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID` env var on the Vercel
  account-app project.
* [ ] **Checkout complete** at `/checkout/complete` refreshes
  membership. Verify the desktop's `lc:tier-refresh` listener clears
  the sidecar's 10-min watermark cache so the next export is clean.
* [ ] **Admin HQ** loads all five new/changed tabs:
  * Missions (CRUD over `sponsored_campaigns`)
  * Banners
  * Announcements
  * Community Channels
  * Bonus Ledger
* [ ] **Community fallback** opens `https://whop.com/liquidclips/`
  when a room has no `whop_channel_id` (paid user · "Open community →"
  button). Free user with the same unconfigured room sees a
  "Room coming soon" non-clickable pill.
* [ ] **Configured rooms** open `whop.com/c/<chat_feed_id>` once the
  IDs are pasted into Admin HQ → Community Channels. Verify by pasting
  one chat_feed_XXX into a single room and confirming the desktop
  Community card routes to the chat feed (not the fallback landing).

---

## 7. Secret hygiene

### Rotate after stable release

Once the smoke tests above pass and v0.7.55 is locked stable, rotate
the secrets that were exposed during this deployment run:

* [ ] **OpenAI API key** — regenerate at
  https://platform.openai.com/api-keys, update
  `~/.claude-credentials/openai.env`.
* [ ] **Vercel personal access tokens** — regenerate at
  https://vercel.com/account/tokens, update
  `~/.claude-credentials/vercel-junior.env` and
  `~/.claude-credentials/vercel.env`.
* [ ] **`INTERNAL_API_SECRET`** — Railway dashboard →
  `junior-backend` service → Variables → rotate; restart backend; sync
  to `~/.claude-credentials/junior-internal.env` AND to the
  account-app's Vercel env var (same name) so the admin proxy keeps
  authenticating.
* [ ] **Clerk Secret Key** — Clerk dashboard → API Keys → rotate;
  update `~/.claude-credentials/clerk.env` AND the Vercel env vars on
  account-app (`CLERK_SECRET_KEY`).
* [ ] **Railway / Postgres credentials** (if exposed) — Railway
  dashboard → Postgres service → reset password; linked services
  auto-receive the new `DATABASE_URL`.

### Mirrored locations to sync after each rotation

| Secret | Local file | Vercel env var (account-app) | Railway env var (junior-backend) | Other |
|---|---|---|---|---|
| OpenAI | `openai.env` | — | `OPENAI_API_KEY` | gen scripts |
| Vercel tokens | `vercel-junior.env` · `vercel.env` | — | — | CLI sessions |
| `INTERNAL_API_SECRET` | `junior-internal.env` | `INTERNAL_API_SECRET` | `INTERNAL_API_SECRET` | — |
| Clerk secret | `clerk.env` | `CLERK_SECRET_KEY` | `CLERK_WEBHOOK_SECRET` (separate) | — |
| `DATABASE_URL` | — | — | auto-injected | — |

### Hard rule — never print secrets in deploy reports

Future deploy runs must:
* Never echo, `cat`, or `grep` raw secret values into chat output.
* Use shell substitution (`"$VAR"`) so values stay in process memory.
* If a secret needs to be displayed for confirmation, show **only its
  first 4 characters + `…`** (e.g. `vcp_…`).

---

## Quick-reference deploy sequence (full v0.7.5x ship)

```bash
# 1. Make sure local main is clean and committed.
cd ~/Desktop/jnr
git status

# 2. Push code to GitHub.
git push origin main

# 3. Deploy account-app.
source ~/.claude-credentials/vercel-junior.env
cd account-app && vercel deploy --prod --yes --token "$VERCEL_TOKEN"
cd ..

# 4. Deploy marketing.
cd liquidclips-marketing && vercel deploy --prod --yes --token "$VERCEL_TOKEN"
cd ..

# 5. Deploy backend.
cd junior-backend && railway up --service junior-backend --detach
until curl -s -o /dev/null -w "%{http_code}" https://api.liquidclips.app/healthcheck | grep -q "200"; do sleep 5; done
cd ..

# 6. Smoke-test §6 against the live deploys.

# 7. (Only after manual approval) Cut the desktop release.
bash desktop/scripts/ship.sh 0.7.55 "release notes"
```
