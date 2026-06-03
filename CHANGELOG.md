# Changelog

All notable changes to Liquid Clips.

## [Unreleased] — targeting v0.5.0 "public launch"

Sprint master doc: `~/Desktop/COMPLETION_SPRINT.md` (32 items). Highlights in flight:

### Added (in flight)
- Apple notarization pipeline — `scripts/notarize.sh`, `scripts/strip-xattrs.sh`, release.yml notarize step
- Apple privacy manifest (`PrivacyInfo.xcprivacy`)
- Hardened-runtime entitlements audit
- Account-app v2 pricing — 4 tiers (Free / Solo / Pro / Agency), Founder removed from UI
- Animated word-by-word captions via ffmpeg + ASS subtitles (sprint #2 — the killer feature)
- mlx-whisper for Apple Silicon (sprint #4 — 4-5× faster transcribe)
- Hosted LLM proxy + tier-gate (Pro+ uses our org key; Free is BYO)
- `PublishModal` rewrite for Ayrshare profile-key model
- Earnings leaderboard (top 100 affiliates by monthly $)
- Marketing site at liquidclips.app (Next.js + Vercel) + privacy/ToS pages
- Onboarding + first-run polish
- Sponsored Clips carousel in workspace (banners link to Earn tab)
- Achievement badges + tier avatars generated via gpt-image-1 (~28 sprites)
- Auto silence removal (ffmpeg `silencedetect`)
- Voice enhancement (ffmpeg `afftdn` + `loudnorm`)
- Game Phase 1: transparent glass overlay + animated icon legend + browser auto-collapse + deferred-result toast

### Changed (in flight)
- Workspace brief bar → Sponsored Clips carousel
- Settings → Connections: drop legacy Postiz tiles (Ayrshare panel only)

## [0.5.0] — 2026-06-03 — "Ready Player One"

A cinematic rebrand. Liquid Clips now opens like the OASIS — a 28-second Kade-in-OASIS intro that takes you through music, fashion, gaming and comedy worlds before handing you the keys to the editor.

### Added
- Cinematic 28s first-launch intro video (Kade, the user-avatar, traveling through five stylised content worlds — music → fashion → gaming → comedy → back to the OASIS with orbiting coins).
- Locked character bible: Kade, your in-app avatar inside the OASIS. Used as the consistent thread across every new visual.
- Faint OASIS atmosphere bleeds through every in-app surface so the brand feels continuous from splash → workspace.
- Liquidclips.app landing now opens with the full cinematic reel as a full-bleed hero.
- Visual-language doc at `desktop/docs/RPO_VISUAL_LANGUAGE.md` capturing the brand vocabulary, palette, aspect ratios, and asset spec for the rebrand sprint.

### Changed
- Splash background swapped from `splash-bg.png` to `closing-still.png` so the intro's final beat morphs seamlessly into the static splash with Kade and orbiting coins.
- Intro duration extended from 10s to 28s; first-launch flag bumped to `liquidclips:intro-seen:v2` so existing installs replay the new reel once.

### Notes
- All visuals generated with Higgsfield Nano Banana Pro (stills) + Seedance 2.0 (video) against locked OASIS + Kade references.
- Logo, brand fuchsia (`#FF1A8C`), and the entire token palette are unchanged.
- v0.5.x will iterate per-surface ambient backdrops + HUD chrome — this release ships the front-door reskin and the cinematic moment.

## [0.4.53] — 2026-06-02

### Added
- Cinematic Seedance first-launch intro, ending on the same cosmic vortex now used behind the splash screen.
- New Higgsfield invader sprite pack with per-row variants for a richer splash-game look.
- Schedule v2 foundation: multi-channel publishing flow, channel state, and analytics overview endpoints for launch ops.
- Marketing `/download` page so public visitors have a dedicated Liquid Clips installer route.

### Changed
- Splash visuals now line up with the intro's final frame for a smoother first-run handoff.
- Release pipeline hardening continued for signed DMG, updater artifacts, and Apple notarization readiness.

## [0.4.43] — 2026-05-31

### Fixed
- **Transcript progress bar now monotonic.** `threading.Event` shared between worker + heartbeat in `_do_transcribe`: heartbeat (wall-clock estimate) shuts up the moment the worker emits its first real segment-based percent. No more 47% → 19% bounce regression from 0.4.42.
- **Thumbnails now render** for YouTube/IG/TikTok. Root cause was Python 3.13 framework's missing system CA bundle — urllib HTTPS to `i.ytimg.com` etc. threw `CERTIFICATE_VERIFY_FAILED`, silently caught by `_try_download`, leaving `poster_path` None. Now uses `ssl.create_default_context(cafile=certifi.where())`.

### Added
- Live ETA in `LiftingProgress` — sidecar emits `eta_s` on every transcribe event (worker derives from measured speed; heartbeat from 5× realtime estimate). UI shows `~3 min left`.

## [0.4.42] — 2026-05-31

### Added
- `beam_size=1` + `condition_on_previous_text=False` on `lift_transcript`'s whisper call (matches the clip pipeline's `stages.py`). 3-5× faster on long-form English audio.
- Heartbeat % tick in the 2s poll loop so the bar moves before the first segment lands (beam search on the first chunk can take 30-60s).
- `<InvadersTrigger />` mounted in `LiftingProgress` — the game button now appears during Script lift waits, not just during the clip pipeline.

### Fixed (regression)
- Bar-bounce: heartbeat + worker fought over the same `percent` field. Fixed properly in 0.4.43 via `threading.Event`.

## [0.4.41] — 2026-05-31

### Fixed
- **Cancel-vs-restart race in `lift_transcript`.** `onCancel` in App.tsx flipped view to empty immediately but the in-flight Promise kept running. When the sidecar finally noticed the cancel marker (or completed first inside the 2s polling window), `setView({kind:"lifted"})` yanked the user back to a stale transcript. Three surgical changes (~25 lines):
  1. `liftGenRef` generation guard in `App.tsx` — every lift captures a generation id; success/error `setView` calls no-op when the id doesn't match
  2. `onCancel` bumps the generation FIRST so abandoned Promise resolutions become no-ops
  3. `.lift_cancel` marker now cleaned on successful exit (not just at next-lift start) — prevents leak into the shared ingest_url path

### Added
- First properly Apple-signed build (`Developer ID Application: KT68NGT4LX → Developer ID CA → Apple Root CA`). Local-only signing; CI cert + notarization still pending.

## [0.4.39] — 2026-05-30 (Kimi + Claude)

### Fixed
- **VAD hang.** `vad_filter=False` in `stages.py` (the main clip pipeline) — same fix `lift_transcript` shipped 2026-05-28. Silero VAD loops infinitely on music-only / corrupt / noisy audio at 148% CPU. Affected every full-pipeline run on noisy sources.

### Added
- `method_check_deps` preflight in sidecar — probes yt-dlp, faster-whisper, openai, cv2, pydantic, psutil, keyring. Frontend `DepsMissingCard` shows the exact `pip install` command when any are missing on the user's system Python 3.13. Catches the silent-hang failure mode where a missing module would make the sidecar JSON-RPC look dead.
- `ingest-failed` view + `FailureCard` mirror of `lift-failed`. URL ingest errors now show an actionable card instead of silently resetting to empty.
- Cancel button on the Download stage (`JuniorLoader.onCancel` prop) — was only on Transcribe.
- Cancel polling inside yt-dlp's `progress_hooks` for both ingest + lift download paths — a 3-hour podcast download is now killable mid-flight.
- Structured error envelope (`{error, human, code, technical}`) from sidecar → Rust → frontend. Frontend `SidecarError` class. `_classify_error` maps 7 common failure modes (deps_missing, canceled, private_source, source_unavailable, rate_limited, ffmpeg_missing, network) to human-readable copy.
- `signingIdentity` set in `tauri.conf.json` to `Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)`.

## [0.4.37] — 2026-05-30

### Added — P1 Ayrshare replaces Postiz
- `app/ayrshare.py` httpx client: `post`, `media_upload`, `history`, `analytics`, `cancel_scheduled`, `check_key`, `is_configured`
- `app/routes/social.py` — `GET /social/connections`, `POST /social/connect`, `POST /social/refresh-platforms`, `DELETE /social/disconnect/{platform}`. One Profile Key per user, hosted linking on Ayrshare's side (no OAuth dance to maintain)
- `/publish-now` rewritten as a single multi-platform Ayrshare call; returns per-platform results
- `cron.py _fire_schedule` becomes a reconciler (legacy Postiz rows surface a friendly "re-schedule" notice instead of stub-firing)
- Desktop: `SocialConnectionState` + `socialGetConnection/Connect/Refresh/Disconnect` in `lib/backend.ts`, `AyrshareConnectionPanel` mounted in Settings → Connections, `publishNow` wrapper translates new response + handles 412 with copy directing user to Settings

### Added — P2 Tier matrix v2 (Free / Solo / Pro / Agency)
- `features.py FEATURES_BY_TIER` 4-tier matrix with `clips_per_ip` / `accounts_included` / `watermark` / `sub_accounts` / `white_label` columns
- `_LEGACY_TIER_ALIASES = {"channel": "pro", "growth": "pro", "autopilot": "agency"}` so existing customers keep working transparently
- `account_limit(tier, extra_packs, founder)` helper
- `models.py`: `User.ip_address`, `clips_created`, `active_at`, `extra_accounts_purchased` + `SocialConnection` table
- `main.py` DDL block — idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` for v2 schema + `CREATE TABLE social_connections`
- `webhooks_clerk.py` — captures `X-Forwarded-For` at `user.created`
- `routes/usage.py` — IP-pool gate (100 clips shared across all Free accounts on one IP) + always-tick `clips_created` / `active_at` on every export (feeds the 2,000-user Founder flash-sale threshold)
- `routes/me.py` — surfaces `account_limit` / `extra_accounts_purchased` / `clips_created`

### Added — P3 Railway deploy prep
- `.env.example` adds `AYRSHARE_API_KEY` with beta-gate explanation
- `/healthcheck` surfaces `ayrshare_configured` for ops dashboards
- `/health` alias for Railway's default healthcheck path
- Ayrshare client uses httpx (already in requirements) — no new deps

### Added — CI sidecar fetch
- `.github/workflows/release.yml` brew-installs ffmpeg/ffprobe + pulls `Systran/faster-whisper-tiny` from HuggingFace before tauri-action (sidecar binaries are .gitignored, 224MB combined)

### Carried forward from earlier in the session
- Transcript hang killed at every layer (Python ThreadPoolExecutor with cancel marker + scaled timeout per audio length, Rust 3600s timeout, Promise.race wrapper)
- Invaders splash mini-game with `MIN_HOLD_MS = 8000`
- `desktop/scripts/bump_patch.sh` — version bumper used before every build

## [0.4.34] — 2026-05-28

### Added
- Earn tab + Whop integration (bounty browsing, submission tracking, affiliate linking)
- Tier system (Free / Solo / Growth / Autopilot / Founder)
- Invaders mini-game during long pipeline waits
- Ayrshare social posting API client

### Changed
- Liquid Clips rebrand (was "Junior"). Bundle id `app.liquidclips.desktop`, public brand `liquid/clips`
- Browse Rewards in-app side panel (Tauri child webview + commerce-redirect filter)
- Stripe Connect Express affiliate-payout flow

### Fixed
- Transcript hang: Python/Rust/frontend timeouts, VAD disable, cancel button
- Postiz OAuth removed (replaced by Ayrshare)

## [0.4.33] — 2026-05-20

### Added
- Desktop-first pipeline (drop video → transcribe → clip → export)
- faster-whisper local transcription
- OpenAI GPT-4o clip selection

### Changed
- Rebranded from "Junior" to "Liquid Clips"

[Unreleased]: https://github.com/Powstit/Jnr-employee/compare/v0.4.53...HEAD
[0.4.53]: https://github.com/Powstit/Jnr-employee/compare/v0.4.43...v0.4.53
[0.4.43]: https://github.com/Powstit/Jnr-employee/compare/v0.4.42...v0.4.43
[0.4.42]: https://github.com/Powstit/Jnr-employee/compare/v0.4.41...v0.4.42
[0.4.41]: https://github.com/Powstit/Jnr-employee/compare/v0.4.39...v0.4.41
[0.4.39]: https://github.com/Powstit/Jnr-employee/compare/v0.4.37...v0.4.39
[0.4.37]: https://github.com/Powstit/Jnr-employee/compare/v0.4.34...v0.4.37
[0.4.34]: https://github.com/Powstit/Jnr-employee/compare/v0.4.33...v0.4.34
[0.4.33]: https://github.com/Powstit/Jnr-employee/releases/tag/v0.4.33
