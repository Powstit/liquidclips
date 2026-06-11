# Schedule Page — Comprehensive Scope & Redesign

## Current State

The Schedule page is a 3-subtab shell (`/schedule`):

| Sub-tab | Component | Data source |
|---------|-----------|-------------|
| **Queue** | `SchedulePage` orchestrator | Ayrshare connection state + three queue lanes |
| | `DirectPublishQueue` | Local disk queue (`useDirectPublishQueue`) |
| | `LocalQueue` | Sidecar JSON store (`$CLIPS_HOME/.schedule.json`) — offline |
| | `ScheduleQueue` | Backend `/schedules` API — gated on `PUBLISHING_ENABLED` |
| **Loadout** | `ChannelsManager` | Backend `/channels` API + Ayrshare profile snapshot |
| | `ChannelRow` | Row UI with stale-status Ayrshare override |
| | `ChannelPicker` | Re-usable single-select picker |
| | `AddChannelModal` | Channel provisioning + OAuth deep-link polling |
| **Analytics** | `AnalyticsView` | Backend `/analytics/overview` + `/analytics/channels` |

**Publishing path**: `InlineScheduler` (on clip cards) → `backend.publishNow()` → targets legacy `SocialConnection` platforms or v2 per-channel Ayrshare sub-profiles.

---

## 🐛 Bug Fixes (Priority Order)

### CRITICAL

**1. Unhandled rejection in `ScheduleQueue.tsx:184-199`**
- `sidecar.licenseJwtRead()` is called **outside** the `try/catch`. If it throws, `setRetrying(null)` never runs → retry button stuck forever.
- **Fix**: Move JWT read inside the `try` block.

**2. Unhandled rejection in `AddChannelModal.tsx:456-469`**
- `backend.relinkChannel()` throws → no `catch` block → unhandled promise rejection.
- **Fix**: Add `catch` that surfaces error via toast or inline banner.

### HIGH

**3. Unmount race in `AddChannelModal.tsx:162-170`**
- Catch block calls `setState` without `if (cancelled) return;` guard.
- **Fix**: Add unmount guard at top of catch block.

**4. Unhandled rejection in `SchedulePage.tsx:71`**
- `backend.listChannels()` has no `.catch()`.
- **Fix**: Add `.catch(() => {})` or async IIFE with try/catch.

**5. Duplicate error surfaces on cancel in `ScheduleQueue.tsx:174-177`**
- One cancel failure produces **two** identical errors: global banner + per-row chip.
- **Fix**: Remove `setError(msg)` from cancel catch; keep only per-row `setCancelError`.

### MEDIUM

**6. Unmount race in `ChannelsManager.tsx:146-152`**
- Fire-and-forget promise inside `load()` calls `setState` after potential unmount.
- **Fix**: Track `cancelled` flag in `load()` and guard the `.then()` callback.

**7. Single `retrying` ID can't track multiple concurrent retries**
- `useState<string | null>` → clicking retry on row A then B re-enables A's button while still in-flight.
- **Fix**: Change to `Set<string>` or per-row state map.

**8. `InlineScheduler.tsx` renders disabled controls when useless**
- Caption textarea, time picker, and Submit render even when `authed === false` or `connLoadState.kind === "error"`.
- **Fix**: Wrap caption/when/submit in conditional requiring `authed !== false && connLoadState.kind === "loaded"`.

**9. Missing card styling on filter empty state**
- `ScheduleQueue.tsx:288-292` bare `<p>` with no HUD brackets or padding.
- **Fix**: Wrap in same container as main empty state (`relative bg-transparent px-5 py-10` with corner spans).

### LOW

**10. Deprecated `socialGetConnection()` still used**
- `SchedulePage.tsx:27`, `DirectPublishQueue.tsx:24` use deprecated function that collapses "backend down" and "no connection row" into `null`.
- **Fix**: Migrate to `socialGetConnectionStrict()`.

**11. `ScheduleQueue.tsx:131` mutates fetched array in place**
- `list.sort(...)` mutates backend cache reference.
- **Fix**: `[...list].sort(...)`

**12-13. Unhandled rejections on "Open post" clicks**
- `LocalQueue.tsx:724-727` and `ScheduleQueue.tsx:328` — wrap in try/catch.

---

## 🎨 UX Redesign (v0.8.0 Design Language)

### Empty States
Every sub-tab needs a crafted empty state with HUD corner brackets, not a bare `<p>`.

**Queue — no posts scheduled:**
```
┌─────────────────────────────────────────────┐
│  [no posts scheduled]                        │
│                                              │
│  Your queue is empty.                        │
│  Select clips in your workspace and hit      │
│  [Schedule] or [Publish now].                │
│                                              │
│  [Go to workspace →]                         │
└─────────────────────────────────────────────┘
```

**Loadout — no channels connected:**
```
┌─────────────────────────────────────────────┐
│  [no channels connected]                     │
│                                              │
│  Connect your social accounts to schedule    │
│  and publish directly from Liquid Clips.     │
│                                              │
│  [Connect Instagram] [Connect TikTok]        │
│  [Connect YouTube]   [Connect X]             │
└─────────────────────────────────────────────┘
```

**Analytics — no data yet:**
```
┌─────────────────────────────────────────────┐
│  [analytics will appear here]                │
│                                              │
│  Publish your first post to see performance  │
│  across all connected channels.              │
│                                              │
│  [Go to workspace →]                         │
└─────────────────────────────────────────────┘
```

### Loading States
Replace generic spinners with the **WorkingBar** component (fuchsia pulse, already in design system):
- `ScheduleQueue` refresh: WorkingBar at top of list
- `ChannelsManager` load: WorkingBar in place of channel rows
- `AddChannelModal` OAuth polling: WorkingBar + "Waiting for Instagram…" with cancel button

### Error States
Use the **ToastHost** pattern (once built per v0.8.0_FIGMA_TREE):
- Network errors: Toast with retry action
- OAuth timeout: Inline card with "Connection timed out — [Retry]"
- Backend down: HUD bracket box with offline icon + "Reconnecting…" auto-retry

### Tab Design
Match v0.8.0 cockpit tab strip:
- Pills: `rounded-full`, idle `bg-paper/50`, active `bg-ink text-paper`
- Eyebrow labels above each tab: `text-[10px] uppercase tracking-[0.2em] text-ink-soft`
- Active indicator: fuchsia underline (2px, `bg-fuchsia`)

### Queue Lanes
Current: 3 separate queue components (`DirectPublishQueue`, `LocalQueue`, `ScheduleQueue`).
**Redesign**: Unified queue with filter tabs:
- `All` | `Scheduled` | `Published` | `Failed` | `Drafts`
- Each row: HUD bracket card with clip thumbnail (32px), platform badges, scheduled time, status dot, actions (retry/cancel/edit)
- Status dots: `connected=green`, `pending=amber pulse`, `failed=red`, `draft=ink/30`

### Channel Rows
Current: basic row with toggle.
**Redesign**:
- Left: Platform icon (real brand glyph, not Lucide) + handle
- Center: Connection status dot + label
- Right: Toggle pill (active/paused) + menu (⋮) for relink/delete/diagnose
- Stale state: amber pulse dot with tooltip "Ayrshare says linked, but we need to verify"
- Error state: red dot with inline retry button

### Schedule Confirmation
Match `docs/demo.html` celebration burst:
- On successful schedule: full-frame fuchsia burst overlay (1.2s) + "Scheduled · 2 platforms" eyebrow
- Sound cue: `schedule-confirm.mp3` (600ms success chime — deferred to Sprint C)

---

## 🔧 Architecture Improvements

### 1. Unified Error Handling
Create `src/lib/scheduleErrors.ts`:
```ts
export function handleScheduleError(e: unknown): { message: string; retryable: boolean } {
  // Normalize backend errors, network errors, sidecar errors
}
```
Use in all schedule components instead of inline `humanError(e)`.

### 2. Cancel Tokens for Polling
`AddChannelModal` polling interval should be stoppable:
```ts
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
```

### 3. Retry State as Set
```ts
const [retrying, setRetrying] = useState<Set<string>>(new Set());
const isRetrying = (id: string) => retrying.has(id);
const startRetry = (id: string) => setRetrying(s => new Set(s).add(id));
const endRetry = (id: string) => setRetrying(s => { const n = new Set(s); n.delete(id); return n; });
```

### 4. Deprecation Cleanup
Migrate all `socialGetConnection()` callers to `socialGetConnectionStrict()`:
- `SchedulePage.tsx`
- `DirectPublishQueue.tsx`
- `PublishModal.tsx`
- `InlineScheduler.tsx`

---

## 🚧 Iron Gates (Do Not Touch)

- **Do NOT change** the Ayrshare OAuth flow (browser-based, deep-link callback). It works.
- **Do NOT change** the backend channel API shape (`/channels`, `/publish-now`, `/schedules`).
- **Do NOT change** the `liquidclips://channel-linked` deep-link scheme.
- **Do NOT remove** legacy `SocialConnectionState` support until v2 channel adoption is 100%.
- **Do NOT change** the existing color palette (fuchsia `#d946ef`, paper `#faf9f7`, ink `#1a1a1a`).
- **Do NOT add** new social platforms beyond the 7 already supported (YT, IG, TT, X, LI, FB, Threads).

---

## 📋 Implementation Order

1. **Bug fixes** (all 13, estimated 2-3 hours)
2. **Empty states** (3 sub-tabs, estimated 1 hour)
3. **Unified queue lanes** (merge 3 queues into filtered single view, estimated 3-4 hours)
4. **Channel row redesign** (estimated 2 hours)
5. **Schedule confirmation burst** (estimated 1 hour)
6. **Sound cues** (deferred to Sprint C per Figma tree)
