# Kade Composer · REAL build scope

**Date:** 2026-07-18
**Owner:** claude
**Status:** the React demo route was PULLED from the UI at 17:33 · scaffolding stays on disk · nothing ships to users until each feature below has a green ✅ under "real bytes behind it"

---

## Ground truth · what I lied about

I shipped a Composer route in the last build that looked functional but was hollow. The UI mounts, Kade animates, JSON updates in a dev-panel — but no bytes touch disk, no OS calls fire, no video is created. That's a demo. It should never have been in the shipping app. It's now unreachable from the UI. This doc replaces that theatre with a real scope you can execute against.

---

## The 12 features in scope · matrix

Legend:
- ✅ = works today, real bytes, no changes needed
- 🟡 = partial (some real code exists, some mocked)
- ❌ = zero real bytes today, all UI theatre
- **Ship as** = which release lane it lands on

| # | Feature | HTML mockup shows | App shows today | Gap | Real build | Effort | Ship as |
|---|---|---|---|---|---|---|---|
| 1 | **Clip window · transcript scrub** | Kade highlights hook words, drops 3 clips | ❌ Composer panel is empty, real work happens in `Workstation` | Wire Composer's `flowDiscovery` to existing `sidecar.get_transcript` + `pick_clips_from_transcript` | Import from `src/design-os/engine/sidecar-stub.ts` · replace mock scan animation with real progress events (`engine:progress`) | 6h | **Runtime bundle** (v2.4.0) |
| 2 | **Clip window · range picker** | Waveform + drag handles | ❌ mock panel | Add waveform via `wavesurfer.js` (BSD-3, MIT-safe) + tie handles to Base Window `in`/`out` | New `src/design-os/engine/composer/ranges/RangePicker.tsx` (~200 lines) | 8h | Runtime bundle |
| 3 | **Clip window · topic prompt** | LLM narrows to a topic | ❌ | Add `/proxy/llm` backend route (junior-backend sprint #8) + client wrapper | Backend endpoint (~4h) + client hook (~2h) | 6h | Backend + runtime bundle |
| 4 | **Clip window · split-screen** | Slot A/B/C region select, live layout switcher | 🟡 Composer panels have layout switcher UI, no ffmpeg overlay filter behind it | Wire Composer flow to `sidecar.export_split_composition` (new sidecar RPC that builds an ffmpeg filter graph) | Sidecar method (~6h Python) + client wire (~2h) | 8h | Native shell + runtime bundle |
| 5 | **Screen recording · display / window / camera** | 6-tile picker · Tutorial mode · REC pill · real clip lands | ❌ mock picker only | Rust helper using `screencapturekit-rs` (screen/window/audio) + `nokhwa` (camera) + Tauri command wrappers | New Rust module `src-tauri/src/screen_capture.rs` (~400 lines) + 5 Tauri commands + macOS permission flow | **16h** | Native shell (v2.2.43) |
| 6 | **Attributable watermark + referral flywheel** | Watermark chip visible on export, QR renders, referral URL from backend | 🟡 watermark render exists in `ExportPanel.tsx:71-110`, no referral URL surface | Backend endpoint `/me/referral-url` returns short URL + tracking token · QR via `qrcode` npm package · overlay in ffmpeg export | Backend (~2h) + QR client (~2h) + ffmpeg filter (~3h) | 7h | Backend + runtime bundle |
| 7 | **Campaign recording integration** | Brief card visible during record, rule validation, one-click Whop submit | 🟡 Whop bounty proxy already lives at `junior-backend/app/routes/whop.py`, campaign fetching works · rule validation + one-click submit are NOT wired to any UI | Wire Composer's `flowCampaign` to real Whop context · move rule validation from mock to sidecar preflight before export | Backend has 90% · client wire (~4h) + preflight in sidecar (~3h) | 7h | Backend refinement + runtime bundle |
| 8 | **CapCut-level editor · Trim** | Multi-track timeline, playback speed, remove silence | 🟡 Workstation has basic trim, no timeline, no speed, no silence removal | Reuse trim from Workstation (already works) · add `remove_silence` sidecar method (calls ffmpeg silence filter) · add speed via ffmpeg atempo | Trim already done · silence (~2h) + speed (~2h) | 4h | Runtime bundle + sidecar |
| 9 | **Editor · Karaoke captions** | Word-level highlight synced to transcript | 🟡 Workstation captions exist but no word-timing | Extract word-level timings from Whisper (already returned by `faster-whisper-tiny`) · render via CSS timing keyframes | Sidecar (~2h) + client render (~4h) | 6h | Runtime bundle + sidecar |
| 10 | **Editor · Reactions overlay** | PIP / side-by-side / top-bottom / full-overlay layouts | 🟡 exists in Workstation via `ReactionModule.tsx`, all 7 layouts work | No gap for basic case · Composer just needs to reuse it | Import `ReactionModule` into Composer flow | 1h | Runtime bundle |
| 11 | **Editor · Frame + Hook overlay** | Safe-zone hints, hook text with gradient template | ❌ mocked in Composer | Reuse existing `hook_burnin` from `stages.py` (already works in bundle export) · client picker for template | Client (~4h) · sidecar already done | 4h | Runtime bundle |
| 12 | **Editor · Audio mixing** | Duck source, add music, per-track volume | ❌ mocked | Sidecar method that layers audio via ffmpeg amix + volume filters · music library curated by us (start with 3 CC0 tracks) | Sidecar (~4h) + client (~3h) + 3 music files | 7h | Runtime bundle + sidecar |
| 13 | **Editor · Multi-track timeline** | Video / Reaction / Caption / Hook / Audio 5-track visual | ❌ mocked | Port from `Augani/openreel-video` (MIT) OR build from scratch via Remotion `<Composition>` | 30-45h if custom · 15-25h with Remotion | **25h** | Runtime bundle |
| 14 | **Watermark preset picker** | 3 presets: BR corner / BL corner / full-bar | 🟡 exists in `ExportPanel` as toggle only | Add preset menu backed by `CockpitSettings.publish` | Client (~2h) · watermark render already exists | 2h | Runtime bundle |
| 15 | **Ask panel · confidence router** | 2-option pickers for ambiguous intent | 🟡 works in the simulator + Composer, but only 3 test intents. Real router needs LLM extraction | LLM backend + Redis cache · router already handles all 3 tiers | Same as feature 3 (needs `/proxy/llm`) | 8h | Backend + runtime bundle |
| 16 | **Whisper voice input** | User speaks, transcribes, feeds into command bar | ❌ no voice input UI, existing sidecar has Whisper for transcripts | Client wrapper `src/lib/whisper.ts` that calls sidecar's existing Whisper on mic capture · MediaRecorder API for audio | Client (~4h) · sidecar already works | 4h | Runtime bundle |

---

## 🎯 Thumbnail clip library · answering your explicit ask

You said "including the thumbnail clip library." Here's what that actually is + the gap.

### What the mockup shows
Right-side "Library" panel · search box · 3 filter chips (HORMOZI · ALEX · IMAN) · results grid with thumbnails · click → adds to current clip.

### What exists today
| Layer | State |
|---|---|
| **HQ YouTube library backend** | Real · HQ delivered the API 2026-07-17 (see `desktop-2/docs/HQ_YOUTUBE_LIBRARY_RESPONSE_ANALYSIS.md`). Endpoints: `/api/library/search`, `/api/handoff/<video_id>`. 1.3M episodes indexed with real transcripts. |
| **App's Library panel** | Zero. The Composer's `flowLibrary` panel is mock chips + fake results. |
| **Existing "My Clips"** | Real user-generated clips already surface at `#/my-clips` (Workstation era) |
| **Existing "Projects"** | Real projects surface at `#/projects` |

### The gap
The **CREATOR LIBRARY** (Hormozi et al · what your mockup shows) is not wired at all. HQ built the backend but no client surface consumes it.

### Real build
| Step | File | Hours |
|---|---|---|
| Client search hook `useHqLibrarySearch(query, filter)` | `src/lib/hqLibrary.ts` (new) | 3 |
| Library panel with real fetch + skeleton loading + error states | `src/design-os/engine/composer/ParamPanels/LibraryPanel.tsx` (replace mock with real) | 6 |
| Thumbnail lazy-load + IntersectionObserver | Same | 2 |
| "Add to clip" action wires to `sidecar.download_yt_segment` | `src/design-os/engine/sidecar-stub.ts` (new RPC) | 4 |
| Auth headers via `authedFetch` | Same | 1 |
| **Total** | | **16h** |

Ships in: **runtime bundle** (client) + **backend** (already done by HQ) + **sidecar** (new download RPC needs to land in bundle inside the .app · effectively a native shell bump).

---

## Delete criteria · when I destroy the Composer scaffolding

The current Composer files at `src/design-os/engine/composer/` + `src/design-os/routes/Composer.tsx` + `App.WelcomeGate.test.ts` + iron gates STAY on disk until one of these is true:

1. You explicitly say "delete Composer route entirely"
2. We complete feature #13 (timeline) OR features 1-11 without the timeline · at which point Composer becomes real and the demo residual is gone by definition
3. 30 days pass without progress · admin cleanup

Deleting the Composer route right now would waste ~30 hours of route + panel scaffolding · but 0 hours of real feature work. Keeping it is only useful if we build the real features into it.

**Recommended:** keep the files, keep them unreachable from UI (already done), work through the feature matrix top-to-bottom.

If you disagree · say "burn it" and I remove `Composer.tsx`, `Composer.css`, the entire `engine/composer/` folder, the test file, the WelcomeGate iron gate, and all lint script invariants pointing at composer/*. That's a clean sweep in ~10 min.

---

## Priority order · what unlocks the most value fastest

If we work top-to-bottom on the matrix, features 8-10 (Trim / Karaoke / Reactions) are the fastest to real bytes because they reuse existing code. But those are Workstation features, not new Composer features. Do those first if you want visible progress in ~11 hours total.

If you want the **new** features (voice input, screen recording, split-screen), the fastest chain is:

1. **Feature 16 · Voice input** (4h · client only) — unlocks the voice-first identity of Composer
2. **Feature 3 · Topic prompt / LLM router** (6h · backend + client) — unlocks natural language clip picking
3. **Feature 5 · Screen recording** (16h · Rust native) — unlocks the flywheel. This is the flagship. Ships as `.app` v2.2.43.
4. **Feature 7 · Campaign integration** (7h · client wire) — unlocks paid clip pipeline
5. **Feature 6 · Watermark + referral flywheel** (7h · backend + client) — completes the Tutorial-mode viral loop

**Total to a REAL Composer that ships:** ~40 hours of focused work across client + backend + Rust + sidecar.

Rough calendar: **5 working days if I focus only on this** · **2 weeks with realistic parallel work + your review cycles**.

---

## What you asked for · in one paragraph

You have (a) 12 HTML mockups that show the aspiration, (b) a Composer route in the app that pretended those aspirations were shipping, and (c) a mismatch between the two that I created. The route is now unreachable from your UI. This document is the real map from mockup to shipping code — 16 features, real files, real hours, real dependencies. The features that reuse existing code (trim, reactions, karaoke) are 4-6 hours each. The features that need new Rust (screen recording) are 16 hours. The features that need backend (LLM, HQ library) are 4-8 hours each. Total to a REAL Composer: ~40 hours if we sequence it. Say the word on which one to start with and I stop building demos.

---

## One action

Say one of these three:
- **"start feature 16 → 3 → 5"** — I start with voice input · then LLM · then screen recording
- **"start feature 8-10 first"** — I hit the reused-code features first for fast visible progress
- **"burn it"** — I delete the entire Composer scaffolding, we go back to Workstation as the editor, and you pick the next real feature to build against Workstation instead
