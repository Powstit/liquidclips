# j007 · Publish · Native Walk Prep

**Journey ID:** `j007-publish`
**Capability:** `capability.content-distribution`
**Simulatable:** `partial` — the publish sheet UI + connection-required state + scheduled-copy state are simulatable; the real social post (Ayrshare or persistent-cookie webview post) is external + native.
**Beta gate item satisfied:** *Publish flow reaches a real destination or shows an honest "connect first" state* (RC1 lower bar · full publish is a post-RC1 goal per `feedback_ayrshare_mistake.md`).

---

## Purpose

Prove that a signed-in Liquid Clips user with ≥1 finished clip in My Clips can:

1. Open the Publish sheet on a clip.
2. See connection state for each social platform (Instagram · TikTok · YouTube · X).
3. Get an honest "Connect first" affordance when no session exists.
4. When a persistent-cookie webview session DOES exist, the sheet shows the destination + a "Post now" or "Post in webview" affordance.
5. The post either lands on the real platform (manual receipt) OR the sheet clearly shows it opened the webview for manual posting (per `liquidclips_publish_walkaround.md`).

**Note per feedback_ayrshare_mistake.md:** RC1 does NOT ship Ayrshare / OAuth SDK / Profile Key. The publish walk-around is the persistent-cookie in-app webview + assisted-schedule local records + native OS notification. Walk exercises the webview handoff, not an Ayrshare API call.

---

## Prerequisites

### Credentials

- `INTERNAL_API_SECRET` — JWT mint.
- No social API keys required · the walk-around uses webview cookies, not APIs.

### Test accounts

- Fresh Liquid Clips user with tier that permits publish (any paid tier · Base has publish surfaced but rate-limited).
- ≥1 finished clip from `j006` walk (`state=complete`, ffmpeg output on disk).
- Optional: a burner Instagram / TikTok test account for the manual receipt step. Do NOT use production social accounts because the persistent webview will store their cookies on the walk machine.

### Env + processes

- Backend + sidecar running.
- Desktop 2 shell installed (webview needs the shell · Vite dev CANNOT test webview persistence).
- Persistent-cookie webview enabled (per legacy `browse.rs:189` · 2026-06-30). Confirm via Settings → Browser → "Persistent sign-in enabled".

### Test files

- N/A · uses clip files from j006.

### State

- Clean webview cookie jar for the platform being tested. Reset via Settings → Browser → "Clear session" if walk needs to re-test the not-connected state.

---

## Step-by-step walk

### Step 1 · Seed + generate clip (dependency)

Complete j006 first (or reuse its output).

**Automated?** Yes (harness reuse).

### Step 2 · Navigate to My Clips · pick a clip (automated)

Playwright: `page.goto("/#/library")` (or wherever My Clips lives).

Assert:
- Grid shows ≥1 clip tile.
- Click first tile · detail view opens.

Capture: screenshot, canonical-state.

**Automated?** Yes.

### Step 3 · Open Publish sheet (automated)

Click "Publish" or "Share" affordance on the clip detail (opens `desktop-2/src/components/publish/PublishModal.tsx`).

Assert:
- `PublishModal` mounts.
- Platform tabs / buttons visible (IG · TikTok · YT · X or subset per plan).
- No fake "Connected" state on a fresh user.

Capture: screenshot, canonical-state.

**Automated?** Yes.

### Step 4 · Connection-required state (automated)

For each platform, if no persistent-cookie session exists, the sheet shows a "Connect first" state:

- Button copy like `"Sign in to Instagram"` (or `"Connect Instagram"`).
- No `"Post now"` button visible until connected.

Assert:
- `[data-platform-state="not_connected"]` OR button-copy match.
- No fake success (INV-002).

Capture: screenshot, canonical-state.

**Automated?** Yes.

### Step 5 · Open persistent webview (MANUAL)

Click "Sign in to Instagram" (or platform of choice).

Shell opens an in-app webview at instagram.com. Manual:
1. Sign in with the burner test account.
2. Complete any 2FA / captcha.
3. Land on the IG home feed (proves session).
4. Close the webview (X button or Cmd+W).

Assert (post-webview close):
- Sheet re-renders with `[data-platform-state="connected"]` for that platform.
- Button copy flips to `"Post in webview"` or `"Open in Instagram to post"`.

**Automated?** NO — real IG login requires a human. `test.skip(true, "NATIVE: persistent-cookie webview + real IG sign-in requires manual step")`.

Capture: screen recording of the webview session.

### Step 6 · Persistent session verified (semi-automated)

Refresh the sheet · re-open Publish on the same clip. The webview session persists between opens (per `liquidclips_publish_walkaround.md`).

Assert:
- Platform stays `connected` after sheet close + reopen.
- No re-sign-in prompt.

**Automated?** Partial · the "no re-sign-in prompt" claim requires observing the webview which is native. The sheet state can be automated.

Capture: screenshot showing `connected` state on second open.

### Step 7 · Post handoff (MANUAL)

Click "Post in webview". Shell opens IG in a webview, pre-fills the caption (via clipboard write) + focuses the upload button. Manual:
1. Select the clip file from Finder (or paste path).
2. IG's upload flow runs.
3. User taps "Share" in the webview.
4. Post lands on IG.

Assert (post-post):
- Backend receives a `POST /me/publish/record` call (assisted-schedule local record per `assistedSchedule.ts`).
- Native OS notification fires (`"Posted to Instagram · check profile"`).

**Automated?** NO — the actual IG post is fully manual. `test.skip(true, "NATIVE: real IG post requires manual pilot")`.

Capture: screen recording, notification screenshot, backend log tail showing `/me/publish/record`.

### Step 8 · Assisted-schedule state (automated)

If user picked "Schedule" instead of "Post now", the local record is written without a real post. Publish sheet closes; a scheduled banner appears on the clip tile.

Assert:
- SQLite `scheduled_posts` (or equivalent · verify path) has a new row.
- Clip tile shows `[data-scheduled]` badge with the target time.
- No API call was fired.

Capture: screenshot, canonical-state, SQLite dump of the scheduled_posts row.

**Automated?** Yes — the scheduled record is a pure-frontend + backend flow with no external service.

---

## Expected capture artifacts per step

| Step | screenshot | canonical-state | telemetry | backend.log | DB snapshot |
|---|---|---|---|---|---|
| 1 seed | — | — | — | ✅ | — |
| 2 my clips | ✅ | ✅ | ✅ | — | — |
| 3 sheet open | ✅ | ✅ | ✅ | — | — |
| 4 not-connected | ✅ | ✅ | ✅ | — | — |
| 5 webview sign-in (MANUAL) | ✅ (recording) | — | — | — | — |
| 6 persistent | ✅ | ✅ | ✅ | — | — |
| 7 post (MANUAL) | ✅ (recording) | — | ✅ (`publish_completed`) | ✅ | ✅ (publish_records row) |
| 8 schedule | ✅ | ✅ | ✅ | ✅ | ✅ (scheduled_posts row) |

All artifacts land under `lcos/reports/golden-path/capture/j007-publish/<NN-step>/`.

---

## Pass / fail criteria

| # | Criterion | Pass | Fail |
|---|---|---|---|
| P1 | Publish sheet mounts on ≥1 clip | ✅ | ❌ (blocks entire journey) |
| P2 | Fresh user shows `not_connected` state per platform · no fake connect | ✅ if state=not_connected + honest copy | ❌ any fake "Connected" state (INV-002) |
| P3 | Webview sign-in opens the real platform site | ✅ (manual observation) | ❌ if in-app fake page renders |
| P4 | Session persists across sheet close + reopen | ✅ | ❌ re-sign-in required = webview persistence broken |
| P5 | Assisted-schedule writes a real local record | ✅ if DB row present | ❌ 0 rows = broken |
| P6 | Native OS notification fires after post | ✅ (manual observation) | ❌ no notification = broken hook |
| P7 | No Ayrshare / OAuth SDK / Profile Key code path exercised | ✅ if backend log shows NO Ayrshare calls | ❌ any Ayrshare = regression (per feedback_ayrshare_mistake.md) |

Overall pass = P1 + P2 + P5 (automated slice) + P3 + P4 + P6 (manual slice). P7 is a REGRESSION guard: must always pass.

---

## Known gaps · what cannot be automated

1. **Real social login.** IG / TikTok / YT / X all require human sign-in + 2FA. Manual, one-time-per-burner.
2. **In-app webview state.** Webview is a Tauri webview, not a Playwright browser context. No hook to inspect its DOM. Assertion is via observation.
3. **Real post confirmation.** Whether the clip actually appeared on IG requires opening IG in a separate browser + visual confirmation. Beta receipt.
4. **Native OS notification.** No JS API to assert notification delivery. Manual observation.
5. **Ayrshare regression guard.** Backend must NOT be running with any Ayrshare env vars. Walk records `env | grep -i ayrshare` in the capture bundle so a missing config is visible.
6. **BUG-012 · runtime staleness.** Same as j005 / j006 · quit + relaunch before this walk.

---

## Beta gate impact

Satisfies (partial):
- ✅ *Publish flow reaches a real destination or shows honest not-connected state* — proven by P2 + P3 + P7.
- ✅ *No Ayrshare regression* — proven by P7.
- ✅ *Assisted-schedule records exist* — proven by P5.

Does NOT satisfy:
- ⏭ *Fully automated publish* — deferred post-RC1 per pricing pivot.
- ⏭ *Analytics · post-publish metrics rollup* — out of scope for this walk.

---

## Rollback / reversal

1. `scripts/rc1-beta/reset-test-env.sh` wipes SQLite (including `scheduled_posts`, `publish_records`).
2. Settings → Browser → "Clear session" clears the persistent webview cookie jar (removes IG session from the walk machine).
3. On the burner IG account: delete any test posts manually so the account doesn't accumulate junk.

---

## Cross-references

- Publish modal: `desktop-2/src/components/publish/PublishModal.tsx` (READ-ONLY).
- Whop submit modal: `desktop-2/src/components/publish/SubmitToWhopModal.tsx` (READ-ONLY · separate flow · C3's campaign submit territory).
- Persistent webview: legacy `desktop/src-tauri/src/browse.rs:189` (READ-ONLY · shell freeze).
- Assisted-schedule: `desktop-2/src/lib/assistedSchedule.ts` (READ-ONLY).
- Related memory: `liquidclips_publish_walkaround.md`, `feedback_ayrshare_mistake.md`.
- Depends-on: j006 (clip exists), j001 (JWT).
- Related bugs: none active for publish.
