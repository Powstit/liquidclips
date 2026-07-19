# Kade Composer · integration scope

**Date locked:** 2026-07-18
**Owner:** claude · desktop-2
**Status:** scope only · no code changes yet · awaiting Daniel approval
**Related mockups:**
- `docs/mockups/proposed/kade-composer-simulator.html` (5,556 lines · 17 capabilities · confidence router · Tutorial mode)
- `docs/mockups/proposed/index.html` (5-feature locked scope)
- `docs/mockups/proposed/kade-asset-gallery.html` (transparent-asset audit)

## TL;DR

The Kade Composer is a **tool surface** (Design OS pipeline) and can safely replace the current Workstation editor route **without touching the money-surface pipeline** (`src/routes/**`). It reuses `CockpitContext` (existing composition state), `KadeController` (existing 19 poses), `Watchdog` + `EngineErrorBoundary`, and `diagnosticLogger` untouched. The 3 iron gates in `Workstation.tsx` (IG-LC2-016 · 017 · 018) transfer 1:1 to the Composer route. Zero paying-user regression risk if we roll out in 5 phases with a feature-flag opt-in first.

## What Composer replaces

| Current | Path | Replaced by Composer |
|---|---|---|
| WorkstationRoute | `src/design-os/routes/Workstation.tsx:546–559` | New `ComposerRoute` in `src/design-os/routes/Composer.tsx` (add · don't overwrite) |
| CockpitDock (module selector) | Workstation lines 34–44 | Kade cockpit sidebar · natural-language + ask-panel |
| ReactionModule | `src/design-os/engine/cockpit/ReactionModule.tsx` | Composer's `flowReactionsDeep` + reaction param panel |
| CaptionModule | `src/design-os/engine/cockpit/CaptionModule.tsx` | Composer's `flowCaptions` + captions param panel |
| TrimModule | `src/design-os/engine/cockpit/TrimModule.tsx` | Composer's `flowTrim` + trim param panel |
| StyleModule | `src/design-os/engine/cockpit/StyleModule.tsx` | Composer's `flowFrame` + frame param panel |
| ScheduleModule | `src/design-os/engine/cockpit/ScheduleModule.tsx` | Composer's `flowLibrary` → publish handoff (schedule stays in Publish flow) |
| PublishModule | `src/design-os/engine/cockpit/PublishModule.tsx` | Composer's `flowWatermark` + publish param panel |
| ClipPreviewShell | `src/design-os/studio/ClipPreviewShell.tsx` | Composer's centered 9:16 canvas (idle-state fix in place) |
| ResultsGrid | `src/design-os/engine/ResultsGrid.tsx` | Composer's clip-stack strip |

The 6 cockpit modules are **not deleted** during Composer rollout · they remain live inside `Workstation.tsx` for the entire opt-in phase. Only after Phase 5 feature-parity gate passes do we retire them.

## What Composer reuses (do NOT rebuild)

| Primitive | Path | Composer usage |
|---|---|---|
| **CockpitContext** (composition state) | `src/design-os/engine/cockpit/CockpitContext.tsx:1–74` | Extend `CockpitSettings` shape with a `baseWindow` field (regions · layout · watermark · audio · captions) · localStorage key format stays `${slug}:${clipIdx}` |
| **CockpitProvider** | `src/design-os/routes/Workstation.tsx:266` | Composer route wraps the same provider · never rewrite |
| **clipSettingsStore** (persistence) | `src/design-os/engine/cockpit/CockpitContext.tsx` | Same key format · same localStorage backend · schema extends, doesn't fork |
| **KadeController** (pose engine) | `src/design-os/components/KadeController.tsx` | 19 existing poses cover ~90% of Composer's needs · add `celebration` if absent · Composer emits pose changes via existing `KadeState` union |
| **KadeState** union | `src/design-os/bridge/events.ts:15–33` | Extend union with any new poses required by capability graph · additive only |
| **Watermark render config** | `src/design-os/studio/ExportPanel.tsx:71–110` | Composer's `flowWatermark` reads the same tier-gated config · watermark toggle logic stays in ExportPanel |
| **Watchdog** | `src/lib/watchdog/Watchdog.tsx` | Composer route wraps in same Watchdog boundary at mount |
| **EngineErrorBoundary** | `src/design-os/components/EngineErrorBoundary.tsx` | Same wrap · matches Workstation lines 548 + 324 |
| **diagnosticLogger / lcDiag** | `src/lib/diagnosticLogger.ts:40` | Composer emits behavioral events only · no `*_rendered` events per CLAUDE.md |
| **Sidecar RPC stubs** | `src/design-os/engine/sidecar-stub.ts` | Composer reuses transcript / clip-pick RPCs · new capability endpoints add to same stub |

## Bus event contracts (must survive)

| Event | Publisher / Subscriber | Composer behavior |
|---|---|---|
| `nav:click` | Workstation:240 · Router:289 | Composer registers under the same nav taxonomy · new alias `composer` |
| `clip:open-edit` | Workstation:98 | Composer subscribes · opens the selected clip inside its canvas |
| `clip:open-export` | Workstation:105 | Composer's `flowWatermark` / Publish path handles this |
| `engine:complete` · `engine:progress` | `src/design-os/bridge/events.ts:127–142` | Composer emits both when running any flow · same shape |
| `route:enter` | bridge/events.ts:122 | Composer emits on mount |
| `toast` | Workstation:435 | Composer emits for user-facing status (matches existing UX) |

## Iron gates (transfer intact · retire only after Workstation is deleted)

| Gate | Purpose | Composer plan |
|---|---|---|
| **IG-LC2-016** | `focusedClip` must come from live session · never `FIXTURE` | Composer's `state.focusedClip` reads the same live session hook · gate transfers verbatim |
| **IG-LC2-017** | Dock + preview read the SAME `focusedClip` reference | Composer's cockpit + canvas both consume `useCockpit().focusedClip` — same reference · gate transfers |
| **IG-LC2-018** | `CockpitProvider` lifted · stable mount across re-renders | Composer route wraps `CockpitProvider` at the route level · same pattern as Workstation:266 |
| **IG-002** | Sidecar contract stability | Composer only consumes existing sidecar RPCs · no schema changes |

**During coexistence (Phases 1–4):** all 4 gates guard **both** Workstation and Composer.
**After Phase 5 (Workstation retirement):** IG-LC2-016/017/018 remain in the Composer file · IG-002 unchanged.

## What Composer must NOT touch

- `src/routes/**` — Section pipeline (money surfaces: Wallet · Cold entry · Outreach · Cancellation · Catalog)
- `src/sections/**` — money-surface implementations
- `src/shell/sectionRegistry.ts` — money-surface registry
- `sections/account/AccountSection.tsx` (WalletDetail + SectionWithFallback)
- Any file under `../junior-backend/` (backend-managed by dev team)
- Any file under `../account-app/admin/` (Lane B territory per CLAUDE.md)
- `SectionWithFallback` wrapper — scoped to Wallet only per money-surface rule

If Composer touches ANY of the above, **STOP and re-scope**. It's a tool surface. It has no business inside money-lane files.

## Backend additions required (not blocking Phase 1)

| New surface | Path | Purpose | Blocking phase |
|---|---|---|---|
| LLM proxy | `junior-backend/app/routes/proxy_llm.py` (sprint #8) | Kade intent extraction · natural-language routing | Phase 2 |
| Capability graph server-side | `junior-backend/app/capabilities/graph.py` | Canonical capability graph mirrored from simulator | Phase 2 |
| Intent endpoint | `POST /me/kade/intent` in `junior-backend/app/routes/kade_intent.py` | `{user_text, session_state}` → `{action:"execute"\|"ask", capability, resolved_params, choices?}` | Phase 3 |
| Sidecar Whisper client wrapper | `desktop-2/src/lib/whisper.ts` (new) | Client-side call into existing faster-whisper-tiny sidecar for voice input | Phase 2 |
| Screen-capture helper | `desktop-2/src-tauri/liquid-capture/` (new Rust helper per feature-2 mockup) | Backs Composer's `flowRecord` (Tutorial + Screen + Window + Camera modes) | Phase 3 |

Phase 1 ships **with regex-only intent routing** (same shape as simulator today). LLM upgrade is a non-blocking Phase 2 swap.

## Rollout order · 5 phases · gates between

### Phase 1 · Coexistence (Composer as opt-in route)
- Add `src/design-os/routes/Composer.tsx`
- Register in `SimulatorRouter.tsx` under key `composer` alongside existing `workstation`
- Kade Home cockpit gains a "Try new Composer" tile (feature-flagged · default OFF)
- Users who click land on Composer · users who don't stay on Workstation
- All 12 flows + capability graph + ask panel port from simulator to React
- Base Window state extends CockpitContext (no localStorage schema fork)
- **Gate to Phase 2:** ship-lens (Design OS · behavioral only) passes · watchdog quiet · zero regressions on Workstation route

### Phase 2 · Backend intent routing
- Ship `/proxy/llm` + `/me/kade/intent` in junior-backend
- Composer's `routeThroughCapabilities` swaps regex-only for real LLM extraction (fallback to regex when offline)
- Whisper client wrapper wires voice input into Composer's command bar
- **Gate to Phase 3:** intent-routing accuracy ≥ 90% on top-20 test intents · voice-to-intent latency < 1.5s

### Phase 3 · Feature parity gate
- Prove EACH of the 6 module capabilities end-to-end in Composer:
  - Reactions module (layout · main volume · reaction volume · auto-switch · duck)
  - Captions module (style preset · position · words-per-line · karaoke · size · font)
  - Trim module (start · end · duration · playback speed · remove silence · auto-tighten)
  - Style / Frame module (safe zones · zoom · hook text · emphasis · duration · template)
  - Schedule module (via Publish flow · date · platform)
  - Publish / Watermark module (preset · handle · QR · export quality · tier gate)
- Add `liquid-capture` Rust helper · Composer's `flowRecord` produces real recordings (Tutorial + all 5 source modes)
- **Gate to Phase 4:** parity matrix 100% green · 40k-user-scale robustness lens passes · zero rollback events for 7 days

### Phase 4 · Default-for-new-users
- Composer becomes DEFAULT route for new signups
- Existing paying users still see Workstation (unchanged experience) unless they opt-in
- Kade Home cockpit tile flips from "Try new" to "Composer (recommended)"
- **Gate to Phase 5:** 30 days · zero user-reported blockers · watchdog stable · retention parity vs Workstation cohort

### Phase 5 · Workstation retirement
- Delete `src/design-os/routes/Workstation.tsx`
- Delete the 6 cockpit modules
- Delete `ClipPreviewShell.tsx` + `ResultsGrid.tsx` (superseded by Composer canvas + clip stack)
- Retire IG-LC2-016/017/018 in Workstation (they live on inside Composer verbatim)
- Update `SURFACE_FOR` and `ALIAS_FOR` in SimulatorRouter to alias `workstation` → `composer` (backward compat for saved routes)
- Ship-lens final pass · SYSTEM_UPDATE.md entry · dev-team notified

## Feature parity matrix

Composer cannot enter Phase 4 until every row is ✅.

| Cockpit module | Current file | Composer flow | Simulator proof | Real React proof | Real backend proof |
|---|---|---|---|---|---|
| Reaction | ReactionModule.tsx | flowReactionsDeep + flowReaction | ✅ | ⚠️ Phase 1 | ⚠️ Phase 3 |
| Caption | CaptionModule.tsx | flowCaptions | ✅ | ⚠️ Phase 1 | ⚠️ Phase 3 |
| Trim | TrimModule.tsx | flowTrim | ✅ | ⚠️ Phase 1 | ⚠️ Phase 3 |
| Style / Frame | StyleModule.tsx | flowFrame | ✅ | ⚠️ Phase 1 | ⚠️ Phase 3 |
| Schedule | ScheduleModule.tsx | (part of flowWatermark → Publish) | ⚠️ Phase 3 | ⚠️ Phase 3 | ⚠️ Phase 3 |
| Publish | PublishModule.tsx | flowWatermark | ✅ | ⚠️ Phase 1 | ⚠️ Phase 3 |
| Screen recording | (not in Workstation today · new capability) | flowRecord (Tutorial · Display · Window · +mic · Camera) | ✅ | ⚠️ Phase 3 | ⚠️ Phase 3 (liquid-capture helper) |
| Campaign brief | (not in Workstation today · new) | flowCampaign | ✅ | ⚠️ Phase 2 | ⚠️ Phase 2 |
| Watermark preview | inside PublishModule (partial) | flowWatermark | ✅ | ⚠️ Phase 1 | ⚠️ Phase 1 |
| Multi-track timeline | absent | flowTimeline | ✅ | ⚠️ Phase 3 | ⚠️ Phase 3 |
| Audio mixing | absent | flowAudio | ✅ | ⚠️ Phase 3 | ⚠️ Phase 3 |

Legend: ✅ done · ⚠️ Phase N required.

## Safety proofs (why Composer can ship without breaking paying users)

1. **Composer lives in a separate route file** — Workstation.tsx is untouched during Phases 1–4
2. **Feature-flagged opt-in** — new UI hidden behind a Kade Home tile · no default route change until Phase 4
3. **CockpitContext extended, not forked** — clipSettings persistence key format stays `${slug}:${clipIdx}` so a user who opts into Composer, tweaks a clip, then opts back out, sees their edits in Workstation too
4. **Iron gates transfer verbatim** — IG-LC2-016/017/018 wrap Composer as they wrap Workstation
5. **No Section-pipeline touch** — money surfaces are physically untouchable per file boundaries
6. **Watchdog + EngineErrorBoundary wrap Composer** — any Composer crash falls back to error card without corrupting session state
7. **Sidecar contract IG-002 unchanged** — Composer consumes existing RPCs · no schema drift
8. **SYSTEM_UPDATE.md maintained** — every Composer commit before push is documented for dev-team pull (per locked memory)
9. **ship-lens is a HARD GATE** — nothing ships without it passing (per locked memory)
10. **2E2 gates run before every phase transition** — 5 customer-journey gates green (per locked memory)

## Migration checklist (Phase 5 only)

- [ ] All parity matrix rows ✅ for 30 consecutive days
- [ ] Watchdog dashboard shows Composer error rate ≤ Workstation baseline
- [ ] Retention cohort at 7 · 14 · 30 days matches or beats Workstation
- [ ] No user-reported "editor missing" tickets since Phase 4 default flip
- [ ] SYSTEM_UPDATE.md drafted with all retirement diffs
- [ ] Ship-lens final pass · behavioral events clean
- [ ] Dev team greenlit · CLAUDE.md updated · iron-gate override for IG-LC2-016/017/018 in Workstation (they persist inside Composer)
- [ ] Backup tag cut before delete (`v2.x-pre-composer-flip`)

## Open decisions for Daniel

1. **Feature-flag storage** — user-preference in localStorage, or Whop entitlement flag? (Recommend Whop entitlement so paying users can opt in tier-by-tier — Agency first, then Solo/Pro)
2. **Tutorial-mode recording eligibility** — should Tutorial captures auto-submit to Whop campaigns, or hold for user review? (Recommend hold-for-review · Whop TOS on auto-submission is untested)
3. **Composer as $299 upgrade vs override navigation** — Daniel raised this earlier in the session. Recommend override (all paying tiers get it) so Tutorial-mode flywheel scales; upsell path becomes "more capabilities per tier" not "Composer or not"
4. **Voice input default on/off** — recommend OFF by default · users tap the mic to opt-in per session

## Files to touch (Phase 1 only)

**Create:**
- `src/design-os/routes/Composer.tsx` (~1200 lines · ports simulator flows to React)
- `src/design-os/engine/composer/` (new folder for capability graph · SYMBOLS · ask panel · confidence router)
- `src/design-os/engine/composer/capabilities.ts` (the graph, mirrored from simulator)
- `src/design-os/engine/composer/AskPanel.tsx` (React port of the ask panel)
- `src/design-os/engine/composer/ParamPanels/*.tsx` (one per flow · reuses CockpitContext)

**Extend (additive only):**
- `src/design-os/routing/SimulatorRouter.tsx` (+2 lines · new `composer` surface + `kade-composer` alias)
- `src/design-os/engine/cockpit/CockpitContext.tsx` (+`baseWindow` field to `CockpitSettings` type · additive · backward-compat load path)
- `src/design-os/bridge/events.ts` (only if new KadeState pose names needed · additive)

**Do NOT modify (Phase 1):**
- `Workstation.tsx` · the 6 module files · `ClipPreviewShell` · `ResultsGrid` · anything under `src/routes/**` · anything in `junior-backend/` · anything in `account-app/`

## Roll-back plan (Phase 1)

If Phase 1 goes sideways:
1. Flip the Kade Home feature-flag OFF (single localStorage / entitlement flag)
2. Users route back to Workstation (unchanged)
3. Delete `src/design-os/routes/Composer.tsx` + `src/design-os/engine/composer/` folder
4. Remove the 2 lines added to `SimulatorRouter.tsx`
5. Revert the `baseWindow` field in `CockpitContext.tsx` (backward-compat load path already handles missing field)
6. `git revert <phase-1-commit-range>` cleanly
7. No user data loss · no schema migration to undo · localStorage still works

Time to roll back: **< 5 minutes** from decision to fully reverted.

## Sign-off gate

Before any code lands:
- [ ] Daniel greenlights this scope doc
- [ ] Ship-lens skill dry-run confirms Design OS route qualifies
- [ ] Iron-gate audit confirms IG-LC2-016/017/018 transfer plan
- [ ] SYSTEM_UPDATE.md primed with Phase 1 header
- [ ] Composer.tsx skeleton stubbed (Watchdog + EngineErrorBoundary + CockpitProvider + placeholder body) as smallest-possible commit to validate the wiring

## Phase 3 gap-scope · 2026-07-18

### Q1 · Camera Rust crate
- **Winner: `nokhwa`** · Apache-2.0 OR MIT · 796 stars · v0.10.11 released 2026-05-15 · active maintenance · 25 releases · AVFoundation backend marked working for Input + Query + Query-Device on macOS · cross-platform (Intel + ARM64 both supported through the shared AVFoundation backend, no arch-conditional gating) · integrates cleanly alongside `screencapturekit-rs` because they own disjoint macOS frameworks (AVFoundation vs ScreenCaptureKit) with no runtime conflict · 5-mode picker wires as an enum dispatch (modes 1-4 → screencapturekit-rs, mode 5 → nokhwa) · known gap: 57 open issues but none blocker-tier on AVFoundation. Sources: [github.com/l1npengtul/nokhwa](https://github.com/l1npengtul/nokhwa), [lib.rs/crates/nokhwa-bindings-macos](https://lib.rs/crates/nokhwa-bindings-macos).
- **Loser: raw `objc2` + AVFoundation binding** · MIT · would need hand-rolled `AVCaptureSession` + `AVCaptureVideoDataOutput` delegate + CMSampleBuffer → BGRA conversion + device enumeration · `objc2` is production-grade ([madsmtm/objc2](https://github.com/madsmtm/objc2)) but no AVFoundation crate ships in the `objc2-*` family (only `objc2-screen-capture-kit`, `objc2-image-capture-core`, `objc2-vision`). Rebuilding what `nokhwa` already ships is 3-5 days of Objective-C bridge work + delegate lifetime bugs for zero product upside. Reject.
- **Wire-up estimate: 6-8 hours** · add `nokhwa = { version = "0.10", features = ["input-native"] }` to sidecar Cargo.toml · one `record_camera_only(device_id, output_path)` command · mode-picker dispatch in the recorder facade · Intel + ARM64 CI smoke.

### Q2 · Remotion composition tree

Composition tree sketch (cite [Composition](https://www.remotion.dev/docs/composition), [Sequence](https://www.remotion.dev/docs/sequence), [AbsoluteFill](https://www.remotion.dev/docs/absolute-fill), [Series](https://www.remotion.dev/docs/series), [Video](https://www.remotion.dev/docs/media/video), [Audio](https://www.remotion.dev/docs/media/audio), [Layers](https://www.remotion.dev/docs/layers)):

```tsx
<Composition id="kade-clip" fps={30} width={1080} height={1920}
  durationInFrames={settings.durationFrames} component={KadeClip} />

// KadeClip
<AbsoluteFill>
  {/* Layer 1 · source video (bottom) */}
  <AbsoluteFill><Video src={sourceUrl} startFrom={trim.inFrame} /></AbsoluteFill>

  {/* Layer 2 · reaction PIP · layout drives AbsoluteFill style */}
  {reaction && (
    <AbsoluteFill style={reactionLayoutStyle(reaction.layout)}>
      <Video src={reaction.videoUrl} muted={reaction.duck} />
    </AbsoluteFill>
  )}

  {/* Layer 3 · hook title (frames 0-45) */}
  <Sequence from={0} durationInFrames={45}><HookTitle text={hook.text} /></Sequence>

  {/* Layer 4 · caption stream · word-emphasis */}
  {captions.map(c => (
    <Sequence key={c.id} from={c.fromFrame} durationInFrames={c.durationFrames}>
      <CaptionWord text={c.text} emphasis={c.emphasis} />
    </Sequence>
  ))}

  {/* Layer 5 · music + duck (audio-only, no visual layer) */}
  <Audio src={music.url} volume={f => duckVolume(f, music.duckPoints)} />
</AbsoluteFill>
```

`reactionLayoutStyle(layout)` returns pure CSS position/size objects — `solo` → `{display:'none'}` on source · `side-by-side` → `{left:'50%',width:'50%'}` · `top-bottom` → `{top:'50%',height:'50%'}` · `pip-tl/tr/bl/br` → `{position:'absolute', top|bottom:24, left|right:24, width:'30%', height:'30%'}` · `full-overlay` → default `AbsoluteFill` with opacity. `AbsoluteFill` layer stack order is DOM order (later = on top) per [Layers docs](https://www.remotion.dev/docs/layers).

### Q3 · Preview↔export parity
- **Verdict: parity is *visual*, not byte-for-byte.** Remotion Player + `renderMedia()` share the same React tree and `useCurrentFrame()` model, so what you see is what you get *visually* — but the render pipeline is a fresh headless Chrome (no cache, seek-driven, frame-at-a-time), the Player is your live browser (cached fonts, real-time playback that can drop frames). Sources: [Player](https://www.remotion.dev/player/), [renderMedia](https://www.remotion.dev/docs/renderer/render-media), [Font-loading errors](https://www.remotion.dev/docs/troubleshooting/font-loading-errors).
- **Sources of drift:**
  1. Fonts loaded via `useEffect` (not `delayRender`) — cached in browser, missing in headless Chrome ([issue #5843](https://github.com/remotion-dev/remotion/issues/5843)).
  2. System fonts referenced by name — present on the dev Mac, absent in Linux/Docker render.
  3. Async data (LLM captions, remote URLs) not wrapped in `delayRender()` — Player waits, render captures a blank frame.
  4. Real-time playback dropped frames vs. seek-driven exhaustive frames — a visual "jank" in preview is not present in export.
  5. Codec differences — Player uses browser MSE/webcodecs, `renderMedia` uses h264 via ffmpeg — expected 1-2 bit deltas per frame, no perceptual drift.
- **Mitigations:** wrap every font load + async fetch in `useDelayRender()` ([docs](https://www.remotion.dev/docs/use-delay-render)) · self-host fonts under `public/fonts/` and reference via `@font-face` · avoid system font names · run a nightly "preview-vs-render" pixel-diff smoke on 3 canonical clips as a CI gate.

### Q4 · Tier gating recommendation

Read `useTierCaps.ts` — server-authoritative capability strings live in `src/lib/authz/capabilities.ts` under `CAP.*`, checked via `hasCapability(capabilities, CAP.X)`. Composer capabilities follow the `composer.*` namespace to mirror the `agency.*` + `hq.*` pattern.

| Flow | Tier gate | Capability string | Visible to free? |
|---|---|---|---|
| (whole route) | all paid + free preview | `composer.enabled` | yes |
| flowTutorial (paid-demo flywheel) | `clipper`+ | `composer.flow.tutorial` | yes |
| flowTrim | `clipper`+ | `composer.flow.trim` | yes |
| flowCaptions | `clipper`+ | `composer.flow.captions` | yes |
| flowFrame (style) | `clipper`+ | `composer.flow.frame` | yes |
| flowLibrary | `clipper`+ | `composer.flow.library` | yes |
| flowReactionsDeep | `pro`+ | `composer.flow.reaction` | walled-off preview + UPGRADE_CTA |
| flowRecord (screen/window/screen+mic) | `pro`+ | `composer.flow.record` | walled-off preview + UPGRADE_CTA |
| flowRecord (camera-only) | `pro`+ | `composer.flow.record.camera` | walled-off preview + UPGRADE_CTA |
| flowThumbnail | `growth`+ | `composer.flow.thumbnail` | walled-off preview + UPGRADE_CTA |
| flowWatermark (remove) | `pro`+ (watermarkLocked=false) | `composer.flow.watermark.remove` | walled-off (leverages existing `watermarkLocked` cap) |
| flowBatch (bulk) | `agency` | `composer.flow.batch` | UPGRADE_CTA only |
| flowAutoPublish | `agency` | `composer.flow.autopublish` | UPGRADE_CTA only |
| flowSchedule (multi-account) | ties to existing `accountsPerClip` cap | reuse `agency.campaign.publish` | walled-off preview |

Add these 13 strings to BOTH `desktop-2/src/lib/authz/capabilities.ts` (`CAP.COMPOSER_*`) AND `junior-backend/app/authz/capabilities.py` per the closed-registry discipline noted in capabilities.ts lines 12-15.

### Follow-ups (not blocking Phase 1)
- Confirm `nokhwa` links cleanly against Tauri 2's macOS entitlements (camera + microphone Info.plist keys).
- Verify Remotion `<Player>` bundle size fits desktop-2 perf budget (current `contain: layout paint style` rule).
- Backend PR to add `composer.*` capabilities to `/me.capabilities` before Phase 3 client wire.
- Pixel-diff CI harness for preview↔render parity (3 canonical clips).
- Decide whether `flowTutorial` should be `unauthenticated` visible (paid-demo flywheel bait) — requires router-level gate above `composer.enabled`.
