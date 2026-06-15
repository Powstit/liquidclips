# App Contracts

> Binding UI/UX contracts for Liquid Clips desktop.
>
> These are not style guides. They are end-to-end behavior contracts that,
> if broken, produce live user bugs. Every future lane must preserve them.

---

## 1. Social OAuth return contract

### Goal

After a user connects a social account (Instagram, TikTok, YouTube, X, Facebook,
LinkedIn, etc.), the app must immediately return to Liquid Clips, land on
**Schedule → Channels**, and refresh connection state everywhere without a
manual restart or page reload.

### Contract

When a user clicks connect for a platform:

1. The app knows which platform was clicked.
2. The app requests an official platform-scoped connect URL from the backend
   (`POST /channels` via `backend.createChannel({ platform, label })` or
   `POST /channels/:id/relink` via `backend.relinkChannel(id)`).
3. The app opens that URL in the user's real browser.
4. The user completes OAuth on the provider's site.
5. The provider redirects to Ayrshare, which redirects to the Liquid Clips
   account-app bounce page, which fires the deep link
   `liquidclips://channel-linked?cid=<channel_id>`.
6. The app catches the deep link in `src/lib/activation.ts`.
7. The app dispatches:
   - `junior:channel-linked` with the channel id.
   - `lc:settings-open-tab` with `{ tab: "channels" }` to return to
     Schedule → Channels.
   - `lc:connections-mutated` to force every consumer of
     `usePlatformConnections` to refresh.
8. `usePlatformConnections` re-fetches `listChannels()` + `socialGetConnectionStrict()`.
9. Schedule, PublishModal, ClipReadyCard, DirectPublishQueue, and ChannelPicker
   all show the new connected state.
10. No social connection surface routes to Settings.
11. No manual app restart/reload is required.

### Provider-specific shortcut

The backend/Ayrshare path already supports provider-specific OAuth URLs. The
frontend must not hardcode provider OAuth URLs. It must request them through:

```ts
const { channel, link_url } = await backend.createChannel({
  platform, // "instagram" | "tiktok" | "youtube" | "x" | ...
  label,
});
await openSmart(link_url);
```

### Surfaces covered

- `SchedulePage` rail icons, routed-to chips, "+ add" pill, `ConnectFirstPrompt`
- `ChannelsManager` add/relink actions
- `ChannelPicker` "+ Add channel"
- `PublishModal` empty state and platform grid
- `ClipReadyCard` platform circles and connect gate
- `DirectPublishQueue` connection error banner
- `AccountBindingChip` and `InlineConnectPopover`

### What is forbidden

- Hardcoding Instagram/TikTok/YouTube OAuth URLs in the frontend.
- Routing a social connect action to `onOpenSettings` / Settings → Channels.
- Fake clickable platform icons with no handler.
- Leaving the app on an unrelated view after OAuth completes.
- Requiring the user to restart the app to see the new connection.

---

## 2. Channel connection state contract

### Goal

Every surface that displays connected social channels must read from a single
shared source of truth.

### Contract

- The canonical React-side source is `src/lib/usePlatformConnections`.
- `SchedulePage`, `ChannelPicker`, `PublishModal`, and `DirectPublishQueue` must
  consume `usePlatformConnections`; they must not independently call
  `backend.listChannels()` or `backend.socialGetConnectionStrict()`.
- `ChannelsManager` is allowed to create/delete/toggle channels directly, but
  after every mutation it must dispatch `lc:connections-mutated`.
- After OAuth completion, `activation.ts` must dispatch
  `lc:connections-mutated`.
- The hook must refresh on:
  - `junior:channel-linked`
  - `social_link_closed`
  - `lc:connections-mutated`
  - `lc:desktop-auth-ready`
  - `window.focus`

---

## 3. Social connection routing contract

### Goal

Social connection empty states and "Add channel" affordances must route to
Schedule → Channels, never to Settings.

### Contract

In `PublishModal`, `ClipReadyCard`, `DirectPublishQueue`, `BottomCockpit`,
`ResultsGrid`, `SchedulePage`, and `ChannelPicker`:

- Social connection handlers must use `onOpenSchedule`.
- The following patterns are forbidden:
  - `onOpenSchedule ?? onOpenSettings`
  - `onOpenSettings ?? onOpenSchedule`
  - `onOpenSettings?.()`
  - `if (onOpenSettings)` used for channel connection
  - "Schedule → Settings", "Settings → Connections", "Settings → Channels"

---

## 4. GuardQuota contract

### Goal

The create-clip quota gate must be server-authoritative.

### Contract

- `App.tsx guardQuota` must not contain a client-side hard block such as
  `if (remainingExports === 0) { setView({ kind: "quota" }); return false; }`.
- Quota enforcement must come from `maybeCheckQuota()` / `/usage/video-started`,
  which raises the quota wall only when the backend returns `402` or
  `QuotaExceededError`.
- `remainingExports` may still be displayed in UI surfaces for quota awareness.

---

## 5. Debug trace log contract

### Goal

No `[trace-lane1]` debug logs ship in production code.

### Contract

No file in `src/` may contain the literal `[trace-lane1]`.
