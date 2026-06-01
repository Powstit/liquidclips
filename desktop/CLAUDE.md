# Liquid Clips Desktop — agent guide

Tauri 2 macOS app. Public brand **Liquid Clips**, bundle id `app.liquidclips.desktop`, source-tree name still `junior-desktop`. The user-facing surface that turns long-form video into ready-to-post short clips with animated captions, social publishing, and an affiliate flywheel.

## Architecture

```
React 18 + Vite + Tailwind 4   ⇄   Tauri 2 (Rust)   ⇄   Python sidecar (stdio JSON-RPC)
                                                              ⇄ ffmpeg / faster-whisper / OpenCV
                                                              ⇄ OpenAI (LLM clip-pick) — BYO for Free, hosted via backend proxy for Pro+
```

- **Frontend**: `src/` — React 18 + TS. Brand tokens in `src/index.css` as Tailwind 4 `@theme` vars. Logo at `src/components/Logo.tsx`.
- **Rust shell**: `src-tauri/src/lib.rs` (entry), `src-tauri/src/sidecar.rs` (stdio JSON-RPC client), `src-tauri/src/browse.rs` (embedded child webview for the in-app Browse Rewards panel).
- **Python sidecar**: `python-sidecar/sidecar.py` — newline-delimited JSON over stdin/stdout. One method per RPC. Heavy modules import lazily inside method bodies; `check_deps` preflight runs at boot.
- **IPC contract**: `src/lib/sidecar.ts` (sidecar RPC) + `src/lib/backend.ts` (HTTP to junior-backend).

## Current version & shipping state

- **v0.4.43** installed locally (2026-05-31). First properly Apple-signed build (`Developer ID Application: KT68NGT4LX → Apple Root CA`).
- **Release CI is unblocked** — `.github/workflows/release.yml` builds signed artifacts, verifies the updater signing key, notarizes + staples the DMG, and opens a draft GitHub release.
- **Auto-updater still needs one live rehearsal** — run the v0.4.99 test below from Daniel's chosen clean release commit before cutting v0.5.0.

## Major surfaces

| Surface | Status | Notes |
|---|---|---|
| Workspace (drop video / paste URL → clips) | ✅ live | Brief bar being removed for Sponsored Clips carousel — sprint item #15-16 |
| Lift Transcript ("Script" mode) | ✅ live | yt-dlp + faster-whisper tiny. Speed = ~5x realtime on CPU; mlx-whisper speed-up in sprint #4 |
| Clip pipeline (cut + reframe + thumbnail) | ✅ live | Face-aware crop via Swift `junior-face-detect`. Animated captions pending sprint #2 |
| Publishing (Ayrshare) | ⚠️ partial | Backend live + Settings → Ayrshare panel works. Workspace PublishModal still uses legacy per-platform model — refactor in sprint #3 |
| Earn tab + AffiliateHero + Stripe Connect | ✅ live | Polish + leaderboard pending sprints #12 + #14a |
| Settings + API keys (keychain) | ✅ live | Legacy Postiz tiles to drop in sprint #17 |
| Invaders mini-game (splash + mid-pipeline) | ✅ basic | Glass overlay + power-ups + lives in sprints #18 + #18a (and phases 2-4 deferred) |
| Browse Rewards (in-app side panel) | ✅ live | Tauri child webview with commerce-redirect filter (App Store guideline 3.1.1) |

## Don't

- Don't reach for Electron, Webview2 native, or "wrap a webpage" patterns — Tauri 2 is locked.
- Don't introduce a second styling library. Tailwind 4 + a few primitive components is the whole system.
- Don't add Redux. Zustand or React state.
- Don't introduce a UI framework that ships its own design tokens (MUI, Chakra, Mantine). The brand is the system.
- Don't add emojis to UI copy. Past tense for done, plain verb for in-progress, no exclamation marks.
- Don't add a second styling/animation system. CSS-in-JS or styled-components are not welcome.

## Hard rules carried forward

- Brand tokens: one fuchsia (`#FF1A8C`), one ink (`#0B0B10`), one paper. No other accents.
- Sidecar deps import lazily; `check_deps` preflight reports missing modules to the UI (added 2026-05-31 as P0 #1).
- Cancel marker pattern: `~/LiquidClips/.lift_cancel` shared by ingest_url + lift_transcript. Cleared on start AND on successful exit.
- Generation guards on every lift Promise (`liftGenRef` in App.tsx) — stale resolutions can't yank you back to a "lifted" state after cancel.
- Heartbeat suppression via `threading.Event first_segment_event` — only one of (wall-clock heartbeat, worker-segment progress) emits at a time.

## Build + ship

```bash
npm install                              # one-time
npm run tauri dev                        # hot-reload dev
npm run tauri build -- --bundles app     # release build; CI handles sign/notarize/staple for tagged releases
bash scripts/local-install.sh            # atomic quit + replace + relaunch in /Applications
bash scripts/bump_patch.sh               # bump patch version in package.json + tauri.conf.json
```

Apple cert is in login keychain (`Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)`) for local builds. CI signs with the imported Developer ID cert, strips resource forks before signing, notarizes the DMG, staples it, and uploads the updater artifacts to a draft GitHub release.

### Auto-updater live rehearsal

Run this once from a clean release candidate commit before v0.5.0. Do not reuse the tag after publishing; delete and recreate only while the draft release remains private.

```bash
git status --short
git tag v0.4.99
git push origin v0.4.99
```

Then in GitHub Actions:

1. Wait for `.github/workflows/release.yml` to finish green.
2. Open the draft `v0.4.99` release and confirm these assets exist:
   - `.dmg`
   - `.dmg.sig`
   - `.app.tar.gz`
   - `.app.tar.gz.sig`
   - `latest.json`
3. Publish the draft release.
4. Install the previous public app build, launch it, and watch for the updater prompt.
5. Accept the update and confirm `/Applications/Liquid Clips.app` relaunches without Gatekeeper warnings.
6. Archive the result in `SPRINT_HANDOFF.md`, then delete the rehearsal release/tag before the real v0.5.0 cut if Daniel does not want `v0.4.99` visible.

## Toolchain

- Node ≥ 22 (24 verified)
- Python 3.13 framework Python (`/Library/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/`). The sidecar runs this — NOT a bundled venv. Heavy deps (faster-whisper, openai, yt-dlp, opencv-python, keyring, psutil, certifi) must be installed into this Python. The `check_deps` method probes for them at boot.
- Rust stable via rustup
- ffmpeg + ffprobe bundled at `python-sidecar/bin/` (gitignored — fetched in CI by `.github/workflows/release.yml`)
- faster-whisper tiny model bundled at `python-sidecar/models/faster-whisper-tiny/` (gitignored — fetched in CI)

## Current sprint

See `~/Desktop/COMPLETION_SPRINT.md` — 32 items mapped hardest → easiest. File ownership split between Kimi + Claude in the same doc. Lockfile at `~/Desktop/jnr/SPRINT_LOCKS.md` for shared-file coordination.
