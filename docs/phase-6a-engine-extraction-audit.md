# Phase 6A · Liquid Clips Engine Extraction Audit

**Status:** Audit report. No code modified.
**Date:** 2026-06-18
**Scope:** Inventory both sides — (A) the existing clipping engine at `/Users/dipdip/code/jnr/desktop/` and (B) the new Design OS shell at `/Users/dipdip/code/jnr/desktop-2/` — and map every reusable brick to its plug point. Pairs with [[liquid-clips-engine-boundaries]] (architectural rule) and [[liquid-clips-route-factory-skill]] (assembly discipline).
**Scope-out:** No backend / auth / payment / release changes. No Design OS shell changes. No asset generation.

---

## 0 · Executive summary

The legacy clipping engine is **mature, mostly working, and operationally rich.** Seven pipeline stages run inside a Python sidecar (`ingest → audio → transcribe → llm → cut → reframe → thumbs`), each cancellable, each progress-streamed. 60+ TypeScript RPC wrappers route through a single `invoke('sidecar_call', …)` bridge. Five Iron Gates (IG-001, IG-002, IG-006, IG-010, IG-014) lock the contracts that survived multiple regression rounds.

The new Design OS shell is **structurally ready** to host the engine. 15 routes are mounted, each with a typed config (world / Kade / placement / hero / state grid / micro strip / optional `centerPanel` and `keyPanel`). The `DesignOSAppShell` exposes clean slots for HUD pills, sticky Kade, world layer, console nav and cursor glow. The `DesignOSBoundary` quarantines legacy chrome. The bridge bus (`bus.emit / useEvent`) is decoupled from Tauri events — adapters need writing.

**Migration shape:** the engine moves brick by brick — not as a refactor. Each brick is picked up by its export interface (RPC + types), re-mounted inside the matching Design OS route's `centerPanel`, hooked into the sticky Kade and Mission Status panels, and re-validated. The Iron Gates travel with the contracts (RPC name, event channel, file path); the UI shell is replaced around them.

**12 bricks are REUSE** (drop straight in, no wrap).
**14 bricks are PORT** (small wrapper, same RPC).
**7 bricks are REBUILD** (UI was tied to a legacy store / canvas / drawer that has no equivalent yet — clean rebuild against the Design OS slots).
**4 bricks are DEFER** (out of Phase 6 scope: workbench canvas, ProjectDetail full-page, thumbnail batch UI, direct-publish queue).

---

## 1 · Engine inventory

### 1.1 UI surfaces · grouped by pipeline stage

> Every component path is absolute. "Mounted" = currently rendered in v0.7.63 production.

#### SOURCE — import / paste / upload

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `UploadPortal` | `desktop/src/components/cockpit/UploadPortal.tsx` | Modal portal for URL paste + file drag-drop; host allowlist (YouTube/TikTok/IG/X/FB/Vimeo/Reddit); intent gate (clips / script) | `open`, `dragHoverActive` props | `onPasteUrl`, `onPickFile` callbacks → App.tsx handlers | ✅ |
| `StudioHome` | `desktop/src/components/workspace/StudioHome.tsx` | 4-tile intent router (Create / Import / Thumbnails / Script); spawns UploadPortal | `onCreate`, `onImport` | — | ✅ |
| `WorkstationRoom` (drop zone) | `desktop/src/components/cockpit/WorkstationRoom.tsx` | Cyan dashed drop affordance overlay; invader sprite landmark | `dragHoverActive` | Tauri `tauri://drag-enter / drag-leave` listeners | ✅ |
| Drop-error toast | inline AnimatePresence inside `WorkstationRoom.tsx` | Ephemeral unsupported-file-type error | `dropError` | — | ✅ |
| `IntentPicker` | `desktop/src/components/IntentPicker.tsx` | Disambiguates clip vs script intent post-drop | `source`, `brief` | Routes to `onChoosingIntent` view | ✅ |

#### INGEST — download + preflight

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `WorkingStage` | `desktop/src/components/WorkingStage.tsx` | Multi-stage ETA + elapsed; per-stage progress (ingest/audio/transcribe/llm/cut/reframe/thumbs); Apple Silicon vs Intel ETA model | `project.stages.*` | events: `sidecar:stage_progress`, `sidecar:ingest_progress` | ✅ |
| Download view | View shape inside `App.tsx` | `{ kind: "downloading"; url; progress?; intent }` | App state | `sidecar.ingestUrl`, `sidecar.importReadyClips` | ✅ |
| Ingest-failed view | `App.tsx` | `{ kind: "ingest-failed"; url; error; intent }` | App state | Retry → re-run same intent | ✅ |
| Deps-missing view | `App.tsx` | `{ kind: "deps-missing"; missing[]; errors; python }` | Preflight (`check_deps`) | `sidecar.checkDeps()` | ✅ |

#### ENGINE — candidate review

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `ResultsGrid` | `desktop/src/components/ResultsGrid.tsx` | Post-LLM clip grid; tabs (Clips / YouTube / Files); multi-select; "best bits" filter (virality ≥ 70) | `project.clips[]`, `tab`, `bestBitsOnly`, `previewSoundOn` | `getCaptions`, `setClipPlatforms`, `removeClip`, `generateMoreClips` | ✅ |
| `ClipCard` | `desktop/src/components/clips-feed/ClipCard.tsx` | Per-clip tile (9:16 preview, virality score 0-100, breakdown chips, platform badges, hover preview) | `clip`, `selected`, `focused` | Context menu (Edit / Remove / Copy) | ✅ |
| Score breakdown | inline header in `ClipPreview.tsx` | "Why this clip" reason + hook/retention/clarity/shareability sub-scores | `clip.score_reason`, `clip.score_breakdown` | Read-only | ✅ |
| `YouTubeView` | `desktop/src/components/YouTubeView.tsx` | Transcript-first tab (script mode) | `project.clips` (imported=true) | Clip nav via `clip.start/end` | ✅ |
| Lifting view | `App.tsx` view | `{ kind: "lifting"; url; progress? }` | App state | `lift_progress` event | ✅ |
| `TranscriptResult` | `desktop/src/components/TranscriptResult.tsx` | Read-only transcript display + copy-to-clipboard | `LiftTranscriptResult` | `writeText` | ✅ |

#### STUDIO — trim / caption / layout

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `ClipPreview` (modal editor) | `desktop/src/components/ClipPreview.tsx` | Full-screen modal (1180px); video player + ratio chips + live caption overlay + reaction studio + trim + metadata + layout + platform badges | `clip`, `ratio`, `trimStart/End`, `titleDraft/descDraft/pinDraft`, `overlayLines` | `updateClipMeta`, `setClipPlatforms`, `startRegenerateClip`, `startApplyOverlayTemplate`, `getCaptions`, `editCaptions`, `localScheduleAdd` | ✅ |
| Video player + ratio chips | inline `<video>` inside `ClipPreview.tsx` | Controlled element; vertical/square/portrait swap; cache-busting via `videoCacheBuster` | `videoPath`, `ratio` | `convertFileSrc()` | ✅ |
| `CaptionOverlay` (live preview) | `desktop/src/components/captions/CaptionOverlay.tsx` | DOM overlay while drawer is dirty or clip has no baked captions | `overlayLines`, `livePreview`, `playheadTime`, `caption_style` | Read-only | ✅ |
| `CaptionDrawer` | `desktop/src/components/captions/CaptionDrawer.tsx` | Editable rows (start/end/text/auto-fix); 8 style palettes; color picker (hue/sat); marginV%; Apply re-bakes via `edit_captions` | `state: CaptionState` (useRef history; undo/redo), `loading`, `baking`, `error`, `autoFixToast` | `getCaptions`, `editCaptions`, `regenerateClipCaptions` | ✅ |
| Trim editor | `<details>` block inside `ClipPreview.tsx` | start/end inputs (seconds); validates 30-75s; Re-cut button + Reset | `trimOpen`, `trimStart/End`, `busy`, `videoDuration` | `startRegenerateClip` + `waitForRegenerate` | ✅ |
| Metadata editor | inline EditableField block | Title (200), Caption (1000), Pinned comment (500); Save/Discard with idle/saving/saved indicator | `titleDraft/descDraft/pinDraft`, `saveState` | `updateClipMeta` | ✅ |
| `ReactionControls` | `desktop/src/components/clips-feed/ReactionControls.tsx` | Reaction-clip + audio + offset picker; 8 reaction tiles; tier-gated paid layouts | `clip.overlay`, `reactionBakingAt` | `pickOverlaySource`, `startOverlayBake`, `setAudioSource`, `setAudioOffset` | ✅ |
| `OverlayTemplateGallery` | `desktop/src/components/OverlayTemplateGallery.tsx` | 8 pre-made split-screen / pop-in templates; Solo+ gate | `selectedId`, `onSelect`, `onClose` | `startApplyOverlayTemplate` | ✅ |
| `PlatformBadgePicker` | `desktop/src/components/PlatformBadge.tsx` | Multi-select platform (YT / TT / IG / X / LI / FB); shows connection status; routes to Channels when disconnected | `clip.platforms[]`, `connectionStatus` | `setClipPlatforms` | ✅ |
| Captions header pill | inline button in `ClipPreview.tsx` | Drawer open toggle; dirty/clean dot indicator; fetch-failure hint | `captionsOpen/Dirty/FetchFailed` | — | ✅ |

#### WORKBENCH — canvas + bulk

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `WindowManager` | `desktop/src/components/workbench/WindowManager.tsx` | Canvas of clip tiles; right-click context menu; Space/E to edit; ←/→ keyboard nav; per-tile selected/focused/playing | `useWorkbenchStore` (selection, playingId, window states) | E key opens drawer or modal | conditional |
| `ClipEditDrawer` | `desktop/src/components/workbench/ClipEditDrawer.tsx` | Side drawer portal mounting `ClipPreview` in drawer mode (transform fix) | `focusedWindow.captionsOpen`, `focusedWindow.clipIdx` | Mounts `ClipPreview` unchanged | conditional |
| `MasterToolbar` | `desktop/src/components/workbench/MasterToolbar.tsx` | Bulk: Remove (confirm), Re-cut (modal), Toggle captions; LC Score badge | `selection.selectedIds`, `visibleClips` | Batch `removeClip` + `startRegenerateClip` | conditional |

#### EXPORT — publish / schedule

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `BottomCockpit` | `desktop/src/components/cockpit/BottomCockpit.tsx` | Fixed 54px status row (collapsed) + expanded popover (Publish / Schedule / Caption Style); prev/next focus nav; ⋮ menu | `selectedIdxs[]`, `focusedIdx`, `popover`, `reactionBakingAt`, `whenKey`, `collapsed` (persisted) | `publishClipsNow`, `scheduleClips`, `setClipMeta`, event watchers | ✅ |
| Schedule popover | inline inside `BottomCockpit.tsx` | When picker: Now / +1h / Tomorrow 9am / custom datetime-local | `whenKey`, `customSchedule`, `scheduleOpen` | `localScheduleAdd` via `scheduleClips()` | ✅ |
| Publish popover | inline inside `BottomCockpit.tsx` | Platform connection status + Publish now button | `platformConnections`, `isBulkMode`, `effectiveIdxs` | `publishClipsNow` (sidecar + backend) | ✅ |
| `BakeErrorStrip` | conditional in `BottomCockpit.tsx` | Red bar with Retry when `bake_status === "error"` | `clip.overlay?.bake_status`, `cockpitTier` | `startOverlayBake` | conditional |
| Caption-style popover | inline 8-style gallery inside `BottomCockpit.tsx` | Pre-made caption style tiles + color picker | `CAPTION_STYLE_KEYS`, `captionDrafts[idx]` | `setClipMeta(..., { caption_style })` | conditional |
| `PublishModal` | `desktop/src/components/PublishModal.tsx` | Full-screen publish editor; platform tabs; per-platform connection; auto-filled post metadata | `mode`, `selectedClipIdxs`, `postMetadata` | `backend.publishClip` (HTTP) or platform RPCs | ✅ |
| `SchedulePage` | `desktop/src/components/schedule/SchedulePage.tsx` | Queue UI (queued → uploading → posted / error); Cancel per item; Channels section | `scheduleQueue[]` from sidecar SQL; `channels[]` from backend | `localScheduleCancel`, `localScheduleEdit`, `disconnectChannel` | ✅ |
| `ChannelPicker` | `desktop/src/components/schedule/ChannelPicker.tsx` | Multi-platform OAuth flow (YT iframe redirect, TT, IG, X, LI, FB); connected list | `channels[]`, `pendingAuth` | Backend OAuth redirects | ✅ |
| "Save copy as…" button | inline in `ClipPreview.tsx` | OS file picker + copy vertical_path to user dest | `revealPath`, `saveCopyBusy` | Tauri `dialog.save()` + `fs.copyFile()` | ✅ |
| "Reveal in Finder" button | inline in `ClipPreview.tsx` | Opens containing folder | `revealPath` | `openSmart()` wrapper around Tauri `shell.open` | ✅ |

#### LIBRARY — archive / projects

| Surface | File | Owns | Reads | IPC | Mounted |
|---|---|---|---|---|---|
| `LibraryTab` | `desktop/src/components/library/LibraryTab.tsx` | Archive of prior projects (card per project: clip count, last modified) | `projects[]` from `backend.listProjects` | Click → `App.tsx` routes to `ProjectDetail` | ✅ |
| `LibraryCard` | `desktop/src/components/cockpit/LibraryCard.tsx` | Project summary (thumb + title + meta) | `project` summary | Click → `{ kind: "project"; slug }` | ✅ |
| `AddClipCard` | `desktop/src/components/AddClipCard.tsx` | "Drop a new video" tile at start of `ResultsGrid` | `onDropAnother` | Routes to `UploadPortal` | ✅ |
| `ProjectsTab` | `desktop/src/components/projects/ProjectsTab.tsx` | Grid of all projects + filter (bounty / owned / shared) | `projects[]`, `filters` | `backend.listProjects` | ✅ |
| `ProjectDetail` | `desktop/src/components/projects/ProjectDetail.tsx` | Per-project view; clip strip; metadata editor; settings; Resume button | `project`, `slug` | Click Resume → `App.tsx` view swap | ✅ |
| `DirectPublishQueue` | `desktop/src/components/upload/DirectPublishQueue.tsx` | Legacy per-clip publish queue (superseded by SchedulePage) | `queue[]` from store | `directPublish*` legacy RPCs | legacy/conditional |
| `ClipReadyCard` | `desktop/src/components/upload/ClipReadyCard.tsx` | Card for finished single-clip render | `clip`, `project` | Routes to `ClipPreview` or `SchedulePage` | legacy/conditional |
| `GlobalToastHost` | `desktop/src/components/GlobalToastHost.tsx` | Listens on `window.lc:toast` CustomEvent; ephemeral success/error | `addEventListener('lc:toast', ...)` | Read-only listener | ✅ |

#### Pipeline state machine (App.tsx view kinds)
```
"empty" → "choosing-intent" → "downloading" → "running" → "results"
Alternate: "lifting" → "lifted" (script/learn mode — no clipping)
Errors: "ingest-failed" · "lift-failed" · "deps-missing"
```

### 1.2 State layer

#### Zustand stores

| Store | File | State | Actions | Persistence |
|---|---|---|---|---|
| `useWorkbenchStore` | `desktop/src/components/workbench/useWorkbenchStore.ts` | `windows` (Map), `selection` (selectedIds, focusedId), `lastProjectSlug`, `lastClipCount` | `addWindow`, `removeWindow`, `moveWindow`, `resizeWindow`, `bindChannels`, `setCaptionsOpen`, `setRatio`, `toggleSelected`, `selectAll`, `clearSelection`, `setFocused`, `reconcileProject` | Debounced 250ms localStorage write + pre-unload flush |
| `useAvatar` | `desktop/src/lib/avatar.ts` | `url`, `bustKey`, `loading`, `error` | `refresh`, `upload`, `clear` | Tauri file `~/LiquidClips/avatar.png` + mtime cache-busting |

#### Custom hooks · engine pipeline

| Hook | File | Returns | Event(s) consumed |
|---|---|---|---|
| `useGlobalBakeEvents` | `desktop/src/lib/useGlobalBakeEvents.ts` | `{ waitForBake(slug, idx, timeoutMs?) }` | `sidecar:bake_complete`, `sidecar:bake_error` (key: `slug:idx`) |
| `useIngestEvents` | `desktop/src/lib/useIngestEvents.ts` | `{ waitForIngest(url, timeoutMs?) }` | `sidecar:ingest_complete`, `sidecar:ingest_error` (URL key) |
| `useLiftEvents` | `desktop/src/lib/useLiftEvents.ts` | `{ waitForLift(url, timeoutMs?) }` | `sidecar:lift_complete`, `sidecar:lift_error` |
| `usePickEvents` | `desktop/src/lib/usePickEvents.ts` | `{ waitForPick(slug, timeoutMs?) }` | `sidecar:pick_complete`, `sidecar:pick_error` |
| `useRegenerateEvents` | `desktop/src/lib/useRegenerateEvents.ts` | `{ waitForRegenerate(slug, idx, timeoutMs?) }` | `sidecar:regenerate_complete`, `sidecar:regenerate_error` |
| `useReactionBakeProgress` | `desktop/src/lib/useReactionBakeProgress.ts` | progress tracking | overlay bake stage progress |
| `useActivityEvents` | `desktop/src/contracts/useActivityEvents.ts` | `{ events, unreadCount, markRead, markAllRead, clear }` | 5 DOM events: `junior:channel-linked`, `lc:publish-result`, `lc:payout`, `lc:bounty-match`, etc. |

All five wait-hooks are singletons (mount-attached listeners per **IG-010**) — removing the on-mount attach breaks v0.8.0 non-blocking pairs.

### 1.3 IPC bridge

**Single entry point:** `desktop/src/lib/sidecar.ts` exports a `sidecar` object with the methods below. Each method calls `sidecarCall<T>(method, params)` which invokes `invoke("sidecar_call", { method, params })` and parses `ENV:{json}` envelopes into structured errors (`SidecarError`, `SidecarTimeoutError`, `SidecarRestartedError`, `SidecarCrashedError`).

#### Lifecycle (5)
`ping`, `checkDeps`, `startRun`, `ingestUrl` (300s timeout), `importReadyClips` (60s timeout)

#### Project + Clip management (10)
`getProject`, `listProjects`, `createBlankProject`, `deleteProject`, `requestDeleteProject`, `undoDeleteProject`, `finalizeDeleteProject`, `addClip`, `removeClip`, `duplicateClip`, `updateClipMeta`

#### Pipeline stages (3)
`runStage(slug, stage)` · `regenerateClip(slug, idx, start, end)` (180s, cancel-on-timeout) · `pickMoreClips(slug)`

#### Captions + styling (2)
`getCaptions`, `editCaptions`

#### Transcript / lift (4)
`liftTranscript` (600s), `liftCancel`, `getYoutubeExtras`, `updateYoutubeExtras`

#### Overlay + baking (5)
`applyOverlay` (180s), `applyOverlayTemplate`, `startOverlayBake` (v0.8.0 non-blocking), `cancelOverlayBake`, `setClipPlatforms`

#### Avatar (3)
`saveAvatar`, `clearAvatar`, `avatarStatus`

#### Secrets + auth (5)
`licenseJwtRead`, `licenseJwtPresence`, `secretSet`, `secretDelete`, `secretRepairPresence`

#### Hardware + system (3)
`hardwareInfo`, `systemInfo`, `probe`

#### Tier + licensing (4)
`tierStatus`, `tierInvalidate`, `openaiKeyStatus`, `validateOpenaiKey`

#### Queues + scheduling (8)
`localScheduleList`, `localScheduleAdd`, `localScheduleMarkPosted`, `localScheduleCancel`, `directPublishQueueRead`, `directPublishQueueWrite`, `dripPlan`, (+ derived helpers)

#### Thumbnail Studio (13)
`thumbnailPreviewPrompt`, `thumbnailGetBrand`, `thumbnailSaveBrand`, `thumbnailGetIdentity`, `thumbnailSaveIdentity`, `thumbnailList`, `thumbnailUseAsCover`, `thumbnailGetCover`, `thumbnailGenerate` (180s), `thumbnailCancel`, `thumbnailLedger`, `thumbnailBatchStart`, `thumbnailBatchCancel`

#### Bounties + Whop (11)
`whopSessionStatus`, `whopOAuthStart`, `whopOAuthStatus`, `whopOAuthCancel`, `whopSetSessionToken`, `whopClearSessionToken`, `whopListBounties`, `whopListPublicBounties`, `whopBounty`, `whopSubmission`, `listBountyProjects`

#### Reactions + media (3)
`reactionSearch`, `reactionSearchProvider`, `reactionDownload`

#### v0.8.0 non-blocking pairs (IG-010) (10 method-pairs)
`startIngestUrl`/`cancelIngestUrl`, `startLiftTranscript`/`cancelLiftTranscript`, `startPickMoreClips`/`cancelPickMoreClips`, `startRegenerateClip`/`cancelRegenerateClip`, `startApplyOverlayTemplate`/`cancelApplyOverlayTemplate`

**Total:** ~85 distinct RPC methods. All errors channel through `humanError()` for UI-safe rendering.

### 1.4 Tauri event channels

| Channel family | Pattern | Used by |
|---|---|---|
| Progress | `sidecar:ingest_progress`, `:stage_progress`, `:bake_progress`, `:thumbnail_batch_progress`, `:regenerate_progress`, `:pick_progress`, `:lift_progress`, `:overlay_progress` | `WorkingStage`, `BakeErrorStrip`, `useReactionBakeProgress` |
| Completion | `sidecar:bake_complete`, `:ingest_complete`, `:lift_complete`, `:pick_complete`, `:regenerate_complete`, `:thumbnail_batch_complete` | The 5 wait-hooks (IG-010) |
| Error | `sidecar:bake_error`, `:ingest_error`, `:lift_error`, `:pick_error`, `:regenerate_error`, `:thumbnail_batch_error` | Same wait-hooks |
| Lifecycle | `sidecar:died` | Drains all pending RPC promises with `SidecarCrashedError` |

#### Custom DOM events (CustomEvent on window)
`junior:channel-linked`, `junior:channel-unlinked`, `lc:publish-result`, `lc:payout`, `lc:bounty-match`, `lc:toast`

### 1.5 Queues + persistent stores

| Queue | File | Methods | Item shape |
|---|---|---|---|
| Local schedule | `$CLIPS_HOME/.schedule.json` | `localScheduleList/Add/MarkPosted/Cancel/Remove` | `{ id, slug, idx, title, platform, scheduled_for, theme }` |
| Direct publish | `$CLIPS_HOME/.direct-publish-queue.json` | `directPublishQueueRead/Write` | `{ id, file_path, filename, size_bytes, duration_seconds, added_at }` |
| Submissions | `$APPDATA/submissions.json` | `listSubmissions`, `createSubmission`, `updateSubmission`, `deleteSubmission` (in `desktop/src/lib/submissions.ts`) | `{ id, brief_id, clip_path, platform, post_url, status, views, estimated_payout, actual_payout, notes, created_at, updated_at }` |
| Thumbnail ledger | `~/LiquidClips/thumbgen_ledger.jsonl` | `thumbnailLedger` | per-generation cost / model / timestamp |
| Drip plan (computed) | — | `dripPlan(slug, weeks, tzOffset)` | `{ slots[] }` (non-persistent) |

### 1.6 Tauri Rust commands

| Command | File:line | Delegates to |
|---|---|---|
| `sidecar_call(method, params)` | `desktop/src-tauri/src/lib.rs:9-16` | Python sidecar via newline-delimited JSON-RPC over stdio |
| `sidecar_log_read()` | `lib.rs:35` | `~/Library/Application Support/Liquid Clips/logs/sidecar-startup.log` |
| `sidecar_log_open()` | `lib.rs:50` | opens logs folder in Finder |
| `sidecar_repair()` | `lib.rs:66` | clears `sidecar-cache` + startup log |
| Browse commands | `desktop/src-tauri/src/browse.rs:58-140` | Earn-tab browse rewards (out of engine scope) |

#### Sidecar lifecycle (Rust)

- **File:** `desktop/src-tauri/src/sidecar.rs:104-516`
- **Prod path:** `Resources/_up_/python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar` (PyInstaller bundle)
- **Dev path:** `.venv/bin/python python-sidecar/sidecar.py`
- **Recovery:** F5 auto-restart, cap 3 attempts, backoff 1s/3s, then "exhausted"
- **Protocol:** newline-delimited JSON. Request `{id, method, params}` → response `{id, result}` or `{id, error, human, code, technical}`
- **Timeout:** 3600s per call

### 1.7 Python sidecar methods

| Method | File:line | Stage / purpose |
|---|---|---|
| `method_ping` | `python-sidecar/sidecar.py:110` | version + uptime |
| `method_check_deps` | `:120` | probes yt-dlp, faster-whisper, openai, cv2, pydantic, psutil, keyring |
| `method_health_check` | `:161` | preflight: ffmpeg/ffprobe executable, whisper readable, data dirs writeable |
| `method_start_run` | `:358` | begins ingest stage from local file |
| `method_run_stage` | `:460` | runs any stage in `STAGE_FUNCS` registry |
| `method_get_project` / `method_list_projects` | `:472`, `:481` | reads from `~/LiquidClips/<slug>/project.json` |
| `method_start_pick_more_clips` / `cancel` | `:1127`, `:1229` | LLM re-pick + re-cut/reframe/thumbs |
| `method_start_overlay_bake` / `cancel` | `:1244`, `:1367` | ffmpeg overlay composition |
| `method_start_regenerate_clip` / `cancel` | `:1414`, `:1508` | re-cut + re-reframe single clip |
| `method_start_apply_overlay_template` / `cancel` | `:2108`, `:2204` | template bake across clips |
| `method_start_ingest_url` / `cancel` | `:2772`, `:2831` | yt-dlp + ingest |
| `method_start_lift_transcript` / `cancel` | `:3301`, `:3358` | yt-dlp + faster-whisper |
| `method_ingest_url` (sync) | `:2619` | back-compat wrapper |
| `method_lift_transcript` (sync) | `:2841` | back-compat wrapper |
| `method_pick_more_clips` (sync) | `:1027` | back-compat wrapper |
| `method_regenerate_clip` (sync) | `:1389` | back-compat wrapper |
| `method_thumbnail_*` | `:4069-4605` | preview prompt · get/save brand · get/save identity · list · use as cover · get cover · generate · cancel · ledger · batch start/cancel |

### 1.8 Pipeline stages (Python)

**Registry** — `python-sidecar/stages.py:347` `STAGE_FUNCS = { ingest, audio, transcribe, llm, cut, reframe, thumbs }`

| Stage | File:line | Input | Output | External tools |
|---|---|---|---|---|
| `ingest` | `stages.py:283` | source_path | `source/` symlink + `poster.jpg` | ffprobe |
| `audio` | `:348` | source | `audio.wav` (16kHz mono) | ffmpeg |
| `transcribe` | `:368` | audio.wav | `transcript.json` + `.srt` + `.vtt` | faster-whisper (local) OR openai whisper-1 OR groq whisper-large-v3 |
| `llm` | `:1008` | transcript.json + source | `clips.json` (cut points + hooks + scores) | Claude API (BYO key for Free; proxy for Pro+) |
| `cut` | `:1109` | clips.json + source | `clip-0.mp4`, `clip-1.mp4`, … | ffmpeg segment |
| `reframe` | `:1207` | clip-N.mp4 + clip-N.srt | `reframe-9-16.mp4` (per format) | ffmpeg + `junior-face-detect` (Swift, ~250 KB) + ASS/SRT burn |
| `thumbs` | (project.py) | reframe-*.mp4 | `poster-*.jpg` | ffmpeg frame extract |

#### Bundled binaries (in `Resources/_up_/python-sidecar/bin/`)
- `ffmpeg` (~80 MB) — all transcoding
- `ffprobe` (~79 MB) — metadata
- `junior-face-detect` (250 KB Swift binary) — face-aware crop
- Whisper model: Apple Silicon → `mlx-whisper` lazy-downloads to `~/Library/Application Support/LiquidClips/models/mlx-whisper/`; other arch → bundled `python-sidecar/models/faster-whisper-tiny/`

### 1.9 Iron Gate sentinels

| Gate | File:line | Locks |
|---|---|---|
| **IG-001** | `sidecar.py:438` | Import pipeline shape (60s timeout · cover-frame call · `humanError` wrap) — paired with `handleImportDirect` in `desktop/src/App.tsx` |
| **IG-002** | `sidecar.py:4639` | RPC method registry contract + lazy-import discipline |
| **IG-006** | `sidecar.py:1961` | Overlay bake-state persistence (`bake_status`, `bake_error` fields on clip) |
| **IG-010** | `sidecar.py:4740-4758` | 10 non-blocking method pairs (start_*/cancel_*) — pre-commit refuses removal without `IRON_GATE_OVERRIDE` |
| **IG-014** | `secrets_store.py:52` | Keychain invariant (`app.liquidclips.auth.v1` namespace + central module) |

### 1.10 Background workers (Python)

`sidecar.py:30, 67-78` declares seven registry dicts → each maps operation key → `threading.Event`:

```
_ACTIVE_BAKES, _ACTIVE_REGENERATIONS, _ACTIVE_PICKS, _ACTIVE_TEMPLATES,
_ACTIVE_INGESTS, _ACTIVE_LIFTS, _ACTIVE_THUMB_BATCHES
```

Daemon threads poll `event.is_set()` → raise `CanceledError` → `project.stage_failed()`. Thread-safe emit via `_EMIT_LOCK` (prevents stdout interleaving).

URL ingest also uses a polling marker file (`~/LiquidClips/.ingest_cancel`) — legacy, but IG-010 prefers the threading.Event path. Cancel-marker pattern: `.lift_cancel` is shared by `ingest_url` + `lift_transcript`, cleared on start AND successful exit.

---

## 2 · Workflow map

> Eleven user flows traced UI → state → IPC → sidecar → external tool → result. Status from the workflow-trace agent's findings.

| # | Flow | Trigger UI (file) | State action | IPC | Runs in | Status |
|---|---|---|---|---|---|---|
| 1 | Paste a video URL | `UnifiedDropZone` paste → `App.tsx::handleIngestDirect(url)` | `view: { kind: "downloading" }` | `sidecar.ingestUrl(url)` (300s) | sidecar yt-dlp → ffmpeg | ✅ COMPLETE |
| 2 | Drop a video file | `DropZone.tsx` / `UnifiedDropZone.tsx` | `view: { kind: "downloading" }` (file path) | `sidecar.startRun(sourcePath, brief?, intent)` | sidecar (no transcode) | ✅ COMPLETE |
| 3 | Import from library | `LibraryTab.tsx` "Import ready clips" | `view: { kind: "results" }` (clips imported=true) | `sidecar.importReadyClips(paths[])` (60s) | sidecar ffprobe | ✅ COMPLETE |
| 4 | Scan video for moments | `WorkingStage.tsx` shows stage="audio" | auto-fires `runStage(slug, "audio")` after ingest | `sidecar.runStage(slug, "audio")` + `stage_progress` listener | sidecar ffmpeg | ✅ COMPLETE |
| 5 | Detect candidates + score | `WorkingStage` progresses through transcribe + llm pills | auto-fires `runStage(slug, "transcribe")` → `runStage(slug, "llm")` | `runStage("transcribe")` (10 min) → `runStage("llm")` (no timeout) | sidecar faster-whisper + Claude/OpenAI | ✅ COMPLETE (hosted-LLM gated by `HOSTED_LLM_ENABLED` flag) |
| 6 | Create clips from candidates | `ResultsGrid` pills "cut · reframe · thumbs" | sequential `runStage` calls | three `runStage` calls | sidecar ffmpeg + `junior-face-detect` + ASS burn | ✅ COMPLETE |
| 7 | Review clips (preview) | `ClipCard` hover or click → `<video>` via `convertFileSrc` | local filesystem read | none | local file | ✅ COMPLETE (with `onError` → "Reveal in Finder") |
| 8 | Edit clip (trim / caption / thumbnail / layout) | `ClipPreview` (full-screen) | drafts → save → bake | `regenerateClip` (180s + cancel marker) · `editCaptions` · `applyOverlay` (180s) · thumbnail picker (no persist) | sidecar ffmpeg | ⚠️ **STUBBED** — thumbnail picker renders but doesn't persist; layout templates only partially wired |
| 9 | Export clip (single) | `ClipCard` Download or `publishClipsNow` | reads `clip.vertical_path` | `backend.publishNow` HTTP **OR** Tauri `dialog.save` | backend Ayrshare OR OS file dialog | ✅ COMPLETE for publish; native "Save As" works via Tauri but is **NOT WIRED** on the Download button |
| 10 | Batch download all clips | `ResultsGrid` toolbar "Download all / Archive" | iterates clips | per-clip `publishNow` | backend Ayrshare | ✅ COMPLETE for batch publish; native ZIP NOT IMPLEMENTED |
| 11 | Handoff finished clip → Library / Schedule | `SchedulePage` queue OR `LibraryTab` archive | `local_schedule_add` OR `requestDeleteProject` (soft) | `localScheduleAdd / List` | sidecar SQL + backend webhook | ✅ COMPLETE for schedule; Library *import-from-finished-project* surface **STUBBED** (no UI) |

### Workflow Health Matrix

| Flow | Complete | Stubbed | Broken | Missing |
|---|---|---|---|---|
| 1 Paste URL | ✅ | | | |
| 2 Drop file | ✅ | | | |
| 3 Import library | ✅ | | | |
| 4 Scan video | ✅ | | | |
| 5 Detect + score | ✅ | (hosted-LLM behind flag) | | |
| 6 Create clips | ✅ | | | |
| 7 Review | ✅ | | | |
| 8 Edit clip | | thumbnail persist · layout persist | | |
| 9 Export single | ✅ (publish path) | native Save-As path | | |
| 10 Batch | ✅ (publish path) | | | native ZIP |
| 11 Handoff | ✅ (Schedule) | Library import surface | | |

**Known broken / inconsistent:**
- Error wrapping is inconsistent: most paths use `humanError()`, a few let raw Python tracebacks leak.
- Thumbnail studio frontend (in legacy) calls `method_set_clip_thumbnails` that does not exist in the sidecar dispatch table.
- Native ZIP export is referenced in UI tooltips but no implementation.

---

## 3 · Lego brick map

> One row per brick. "Risk" weighs (a) coupling to legacy stores, (b) drawer/canvas UI not present in Design OS, (c) Iron Gates touching the brick.

| # | Brick | Existing file | What it does | Dependencies | Move unchanged? | Needs wrapper? | Required Design OS integration | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | `UploadPortal` | `cockpit/UploadPortal.tsx` | Modal: URL paste + file drag-drop + intent gate | None (props-driven) | No (modal portal host missing in DS) | Yes — `<ModalPortal>` slot in AppShell | Mount inside `CreateClips` route via portal; trigger from `keyPanel` CTA; pipe `onPasteUrl` → `sidecar.ingestUrl` | **MED** |
| 2 | `WorkstationRoom` drop overlay | `cockpit/WorkstationRoom.tsx` | Cyan dashed drop affordance | Tauri `tauri://drag-enter/leave` | No (global overlay, needs `AppShell`-level slot) | Yes — `<DropOverlay>` in AppShell | Mount above `WorldLayer`; emit `bus.emit("source:drop", path)`; CreateClips subscribes | **MED** |
| 3 | `IntentPicker` | `IntentPicker.tsx` | Disambiguate clip vs script | None | Yes | No | Mount inline in `CreateClips.keyPanel` when intent ambiguous | LOW |
| 4 | URL input | inside `UploadPortal` | Validates host allowlist + paste | None | Yes (extract function) | No | `CreateClips.keyPanel` first input | LOW |
| 5 | File picker | Tauri `dialog.open` | Native dialog | Tauri capability | Yes | No | Trigger from `CreateClips.keyPanel` button | LOW |
| 6 | `WorkingStage` | `WorkingStage.tsx` | Per-stage ETA + progress | `project.stages.*`, `stage_progress` events | No (visual language doesn't match DS) | Yes — port progress data into Design OS `MetricBoard` + `AllowanceBar` | `ClippingEngine` route: render 7 stages via `MetricBoard` row + active stage as glowing tile; Kade flashes through `cutting-clips`/`generating-captions`/`publishing` as stages advance | **MED** |
| 7 | `ResultsGrid` | `ResultsGrid.tsx` | Clip candidate grid + tabs + multi-select | `project.clips[]`, `getCaptions`, `setClipPlatforms`, `removeClip`, `generateMoreClips` | No (legacy grid CSS) | Yes — wrap grid in `<GlassCard>` shells | `ClippingEngine.centerPanel`: 9:16 cards inside `GlassCard` grid; selection state lives locally; LC Score badge feeds `bus.emit("nav:hover", { kade: "success" })` on threshold | **MED** |
| 8 | `ClipCard` | `clips-feed/ClipCard.tsx` | Per-clip tile, hover preview, score breakdown | `clip`, hover state | Yes (props-driven) | Light — drop inside `GlassCard density="default"` | Inside `ResultsGrid` host | LOW |
| 9 | Score breakdown chips | inline in `ClipPreview.tsx` | Hook / retention / clarity / shareability sub-scores | `clip.score_reason`, `clip.score_breakdown` | Yes (read-only) | No | Surface inside `ClipCard` hover tooltip or `Studio` header strip | LOW |
| 10 | `YouTubeView` | `YouTubeView.tsx` | Transcript-first tab | `project.clips` (imported=true) | Yes | Light — wrap in `<GlassCard>` | `ClippingEngine` route tab swap | LOW |
| 11 | `ClipPreview` (modal editor) | `ClipPreview.tsx` | Full-screen modal | Half the studio RPCs | No (1180px takeover assumes legacy CSS environment) | **YES — extensive** | `TimelineStudio` route: mount as React Portal at AppShell root; respect HUD safe area; Kade hides during modal | **HIGH** |
| 12 | `CaptionOverlay` (live preview) | `captions/CaptionOverlay.tsx` | DOM-layered preview while drawer is dirty | `overlayLines`, `playheadTime` | Yes | No | Mount inside `ClipPreview` modal | LOW |
| 13 | `CaptionDrawer` | `captions/CaptionDrawer.tsx` | Side drawer · 8 palettes + color picker + per-word + Apply re-bake | `CaptionState` (useRef history) | No (no drawer host in DS) | Yes — `<Drawer>` slot at AppShell or modal-internal | Mount inside `ClipPreview` modal OR `TimelineStudio.centerPanel` as a side rail | **MED** |
| 14 | 8 caption-style palettes | inside `CaptionDrawer` | Pre-made colour packs | static data | Yes | No | Drop into Drawer grid | LOW |
| 15 | Caption colour picker | inside `CaptionDrawer` | Hue + sat | None | Yes (extract) | No | Drawer | LOW |
| 16 | Per-word burn | inside `CaptionDrawer` | Timeline + word list | `transcript_words` from sidecar | Yes | No | Drawer timeline | LOW |
| 17 | `ReactionControls` | `clips-feed/ReactionControls.tsx` | Reaction layer + audio + offset picker | `clip.overlay`, `reactionBakingAt` | Yes | Light — wrap in `<GlassCard>` | `TimelineStudio.centerPanel` right rail | LOW |
| 18 | `OverlayTemplateGallery` | `OverlayTemplateGallery.tsx` | 8 split-screen templates · Solo+ gated | static + sidecar `startApplyOverlayTemplate` | Yes | No | `TimelineStudio` or `ThumbnailStudio` modal | LOW |
| 19 | `PlatformBadgePicker` | `PlatformBadge.tsx` | Multi-select platforms + connection status | `connectionStatus`, `setClipPlatforms` | Yes | No | Inside `ClipPreview` modal OR `Schedule.centerPanel` | LOW |
| 20 | Trim editor | inline `<details>` in `ClipPreview.tsx` | start/end inputs + Re-cut | `trimStart/End`, `startRegenerateClip` | Yes (extract) | No | Inside `ClipPreview` modal | LOW |
| 21 | Metadata editor (title/desc/pin) | inline in `ClipPreview.tsx` | Three fields + Save/Discard | `titleDraft/descDraft/pinDraft`, `updateClipMeta` | Yes (extract) | No | Inside `ClipPreview` modal | LOW |
| 22 | Captions header pill | inline in `ClipPreview.tsx` | Open drawer + dirty dot | `captionsOpen/Dirty` | Yes | No | Inside `ClipPreview` modal | LOW |
| 23 | `WindowManager` (workbench canvas) | `workbench/WindowManager.tsx` | Tile canvas + keyboard nav | `useWorkbenchStore` (canvas store) | No (store ties to canvas DOM) | **YES — rebuild against DS** | Rebuild as DS workspace canvas in Phase 7+; defer for Phase 6 | **HIGH** |
| 24 | `ClipEditDrawer` (workbench drawer) | `workbench/ClipEditDrawer.tsx` | Side drawer hosting `ClipPreview` | `focusedWindow` | No | Yes — superseded by Phase 6 modal portal | Defer (workbench is Phase 7+) | **HIGH** |
| 25 | `MasterToolbar` | `workbench/MasterToolbar.tsx` | Bulk Remove / Re-cut / Captions | `selection`, `visibleClips` | No | Yes — adapt as `TimelineStudio` bottom strip | Mount as `TimelineStudio` toolbar after #11 | MED |
| 26 | `BottomCockpit` | `cockpit/BottomCockpit.tsx` | Sticky bottom bar · 3 popovers | many | No (visual language clashes with HUD) | **YES — significant** | Rebuild key affordances inside `Schedule.centerPanel` as panels rather than a docked bar | MED |
| 27 | Schedule popover | inside `BottomCockpit` | Now / +1h / Tomorrow 9am / custom | `whenKey`, `customSchedule` | Yes (extract) | No | Drop into `Schedule.keyPanel` | LOW |
| 28 | Publish popover | inside `BottomCockpit` | Connection status + Publish now | `platformConnections` | Yes (extract) | No | Drop into `Schedule.keyPanel` | LOW |
| 29 | `BakeErrorStrip` | inline in `BottomCockpit` | Red bar + Retry | `bake_status` + `cockpitTier` | Yes (extract) | Light — wrap in `<GlassCard tone="danger">` | Inside `ClippingEngine` or `TimelineStudio.centerPanel` as conditional banner | LOW |
| 30 | Caption-style popover | inline in `BottomCockpit` | 8-style picker + colour | `CAPTION_STYLE_KEYS` | Yes (extract) | No | Drop into `CaptionDrawer` (same as #14) | LOW |
| 31 | `PublishModal` | `PublishModal.tsx` | Platform tabs + auto-filled metadata | `backend.publishClip` | No (modal takeover) | Yes — modal portal | `Schedule.centerPanel` triggers portal | MED |
| 32 | `SchedulePage` | `schedule/SchedulePage.tsx` | Queue UI + cancel | `scheduleQueue`, `channels[]` | Yes | Light — wrap rows in `<GlassCard>` | `Schedule.centerPanel` table | LOW |
| 33 | `ChannelPicker` | `schedule/ChannelPicker.tsx` | Multi-platform OAuth + connected list | backend OAuth flow | Yes | Light — wrap in `<GlassCard>` | `Channels.centerPanel` | LOW |
| 34 | "Save copy as…" button | inline in `ClipPreview` | OS save dialog + copy | Tauri `dialog.save` + `fs.copyFile` | Yes (extract) | No | Inside `ClipPreview` modal action row | LOW |
| 35 | "Reveal in Finder" button | inline in `ClipPreview` | `openSmart` wrapper | Tauri `shell.open` | Yes (extract) | No | Inside `ClipPreview` modal action row | LOW |
| 36 | `LibraryTab` | `library/LibraryTab.tsx` | Archive grid + card-per-project | `backend.listProjects` | Yes | Light — wrap in `<GlassCard>` | `Library.centerPanel` | LOW |
| 37 | `LibraryCard` | `cockpit/LibraryCard.tsx` | Project summary tile | `project` summary | Yes | No | Inside `LibraryTab` | LOW |
| 38 | `AddClipCard` | `AddClipCard.tsx` | "Drop another" tile | `onDropAnother` | Yes | No | Inside `ResultsGrid` or `Library.centerPanel` head | LOW |
| 39 | `ProjectsTab` | `projects/ProjectsTab.tsx` | Filterable project grid | `projects[]`, `filters` | Yes | Light — wrap in `<GlassCard>` | `Library.centerPanel` (alt tab) | LOW |
| 40 | `ProjectDetail` | `projects/ProjectDetail.tsx` | Per-project view + Resume | `project`, `slug` | No (full-page takeover) | Yes — either modal portal or dedicated route | **DEFER** to Phase 7 or treat as `Library` sub-route | MED |
| 41 | `DirectPublishQueue` | `upload/DirectPublishQueue.tsx` | Legacy publish queue (superseded) | legacy RPCs | — | — | **DEFER** — superseded by `SchedulePage` | DEFER |
| 42 | `ClipReadyCard` | `upload/ClipReadyCard.tsx` | Single-clip finished card | `clip`, `project` | Yes | No | Inside `Library.centerPanel` recent strip | LOW |
| 43 | `GlobalToastHost` | `GlobalToastHost.tsx` | Window-event toast queue | `lc:toast` CustomEvent | Yes | No | Mount in `AppShell` after `StickyKade` | LOW |
| 44 | `sidecar.ts` IPC layer | `desktop/src/lib/sidecar.ts` | 85+ RPC wrappers + error envelope parser | None (Tauri `invoke`) | **Yes — entire file ports unchanged** | No | Import directly from `design-os` routes | LOW |
| 45 | `useIngestEvents` | `desktop/src/lib/useIngestEvents.ts` | IG-010 singleton wait-hook | Tauri listeners | Yes | No | Used by `CreateClips` + `ClippingEngine` | LOW |
| 46 | `useGlobalBakeEvents` | `useGlobalBakeEvents.ts` | Bake wait-hook (IG-010) | Tauri listeners | Yes | No | Used by `TimelineStudio` | LOW |
| 47 | `useRegenerateEvents` | `useRegenerateEvents.ts` | Regenerate wait-hook (IG-010) | Tauri listeners | Yes | No | Used by `TimelineStudio` | LOW |
| 48 | `useLiftEvents` | `useLiftEvents.ts` | Lift wait-hook (IG-010) | Tauri listeners | Yes | No | Used by `CreateClips` (script mode) | LOW |
| 49 | `usePickEvents` | `usePickEvents.ts` | Pick wait-hook (IG-010) | Tauri listeners | Yes | No | Used by `ClippingEngine` (Generate more) | LOW |
| 50 | `useReactionBakeProgress` | `useReactionBakeProgress.ts` | Overlay bake progress | Tauri listeners | Yes | No | Used by `TimelineStudio` | LOW |
| 51 | `useActivityEvents` | `contracts/useActivityEvents.ts` | 5 DOM event aggregator | `localStorage` | Yes | No | `Community` + `Earn` routes | LOW |
| 52 | `useWorkbenchStore` | `workbench/useWorkbenchStore.ts` | Canvas tile + selection store | DOM-bound | No (canvas not yet in DS) | Yes — rebuild around DS workspace canvas | **DEFER** — Phase 7 alongside #23/#24 | HIGH |
| 53 | `useAvatar` | `lib/avatar.ts` | Tauri file-backed avatar | Tauri fs | Yes | No | Mount in `Settings.centerPanel` + `TopHud` consumer | LOW |
| 54 | Tauri events → Design OS bus adapter | NEW file: `design-os/bridge/tauri-adapter.ts` | Re-emit `sidecar:*` events as `bus.emit("engine:progress" / "engine:complete" / "engine:error")` | Tauri `listen` | New file | New | Mount in `DesignOSBoundary` `useEffect`; routes subscribe via `useEvent("engine:progress")` | MED (clean code, but new contract) |
| 55 | Local schedule queue file | `~/LiquidClips/.schedule.json` | persistent queue | — | Yes (unchanged) | No | Read via `localScheduleList/Add/MarkPosted/Cancel` | LOW |
| 56 | Direct publish queue file | `~/LiquidClips/.direct-publish-queue.json` | persistent queue | — | — | — | **DEFER** with #41 | DEFER |
| 57 | Submissions tracker | `desktop/src/lib/submissions.ts` | Brief → submission ledger | `$APPDATA/submissions.json` | Yes | No | `Community.centerPanel` | LOW |
| 58 | Thumbnail ledger | `~/LiquidClips/thumbgen_ledger.jsonl` | Per-gen cost trail | — | Yes | No | `Settings.centerPanel` or `Library.centerPanel` admin section | LOW |
| 59 | Drip plan | `dripPlan(...)` RPC | Auto-spaced schedule suggestion | — | Yes | No | `Schedule.centerPanel` action row | LOW |

### 3.1 Design OS components that already cover legacy needs

| DS component | File | Legacy equivalent | Reuse / Port / Rebuild |
|---|---|---|---|
| `GlassCard` | `design-os/components/GlassCard.tsx` | `ClipCard` wrapper / generic surface | **REUSE** — drop legacy ClipCard inside |
| `MetricBoard` + `CountdownBoard` | `design-os/components/MetricBoard.tsx` | `WorkingStage` progress DSEG display | **PORT** — feed sidecar % into `MetricBoard value+ghost`; tone="fx" for ingest, "amber" for warnings |
| `AllowanceBar` | `design-os/components/AllowanceBar.tsx` | Stage progress bar / clip allowance | **REUSE** — already in CommandRoom |
| `KadeController` + `StickyKade` | `design-os/components/Kade*` | (no legacy equivalent — Kade is new) | **REUSE** — feed sidecar event → bus → Kade pose |
| `TopHud` | `design-os/components/TopHud.tsx` | Legacy top bar | **REUSE** — wire props from `useAvatar` |
| `ConsoleNav` | `design-os/components/ConsoleNav.tsx` | Legacy left rail | **REUSE** — already firing `nav:hover/click` |
| `WorldLayer` | `design-os/components/WorldLayer.tsx` | Legacy cockpit background | **REUSE** — per-route world from `routeRegistry` |
| `CursorGlow` | `design-os/effects/CursorGlow.tsx` | — | **REUSE** — already calibrated |
| `DesignOSBoundary` | `design-os/components/DesignOSBoundary.tsx` | — | **REUSE** — owns body attr + leak test |

### 3.2 Gaps in the Design OS that bricks need

| Gap | What's needed | Where it lives | Used by which bricks |
|---|---|---|---|
| `<ModalPortal>` | React portal root mounted in `AppShell` after StickyKade (z-index above world + nav, below cursor glow) | NEW `design-os/components/ModalPortal.tsx` | `UploadPortal`, `ClipPreview`, `PublishModal`, `ProjectDetail` |
| `<Drawer>` | Side rail host with backdrop, escape close, dirty-guard | NEW `design-os/components/Drawer.tsx` | `CaptionDrawer`, future drawer hosts |
| `<DropOverlay>` | Global drag-drop affordance + handler that emits `bus.emit("source:drop", path)` | NEW `design-os/effects/DropOverlay.tsx` | `WorkstationRoom` drop zone |
| `<ToastHost>` | `lc:toast` listener mounted at AppShell root | NEW `design-os/effects/ToastHost.tsx` | `GlobalToastHost` (port) |
| Tauri-bus adapter | Map `sidecar:*` events → `bus.emit("engine:*")` | NEW `design-os/bridge/tauri-adapter.ts` | All routes that need progress/complete/error |
| Engine state context | Per-route engine session (slug, current stage, percent) | NEW `design-os/state/useEngineSession.ts` | `CreateClips`, `ClippingEngine`, `TimelineStudio` |
| Workspace canvas | Tile-grid layout host (rebuild of `WindowManager`) | NEW component in Phase 7 | `useWorkbenchStore`, `WindowManager`, `MasterToolbar` |

---

## 4 · Plug-point coverage matrix (sides A × B)

> One row per brick. Same rows as §3, condensed to the eight columns Daniel asked for. "Phase" = first Phase that can land it. "Risk" repeats from §3 for sorting.

| Brick | DS host route | Exact mount slot | Reuse / Port / Rebuild | Phase | Risk |
|---|---|---|---|---|---|
| 1 UploadPortal | `CreateClips` | `<ModalPortal>` (new) triggered from `keyPanel` CTA | REBUILD around portal | 6B | MED |
| 2 Drop overlay | shell-wide | `<DropOverlay>` (new) above `WorldLayer` in `AppShell` | PORT | 6B | MED |
| 3 IntentPicker | `CreateClips` | inline in `keyPanel` when ambiguous | REUSE | 6B | LOW |
| 4 URL input | `CreateClips` | first input in `keyPanel` | REUSE (extract) | 6B | LOW |
| 5 File picker | `CreateClips` | trigger in `keyPanel` button | REUSE | 6B | LOW |
| 6 WorkingStage | `ClippingEngine` | seven `MetricBoard`s in `centerPanel`; Kade pose follows active stage | PORT | 6C | MED |
| 7 ResultsGrid | `ClippingEngine` | `centerPanel` (replaces SimPage 5-state grid) | PORT (wrap in GlassCards) | 6C | MED |
| 8 ClipCard | inside ResultsGrid | grid cell | REUSE | 6C | LOW |
| 9 Score breakdown | inside ClipCard / Studio header | tooltip / strip | REUSE | 6C | LOW |
| 10 YouTubeView | `ClippingEngine` (alt tab) | `centerPanel` tab swap | REUSE (wrap GlassCard) | 6C | LOW |
| 11 ClipPreview modal | `TimelineStudio` | `<ModalPortal>` takeover | REBUILD (modal + HUD safe area) | 6D | HIGH |
| 12 CaptionOverlay | inside ClipPreview modal | layered over `<video>` | REUSE | 6D | LOW |
| 13 CaptionDrawer | `TimelineStudio` | `<Drawer>` (new) inside `ClipPreview` | REBUILD around Drawer | 6D | MED |
| 14 8 caption palettes | Drawer | static grid | REUSE | 6D | LOW |
| 15 Caption colour picker | Drawer | inside Drawer | REUSE (extract) | 6D | LOW |
| 16 Per-word burn | Drawer timeline | inside Drawer | REUSE | 6D | LOW |
| 17 ReactionControls | `TimelineStudio` | `centerPanel` right rail (or Drawer alt-tab) | REUSE (GlassCard wrap) | 6D | LOW |
| 18 OverlayTemplateGallery | `TimelineStudio` | `<ModalPortal>` triggered from layout tile | REUSE | 6D | LOW |
| 19 PlatformBadgePicker | `TimelineStudio` / `Schedule` | inline in metadata editor / Schedule key panel | REUSE | 6D | LOW |
| 20 Trim editor | `TimelineStudio` | inside `ClipPreview` modal right rail | REUSE (extract) | 6D | LOW |
| 21 Metadata editor | `TimelineStudio` | inside `ClipPreview` modal right rail | REUSE (extract) | 6D | LOW |
| 22 Captions header pill | `TimelineStudio` | inside `ClipPreview` header | REUSE | 6D | LOW |
| 23 WindowManager | `TimelineStudio` workbench tab | NEW canvas host (Phase 7+) | REBUILD | 7+ | HIGH (DEFER) |
| 24 ClipEditDrawer | `TimelineStudio` | superseded by #13 + #11 | DEFER (Phase 7) | 7+ | HIGH (DEFER) |
| 25 MasterToolbar | `TimelineStudio` | bottom strip after #11 | PORT | 7 | MED |
| 26 BottomCockpit | `Schedule` | DECOMPOSED into key panel + action chips inside `centerPanel` (no docked bar) | REBUILD | 6E | MED |
| 27 Schedule popover | `Schedule` | inside `keyPanel` | REUSE (extract) | 6E | LOW |
| 28 Publish popover | `Schedule` | inside `keyPanel` | REUSE (extract) | 6E | LOW |
| 29 BakeErrorStrip | `ClippingEngine` / `TimelineStudio` | conditional `<GlassCard tone="danger">` banner | REUSE | 6C/6D | LOW |
| 30 Caption-style popover | inside `CaptionDrawer` | Drawer grid | REUSE (extract) | 6D | LOW |
| 31 PublishModal | `Schedule` | `<ModalPortal>` | PORT | 6E | MED |
| 32 SchedulePage | `Schedule` | `centerPanel` table | REUSE (GlassCard rows) | 6E | LOW |
| 33 ChannelPicker | `Channels` | `centerPanel` | REUSE (GlassCard wrap) | 6E | LOW |
| 34 "Save copy as…" | inside ClipPreview | action row button | REUSE (extract) | 6D | LOW |
| 35 "Reveal in Finder" | inside ClipPreview | action row button | REUSE (extract) | 6D | LOW |
| 36 LibraryTab | `Library` | `centerPanel` | REUSE (GlassCard wrap) | 6F | LOW |
| 37 LibraryCard | inside LibraryTab | grid cell | REUSE | 6F | LOW |
| 38 AddClipCard | `Library` head / inside ResultsGrid | grid head cell | REUSE | 6F | LOW |
| 39 ProjectsTab | `Library` (alt tab) | `centerPanel` tab swap | REUSE (GlassCard wrap) | 6F | LOW |
| 40 ProjectDetail | `Library` modal or sub-route | `<ModalPortal>` or new `library/:slug` route | REBUILD or DEFER | 7 | MED |
| 41 DirectPublishQueue | — | — | DEFER (superseded) | — | DEFER |
| 42 ClipReadyCard | `Library` recent strip | grid cell | REUSE | 6F | LOW |
| 43 GlobalToastHost | shell-wide | `<ToastHost>` in AppShell after StickyKade | PORT | 6B | LOW |
| 44 sidecar.ts | every route | direct import | REUSE (unchanged) | 6A→ | LOW |
| 45 useIngestEvents | `CreateClips`, `ClippingEngine` | hook at route root | REUSE | 6B | LOW |
| 46 useGlobalBakeEvents | `TimelineStudio` | hook at route root | REUSE | 6D | LOW |
| 47 useRegenerateEvents | `TimelineStudio` | hook at route root | REUSE | 6D | LOW |
| 48 useLiftEvents | `CreateClips` (script) | hook at route root | REUSE | 6B | LOW |
| 49 usePickEvents | `ClippingEngine` | hook at route root | REUSE | 6C | LOW |
| 50 useReactionBakeProgress | `TimelineStudio` | hook at route root | REUSE | 6D | LOW |
| 51 useActivityEvents | `Community`, `Earn` | hook at route root | REUSE | 7 | LOW |
| 52 useWorkbenchStore | `TimelineStudio` workbench tab | superseded canvas (Phase 7) | DEFER | 7+ | HIGH |
| 53 useAvatar | `Settings`, `TopHud` | context provider | REUSE | 6B | LOW |
| 54 Tauri-bus adapter | shell-wide | `design-os/bridge/tauri-adapter.ts` (new) | NEW (small) | 6B | MED |
| 55 .schedule.json | `Schedule` | read via `localScheduleList` | REUSE (unchanged file path) | 6E | LOW |
| 56 .direct-publish-queue.json | — | — | DEFER (superseded) | — | DEFER |
| 57 submissions.json | `Community` | read via `listSubmissions` | REUSE | 7 | LOW |
| 58 thumbnail ledger | `Settings` admin / `Library` | read via `thumbnailLedger` | REUSE | 7 | LOW |
| 59 drip plan | `Schedule` action | call via `dripPlan` | REUSE | 6E | LOW |

---

## 5 · Missing pieces

### 5.1 What already exists (and ports clean)
- The whole Python pipeline (7 stages · 7 cancellable workers · 5 Iron-Gated contracts).
- 85+ RPC wrappers in `sidecar.ts` — single import surface for the new shell.
- 8 Tauri event families + lifecycle crash signal.
- 4 persistent queue files.
- All Iron Gates (IG-001, IG-002, IG-006, IG-010, IG-014) — they travel with the contracts, not the UI.
- Most STUDIO components (`ClipPreview` parts, `CaptionDrawer`, `ReactionControls`, `OverlayTemplateGallery`) are props-driven and extractable.
- `LibraryTab`, `ProjectsTab`, `ChannelPicker`, `SchedulePage` already glass-card-shaped enough to wrap.

### 5.2 What's broken / inconsistent
- **Thumbnail picker** in legacy `ClipPreview` calls `method_set_clip_thumbnails` — **method does not exist in sidecar dispatch.** Persist path missing.
- **Layout templates** — UI wires Apply, but persistent layout-per-clip selection round-trips incomplete on some templates.
- **Native ZIP export** — referenced in UI tooltips, no implementation.
- **Native "Save As"** on the Download button — Tauri capability exists; binding is missing on the Download CTA.
- **Error wrapping** — most paths use `humanError()`, a few leak raw Python tracebacks (e.g., LLM 5xx fallthrough).
- **`DirectPublishQueue`** — legacy surface superseded by `SchedulePage`; still mounted conditionally, dead code path on most flows.

### 5.3 What must be rebuilt (not just ported)
- `<ModalPortal>` host (not present in Design OS).
- `<Drawer>` host (not present in Design OS).
- `<DropOverlay>` host (not present in Design OS).
- `<ToastHost>` host (not present in Design OS).
- `tauri-adapter.ts` in `design-os/bridge/` — bridges `sidecar:*` → `bus.emit("engine:*")`.
- `useEngineSession` context — owns current `slug`, `stage`, `percent`, `kadePose`, fed by adapter.
- `ClipPreview` modal — current 1180px takeover assumes legacy CSS; rebuild against HUD safe-area + DesignOSBoundary.
- `WindowManager` workbench canvas — defer to Phase 7. Tied to `useWorkbenchStore` which is canvas-DOM-bound.
- `BottomCockpit` — replace docked bar with `keyPanel` + action chips inside `Schedule.centerPanel`. Decompose, do not re-mount the bar.

### 5.4 What must be redesigned (decision points, not just rebuild)
- **Studio's drawer vs modal posture.** Legacy uses a side drawer that opens within the modal. Decision: keep the drawer inside the modal (deeper nesting, faster prototype) OR make the drawer a top-level surface inside `TimelineStudio.centerPanel` (cleaner UX, more code). Recommend **inside the modal** for Phase 6D; surface as `TimelineStudio.centerPanel` later if user studies confirm.
- **Workbench canvas posture.** Legacy is a freeform tile canvas (`WindowManager` + `useWorkbenchStore`). The Design OS has no canvas paradigm. Decision: drop the workbench and surface `TimelineStudio` as a single-clip editor (simpler) OR rebuild the canvas in Phase 7 (longer arc). Recommend **drop for v0.8 cycle; revisit Phase 7**.
- **`BottomCockpit` replacement.** Already covered above — decompose, no docked bar.

### 5.5 What can be deferred
- `WindowManager`, `ClipEditDrawer`, `useWorkbenchStore` — Phase 7+.
- `DirectPublishQueue`, `ClipReadyCard` (legacy single-clip card) — superseded.
- `ProjectDetail` full-page surface — Phase 7 as `library/:slug` sub-route or portal.
- `Community` + `Earn` + `Clipper Journey` engine integration (submissions / activity) — Phase 7.
- Native ZIP batch export — Phase 8 (after publish path is fully reliable in DS).

---

## 6 · Phase 6 build order

> One brick per step. Easiest → hardest. Each step lands one PR / install. No PR may ship without (a) tsc green, (b) `__lcRunLeakTest()` clean, (c) StickyKade reacting to the new event channel, (d) a screenshot pair for sign-off.

### Phase 6B · Shell prerequisites (no engine UI yet)
1. **Add `<ModalPortal>`** to `AppShell` after StickyKade. Empty for now. (1 file, 30 lines)
2. **Add `<Drawer>`** to `AppShell`. Empty. (1 file, 50 lines)
3. **Add `<DropOverlay>`** to `AppShell`. Wires `bus.emit("source:drop", path)`. (1 file, 60 lines)
4. **Add `<ToastHost>`** to `AppShell`. Subscribes to window `lc:toast`. (1 file, 40 lines)
5. **Write `tauri-adapter.ts`** in `design-os/bridge/`. Mounts in `DesignOSBoundary` useEffect. Re-emits `sidecar:ingest_progress` → `bus.emit("engine:progress", { stage, percent })` for all 8 families. (1 file, 120 lines)
6. **Write `useEngineSession`** context (slug / stage / percent / pose) in `design-os/state/`. Backed by the adapter. (1 file, 70 lines)
7. **Wire `useAvatar` into `TopHud`** via context provider. (small refactor)

### Phase 6C · SOURCE → ENGINE happy path
8. **Mount `UploadPortal` in `CreateClips`** via `ModalPortal`. Wire URL paste → `sidecar.ingestUrl`. (small route refactor)
9. **Mount `DropOverlay` handler in `CreateClips`** — subscribe to `bus.on("source:drop")` → `sidecar.startRun(path)`.
10. **Add `useIngestEvents` + `useLiftEvents` hooks** at `CreateClips` route root; route enters loading state from `engine:progress`.
11. **Mount `WorkingStage` data in `ClippingEngine.centerPanel`** as a row of seven `MetricBoard`s. Active stage drives `bus.emit("nav:hover", { kade: <stagePose> })`.
12. **Port `ResultsGrid` into `ClippingEngine.centerPanel`** (replaces stub). Wrap rows in `GlassCard` grid. Wire `getCaptions`, `setClipPlatforms`, `removeClip`.
13. **Port `ClipCard`** inside the grid. Hover preview retained.
14. **Mount `BakeErrorStrip`** as a `<GlassCard tone="danger">` banner inside `ClippingEngine`.
15. **Mount `AddClipCard` + `YouTubeView`** tabs.

### Phase 6D · STUDIO (heavy)
16. **Build `<ClipPreviewShell>`** that mounts inside `<ModalPortal>` and respects HUD safe area.
17. **Move `ClipPreview` core (video player + ratio chips)** into the shell.
18. **Mount `CaptionDrawer`** inside `<Drawer>` triggered from `ClipPreview` captions pill.
19. **Mount the 8 caption palettes + colour picker + per-word timeline** inside the Drawer.
20. **Mount Trim editor + Metadata editor** as right-rail blocks inside `ClipPreviewShell`.
21. **Mount `ReactionControls`** as right-rail panel inside `ClipPreviewShell`.
22. **Mount `OverlayTemplateGallery`** as nested `<ModalPortal>` triggered from the layout button.
23. **Mount `PlatformBadgePicker`** inline in the metadata editor.
24. **Wire "Save copy as…" + "Reveal in Finder"** action-row buttons.
25. **Add `useGlobalBakeEvents` + `useRegenerateEvents` + `useReactionBakeProgress`** at the `TimelineStudio` route root.

### Phase 6E · EXPORT
26. **Mount `SchedulePage` into `Schedule.centerPanel`** (wrap rows in GlassCard).
27. **Mount `PublishModal` via `<ModalPortal>`** triggered from `Schedule` keyPanel.
28. **Decompose `BottomCockpit`** — extract Schedule + Publish + Caption-style popovers into `Schedule.keyPanel` chips.
29. **Mount `ChannelPicker` into `Channels.centerPanel`**.

### Phase 6F · LIBRARY
30. **Mount `LibraryTab` + `LibraryCard` into `Library.centerPanel`**.
31. **Mount `ProjectsTab` as alt tab** inside `Library.centerPanel`.

### Phase 6G · Cleanup
32. **Remove the legacy section registry entries** for any surface fully covered by Design OS (no live consumers).
33. **Run `__lcRunLeakTest()`** across all 15 routes (CI script).
34. **Iron-gate audit** — verify IG-001 / IG-002 / IG-006 / IG-010 / IG-014 all still pass.

### Phase 7 (deferred · referenced for sequencing)
- `WindowManager` workbench canvas.
- `ProjectDetail` full surface.
- `Community` + `Earn` + `Clipper Journey` engine wiring (submissions / activity).
- Native ZIP batch export.

---

## 7 · Risk ledger

| Risk | Likelihood | Mitigation |
|---|---|---|
| Iron Gate violation during port | LOW | Iron Gates touch contracts (RPC names + event channels + file paths), not UI. As long as the brick imports `sidecar.ts` unchanged and the hook list (IG-010) remains the wait-hook source, gates hold. Run pre-commit hook before every step. |
| Legacy CSS bleed | MED | Confirmed: `DesignOSBoundary` quarantines body and AppShell.css hides legacy classes. Every step ends with `__lcRunLeakTest()`. Any leak blocks the merge. |
| Modal positioning conflicts with HUD | MED | Reserved 88px HUD safe area is already in `AppShell.css`. `<ModalPortal>` z-index between StickyKade (60) and CursorGlow (4) — modal at z-index ~120. |
| Sidecar event flood inside the adapter | LOW | Each event family carries identifiers (slug, idx, url); bus event payloads stay typed. Adapter does no transformation beyond rename. |
| Drawer-inside-modal nesting fragility | MED | Decision: keep `CaptionDrawer` as a child of `ClipPreviewShell`. Drawer escape closes only the drawer; modal escape only after drawer is closed. Add dirty-guard. |
| Workbench canvas deferral leaves single-clip editor as the studio | LOW | Acceptable for v0.8 / v0.9. Workbench is power-user only. |
| Hosted-LLM gate (`HOSTED_LLM_ENABLED`) | LOW | Already flag-gated; CreateClips can fall back to BYO key when off. |

---

## 8 · Memory updates landed for Phase 6A
- `~/.claude/projects/-Users-dipdip/memory/liquid_clips_route_factory_skill.md` references this audit.
- The engine boundaries doc (`/Users/dipdip/code/jnr/docs/liquid-clips-engine-boundaries.md`) is the architectural rule; this audit is the migration plan that respects it.

---

## 9 · What comes next

**Stop after this audit per Daniel's directive.**

Phase 6B build is unblocked the moment Daniel approves. Recommended first commit: step **1 of Phase 6B — `<ModalPortal>`** — tiny, reversible, foundational, no engine coupling. From there each step lands one brick at a time.

No code changes will be made until Daniel says go.
