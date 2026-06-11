# Social Media Posting — Comprehensive Scope & Redesign

## Current State

### ✅ What's Working
- **Channel linking** via real browser OAuth + deep-link callback (`liquidclips://channel-linked?cid=`)
- **Stale-status override** — Ayrshare snapshot flips `pending_link`/`unlinked` to routable
- **Publish now** via Ayrshare (single and multi-channel with `Promise.allSettled`)
- **Schedule** via Ayrshare native scheduler (`scheduledAt`) + legacy `/schedules` cron
- **Inline scheduler** on clip cards (`InlineScheduler.tsx`)
- **Channel picker** inside `PublishModal` (`ChannelPicker.tsx`)
- **AccountBindingChip** in workbench windows

### ⚠️ Technical Debt
- `socialGetConnection()` (legacy) still used by 4 callers instead of `socialGetConnectionStrict()`
- Orphaned Rust `social_link.rs` child-window flow (not used; app uses browser OAuth)

### ❌ What's Missing / Broken

1. **Clicking a social icon on a clip does NOT connect the account.**
   - `ClipCard.tsx:498-501`: `PlatformBadge` `onClick` just routes to `lc:settings-open-tab` → Schedule → Channels.
   - Placeholder icons (`ClipCard.tsx:510-518`) are `pointer-events-none`.

2. **No connection-state awareness on clip-card icons.**
   - `PlatformBadge` renders **routed platforms** (`clip.platforms`), not **connected platforms**.
   - User sees Instagram badge on clip but has no Instagram connected → click does nothing useful.

3. **Platform glyph gaps.**
   - Threads: no glyph in `PlatformIcon` or `PlatformBadge` (falls back to mono initial)
   - LinkedIn: `PlatformBadge` only, no `PlatformIcon`
   - Facebook: `PlatformBadge` only, no `PlatformIcon`

4. **`RoomShell.tsx` / `WorkstationRoom.tsx` have no platform-icon functionality.**
   - These are layout shells, not clip surfaces. Platform icons live on `ClipCard`, `ClipWindow`, `ClipPreview`, `InlineScheduler`.

5. **PublishModal channel list doesn't refresh while open.**
   - If user adds a channel in another tab, modal won't see it until reopened.

---

## 🎯 Core User Story

> "I see a clip. I want to post it to Instagram. I click the Instagram badge on the clip. If I'm not connected, it starts the OAuth flow right there. If I am connected, it toggles the route on/off. I never leave the workspace."

---

## 🎨 Redesign — Connection-State Badges on Clips

### Current Behavior
```
Clip thumbnail
┌─────────────────────┐
│ [🔥HOT]         [IG]│  ← IG badge = clip.platforms includes "instagram"
│                     │     Click = navigate to Settings → Channels
│                     │
└─────────────────────┘
```

### New Behavior
```
Clip thumbnail
┌─────────────────────┐
│ [🔥HOT]    [●] [IG]│  ← ● = connection state dot
│                     │     Click = smart action based on state
│                     │
└─────────────────────┘
```

### Connection State Dot
Small 6px dot, top-right of each `PlatformBadge`:
- **Green solid** (`#22c55e`): Connected + routable
- **Amber pulse** (`#f59e0b`): Connected but stale (Ayrshare override active)
- **Red solid** (`#ef4444`): Error / paused
- **Hidden**: Not connected at all

### Smart Click Handler
```ts
function handlePlatformClick(platform: ChannelPlatform) {
  const channel = findChannelByPlatform(platform);
  if (!channel) {
    // Not connected → start OAuth inline
    startInlineConnect(platform);
  } else if (channel.status === "error" || channel.status === "paused") {
    // Connected but broken → show reconnect dialog
    showReconnectDialog(channel);
  } else {
    // Connected → toggle route on/off for this clip
    toggleClipPlatform(clip.id, platform);
  }
}
```

### Inline OAuth Mini-Flow
Instead of routing away, show an **in-place popover**:

```
┌─────────────────────────────┐
│  Connect Instagram           │
│                              │
│  Post this clip directly     │
│  to your Instagram feed.     │
│                              │
│  [Authorize with Ayrshare →] │
│  (opens browser — 30 sec)    │
│                              │
│  [Not now]                   │
└─────────────────────────────┘
```

- Uses existing `backend.createChannel({ platform, label })` → `openExternal(link_url)` flow
- Listens for `junior:channel-linked` deep-link event
- On success: dot turns green, badge becomes clickable toggle
- On timeout (90s): shows "Still waiting? [Retry]"

### Placeholder Icons (When No Platforms Routed)
Current: 4 low-opacity placeholders (`pointer-events-none`).
**New**: Still show placeholders, but:
- `pointer-events-auto` (clickable)
- On click: trigger inline connect popover for that platform
- Tooltip: "Click to connect Instagram"

---

## 🎨 Redesign — Platform Glyphs

Per `v0.8.0_FIGMA_TREE.md`: **real brand glyphs, not Lucide**.

### Required SVGs (add to `src/assets/platforms/`)

| Platform | File | Source |
|----------|------|--------|
| YouTube | `youtube.svg` | Official press kit, monochrome variant |
| TikTok | `tiktok.svg` | Official brand assets |
| Instagram | `instagram.svg` | Official glyph, gradient optional |
| X/Twitter | `x.svg` | Official brand kit |
| LinkedIn | `linkedin.svg` | Official brand kit |
| Facebook | `facebook.svg` | Official brand kit |
| Threads | `threads.svg` | Official brand kit |

### Component Updates

**`PlatformIcon.tsx`** — add missing platforms:
```tsx
case "linkedin": return <LinkedInGlyph className={cn} />;
case "facebook": return <FacebookGlyph className={cn} />;
case "threads": return <ThreadsGlyph className={cn} />;
```

**`PlatformBadge.tsx`** — add missing platforms + connection dot:
```tsx
// Wrap badge in relative container
<div className="relative inline-flex">
  <BrandGlyph platform={platform} />
  {connectionState && (
    <span className={cn("absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full", dotColor)} />
  )}
</div>
```

---

## 🎨 Redesign — Inline Scheduler

### Current
`InlineScheduler.tsx` renders caption + when + submit even when user is signed out or has no channels.

### New
- **Collapsed state** (default): Platform badge row only. Click badge to toggle route.
- **Expanded state** (when ≥1 platform routed): Show caption textarea + when picker + Submit.
- **No-auth state**: Replace controls with "Sign in to schedule" button that opens auth modal.
- **No-channels state**: Replace controls with "Connect a channel" button that opens inline connect.

### Channel-Aware Submit Button
```
[Publish now · 2]     ← enabled, 2 platforms routed + connected
[Schedule · 1]        ← enabled, 1 platform routed + connected
[Connect to publish]  ← disabled, platforms routed but not connected
```

---

## 🎨 Redesign — PublishModal

### Live Channel Refresh
Add `useEffect` that polls `listChannels()` every 5s while modal is open:
```tsx
useEffect(() => {
  if (!open) return;
  const id = setInterval(() => refreshChannels(), 5000);
  return () => clearInterval(id);
}, [open]);
```

### Channel List Item
```
┌─────────────────────────────────────────────┐
│  [●]  📷  @danieldiyepriye                  │
│       Instagram · Connected                 │
│                              [Toggle]       │
└─────────────────────────────────────────────┘
```

---

## 🔧 Architecture Changes

### 1. Connection State Hook
Create `src/lib/usePlatformConnections.ts`:
```ts
export function usePlatformConnections() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [snapshot, setSnapshot] = useState<AyrshareSnapshot | null>(null);
  // Fetches listChannels + socialGetConnectionStrict
  // Returns: isConnected(platform), getChannel(platform), refresh()
}
```

### 2. Inline Connect Popover
Create `src/components/social/InlineConnectPopover.tsx`:
- Props: `platform: ChannelPlatform`, `onConnected: () => void`, `onCancel: () => void`
- Uses existing `backend.createChannel` + `openExternal` + deep-link listener
- 90s timeout with retry

### 3. Platform Glyph Registry
Create `src/components/platforms/PlatformGlyph.tsx`:
- Unified component that renders the correct brand SVG
- Falls back to Lucide `Globe` if platform unknown
- Size variants: `sm` (12px), `md` (16px), `lg` (24px), `xl` (32px)

### 4. Connection Dot Component
Create `src/components/platforms/ConnectionDot.tsx`:
- Props: `status: ChannelStatus | "stale" | undefined`
- Returns colored dot with tooltip

---

## 🚧 Iron Gates (Do Not Touch)

- **Do NOT change** the Ayrshare OAuth flow (browser-based, deep-link callback).
- **Do NOT change** the backend channel API shape.
- **Do NOT change** the `liquidclips://channel-linked` deep-link scheme.
- **Do NOT remove** legacy `SocialConnectionState` support.
- **Do NOT store** Ayrshare tokens on the desktop.
- **Do NOT change** the existing color palette.

---

## 📋 Implementation Order

1. **Platform glyphs** (7 SVGs + `PlatformGlyph` component, estimated 2-3 hours)
2. **Connection state hook** (`usePlatformConnections`, estimated 1 hour)
3. **Connection dot + smart click handler** on `ClipCard` (estimated 2 hours)
4. **Inline connect popover** (estimated 2-3 hours)
5. **InlineScheduler redesign** (conditional rendering, estimated 2 hours)
6. **PublishModal live refresh** (estimated 30 min)
7. **Migrate `socialGetConnection()` callers** to strict version (estimated 1 hour)
8. **Placeholder icons** become clickable (estimated 30 min)

---

## 🔄 Integration with v0.8.0 Demo

Claude's `docs/demo.html` already has:
- Platform brand badges on clips (lines 758-802)
- Ayrshare auth flow (lines 611-623)
- Schedule confirm burst (lines 559-562, 986-987)

**Gap**: The demo shows visual treatment but does NOT implement:
- Connection state dots
- Smart click-to-connect behavior
- Inline popover (it shows a full-screen auth card)
- Platform glyph SVGs (uses Lucide placeholders)

This scope document closes those gaps.
