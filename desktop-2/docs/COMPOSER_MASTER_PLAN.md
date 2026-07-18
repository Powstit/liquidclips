# Kade Composer · MASTER PLAN

**Date locked:** 2026-07-18
**Owner:** claude
**Purpose:** deterministic execution map · one source of truth · read before every session
**Anti-bug standard:** 4-layer defense on every commit (iron gate sentinel · vitest test · pre-commit lint · build/runtime guard)

**Read this file at the start of every session. Do not deviate. If a feature isn't in this doc, don't build it. If a contract isn't in this doc, don't skip it.**

---

## 1 · GROUND RULES · non-negotiable

### A · What "done" means for any feature

A feature is done when ALL of these are true:

1. Real bytes: a user action produces a real artifact (file on disk, backend row, rendered pixel — not a JSON mutation in a dev-panel)
2. Iron gate sentinel comment placed in the primary file
3. Vitest regression test added under `src/**/*.test.ts` asserting source + runtime invariants
4. `desktop-2/scripts/lint-session-reset-guard.sh` extended with grep invariants for the new contract (or a sibling `lint-<feature>-guard.sh` wired into `.githooks/pre-commit`)
5. Runtime or build guard added (only when the failure mode touches env, native APIs, or external contracts)
6. tsc EXIT 0 · full vitest suite green · installed dist verified
7. This master plan's `## 6 · STATE LOG` row flipped from `❌` to `✅`

If you can't check every box, the feature is not done. No fake "green" claims.

### B · Files never touched during Composer work

- `desktop-2/src/design-os/routes/Workstation.tsx` (existing editor · Composer is a sibling not a replacement)
- `desktop-2/src/routes/**` and `desktop-2/src/sections/**` (money-surface pipeline · Composer is Design OS pipeline)
- `desktop-2/src/shell/sectionRegistry.ts` (section pipeline registry)
- `junior-backend/` (unless the specific feature requires a new backend route AND is called out in that feature's file list below)
- `account-app/` (Vercel-hosted separately · never touch during Composer builds)

If a feature edit lands in any of the above, **STOP · re-read this doc · confirm the file list · escalate if the doc is wrong**.

### C · Composer opt-in state

- The Composer route stays UNREACHABLE from the UI until a feature graduates. Nav tile is deleted from `CommandRoom.tsx` per commit `07c826ad+`.
- Deep link `#/composer` still resolves for testing.
- Individual features graduate the route by wiring their real code into `Composer.tsx` flows AND checking the STATE LOG box.
- The tile only reappears in Kade Home when the row **[FLYWHEEL COMPLETE]** in the STATE LOG is checked.

---

## 2 · ANTI-BUG INFRASTRUCTURE · protect at every commit

### A · Iron gates currently in the codebase

| Gate | Purpose | Location |
|---|---|---|
| **IG-001** | Portal-side ingest contract | `src/routes/upload/portalUrlContract.ts` |
| **IG-002** | Sidecar RPC contract | `src/design-os/engine/sidecarCall.ts:30` |
| **IG-003** | Intro cinematic guard | `src/overlays/IntroSplash.tsx` |
| **IG-LC2-015** | ClipCard visual state | `src/design-os/engine/ClipCard.tsx` |
| **IG-LC2-016** | `focusedClip` from live session, never FIXTURE | `src/design-os/routes/Workstation.tsx:149-156` |
| **IG-LC2-017** | Dock + preview share focusedClip reference | `src/design-os/routes/Workstation.tsx:519-536` |
| **IG-LC2-018** | CockpitProvider mounted once + stable | `src/design-os/engine/cockpit/CockpitContext.tsx:197-210` + `Workstation.tsx:250-266` |
| **IG-LC2-AdminGate** | Admin-HQ visibility | `src/design-os/surfaces/surfaceRegistry.ts` |
| **IG-SOV-2.2-001** | Sponsored Reward economics (5% fee, $10 min withdraw) | `src/lib/carrot.ts` |
| **IG-014-B** | Session-reset · never silently swallow keychain errors | `src/lib/authStorage.ts:146-167` |
| **IG-014-C** | Prod-build env guard · no dev URLs in stable | `scripts/assert-prod-build-env.sh` |
| **IG-014-D** | WelcomeGate subscribes to both `activation:complete` AND `auth:signed-in` | `src/App.tsx:530-570` |

Every new feature in `## 5 · FEATURES` gets its own iron gate ID (IG-COMPOSER-A, B, C, ...) once real code lands.

### B · Pre-commit lint scripts wired into `.githooks/pre-commit`

Runs in order (guard #1–#8). All must pass before commit.

1. `desktop/scripts/check-humanError.sh` — `String(e)` regression guard
2. `desktop/scripts/iron-gate-precommit.sh` — refuses deletion of `IRON GATE` sentinels
3. `desktop/scripts/assert-no-passive-keychain.sh` — auth-keychain invariant (IG-014)
4. `desktop/scripts/brand-kit-drift-check.sh` — token parity between index.css + demo HTML
5. `desktop-2/scripts/lint-kade-decoupling.sh` — `onboarding:milestone` emitter-only rule (Sprint G.5)
6. `desktop-2/scripts/assert-shell-contracts.sh` — nav / shell / auth / brand contracts (~116 checks)
7. `desktop-2/scripts/assert-kade-anchor.sh` — `[data-kade-anchor]` on every primary route
8. `desktop-2/scripts/lint-session-reset-guard.sh` — IG-014-B/C/D invariants (11 checks)

When a new feature ships, extend guard #8 (or add a sibling script + wire it in) with its regression invariants.

### C · Vitest test files that MUST stay green forever

Full suite must show `Test Files N passed (N)` · `Tests M passed | 1 skipped (M+1)` · zero failures.

Regression-locked files added in this Composer arc:
- `src/App.WelcomeGate.test.ts` (IG-014-D · 5 assertions)
- `src/lib/authStorage.session-reset.test.ts` (IG-014-B · 9 assertions)

Vitest config:
- `vite.config.ts` `test.include: ["src/**/*.{test,spec}.{ts,tsx}"]`
- `vite.config.ts` `test.exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.cache/**", "**/.claude/worktrees/**", "**/tests/e2e/**"]`

Per-file `// @vitest-environment jsdom` directive for tests needing DOM.

### D · Build-time guards

- `desktop-2/scripts/assert-prod-build-env.sh` — IG-014-C · fails stable builds if `VITE_BACKEND_URL` / `VITE_ACCOUNT_APP_URL` / `VITE_MARKETING_URL` point anywhere except production
- Wired into `desktop-2/scripts/runtime-ship.sh` right after preflight
- **Known gap:** current guard only checks shell env, not `.env.local`. Extend before shipping any runtime bundle to prod (feature #14 in `## 5`)

### E · Runtime guards

- `SessionResetButton` (`src/components/auth/SessionResetButton.tsx`) — detects `hasJwt()=false + hasJwtKeychainPresence()=true` and offers recovery
- `reconcileKeychainOnBoot()` in `authStorage.ts` — silent preemptive purge on cold boot mismatch
- Called from `App.tsx:292` right after `initAuthStorage()`

---

## 3 · CODEBASE INTEGRATION MAP · what exists, what to reuse

### A · Composer route (scaffolded, unreachable)

- `src/design-os/routes/Composer.tsx` (620 lines) — Watchdog → EngineSession → CockpitProvider → DesignOSAppShell wrap · matches Workstation route pattern
- `src/design-os/routes/Composer.css` (281 lines)
- Registered at `src/design-os/routing/SimulatorRouter.tsx` under `SURFACE_FOR.composer` + `ALIAS_FOR["kade-composer"]`

### B · Composer engine folder

- `src/design-os/engine/composer/capabilities.ts` (646 lines · 18 capabilities)
- `src/design-os/engine/composer/SYMBOLS.tsx` (97 lines · 29 SVG glyphs)
- `src/design-os/engine/composer/shapes.tsx` (126 lines · compositional SVG)
- `src/design-os/engine/composer/router.ts` (293 lines · 3-tier confidence router)
- `src/design-os/engine/composer/AskPanel.tsx` (256 lines)
- `src/design-os/engine/composer/ParamPanels/` × 12 panels
- **All UI · zero real bytes today · each panel graduates by wiring its flow into real code**

### C · Sidecar (real bytes today)

- `src/design-os/engine/sidecar-stub.ts` — Tauri RPC wrappers for the Python sidecar
- Python sidecar at `desktop/python-sidecar/sidecar.py` (legacy · but currently active) OR `desktop-2/src-tauri/binaries/liquid-clips-sidecar`
- Real methods available: `get_transcript`, `pick_clips_from_transcript`, `run_stage`, ffmpeg wraps, Whisper transcription
- New methods to add: `download_yt_segment`, `remove_silence`, `export_split_composition`, `record_screen_capture` (Rust), `karaoke_word_timings`

### D · Backend (real bytes today)

- Live at `https://api.liquidclips.app`
- `POST /desktop/auth/start`, `/desktop/auth/verify`, `/sync`, `/me`, `/me/carrot`, `/campaigns`, `/community/channels`, `/whop/*`, `/stripe-connect/*`, `/affiliate/*`
- HQ delivered YouTube library API 2026-07-17: `/api/library/search`, `/api/handoff/<video_id>`, `/api/podcast/handoff/<episode_id>` (1.3M episodes)
- New routes to add: `/proxy/llm`, `/me/referral-url`, `/me/kade/intent`

### E · Existing UI to reuse

- `Workstation.tsx` + 6 cockpit modules (ReactionModule, CaptionModule, TrimModule, StyleModule, ScheduleModule, PublishModule) — trim, captions, reactions, style already have real bytes
- `ExportPanel.tsx:71-110` — watermark render config (real ffmpeg overlay)
- `CockpitContext.tsx` — composition state primitive · Composer extends via `baseWindow` field (already added)
- `KadeController.tsx` — 19 poses already registered · new poses go into `bridge/events.ts` KadeState union
- `StickyKade` — existing dialogue bubble system driven by `kade:speak` bus event
- `useTierCaps()` at `src/design-os/state/useTierCaps.ts` — tier-gating hook
- `useMe()` at `src/design-os/state/useMe.ts` — identity hook

### F · Bus events (canonical list)

Every Kade dialogue and cross-surface signal fires through `bus.emit()`. **NEVER invent new event names without adding them to `bridge/events.ts` LCEvents type map first.**

Currently registered (verify with grep):
- `nav:click` · `nav:hover` · `route:enter`
- `clip:open-edit` · `clip:open-export` · `clip:open-schedule` · `clip:open-submit` · `clip:submitted` · `clip:status-change` · `clip:platforms-change`
- `engine:progress` · `engine:complete` · `engine:error`
- `activation:complete` · `auth:signed-in` · `auth:signed-out` · `auth:open-panel`
- `kade:mood` · `kade:speak` · `kade:dismiss`
- `home:open-panel` · `mode:change` · `mode:set`
- `source:drop` · `browse:open` · `crew:invite-sent`
- `settings:open-tab` · `submission:reviewed` · `campaign:lifecycle-change`
- `toast` · `system:intercession` · `app:hard-refresh`
- `inbox:added` · `inbox:read` · `inbox:email-state`
- `onboarding:milestone` (emitter-only rule enforced by lint)
- `trial:upgrade-request` · `trial:upgrade-resolved`
- `billing:reserve-refused` · `billing:reserved` · `billing:settled` · `billing:released` · `billing:cache-hit` · `billing:free-preview-disclosure`
- `identity:open-claim-sheet` · `allowance:update` · `payout:demo`

New events required by upcoming features (see `## 5`):
- `composer:command-submitted` (voice input feature)
- `composer:capability-executed` (router feature)
- `composer:record-started` · `composer:record-stopped` (screen recording feature)

Add to `bridge/events.ts` LCEvents map BEFORE using in any component. Line 8 rule holds: Kade emits are user-action driven, never observer-driven.

### G · Kade asset library (verified transparent)

Path: `desktop-2/public/brand/kade/`

- `kade-base.png`, `kade-avatar.png` (RGBA 1024×1024 · canonical hero)
- 23 `.webp` poses (RGBA 1024×1024 · in-app tool poses)
- 12 up-sequence frames (RGBA 496×496 · animation)
- **NEVER reference:** `kade-checking.png`, `kade-first-clip-celebration.png`, `kade-empty-invite.png`, `login-kade-*`, `kade-oasis-hero.png` (all opaque · flagged as "AI slop")

Feature 24 (Kade character system) formalizes the asset registry.

---

## 4 · CATEGORIZATION · features grouped by class

Class dictates cost + release lane.

- **Class A · Reuse existing code** (1–6 h · runtime bundle only) — fastest wins · no new backend / native / dependency
- **Class B · New sidecar Python** (2–6 h · sidecar + runtime bundle) — new ffmpeg wrap or Whisper subfeature
- **Class C · New backend route** (2–8 h · junior-backend + runtime bundle) — new /me/*, /proxy/llm, /api/*
- **Class D · New Rust native** (12–20 h · shell version bump v2.2.43+ · signing + notarization) — Tauri command wrappers for OS-level APIs
- **Class E · Kade character + UX chrome** (2–15 h · runtime bundle only) — dialogue library, pose registry, dev-panel, session persistence
- **Class F · Frontend integration donor port** (8–45 h · runtime bundle) — external OSS component ported into Composer (Remotion, wavesurfer.js, etc.)

---

## 5 · FEATURES · 42-row matrix

Every row has: Feature · Class · Files · Iron gate id (once landed) · Test file · Lint invariant · Exit criteria · Est. hours.

### Class A · Reuse existing (11 features)

| # | Feature | Files | Exit criteria | h |
|---|---|---|---|---|
| A1 | Composer route mount + real focusedClip | `Composer.tsx` (already scaffolded) | Route mounts inside AuthGate · reads `focusedClip` from useCockpit · IG-COMPOSER-A sentinel | 3 |
| A2 | Reaction module reuse (7 layouts) | Import `ReactionModule` into Composer flow | Composer's `flowReaction` mounts existing module · CockpitSettings write via existing hooks | 2 |
| A3 | Trim reuse | Import from Workstation trim path | Composer's `flowTrim` calls same reducer | 2 |
| A4 | Captions reuse (existing styles) | Import from Workstation caption path | 4 real presets from `CaptionStyleKey` render | 2 |
| A5 | Watermark preset picker (existing render) | New `WatermarkPresetPicker.tsx` · reads/writes `CockpitSettings.publish` | 3 preset menu (BR/BL/full-bar) writes to existing publish schema · ExportPanel picks it up | 3 |
| A6 | Base Window JSON dev-panel (mock → real) | `Composer.tsx` DevPanel component reads live `CockpitContext.settings` | JSON updates on every setter · testId `composer-dev-panel` | 3 |
| A7 | Command bar text input | `CommandBar.tsx` in composer folder · fires `composer:command-submitted` bus event | Text submit routes to `routeIntent` · adds to history | 2 |
| A8 | Command history bar (chips) | Extends A7 · localStorage `lc.composer.history.v1` | Last 8 commands render as chips · click re-fires · IG-COMPOSER-B sentinel | 3 |
| A9 | Turbo mode toggle | `useTurboMode` hook + CSS class on route root | Motion scale factor `data-turbo="true"` collapses animation durations to 40 ms · settings persist localStorage | 2 |
| A10 | Session state persistence (resume) | Uses existing `CockpitContext` clipSettingsStore · adds Composer-specific baseWindow.aspect + baseWindow.regions | Close + reopen app · Composer restores last aspect + regions | 3 |
| A11 | Idle-state canvas (blank until command) | Composer route · `data-canvas-loaded="false"` attribute on canvas | Fresh mount = blank · first command flips attribute · already done in simulator, port to React | 3 |

**Class A total: 28 h**

### Class B · New sidecar (7 features)

| # | Feature | Files | Exit criteria | h |
|---|---|---|---|---|
| B1 | Silence removal (auto-tighten pauses) | `python-sidecar/silence.py` new · exposed as RPC `remove_silence` in `sidecar.py` | Real ffmpeg silence filter runs · returns trimmed timeline · Trim panel toggle wires through | 3 |
| B2 | Playback speed (0.5×–2.0×) | Sidecar RPC `apply_playback_speed` · ffmpeg atempo | Trim panel slider maps to real export speed | 2 |
| B3 | Karaoke word-emphasis captions | Sidecar RPC `get_word_timings` (already computable from faster-whisper) + client render | Word-level highlight ranges output · client CSS keyframes render karaoke effect | 5 |
| B4 | Split-screen composition (2 regions) | Sidecar RPC `export_split_composition` · ffmpeg overlay filter graph | Two-source overlay renders to real MP4 · slot A/B labeled at render time | 5 |
| B5 | Grid 2×2 composition (4 regions) | Extends B4 · ffmpeg 4-input overlay | Four-source grid renders · deferred until 4-slot UX validated | 4 |
| B6 | Audio mixing · music track + duck | Sidecar RPC `mix_audio` · ffmpeg amix + volume | Music picker + main/music volume sliders write real MP4 with mixed audio | 5 |
| B7 | Hook / opening title burn-in | Reuse existing `hook_burnin` in `stages.py` (already exports) | Composer's `flowFrame` wires template picker to existing stage | 4 |

**Class B total: 28 h**

### Class C · New backend (7 features)

| # | Feature | Files | Exit criteria | h |
|---|---|---|---|---|
| C1 | LLM intent extraction proxy | `junior-backend/app/routes/proxy_llm.py` new · GPT-4o-mini via existing OpenAI key · Redis cache | `POST /proxy/llm` returns structured intent JSON · rate-limited per tier · caches 24 h | 6 |
| C2 | Kade intent endpoint | `junior-backend/app/routes/kade_intent.py` new · consumes C1 · reads capability graph server-side | `POST /me/kade/intent` returns `{ action, capability, resolved_params, choices? }` | 5 |
| C3 | Referral URL for watermark | `junior-backend/app/routes/referral.py` new · reads user handle + affiliate token | `GET /me/referral-url` returns short URL + tracking token · signed | 3 |
| C4 | HQ YouTube library client hook | `desktop-2/src/lib/hqLibrary.ts` new · consumes existing HQ API | `useHqLibrarySearch(query, filter)` returns thumbnails + timestamps · authed | 4 |
| C5 | Podcast archive hook | Same file as C4 · consumes `/api/podcast/handoff/<episode_id>` | Podcast filter chip surfaces real transcripts (whisper_needed:false) | 3 |
| C6 | Rule validation preflight | `junior-backend/app/routes/campaign_preflight.py` new | `POST /campaigns/<id>/preflight` returns pass/fail per rule · client blocks export on fail | 5 |
| C7 | One-click Whop submission | Reuse existing `whop.py` proxy · add `submit_clip_to_bounty` method | `POST /me/whop/submit` accepts clip metadata + campaign_id · returns Whop URL | 4 |

**Class C total: 30 h**

### Class D · New Rust native (5 features)

Each Class D feature triggers a shell version bump (e.g., v2.2.43 → v2.2.44). Requires signing + notarization + `.app` reinstall for existing users. Rollout: bundled fallback dist works until shell updates.

| # | Feature | Files | Exit criteria | h |
|---|---|---|---|---|
| D1 | Screen capture · display + window | `src-tauri/src/screen_capture.rs` new · `screencapturekit-rs` crate | Tauri commands `screen_capture_start`, `screen_capture_stop` · returns MP4 path · macOS permission prompt fires | 12 |
| D2 | Screen capture · system audio + mic | Extends D1 · adds audio track via ScreenCaptureKit | Real audio bytes in MP4 · per-app volume picker later | 6 |
| D3 | Camera capture | Extends screen_capture.rs · `nokhwa` crate | Tauri commands `camera_start`, `camera_stop` · returns MP4 path · webcam permission prompt fires | 8 |
| D4 | Countdown + live preview | Client-side over D1-D3 · uses IOSurface preview stream | 3-2-1 countdown overlay · live preview canvas · REC pill starts on go | 4 |
| D5 | Multi-monitor + per-app audio picker | Extends D1 · queries `SCContentFilter` for available displays + apps | Display picker card grid renders real monitors · app volume sliders wire through | 6 |

**Class D total: 36 h (requires v2.2.43+ native shell release)**

### Class E · Kade character + UX chrome (7 features)

| # | Feature | Files | Exit criteria | h |
|---|---|---|---|---|
| E1 | Kade dialogue library port | `src/design-os/engine/composer/kadeDialogue.ts` new · port `LINES` object from simulator | `pickLine(key)` returns in-character line · 3-8 words · money-aware vocab (no "bounty" → "skill/clip job") | 3 |
| E2 | Pose registry | `src/design-os/engine/composer/kadePoses.ts` new · enumerates 23 webp poses | `setPose(pose, statusText)` fires `kade:mood` bus event with pose id · KadeController consumes | 2 |
| E3 | Celebration flash | `CelebrationFlash.tsx` new · overlay renders `kade-celebration.webp` 240px transparent | Fires on success flows · fades 800 ms · respects reduced-motion | 2 |
| E4 | moveKade animation | Composer canvas · absolute-positioned Kade with CSS transform transitions | `moveKade(x, y, ms)` helper wires to `data-kade-pos` attribute · scaled by turbo | 3 |
| E5 | Progressive silence rule | Counter in useComposerState · dampens dialogue frequency after N successful flows | After 5 flows in session, only 1-in-3 dialogue lines emit | 2 |
| E6 | Command bar mic (voice input) | Wraps existing sidecar Whisper · MediaRecorder API + Blob → sidecar transcribe | Mic tap starts capture · stop transcribes via existing `faster-whisper-tiny` · inserts into command bar | 4 |
| E7 | Slot A/B/C region system | Composer `SlotGrid.tsx` new · overlay grid with letter labels + selection state | Voice/text "add reaction to slot B" resolves via router · click-to-select works · IG-COMPOSER-C sentinel | 5 |

**Class E total: 21 h**

### Class F · Frontend donor port (5 features)

Deferred until Class A/B/C/D land the core loop. Class F features add polish + power tools.

| # | Feature | Files | Exit criteria | h |
|---|---|---|---|---|
| F1 | Multi-track timeline UI | Port `Augani/openreel-video` timeline component OR build with Remotion Composition | Video / Reaction / Caption / Hook / Audio tracks render · drag repositions · playhead scrubs | 25 |
| F2 | Waveform audio track | `wavesurfer.js` (BSD-3) integration · scoped to Audio panel | Stereo waveform renders · beat markers show when B3 lands | 8 |
| F3 | Reactions Deep · beat lock | Extends F2 · beat detection via wavesurfer + client snap-to-beat | Reaction snaps to beat when toggle on · IG-COMPOSER-D sentinel | 6 |
| F4 | Batch apply + Ship module | New `ShipPanel.tsx` · reuses B1-B7 in a loop over selected clips | "Apply to 14 clips" fires each per-clip export · progress bar · preview 3 samples | 12 |
| F5 | Brand presets (Growth / Personal / Client) | New `BrandPresetsPanel.tsx` · localStorage-backed preset store · CockpitSettings clone | Create / edit / duplicate / delete preset · apply preset updates CockpitSettings | 8 |

**Class F total: 59 h**

---

## 6 · STATE LOG · progress tracker (single source of truth)

Legend: ❌ not started · 🟡 in progress · ✅ done · 🔒 iron-gate + tests + lint locked

| Feature | Status | Iron gate | Test file | Lint invariant | Landed commit |
|---|---|---|---|---|---|
| A1  Composer route mount | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-A · `Composer.tsx:580` | `src/design-os/routes/Composer.mount.test.ts` (9 assertions) | Invariants #12–18 in `lint-session-reset-guard.sh` | landed via editor · commit pending |
| A2  Reaction module reuse | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-G · `ReactionPanel.tsx:12` | `Composer.reactionpanel.test.ts` (5 assertions) | Invariants #47–50 in `lint-session-reset-guard.sh` | pending commit |
| A3  Trim reuse | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-H · `TrimPanel.tsx:12` | `Composer.trimpanel.test.ts` (4 assertions) | Invariants #51–54 | pending commit |
| A4  Captions reuse | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-I · `CaptionsPanel.tsx:12` | `Composer.captionspanel.test.ts` (4 assertions) | Invariants #55–58 | pending commit |
| A5  Watermark preset picker | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-J · `WatermarkPanel.tsx:14` | `Composer.watermarkpanel.test.ts` (4 assertions) | Invariants #59–62 | pending commit |
| A6  Base Window dev-panel | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-B · `Composer.tsx:521` | `src/design-os/routes/Composer.devpanel.test.ts` (8 assertions) | Invariants #19–24 in `lint-session-reset-guard.sh` | pending commit |
| A7  Command bar text | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-C · `Composer.tsx:64` | `src/design-os/routes/Composer.commandbar.test.ts` (8 assertions) | Invariants #25–30 in `lint-session-reset-guard.sh` | pending commit |
| A8  Command history | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-T · `Composer.tsx` (chip row + storage key) | `Composer.historychips.test.ts` (9 assertions) | Invariants (T block) | pending commit |
| A9  Turbo mode | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-D · `Composer.tsx:127` | `src/design-os/routes/Composer.turbo.test.ts` (10 assertions) | Invariants #31–36 in `lint-session-reset-guard.sh` | pending commit |
| A10 Session persistence | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-E · `CockpitContext.tsx:67` | `CockpitContext.baseWindow.test.ts` (8 assertions) | Invariants #37–42 in `lint-session-reset-guard.sh` | pending commit |
| A11 Idle canvas | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-F · `Composer.tsx:488` | `src/design-os/routes/Composer.idle.test.ts` (7 assertions) | Invariants #43–46 in `lint-session-reset-guard.sh` | pending commit |
| B1  Silence removal | ❌ | — | — | — | — |
| B2  Playback speed | ❌ | — | — | — | — |
| B3  Karaoke captions | ❌ | — | — | — | — |
| B4  Split-screen render | ❌ | — | — | — | — |
| B5  Grid 2×2 render | ❌ | — | — | — | — |
| B6  Audio mixing | ❌ | — | — | — | — |
| B7  Hook overlay | ❌ | — | — | — | — |
| C1  LLM proxy | ❌ | — | — | — | — |
| C2  Kade intent endpoint | ❌ | — | — | — | — |
| C3  Referral URL | 🔒 LOCKED 2026-07-18 · client-side collapse | IG-COMPOSER-R · `src/lib/referralUrl.ts:12` | `referralUrl.test.ts` (8 assertions) | Invariants #85–88 | pending commit |
| C4  HQ library search | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-K + L · `hqLibrary.ts` + `LibraryPanel.tsx` | `hqLibrary.test.ts` + `Composer.librarypanel.test.ts` (15 assertions) | Invariants (K/L block) | commit `f6a351ae` |
| C5  Podcast archive | 🔒 LOCKED 2026-07-18 · via HQ podcast handoff | IG-COMPOSER-K · `hqLibrary.ts:getPodcastHandoff` | `hqLibrary.test.ts` (podcast route asserted) | Invariants (K block) | commit `f6a351ae` |
| C6  Rule preflight | ❌ | — | — | — | — |
| C7  One-click Whop submit | ❌ | — | — | — | — |
| D1  Screen capture display + window | ❌ | — | — | — | — |
| D2  System audio + mic | ❌ | — | — | — | — |
| D3  Camera capture | ❌ | — | — | — | — |
| D4  Countdown + live preview | ❌ | — | — | — | — |
| D5  Multi-monitor + per-app | ❌ | — | — | — | — |
| E1  Dialogue library | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-M · `kadeDialogue.ts:15` | `kadeDialogue.test.ts` (7 assertions) | Invariants #70–72 | pending commit |
| E2  Pose registry | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-N · `kadePoses.ts:14` | `kadePoses.test.ts` (7 assertions) | Invariants #73–75 | pending commit |
| E3  Celebration flash | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-O · `CelebrationFlash.tsx:12` | `CelebrationFlash.test.ts` (7 assertions) | Invariants #76–78 | pending commit |
| E4  moveKade animation | 🔒 LOCKED 2026-07-18 · end-to-end wired via ComposerKade | IG-COMPOSER-P + W · `kadeMove.ts:15` + `ComposerKade.tsx:16` | `kadeMove.test.ts` + `ComposerKade.test.ts` (17 assertions) | Invariants (P + W blocks) | pending commit |
| E5  Progressive silence | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-Q · `kadeSilence.ts:14` | `kadeSilence.test.ts` (6 assertions) | Invariants #82–84 | pending commit |
| E6  Voice input | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-V · `voiceInput.ts:12` | `voiceInput.test.ts` (7 assertions) | Invariants (V block) | pending commit |
| E7  Slot A/B/C system | 🔒 LOCKED 2026-07-18 | IG-COMPOSER-U · `SlotGrid.tsx:16` | `SlotGrid.test.ts` (8 assertions) | Invariants (U block) | pending commit |
| F1  Timeline UI | ❌ | — | — | — | — |
| F2  Waveform | ❌ | — | — | — | — |
| F3  Beat lock | ❌ | — | — | — | — |
| F4  Batch apply / Ship | ❌ | — | — | — | — |
| F5  Brand presets | ❌ | — | — | — | — |
| **[FLYWHEEL COMPLETE]** — re-mount Composer tile in CommandRoom | ❌ | — | — | — | — |

**FLYWHEEL COMPLETE requires:** A1 · A2 · A3 · A5 · A6 · A7 · A10 · A11 · B1 · B7 · C3 · C4 · C6 · C7 · D1 · D2 · E1 · E2 · E3 · E4 · E6 · E7 all ✅

That's the minimum viable flywheel: user types "give me 3 clips about customer acquisition" → real transcript scrub → real trim → real watermark → real referral URL → real Whop submit. Everything else is polish/optionality.

**MVP feature count: 22 features. Est: 88 h focused work.**

---

## 7 · EXECUTION SEQUENCE · deterministic order

Follow this order top-to-bottom. Each feature unlocks the next.

### Sprint 1 · Real Composer route (Class A ground)

Do all of A1 · A6 · A7 · A9 · A10 · A11 first. Compressible into one 2-day sprint. Unlocks a real Composer shell users can actually enter (behind a hidden route).

**Sprint 1 exit gate:** deep-link `#/composer` mounts the route · voice/text command lands · JSON dev-panel updates from real state · turbo toggle works · session restores after reopen · idle canvas blank at rest.

### Sprint 2 · Reuse the editor (Class A + one Class C)

A2 · A3 · A4 · A5 · C3 (referral URL). Trim / Captions / Reaction from Workstation land in Composer via imports. Real watermark render with real referral URL.

**Sprint 2 exit gate:** user in Composer can trim a clip, style captions, add a reaction (existing 7 layouts), pick watermark preset. Export produces real MP4 with real referral URL burned in.

### Sprint 3 · Kade character (Class E)

E1 · E2 · E3 · E4 · E5. Port dialogue library, pose registry, celebration, moveKade, silence rule from simulator to React.

**Sprint 3 exit gate:** Composer feels like the simulator visually · Kade speaks + poses + celebrates on real actions · progressive silence kicks in after 5 flows.

### Sprint 4 · Voice + LLM router (Class C + E6)

C1 · C2 · E6. Voice input via existing Whisper sidecar wraps into command bar · LLM proxy answers ambiguous intents.

**Sprint 4 exit gate:** speak a command · Composer transcribes + routes + executes. High-confidence intents fire directly. Low-confidence surface 2-option ask panel.

### Sprint 5 · Screen recording (Class D) — flagship

D1 · D2 · D3 · D4. Requires v2.2.43 shell release + signing.

**Sprint 5 exit gate:** click Tutorial mode tile → real MP4 lands in ~/LiquidClips/ · watermark visible in-frame · Kade dialogue narrates the capture.

### Sprint 6 · Library + Campaign wire-up (Class C)

C4 · C5 · C6 · C7. HQ library search + podcast archive · rule preflight · Whop submission.

**Sprint 6 exit gate:** flywheel closes. User records with Tutorial mode → real clip → real preflight → real Whop submit → real payout.

### Sprint 7 · Sidecar polish (Class B)

B1 · B2 · B3 · B7. Silence removal · playback speed · karaoke captions · hook overlay.

**Sprint 7 exit gate:** all Trim / Frame / Audio features work end-to-end. Editor parity with Workstation + karaoke bonus.

### Sprint 8 · Slot system + split-screen (E7 + B4 + B5 + B6)

E7 · B4 · B5 · B6. Slot A/B/C system + real ffmpeg split render + audio mixing.

**Sprint 8 exit gate:** split-screen compositions render to real MP4 with real audio mixing.

### Sprint 9 · Donor ports (Class F)

F1 · F2 · F3 · F4 · F5 — as time allows.

**Sprint 9 exit gate:** timeline · waveform · beat lock · batch apply · brand presets. Composer becomes power-user-ready.

**FLYWHEEL COMPLETE after Sprint 6.** Sprints 7-9 are polish.

---

## 8 · PER-FEATURE PROTOCOL · anti-regression discipline

For every feature landing in the STATE LOG:

### Step 1 · Scope · read-only

Read the feature's row in `## 5`. Read every file listed. Read the iron gates + tests + lint scripts in `## 2`. Do NOT edit yet.

### Step 2 · Write iron gate sentinel FIRST

In the primary file, add:

```typescript
/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-X · <feature name> · LOCKED YYYY-MM-DD
   ─────────────────────────────────────────────────────────────────────
   <what this code MUST do · what it MUST NEVER do · why>
   ═════════════════════════════════════════════════════════════════════ */
```

### Step 3 · Write vitest regression test FIRST

New file: `src/**/<primary-file>.<feature-slug>.test.ts`. Use `readFileSync` to grep source-level invariants + runtime assertions when jsdom is needed. Reference `authStorage.session-reset.test.ts` as template.

### Step 4 · Write lint script FIRST

Extend `desktop-2/scripts/lint-session-reset-guard.sh` OR create sibling `lint-<feature>-guard.sh`. Wire into `.githooks/pre-commit` if new script. Grep invariants match the iron gate.

### Step 5 · Write build/runtime guard (if applicable)

Only if the failure mode touches build env, native APIs, external contracts. Follow `assert-prod-build-env.sh` pattern.

### Step 6 · NOW write the actual feature code

Only after 2-5 are in place. This forces you to think about the contract before the implementation.

### Step 7 · Run the gates

- `npx tsc --noEmit -p tsconfig.json` → EXIT 0
- `npx vitest run` from `desktop-2/` → 0 failures
- `bash scripts/lint-session-reset-guard.sh` (or sibling) → PASS
- `bash .githooks/pre-commit` → PASS (dry-run before commit)

### Step 8 · Commit + verify

Commit with sentinel-linked message. Rebuild dist. Install to `/Applications`. Grep the installed bundle for the feature's distinctive strings.

### Step 9 · Update STATE LOG

Flip status from ❌ → 🟡 → ✅ → 🔒. Record commit SHA. Never lie.

### Step 10 · Re-run every prior feature's test

Every commit runs the FULL vitest suite. Any regression = revert.

---

## 9 · ROLLBACK PROTOCOL

If any commit breaks a previously-locked feature:

1. `git log --oneline -20` — find the offending commit
2. `git revert <sha>` — clean revert (not `git reset`, we preserve history)
3. Re-run full vitest suite until 0 failures
4. Re-run `bash .githooks/pre-commit`
5. Update STATE LOG · flip the affected feature to 🟡 with note "reverted <sha>, needs re-do"
6. Post-mortem: which layer of the 4-layer defense failed to catch the regression? Add the missing invariant.

---

## 10 · SESSION START CHECKLIST

At the start of every Composer session:

- [ ] Read this master plan preamble + STATE LOG
- [ ] `cd /Users/dipdip/code/jnr/desktop-2 && git status` — confirm working tree state
- [ ] `npx tsc --noEmit -p tsconfig.json` — must EXIT 0
- [ ] `npx vitest run` — must pass all suites
- [ ] `bash scripts/lint-session-reset-guard.sh` — must PASS
- [ ] Read the next incomplete feature row in STATE LOG
- [ ] Execute the 10-step per-feature protocol (§ 8)

If any check fails, fix that BEFORE starting new work.

---

## 11 · WHAT THIS DOC IS NOT

- Not aspirational. Every feature has a real file path and real hours.
- Not editable during a sprint. Update the STATE LOG only. Structural changes to `## 5` (adding features, removing features) require an explicit "master plan update" commit.
- Not a substitute for your judgment. If a feature's exit criteria conflict with the ground rules in `## 1`, the ground rules win.

---

## 12 · APPENDIX · dependency map

Which features unlock which:

- **A1 unlocks:** every other feature (Composer route must exist)
- **E1, E2 unlock:** every Kade dialogue moment
- **C1 unlocks:** C2 (LLM router), E6 disambiguation, ask panel high-fidelity
- **D1 unlocks:** D2, D4, D5, and Tutorial mode
- **C3 unlocks:** flywheel viability (referral URL is core to the paid-demo loop)
- **B1-B7 unlock:** real export pipeline (until these land, "export" is fake)
- **E7 unlocks:** B4, B5 (slots are the referential system for multi-region composition)
- **C4, C5 unlock:** Library panel becomes real
- **C6, C7 unlock:** Whop submission loop closes

---

## END · single source of truth

**Do not deviate from this doc. Extend it via explicit "master plan update" commits when scope changes. Track state in `## 6`. Follow the sequence in `## 7`. Ship one feature at a time. Green tests, green lints, green tsc, or don't commit.**
