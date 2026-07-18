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
