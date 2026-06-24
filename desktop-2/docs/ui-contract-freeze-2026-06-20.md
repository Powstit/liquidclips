# UI Contract Freeze · desktop-2 → sidecar port

**Date:** 2026-06-20
**Author:** Claude
**Purpose:** Document every plug-point the real Python sidecar must satisfy when the engine port lands. The UI shell is now complete enough that the sidecar can drop straight in without UI changes.

This file is the **wiring diagram** for step C of the agreed sequence:
- ✅ A · UI shell completion pass (this turn — see end of file for the diff)
- ✅ B · Freeze UI contract (this document)
- ⏳ C · Port sidecar (awaiting greenlight)
- ⏳ D · Notifications · payments · Resend · billing · affiliate · agency

Touching any of the five plug-points below requires updating this file in the same commit.

---

## Plug-point 1 · URL ingest entry

**User action:**
1. Open CreateClips (`#/create`) — either via inner ConsoleNav or the auto-route from CommandRoom.
2. Click the floating "Upload portal" CTA → `UploadPortal` modal opens.
3. Paste URL in the URL field → presses ↵.

**Today's code path (mock):**

```
UploadPortal.onPasteUrl(url)
  ↓
src/design-os/routes/CreateClips.tsx · line ~97
  startPersistedSession(url, { url })            // session UI state
  sidecar.ingestUrl(url)                          // ← SWAP POINT
  ↓
src/design-os/engine/sidecar-stub.ts · line 126
  async ingestUrl(url, brief?, intent?) :
    Promise<{ project: ProjectMeta; downloaded_path?: string }>
```

**Port contract — what the real sidecar wrapper must satisfy:**

```ts
sidecar.ingestUrl(
  url: string,
  brief?: string,
  intent?: "clips" | "script"
): Promise<{
  project: ProjectMeta;            // existing TS type
  downloaded_path?: string;        // local file path after yt-dlp
}>
```

- Same TS signature as the stub (callers do NOT change).
- Must emit `bus.emit("engine:progress", { ... })` ticks (see Plug-point 2).
- Must emit `bus.emit("engine:complete", { kind: "ingest", slug, url })` on success.
- Must throw a `SidecarError` on failure (the EngineErrorBoundary catches this per-brick).

**Local-file equivalent:**

```ts
sidecar.startRun(
  sourcePath: string,
  brief?: string,
  intent?: "clips" | "script"
): Promise<{ project: ProjectMeta }>
```

Already wired at CreateClips line ~50 (drop handler) and line ~110 (file picker).

---

## Plug-point 2 · Progress events

**Today's code path (mock):**

```
sidecar.ingestUrl(url)
  ↓
sidecar-stub.ts · mockIngest() · ~6s pacing
  bus.emit("engine:progress", {
    kind: "ingest",
    slug, url,
    stage: "downloading" | "muxing" | "probing" | ...,
    percent: 0..1,
    note: string | undefined,
  }) × N
  ↓
bus.emit("engine:complete", { kind: "ingest", slug, url })
```

**Consumers in the UI (these are stable — do not change):**

| Subscriber | File | Reads |
|---|---|---|
| `useEngineSession` provider | `src/design-os/state/useEngineSession.ts` | `session.phase`, `session.stage`, `session.percent`, `session.note` |
| Stage rail | `src/design-os/engine/StageRail.tsx` | `session.stage` (icon swap per stage) |
| Engine hero | `src/design-os/routes/ClippingEngine.tsx` lines ~75-95 | `session.phase` (`running` / `complete` / `error`) |
| Source-bay hero | `src/design-os/routes/CreateClips.tsx` lines ~56-72 | `session.percent`, `session.stage` |
| KadeFromSession | `src/design-os/state/useKadeFromSession.ts` | `session.phase` (drives Kade pose) |
| Persistence | `src/design-os/state/engineSessionPersistence.ts` | progress writes persist between routes |

**Port contract — what the real sidecar wrapper must satisfy:**

The 7-stage pipeline from `desktop/python-sidecar/stages.py` must map cleanly to `session.stage`:

| Python stage | UI `session.stage` | Notes |
|---|---|---|
| `stage_ingest` | `"ingest"` | yt-dlp download + ffmpeg mux |
| `stage_audio` | `"audio"` | audio extraction |
| `stage_transcribe` | `"transcribe"` | faster-whisper tiny |
| `stage_llm` | `"llm"` | OpenAI moment-finding (Free tier needs user's key — see Plug-point 6) |
| `stage_cut` | `"cut"` | ffmpeg cut + concat |
| `stage_reframe` | `"reframe"` | junior-face-detect + ffmpeg crop |
| `stage_thumbs` | `"thumbs"` | per-clip thumbnail generation |

`percent` must be monotonic-increasing within a single ingest, 0.0..1.0. The Python `emit()` call shape (see `desktop/src/lib/sidecar.ts` lines ~1467+) is already mirrored by the stub — keep that shape.

---

## Plug-point 3 · Real clip cards (replace FIXTURE_PROJECT)

**Today's code path (mock):**

```
src/design-os/routes/ClippingEngine.tsx · line 108
  <ResultsGrid project={FIXTURE_PROJECT} onOpenClip={...} />
                       ^^^^^^^^^^^^^^^^^
                       hardcoded fixture from src/design-os/engine/types.ts
```

**Port contract — what the engine wrapper must satisfy:**

After `engine:complete` fires for an ingest, the same session must hold a real `project` object that ResultsGrid can render:

```ts
interface ProjectMeta {
  slug: string;
  title: string;
  source_url?: string;
  source_path?: string;
  clips: ClipMeta[];               // ← shape ResultsGrid reads
  // ... existing fields (already typed in design-os/engine/types.ts)
}

interface ClipMeta {
  idx: number;
  title: string;
  duration_sec: number;
  preview_url?: string;            // local file:// or app-cache URL
  thumbnail_url?: string;
  score?: number;                  // predictor.py output
  // ... existing fields
}
```

The wrapper must call `sidecar.getProject(slug)` (mirrors legacy `desktop/python-sidecar/sidecar.py` `method_get_project`) and feed the result into `useEngineSession` so ResultsGrid reads `session.project` instead of `FIXTURE_PROJECT`.

**Single line to flip on port:**

```
- <ResultsGrid project={FIXTURE_PROJECT} ... />
+ <ResultsGrid project={session.project ?? FIXTURE_PROJECT} ... />
```

(Preserving the fixture fallback prevents a blank state in dev without a sidecar running.)

---

## Plug-point 4 · Project files on disk

**Today's code path (mock):** nothing writes to disk. The "session" lives in zustand + sessionStorage.

**Port contract — what the engine wrapper must satisfy:**

The real sidecar writes projects under `CLIPS_HOME` (defined in `desktop/python-sidecar/project.py`):

```
~/Library/Application Support/Liquid Clips/clips/
  <slug>/
    project.json                  # ProjectMeta JSON
    source/                       # downloaded source video
      <source>.mp4
    audio/
      audio.wav
    transcript/
      transcript.json
    clips/
      clip_<idx>.mp4              # cut output
      clip_<idx>.thumb.jpg
    exports/                      # written by Plug-point 5
      clip_<idx>.exported.mp4
```

**Tauri side requirements:**

| Requirement | File to add | Notes |
|---|---|---|
| Read-access capability for `CLIPS_HOME` | `desktop-2/src-tauri/capabilities/main.json` | Allow `tauri-plugin-fs` read of `$APPDATA/clips/**` |
| Path resolver | `desktop-2/src-tauri/src/sidecar.rs` (port from legacy) | Resolves `Resources/python-sidecar/sidecar.py` and `_up_/python-sidecar/sidecar.py` |
| Default path bridge | `getClipsHome()` TS helper | Calls `path.appDataDir().clips/` for UI references |

The UI does **not** read files directly. All file-system access goes through `sidecar.getProject(slug)` and `tauri-plugin-asset:` URLs for previews.

---

## Plug-point 5 · Export output

**Today's code path (stub):**

```
src/design-os/routes/ExportRoute.tsx · ~lines 200-260
  useChannels()                                  // real channel list (when present)
  exportApi.exportClip(params)                   // ← SWAP POINT
  ↓
sidecar-stub.ts · line ~565
  exportApi.exportClip(...)
    → emits engine:progress (kind: "export")
    → emits engine:complete (kind: "export")
    → returns a fake export record
```

**Port contract — what the engine wrapper must satisfy:**

```ts
exportApi.exportClip(params: ExportClipParams): Promise<{
  slug: string;
  idx: number;
  output_path: string;              // absolute file path inside CLIPS_HOME/<slug>/exports/
  duration_sec: number;
  watermark_applied: boolean;       // true for Free tier (per render_watermark_overlay.py)
  completed_at: string;
}>
```

- Watermark policy: Free tier always gets `watermark_applied: true` (sidecar enforces, NOT the UI).
- The UI surfaces the watermark state via the existing `ExportRoute` row but does NOT decide it.
- After export completes, the export should also become a Library entry (so the Library route fixture transitions to real `/me/clips` rows).

---

## Plug-point 6 · OpenAI API key entry (Free tier prerequisite)

**Today's state:** no UI for user-provided OpenAI keys.

**What the port adds:**

- A new Settings card (between Account and Upgrade): "OpenAI key" with a single password-field row.
- Stores the key via `secret_set_jwt`-style Tauri command (port from `desktop/python-sidecar/secrets_store.py`).
- Free tier requires this key for `stage_llm`. Pro tier (when shipped) routes through hosted compute per `junior_hosted_compute` memory.

**Surface to add:**

```tsx
<section className="lc-settings-card">
  <span className="lc-settings-card-eb">OpenAI key</span>
  <SettingsRow label="Status" value={hasOpenAIKey ? "Saved" : "Not set"} />
  <input type="password" placeholder="sk-..." onChange={...} />
  <button>Save key</button>
  <p>Required on Free tier · stays on this Mac (Keychain).</p>
</section>
```

Effort: ~0.25 d. Lands in the same sidecar port commit.

---

## Plug-point 7 · Notification surface (post-sidecar, low priority)

**Today's state:** Inbox shell wired but reads `fakeInbox.ts`. NotificationBell opens the sheet, marks-as-read, displays unread count.

**What needs to happen for real notifications:**

| Event | Inbox row | Producer |
|---|---|---|
| Campaign approved | `kind: "campaign"` | junior-backend webhook → app event bus |
| Clip ready (sidecar) | `kind: "clip-ready"` | `engine:complete` listener |
| Reward earned (Whop) | `kind: "reward"` | webhook polling |
| Welcome / system | `kind: "welcome" \| "system"` | hardcoded on first launch |

Effort: ~1 day after sidecar lands. Until then, fixture is honest.

---

## What this turn changed (A · UI shell completion pass)

Surgical fills only. Brand-consistent (uses existing CSS tokens + design-OS shell). No restyling. Build green: `npm run build` → 2317 modules, 16.38 s, no errors.

| # | Change | Files |
|---|---|---|
| 1 | New Inbox shell (overlay sheet, 5 fixture messages, mark-as-read, empty state) | `src/shell/InboxSheet.tsx` (new), `src/shell/InboxSheet.css` (new), `src/fixtures/fakeInbox.ts` (new) |
| 2 | NotificationBell wired to InboxSheet (dot conditional on unread count) | `src/shell/NotificationBell.tsx` |
| 3 | Outer SideNav hidden when `activeId === SECTION_HOME` (resolves the 5-vs-12-nav-items confusion) | `src/shell/AppShell.tsx` |
| 4 | TopBar "Upgrade" pill (Free tier · click surfaces "coming soon" toast) | `src/shell/TopBar.tsx`, `src/index.css` |
| 5 | Library: SimPage placeholder → real read-only grid backed by `fakeClips` + empty state with "Cut your first clip" CTA | `src/design-os/routes/Library.tsx`, `src/design-os/routes/Library.css` (new) |
| 6 | ClipperJourney: honest "Coming after beta" stub (removed "Step 3 of 8" hard-coded mock) | `src/design-os/routes/ClipperJourney.tsx` |
| 7 | StopPages: honest "Not part of 0.8.0 beta" stub (removed "10 stops mapped" hard-coded mock) | `src/design-os/routes/StopPages.tsx` |
| 8 | Settings: "Upgrade" placeholder card between Account and Connection Status (disabled CTA, honest copy) | `src/design-os/routes/Settings.tsx` |

**Not touched (out of scope for this pass):**

- Real billing, Stripe, checkout flow.
- Real notification backend, webhooks, push.
- The sidecar (Plug-points 1-6 above) — explicit deferral.
- Phase 2 polish: empty-state sweep on Channels/Schedule/Earn/Community, Settings polish, banner generation v1, CampaignPageShell polish.
- Tauri / Cargo build verification.
- No git commits, no tags, no pushes (per `feedback_no_push_until_confirmed`).

---

## Next step (awaiting your call)

When you say go on step C, the sidecar port lift-and-shift is:

1. Copy `desktop/python-sidecar/` to repo root (single source of truth).
2. Port `desktop/src-tauri/src/sidecar.rs` (726 LOC) into `desktop-2/src-tauri/`.
3. Update `desktop-2/src-tauri/tauri.conf.json` resources to point at the shared sidecar.
4. Replace `desktop-2/src/design-os/engine/sidecar-stub.ts` ingest paths with the real `sidecarCall("ingest_url", ...)` chain from `desktop/src/lib/sidecar.ts`.
5. Add the Plug-point 6 OpenAI key Settings card.
6. End-to-end smoke: real URL → real progress → real clips → Studio → Export.

Estimate: ~3.5 days per the gap analysis. No UI changes required because of this contract.
