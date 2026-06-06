# Claude Handoff — Workspace Cold Onboarding Upgrade

Date: 2026-06-04

## Goal

Make Workspace friendly for a brand-new clipper without reducing power for experienced users.

The product decision is now locked:

**Workspace has two starting lanes, but both lanes land in the same clip workspace.**

1. **Make clips** — user starts with a long source video or social link.
2. **Import finished clips** — user already has MP4/MOV/WEBM clips and wants to stack, split, remix, caption, schedule, and publish them.

Both paths must end at `ResultsGrid` / `Project.clips[]`, not two separate experiences.

## Why This Matters

The app already has strong clip-card tooling: stack/split layouts, overlay picker, remix/enhance, metadata, inline scheduling, and publishing. But today, finished-clip upload lives in `UploadTab` / `DirectPublishQueue`, which behaves like a publishing queue and bypasses the full clip workspace.

That is not the ideal onboarding path. A user who brings finished clips should still get the same Liquid Clips workspace where stack/split/remix exists.

## Current Code Shape

### Existing generated-clips path

```text
UnifiedDropZone
  -> App.tsx pickFile / onPasteUrl
  -> sidecar start_run / ingest_url
  -> runRemainingStages
  -> view.kind = "results"
  -> ResultsGrid
  -> ClipCard / ClipPreview
```

This path is good. It lands in `Project.clips[]` and gets stack/split/remix/schedule.

### Existing finished-clips path

```text
UploadTab
  -> DirectPublishQueue
  -> ClipReadyCard
  -> PublishModal
```

This path is useful for operations, but it is not the right cold onboarding lane because it does not create a normal `Project` and does not render `ResultsGrid`.

### Stack/split/remix live here

- `desktop/src/components/ResultsGrid.tsx`
- `desktop/src/components/clips-feed/ClipCard.tsx`
- `desktop/src/components/ClipPreview.tsx`
- `desktop/src/components/OverlaySourcePicker.tsx`
- `desktop/python-sidecar/stages.py` `apply_overlay_to_clip`
- `desktop/python-sidecar/sidecar.py` `method_apply_overlay`

Therefore imported clips must become normal `Clip` records inside a normal `Project`.

## UX Direction

Use an Opus-style first action surface, not chat-first onboarding.

Use LLM-style guidance only as light contextual help:

- tiny “Watch 30 sec” links
- one-line helper text
- next-step nudges after actions

Do not create a tutorial-only tab or wizard state machine. Workspace should onboard by doing.

## Proposed Workspace UI

Top of Workspace:

```text
start here
Choose your clip flow.
Make new clips or bring finished ones into the same workspace.

[ Make clips ]           [ Import finished clips ]
[Wand/Scissors icon]     [Upload/Layers/FileVideo icon]
Long video or link       Ready clips to stack, split, remix, schedule
YouTube TikTok IG X File MP4 MOV WEBM Multi-account
```

### Visual treatment

Use existing brand language:

- fuchsia active border/glow
- paper/elevated card background
- mono uppercase eyebrow
- display heading
- lucide icons
- capability pills, not paragraphs
- no big embedded tutorial video blocks

Active lane:

- fuchsia border
- soft fuchsia background
- subtle glow
- icon in fuchsia circle

Inactive lane:

- line border
- paper background
- muted text

### Lane-specific input area

When **Make clips** is active:

```text
[Paste URL input................................] [Get clips ->]
pills: YouTube · TikTok · Instagram · X · Local file
```

When **Import finished clips** is active:

```text
[Drop finished clips / browse files]
pills: MP4 · MOV · WEBM · Stack · Split · Remix · Schedule
```

### Shared step strip

Under the active input:

```text
[1 Add] -> [2 Review] -> [3 Schedule]
```

Icons:

- `PlusCircle` or `UploadCloud` for Add
- `Film` for Review
- `CalendarClock` for Schedule

### Help videos

Use small buttons only:

```text
[PlayCircle] Watch 30 sec
```

Suggested help video slots:

- Make clips from a long video
- Import finished clips
- Stack/split/remix
- Connect social accounts
- Schedule across accounts

Actual videos can live in Learn later. Workspace should link to or open them, not host a heavy library on first load.

## Required Functional Upgrade

Add a sidecar import path for finished clips:

```text
import_ready_clips(paths[])
  -> create Project
  -> copy or reference uploaded clips
  -> create one Clip record per file
  -> set vertical_path to the imported file or normalized local copy
  -> fill title from filename
  -> ffprobe duration
  -> set start=0, end=duration
  -> neutral virality/default theme
  -> return { project }
```

Then in `App.tsx`:

```text
onImportReadyClips(paths)
  -> sidecar.importReadyClips(paths)
  -> setView({ kind: "results", project })
```

This is the core. Without this, the UI would be pretty but the finished-clips lane would still not land in the same workspace.

## Suggested Sidecar Project Shape

For each imported file:

```json
{
  "start": 0,
  "end": 42.5,
  "title": "Filename without extension",
  "description": "",
  "theme": "imported",
  "virality": 70,
  "slug": "filename-slug",
  "title_variants": ["Filename without extension"],
  "cut_path": "/path/to/imported/file.mp4",
  "vertical_path": "/path/to/imported/file.mp4",
  "overlay": null,
  "remix": null
}
```

If ffprobe detects non-vertical videos, do not block v1. Let the card preview it and allow stack/split/remix where possible. Later we can add normalization/reframe.

## Files To Touch

Likely files:

- `desktop/src/components/UnifiedDropZone.tsx`
  - Convert from one generic input into two-lane launcher + active input.
  - Keep the existing make-clips URL/file behavior.
  - Add import-finished-clips picker.

- `desktop/src/App.tsx`
  - Add `onImportReadyClips`.
  - Pass handler into `UnifiedDropZone`.
  - Route returned project to `ResultsGrid`.

- `desktop/src/lib/sidecar.ts`
  - Add `importReadyClips(paths: string[])`.
  - Add response typing.

- `desktop/python-sidecar/sidecar.py`
  - Add `method_import_ready_clips`.
  - Add method to `METHODS`.

- `desktop/python-sidecar/project.py`
  - Reuse `Project.create` if suitable, or add helper for imported-clip projects.
  - Keep project under normal `~/LiquidClips/projects`.

- `desktop/python-sidecar/stages.py` or a small helper module
  - ffprobe duration helper may already exist; reuse if possible.

Optional:

- `desktop/src/components/workspace/WorkspaceDashboard.tsx`
  - Demote/remove `RankStrip`, `AffiliateStrip`, `LeaderboardPreview` from cold Workspace.
  - Keep `ActiveClipsList`, `ScheduledClipsBlock`, and optionally `LiveCampaignsRow` lower down.

## What Not To Do

- Do not route finished clips only into `DirectPublishQueue`.
- Do not create a new wizard state machine.
- Do not make chat the primary onboarding interface.
- Do not bury finished-clip import in Upload tab only.
- Do not promise multi-account scheduling from legacy `/schedules`; use Schedule v2 channels and Ayrshare-native scheduled posts.

## Scheduler Context

The scheduler is not Postiz now. The preferred live path is:

```text
PublishModal / InlineScheduler
  -> backend.publishNow
  -> POST /publish-now
  -> channel_id + scheduled_at
  -> Ayrshare queues native scheduled post
  -> backend stores Schedule row
```

Channel system:

- One channel = one social handle.
- Users can add multiple channels from Schedule -> Channels.
- `AddChannelModal` handles OAuth through Ayrshare profile linking.

Important: legacy direct `/schedules` rows are not the public path to promote.

## Customer Journey After Upgrade

### New user with long video

```text
Open Workspace
-> choose Make clips
-> paste link or choose long file
-> pipeline runs
-> ResultsGrid opens
-> user stack/split/remix/edit
-> schedule/publish
-> if no channel, add channel
```

### New user with finished clips

```text
Open Workspace
-> choose Import finished clips
-> pick multiple MP4/MOV/WEBM
-> imported Project opens in ResultsGrid
-> user stack/split/remix/edit
-> schedule/publish
-> if no channel, add channel
```

### Existing operator managing accounts

```text
Open Schedule
-> Channels
-> Add another channel
-> return to Workspace/ResultsGrid
-> schedule clips per channel
```

## Acceptance Criteria

- Workspace first screen clearly shows two lanes.
- Make-clips lane still works exactly as before.
- Import-finished-clips lane opens OS file picker and supports multi-select.
- Imported clips appear as normal cards in `ResultsGrid`.
- Imported clip cards show stack/split layout controls.
- Imported clip cards can open `ClipPreview`.
- Imported clip cards can schedule/publish through the same inline/card publish flow.
- User can add another account/channel after scheduling one.
- `npm run build` in `desktop` passes.
- `npx tsc -b --pretty false` in `desktop` passes.
- `python3 -m py_compile desktop/python-sidecar/*.py` passes.

## Suggested Version Name

`v0.6.7 — two-lane workspace onboarding`

