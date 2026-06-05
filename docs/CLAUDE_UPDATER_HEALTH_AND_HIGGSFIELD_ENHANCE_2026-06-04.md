# Claude Build Note — Admin Health, Updater Proof, Higgsfield Enhance

Date: 2026-06-04
Owner: Codex
Status: built locally, not pushed

## Why this exists

Daniel asked for one place where admin users can see whether Liquid Clips is launch-green without manually curling every endpoint. He also asked whether Higgsfield/Railway should auto-generate long-form clips. My read: updater health is launch-critical now; Higgsfield is valuable, but belongs after clipping as an Enhance/Reaction generator, not as the core 2-hour clipping engine.

## Built

### 1. Admin Launch Health

Files touched:

- `junior-backend/app/routes/admin.py`
- `junior-backend/app/config.py`
- `account-app/src/app/api/admin/[...path]/route.ts`
- `account-app/src/components/admin/AdminHQ.tsx`

Endpoint:

- `GET /admin/health?clerk_user_id=...`
- Protected by the existing backend `require_admin` gate.
- Frontend proxy allowlist now permits `admin/health`.
- Admin HQ has a `Launch Health` tab.

Admin-only visibility is hard-coded by the existing admin email allowlist:

- `junior-backend/app/features.py`
- `JUNIOR_ADMIN_EMAILS`
- current default includes `danieldiyepriye@gmail.com`

The UI gate is useful, but the backend gate is the real enforcement.

### 2. Public updater proof

New config defaults:

- `TAURI_UPDATE_ENDPOINT=https://updates.liquidclips.app/latest.json`
- `TAURI_UPDATE_TARGETS=darwin-aarch64,darwin-x86_64`

The health endpoint now checks both:

- backend release volume: `JUNIOR_RELEASES_DIR/manifest.json`
- public customer updater path: `updates.liquidclips.app/latest.json`

The public updater gate performs the same contract an installed Tauri app depends on:

1. `GET https://updates.liquidclips.app/latest.json?target=darwin-aarch64&current_version=0.0.0`
2. `GET https://updates.liquidclips.app/latest.json?target=darwin-x86_64&current_version=0.0.0`
3. Verify JSON includes `version`.
4. Verify each target includes `platforms[target].signature`.
5. Verify each target includes `platforms[target].url`.
6. Probe the artifact URL with `HEAD`; if the host rejects `HEAD`, fallback to `GET` with `Range: bytes=0-0`.
7. Fail if targets return different versions.

Green means: an old installed app can discover and download a signed update for both Mac arch targets.

Yellow means: local or backend pieces may exist, but customer auto-update is not provably ready.

Red means: do not tell users in-app updates are ready.

## How Claude should verify

Run these after rebasing over any release-pipeline branch:

```bash
cd /Users/dipdip/Desktop/jnr
python3 -m py_compile junior-backend/app/*.py junior-backend/app/routes/*.py
cd account-app && npx tsc --noEmit
```

Production smoke once deployed:

```bash
curl -i "https://updates.liquidclips.app/latest.json?target=darwin-aarch64&current_version=0.0.0"
curl -i "https://updates.liquidclips.app/latest.json?target=darwin-x86_64&current_version=0.0.0"
```

Expected: HTTP 200 with `version`, target-specific `signature`, and `url`. HTTP 204 means the app will believe there is no update.

Manual end-to-end updater proof:

1. Install an older signed Liquid Clips build.
2. Publish a newer signed updater artifact through the release flow.
3. Confirm Admin HQ → Launch Health shows `Public updater endpoint` green.
4. Open old app.
5. Confirm launch banner or Settings → Check for updates detects the new version.
6. Install/relaunch.
7. Confirm app version pill reports the new version.

## Higgsfield / AI auto-generate decision

Do not make Railway/Higgsfield the main long-form clipping engine for launch.

Reason:

- Local clipping is already the product promise: fast, private, files stay local.
- Railway jobs for 2-hour media would introduce upload cost, queue risk, timeout risk, storage cleanup, and privacy friction.
- It would compete with the speed race against Opus instead of helping it.

Best launch fit:

- Add Higgsfield as a post-clip `Enhance` feature.
- User generates clips locally first.
- After each clip, Liquid Clips suggests enhancements:
  - Reaction overlay
  - Meme/ad-lib cutaway
  - B-roll insert
  - Visual hook variant
  - Caption/title angle
- The generated asset becomes an overlay/reaction source and uses the existing stacked/split/overlay editor path.

This keeps the workflow one step from publish: clip -> enhance -> preview -> schedule.

## Proposed Higgsfield architecture

Backend/Railway:

- `POST /enhance/jobs`
  - input: clip id or uploaded reference, prompt, niche, desired format, duration cap
  - output: job id
- Worker calls Higgsfield/provider API.
- Store generated asset metadata and URL.
- `GET /enhance/jobs/{id}`
  - returns pending/running/failed/ready and asset metadata.

Desktop:

- Show `Enhance` suggestions on every generated clip and every imported clip.
- When an asset is ready, apply it through the existing reaction/remix editor:
  - stacked
  - split
  - picture-in-picture
  - quick cutaway
- Keep source files local unless the user explicitly opts into cloud generation.

Admin Health future gates:

- `higgsfield_configured`: API key present.
- `enhance_queue`: worker alive / recent job success rate.
- `enhance_storage`: generated asset bucket reachable.

## Notes for release coordination

Do not touch while Claude is releasing:

- `.github/workflows/release.yml`
- release tags
- GitHub Actions secrets
- `desktop/src-tauri/tauri.conf.json` version field

If the public updater gate is red after deploy, inspect in this order:

1. `updates-proxy/vercel.json` rewrite to backend.
2. `api.jnremployee.com/updates/latest.json` response.
3. `JUNIOR_RELEASES_DIR` mounted and persistent on Railway.
4. `manifest.json` includes both `darwin-aarch64` and `darwin-x86_64`.
5. Artifact filenames exist beside `manifest.json`.
6. Artifact signatures match the public updater key in `desktop/src-tauri/tauri.conf.json`.

