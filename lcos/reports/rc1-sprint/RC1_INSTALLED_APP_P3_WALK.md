# RC1 · Installed-App P3 Live Walk Script

**Purpose:** the final SHIP gate. Automated tests are not enough. This walk exercises the real Tauri shell + native file picker + local Whisper + Anthropic API + ffmpeg + real campaign submit + Codex-style update journey.

**Runs on:** your installed Liquid Clips app (`/Applications/Liquid Clips.app` or wherever it lives).

**Owner:** Daniel executes · captures artifacts into `lcos/reports/rc1-sprint/p3-walk-capture/`.

**Time budget:** ~30-40 min.

---

## Preconditions

- Installed Liquid Clips app on your Mac (existing install · we don't rebuild the shell)
- `~/.claude-credentials/junior-backend.env` present with `INTERNAL_API_SECRET`
- `ANTHROPIC_API_KEY` in the sidecar env (existing Pro/hosted setup)
- At least one real Whop campaign ID available for the submit step
- A real MP4 file on your Mac (10-60 seconds is fine)
- HQ URL reachable (account.liquidclips.app or local `pnpm dev` for account-app)

## Step 0 · Promote the runtime bundle built this sprint

The frontend was built at commit tip. Promote it:

```bash
cd ~/code/jnr
VERSION="rc1-codex-$(date +%s)"
BUNDLE_DIR="$HOME/Library/Application Support/Liquid Clips/runtime/bundles/$VERSION"
mkdir -p "$BUNDLE_DIR"
cp -R desktop-2/dist/* "$BUNDLE_DIR/"

# Compute integrity + update current.json
INDEX_SHA=$(shasum -a 256 "$BUNDLE_DIR/index.html" | awk '{print $1}')
cat > "$HOME/Library/Application Support/Liquid Clips/runtime/current.json" <<EOF
{
  "version": "$VERSION",
  "bundle_path": "$BUNDLE_DIR",
  "index_sha256": "$INDEX_SHA",
  "promoted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source_sha": "$(git -C ~/code/jnr rev-parse HEAD)"
}
EOF
echo "Promoted $VERSION"
```

## Step 1 · Codex update journey walk

**Goal:** prove requirements 1-10 from Train D1 on the installed app.

### 1a · Quit any running Liquid Clips instance
```bash
osascript -e 'tell application "Liquid Clips" to quit' 2>/dev/null || true
sleep 2
```

### 1b · Launch installed app · sign in
- Open `/Applications/Liquid Clips.app`
- If not signed in, sign in via OTP (email → code → JWT)
- Capture screenshot: `p3-walk-capture/01-signed-in.png`
- Confirm: TopHud identity strip does NOT say `Guest`. Should show handle or LC-ID or email-local.

### 1c · Trigger a background check
Open the app diagnostics section (Settings > Diagnostics). Manually trigger a "Check now" if a CTA exists, OR wait for the background poll (~5 min).

Since we just promoted `$VERSION` and the app was launched BEFORE promotion, the app's `useRuntimeVersion` should currently show the previous version. After trigger, `update_detected` fires.

### 1d · Verify the soft indicator appears (non-critical)
Non-critical criticality = `null` (this promotion didn't set one). Confirm:
- A soft "Update ready · Restart to continue →" pill appears (near app version or in Diagnostics)
- Capture: `p3-walk-capture/02-update-ready-indicator.png`

### 1e · Verify indicator defers if we start a protected journey
Start uploading a video (drop a real MP4 into the drop zone). Before completing:
- Confirm indicator changes to *"Update ready · Waiting for j005-upload →"*
- Capture: `p3-walk-capture/03-indicator-deferred-upload.png`
- Cancel the upload (or complete it) so we can proceed to Step 1f

### 1f · Click the indicator · verify RestartGate mounts
Click the soft indicator. Should transition to State 4 (Restart required).
- Modal appears
- Copy MUST read: **"Update ready · Restart to continue."** headline + **"A new version is ready. The app will quit and relaunch to activate it. Your sign-in, current view, and any unsaved draft will be restored."**
- CTA MUST read: **"Restart now"**
- Confirm the modal blocks all other navigation
- Capture: `p3-walk-capture/04-restart-gate-modal.png`

### 1g · Click "Restart now" · verify quit-and-relaunch behaviour
Click the button.
- App quits · then relaunches (via `plugin-process::relaunch()`)
- If the app relaunches automatically → OK, note the behaviour
- If the app quits but doesn't relaunch → open it again manually. **This is the honest beta truth.**
- On boot:
  - App should show TopHud identity strip immediately (JWT + identity restored from `localStorage["lc.restore.v1"]`)
  - App should land on the same route you were on before restart
  - App version pill should reflect the new `$VERSION`
- Capture: `p3-walk-capture/05-restored-on-new-runtime.png`

### 1h · Verify HQ received the 8 telemetry topics
Visit HQ Admin (account-app · /admin > LCOS Events tab). Filter by topic:
- `update_detected` · at least 1
- `update_download_started` · at least 1
- `update_staged` · at least 1
- `update_gate_shown` · at least 1 · one with `deferred_by_protected_journey`
- `update_restart_clicked` · exactly 1
- `update_boot_verified` · exactly 1 with `matches: true`
- `route_restored_after_update` · exactly 1

Capture: `p3-walk-capture/06-hq-lcos-events.png`

**Codex journey walk PASS criteria:** all 7 topics observed + `update_boot_verified.matches: true` + soft indicator observed + deferral observed + gate copy verified + app version updated + JWT preserved.

## Step 2 · Clipping journey walk

**Goal:** prove `real MP4 → upload → local Whisper → Anthropic → ffmpeg → real clips on disk → My Clips → reveal/open/copy → real campaign submit` end-to-end.

### 2a · Upload a real video
- Open Upload route
- Native file picker · select a real MP4 (10-60s recommended)
- Capture: `p3-walk-capture/07-upload-selected.png`
- Confirm preflight ok (no red state)
- Submit
- Confirm upload progress UI shows real progress bars (not fake)
- Capture: `p3-walk-capture/08-upload-in-progress.png`

### 2b · Wait for clip generation
- Backend dispatches to sidecar
- Sidecar runs Whisper on the audio track
- Anthropic judges the transcription for clip-worthy moments
- ffmpeg cuts the source into clip files
- Poll status via the app OR curl `GET /me/clip-runs/latest`

**Success criteria:**
- `clip_run.status = 'completed'`
- `clip_run.result_clip_ids` is non-empty
- Each clip file exists on disk (usually under `~/Library/Application Support/Liquid Clips/clips/`)
- ffprobe reports valid duration on each clip MP4

Capture: `p3-walk-capture/09-clip-run-completed.png` + `p3-walk-capture/09-clip-files-ls.txt` (from `ls -la` of the clips dir)

### 2c · My Clips route shows the real clips
- Navigate to My Clips
- Each clip visible with: thumbnail · title (from Anthropic judgment) · duration · reveal/open/copy affordances
- Capture: `p3-walk-capture/10-my-clips.png`
- Click "Reveal in Finder" on one clip · verify Finder opens with the file selected
- Capture: `p3-walk-capture/11-reveal-in-finder.png`
- Click "Copy path" on another · verify clipboard contains the path (paste into a scratch file)
- Capture: `p3-walk-capture/12-copy-path-clipboard.txt`

### 2d · Submit to a real campaign
- Click Submit on one clip
- SubmitToWhopModal opens · select a real Whop campaign ID
- Confirm the campaign dropdown does NOT show `preview_campaign_id` or `test_campaign` values
- Submit
- Verify backend response is 200 with real campaign_id in the confirmation
- Capture: `p3-walk-capture/13-submit-modal.png` + `p3-walk-capture/14-submit-response.txt` (from backend log or curl `GET /me/submissions/latest`)

**Clipping walk PASS criteria:** real MP4 uploaded · clip_run completed with ≥1 real MP4 file on disk with valid duration · My Clips shows the clips with all 4 affordances · reveal/open/copy work · real campaign submitted with real ID · zero fake fallback IDs.

## Step 3 · Money journey walk (spot check)

**Goal:** confirm canonical /me/money-rollup is the ONLY source and UI numbers match backend byte-identical.

### 3a · Wallet page reads from rollup
- Navigate to Wallet
- Note the wallet balance number displayed
- Capture: `p3-walk-capture/15-wallet-ui.png`
- Curl `GET /me/money-rollup` (with your JWT) — capture the payload to `p3-walk-capture/16-money-rollup.json`
- Assert: UI value == payload.`wallet_balance_cents / 100`

### 3b · HQ mirror byte-identical
- Curl `GET /admin/money-rollup/{your_user_id}` (with internal secret + admin JWT)
- Assert: HQ payload byte-identical to `/me/money-rollup` from step 3a

### 3c · Withdraw disabled if not eligible
- If your test account is not eligible (no affiliate agreement OR no whop OR zero balance):
  - Withdraw CTA must be disabled or hidden
  - Capture: `p3-walk-capture/17-withdraw-state.png`

**Money walk PASS criteria:** UI == /me/money-rollup == /admin/money-rollup byte-identical + withdraw eligibility gate respects INV-004.

## Step 4 · Auth + identity spot check

- Navigate to any protected route · confirm identity strip stays consistent (no Guest flash)
- Force-refresh (`Cmd+R`) · confirm identity strip repaints immediately from persisted snapshot
- Capture: `p3-walk-capture/18-identity-persistence.png`

## Step 5 · Regression spot check

- Cancel modal · confirm 6-state disposition renders correctly for your account state
- Referral link + QR · confirm copy works + telemetry fires (grep backend log)
- Capture: `p3-walk-capture/19-cancellation-modal.png`

## Deliverable

Save all captures under `lcos/reports/rc1-sprint/p3-walk-capture/`. Commit them. Add a short signoff at `lcos/reports/rc1-sprint/P3_WALK_SIGNOFF.md`:

```
Walker: Daniel
Date + time: <UTC>
Installed app version pre-walk: <X.Y.Z>
Bundle version post-walk: <VERSION from Step 0>
Codex journey: PASS / FAIL
Clipping journey: PASS / FAIL
Money journey: PASS / FAIL
Auth spot check: PASS / FAIL
Regression spot check: PASS / FAIL

Overall verdict: SHIP-READY / DO NOT SHIP
Notes: <anything>
```

## Rollback

If any journey fails and the failure is in the promoted bundle (not native):

```bash
# Restore prior current.json (backed up · alternately point at a prior bundle)
mv "$HOME/Library/Application Support/Liquid Clips/runtime/current.json.pre-p3-walk" \
   "$HOME/Library/Application Support/Liquid Clips/runtime/current.json"
```

Quit + relaunch. Old bundle activates. No shell touches.
