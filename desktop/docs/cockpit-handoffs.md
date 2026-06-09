# Cockpit Handoff Contract (v7+)

The cockpit is the panel that edits the focused clip. It does not own every
clipper feature. This document defines the boundary: what the cockpit
**OWNS**, what it **DELEGATES**, what it **WATCHES** (status only), and what
it **AVOIDS** entirely.

Becomes IG-006 (Cockpit handoff contracts) on ship.

## The four-bucket model

For every action the user can take in the cockpit:

- **OWN** — cockpit writes directly (no other surface opens). Single writer.
- **DELEGATE** — cockpit triggers another surface that owns the write. Cockpit dims its conflicting controls until the surface closes.
- **WATCH** — cockpit reads + displays state another surface wrote. Read-only at this boundary.
- **AVOID** — cockpit never touches; user goes to that surface directly from the nav rail.

## Per-action ledger

### OWN (cockpit is the single writer)

| Action | RPC | Notes |
|---|---|---|
| Pick reaction layout | `apply_overlay` | `ReactionControls` is the canonical writer. `modalOpen` suppresses any second mount. |
| Pick audio source | `apply_overlay` (auto-save) | debounced 400ms + unmount flush (user-journey-lens fix) |
| Set offset slider | `apply_overlay` (auto-save) | same as audio |
| Schedule whenKey (Now/+1h/+24h) | LOCAL state until Master CTA fires | popover initialWhen syncs from this |
| Master CTA (Publish now / Schedule) | `scheduleClips` / `publishClipsNow` | from `masterClipActions` |
| Focus prev/next | LOCAL state in ResultsGrid | sets `focusedIdx` |
| Routes alt button | LOCAL → opens ChannelPicker | see DELEGATE below |
| Caption pin draft text | `update_clip_meta { pinned_comment }` (onBlur fan-out) | per-effective-idx |

### DELEGATE (cockpit triggers another surface, that surface owns the write)

| Action | Surface opened | Cockpit state during handoff | Return path | Conflict rule |
|---|---|---|---|---|
| Caption **Edit** button | `CaptionDrawer` (per-line styling, burn, palette) | cockpit Caption row dims; Reaction tiles stay live | drawer's `onClose` re-syncs via `onProjectChange` | drawer is per-clip; cockpit never writes `caption_style` |
| Source **Change** pill | `pickOverlaySource` dialog | cockpit Reaction tiles + adv panel dim until pick resolves | `applyOverlay` fires with new path; cockpit re-syncs from new `clip.overlay` | dialog is modal, no concurrent writes possible |
| Schedule pill (Custom) | `SchedulePopoverInline` | popover inherits `whenKey` via `initialWhen`; effect resyncs on change | onApply fires `scheduleClips`; cockpit closes popover | useEffect sync on `[initialWhen]` keeps them aligned |
| **Routes** alt button | `ChannelPicker` modal | cockpit's Routes count dims | onClose updates project.clips[*].platforms | ChannelPicker is per-selection; cockpit shows count |
| ⋮ **Brief** | `BriefModal` | cockpit unchanged (brief is project-scoped) | onSave writes `project.brief` via `update_clip_meta`-style call | modal is modal; no concurrency |
| ⋮ **Open full editor** | `ClipPreview` modal (Reaction Studio inside) | cockpit's Reaction module → tombstone via `modalOpen` prop | modal close clears `previewIdx`; cockpit re-mounts Reaction | `modalOpen` prop is the load-bearing fix from v0.7.27 |
| ⋮ **Captions** | `CaptionDrawer` (drill straight in) | same as Caption Edit | same as Caption Edit | same |
| ⋮ **Edit thumbnail** | `Thumbnails` flow (cover-frame picker) — *to build* | cockpit unchanged | RPC `set_clip_cover_frame` (new) writes `clip.thumbnails[0]` | thumbnail picker is per-clip; no cockpit overlap |
| ⋮ **Refresh transcript** | `Script` flow re-run | cockpit Caption row dims | `lift_transcript` re-fires; new caption lines land via `clip.caption_lines` | transcript regen happens via long-running RPC; cockpit shows pending strip |
| ⋮ **Add more clips** | routes to Workstation Home (Create/Import/Thumbnails/Script tiles) | full route change | back-navigation returns to cockpit with same focused clip | home is a different view; no concurrent state |
| ⋮ **Settings → Connections** | Settings tab (`Settings.tsx`) | full route change | back-navigation, channels list refreshes | independent surface |
| ⋮ **View profile** | Profile / vanity stats view — *to build* | full route change | back-navigation | streak/V-pill/counters live here |
| ⋮ **Refresh** | `get_project` re-fetch | brief loading spinner in ⋮ menu | re-renders cockpit from fresh project | idempotent; no conflict |

### WATCH (cockpit shows status but doesn't write)

| State | Source | How cockpit displays |
|---|---|---|
| Bake in flight | `clip.overlay.bake_status` (new field on `Clip`) | teal pending strip + sweep animation + Cancel button |
| Bake failed | `clip.overlay.bake_error` (new field) | red error strip + Retry |
| Caption bake in flight | `clip.captions_burning` (new field) | could surface in Caption row label (TBD) |
| Channel health | `listChannels` polled on mount | `ⓘ` icon hue (cyan=ok, amber=warn, red=down) + tooltip |
| Sidecar/render/ayrshare connectivity | `useSidecarHealth` hook | same `ⓘ` icon |
| Clip count / focus pos | `project.clips.length` + `focusedIdx` | focusnav `01 / 03` |
| RDY/QUE/PUB counters | `project.clips.filter(...)` + local schedule queue | hidden in ⋮ menu (cut from v6) |
| Whop bounty fit | `clip.virality` + `project.whop_bounty_id` | card-level badge only; cockpit doesn't surface |

### AVOID (cockpit never touches)

| Surface | Why not |
|---|---|
| Earn tab (`MinecraftChallengeCard`, `AvatarPicker`, bounty submissions) | Earn is a separate view; cockpit only WATCHES bounty fit via the card-badge |
| Browse Rewards side panel (`browse.rs` webview) | Independent always-on side panel; nav-rail toggle |
| Auth flows (`AuthPanel`) | Pre-cockpit; cockpit only renders when authenticated |
| Splash + Intro (`Splash.tsx`, IG-003) | Pre-cockpit; iron-gated |
| First-run onboarding (`OnboardingOverlay`) | Pre-cockpit; gated on empty-project view |
| Settings tab itself | ⋮ routes to it; cockpit never embeds it |
| Workstation home tiles (Create/Import/Thumbnails/Script) | ⋮ routes to them; cockpit shows clips that already exist |
| Sidecar crash overlay (`SidecarCrashOverlay`) | Top-of-app overlay; cockpit may be hidden behind it |

## Handoff protocols (the four invariants)

For every DELEGATE row above, the protocol must satisfy:

1. **Trigger is explicit.** Click, ⋮ menu item, keyboard chord. Never automatic mid-task.
2. **Cockpit dims conflicting controls during the handoff.** The user can see which controls are "blocked while the modal is open" — never silently competing writes. The `modalOpen` prop is the canonical signal.
3. **Return path is a project mutation.** Surfaces close by calling `onProjectChange(nextProject)`. Cockpit reads the new state on next render. No event-bus, no shared mutable state.
4. **Conflict rule names the writer.** For every clip field, exactly one surface writes it at a time. The handoff protocol enforces "modal wins while open" for fields the modal edits; cockpit resumes ownership on close.

## ⋮ menu (the handoff hub)

The cockpit's status strip has one ⋮ menu. It groups handoffs into four sections:

```
┌── ⋮ MENU ─────────────────────────┐
│ Per-clip                          │
│   ▸ Open full editor       Enter  │
│   ▸ Captions               C      │
│   ▸ Edit thumbnail         T      │
│   ▸ Refresh transcript            │
│   ▸ Duplicate clip                │
│   ▸ Remove clip            ⌫      │
├───────────────────────────────────┤
│ Project                           │
│   ▸ Brief                  B      │
│   ▸ Add more clips        ⌘N      │
│   ▸ Refresh from sidecar    R     │
├───────────────────────────────────┤
│ Vanity (was status strip)         │
│   ▸ RDY 3 · QUE 0 · PUB —         │
│   ▸ V70 score                     │
│   ▸ Streak: 3 today               │
│   ▸ View profile                  │
├───────────────────────────────────┤
│ Navigation                        │
│   ▸ Settings → Connections        │
│   ▸ Earn                          │
│   ▸ Sign out                      │
└───────────────────────────────────┘
```

The keyboard chords (`Enter`, `C`, `T`, `B`, etc.) are wired on `App.tsx`'s
global keydown handler. The ⋮ menu surfaces them for discoverability.

## Bake state contract (the import-pending parity ask)

Per Daniel's "loading state needs to inform customer like import does":

The `Clip` type gains two optional fields:

```ts
type Clip = {
  // ... existing fields ...
  overlay?: {
    type: OverlayType;
    source_path: string;
    start_offset_s: number;
    audio_source: AudioSource;
    // NEW:
    bake_status?: "idle" | "pending" | "error";
    bake_started_at?: string;  // ISO
    bake_error?: string;
  };
};
```

Lifecycle:

1. User clicks reaction layout tile → `applyOverlay` called.
2. Sidecar sets `bake_status = "pending"`, `bake_started_at = now`, returns the partial project (overlay armed but not yet applied).
3. Cockpit renders the teal pending strip with `Date.now() - bake_started_at` as elapsed.
4. Bake completes → sidecar sets `bake_status = "idle"`, fills `applied_paths`, returns final project. Cockpit hides pending strip, re-enables controls.
5. Bake fails → sidecar sets `bake_status = "error"`, `bake_error = humanError(e)`. Cockpit shows red error strip with Retry button that re-fires `applyOverlay` against the same params.

Card-level mirror: same `clip.overlay.bake_status` drives the card-level pending/error strip.

Cancel button writes a cancel marker (similar pattern to `.lift_cancel`):
`~/LiquidClips/<slug>/.bake_cancel.<clipIdx>` — sidecar polls this and aborts ffmpeg.

## What this scope does NOT cover

- Image-gen / thumbnail asset pipeline (covered by Catjack-asset memory + future Thumbnails feature scope)
- Earn submission flow (independent; cockpit only watches `clip.virality` badge)
- Auth deep-link flow (IG-004)
- Intro/Splash (IG-003)

## Iron-gate plan

Once v0.7.29 ships with v7 + this handoff contract:

- Add `IG-006 — Cockpit handoff contracts` to `docs/IRON_GATES.md`
- Add sentinel comments at:
  - `src/components/cockpit/BottomCockpit.tsx` (handoff trigger points: ⋮ menu items, Routes alt, Caption Edit, Source Change)
  - `src/components/clips-feed/ReactionControls.tsx` (the OWN/DELEGATE boundary)
  - `src/lib/sidecar.ts` (the bake_status field on `Clip` type)
- Cross-reference from IG-005 (Workspace UI design) so the gate pair is read together.
