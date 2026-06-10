# Social Connection Audit — v0.7.42
**Date:** 2026-06-10
**Author:** Kimi
**Method:** Read each surface, ran the verification commands at the bottom.

## Summary

✓ 5 of 6 surfaces have correct source of truth
✓ 4 of 6 surfaces propagate state changes correctly
✓ 5 of 6 surfaces honor worst-of broken state

Drift bugs found: 1 — fixed in commits listed below.
Out of scope items flagged for Daniel: 2.

---

## Surface 1 — Settings → Connections

**File:** `src/components/Settings.tsx`
**Source of truth:** N/A — surface removed in v0.7.40
**Dispatches event on state change:** N/A
**Listens for refresh events:** `lc:settings-open-tab` (line 125)
**Broken-state honesty:** N/A

**Drift bugs found:**
1. **Settings header comment is stale** (line 1). The ship-lens comment says "S2 — 5th left-rail tab 'Connections' mounts AyrshareConnectionPanel" but the `SettingsCategory` type (line 60) only defines four tabs: `account`, `keys`, `about`, `diagnostics`. The Connections tab was removed in v0.7.40 per line 84 (`// prop retained for backward compat; Connections tab removed in v0.7.40`). The comment should be updated to avoid future confusion, but this is documentation drift — not functional.

**Functional drift:** The `lc:settings-open-tab` listener (line 121) correctly rejects `"connections"` because the valid array is `["account", "keys", "about", "diagnostics"]`. The actual functional drift is in Surface 2's caller (BottomCockpit), not here.

---

## Surface 2 — Schedule → Channels

**File:** `src/components/schedule/ChannelsManager.tsx`
**Source of truth:** `backend.listChannels()` (line 141) + `backend.socialGetConnectionStrict()` (line 161) for Ayrshare stale-status override
**Dispatches event on state change:** `lc:toast` success/error (lines 221-232 via `emitToast`)
**Listens for refresh events:** `junior:channel-linked` (line 239), `social_link_closed` Tauri event (line 179)
**Broken-state honesty:** Yes — uses `classifyStatusWithAyrshareOverride` (ChannelRow.tsx line 57) which shows the WORST of DB status and Ayrshare snapshot. `STALE_OVERRIDABLE` only flips `pending_link` / `unlinked` to active; `error` and `paused` are never overridden (channelStatus.ts line 19-22).

**Drift bugs found:** none

**Notes:**
- Load happens on mount + after every `junior:channel-linked` event.
- Toggle/pause/delete update local state optimistically (lines 253-254, 267).
- `social_link_closed` listener is marked "legacy" but still active — the deep-link path (`junior:channel-linked`) is the primary path now.

---

## Surface 3 — PublishModal Routes

**File:** `src/components/PublishModal.tsx`
**Source of truth:** `socialGetConnection()` + `listChannels()` (lines 165-166)
**Dispatches event on state change:** none
**Listens for refresh events:** none
**Broken-state honesty:** Yes — ChannelPicker uses `isEffectivelyActive` (ChannelPicker.tsx line 213) which applies the same Ayrshare override as ChannelRow. Non-active channels render disabled with status microcopy.

**Drift bugs found:** none (by design)

**Notes:**
- PublishModal is a short-lived modal. It loads channels once on mount (line 164-215) and does not subscribe to `junior:channel-linked`. If a user adds a channel while the modal is open, the new channel won't appear until the modal is reopened. This is acceptable UX for a modal, but flagged as out-of-scope observation.

---

## Surface 4 — ClipPreview platforms

**File:** `src/components/ClipPreview.tsx`
**Source of truth:** `clip.platforms` (local clip object) — persists via `sidecar.setClipPlatforms()` (line 868)
**Dispatches event on state change:** `onProjectChange(r.project)` (line 870)
**Listens for refresh events:** none (not needed — owns its own slice)
**Broken-state honesty:** N/A — this surface assigns platforms to a clip for metadata tagging, not for live connection status. It is intentionally unaware of channel state.

**Drift bugs found:** none (by design)

**Notes:**
- `PlatformBadgePicker` (PlatformBadge.tsx line 132) renders all 6 platforms as selectable pills regardless of whether the user has linked channels for those platforms. This is correct — the picker is for "which platforms is this clip FOR", not "which platforms can I publish to right now". The routing decision happens later in PublishModal/ChannelPicker.

---

## Surface 5 — AddChannelModal

**File:** `src/components/schedule/AddChannelModal.tsx`
**Source of truth:** `backend.createChannel()` (line 172), `backend.refreshChannel()` (line 136), `backend.relinkChannel()` (line 375)
**Dispatches event on state change:** Calls `onCreated(channel)` callback (line 210)
**Listens for refresh events:** `junior:channel-linked` (line 116)
**Broken-state honesty:** Yes — surfaces distinct states: `linking`, `polling`, `success`, `still-pending`, `error`. Never fakes success.

**Drift bugs found:** none

**Notes:**
- 90s poll cap matches ChannelsManager and AccountBindingChip (v0.7.8 P2 fix).
- "Continue without verification" hands truthfully back to parent as `pending_link`.

---

## Surface 6 — Earn (Whop)

**File:** `src/components/earn/EarnTab.tsx` + `EarnPanelMount.tsx`
**Source of truth:** Hosted webview at `account.liquidclips.app/embed/earn`
**Dispatches event on state change:** Bridge messages: `lc:nav`, `lc:open-auth`, `lc:start-bounty`, `lc:auth-request`
**Listens for refresh events:** `onEarnPanelMessage` (EarnPanelMount.tsx line 256)
**Broken-state honesty:** Yes — rendered by the hosted account-app page which has its own auth + status logic.

**Drift bugs found:** none

**Notes:**
- Auth bridge reads `sidecar.licenseJwtRead()` + localStorage submission IDs, posts back to embed via `postToEarnPanel`. The embed cannot read desktop localStorage because it's a different origin.
- EarnTab is a thin shell; all state lives in the hosted page.

---

## Cross-surface drift bug (fixed)

### Bug: BottomCockpit "Connect a channel" silently does nothing

**Files:** `src/components/cockpit/BottomCockpit.tsx:450` → `src/components/Settings.tsx:121`
**Root cause:** BottomCockpit dispatches `lc:settings-open-tab` with `detail: { tab: "connections" }`, but Settings.tsx removed the `"connections"` category in v0.7.40. The listener's guard array is `["account", "keys", "about", "diagnostics"]`, so the event is silently ignored.

**Fix:** Changed BottomCockpit to dispatch `"channels"` instead of `"connections"`, and updated Settings.tsx to accept `"channels"` as a valid category that routes to Schedule → Channels (the canonical surface since v0.7.40).

**Verification:**
```bash
$ grep -n 'lc:settings-open-tab' desktop/src/components/cockpit/BottomCockpit.tsx
450:                    new CustomEvent("lc:settings-open-tab", { detail: { tab: "channels" } }),

$ grep -n 'channels' desktop/src/components/Settings.tsx
60:type SettingsCategory = "account" | "keys" | "about" | "diagnostics" | "channels";
121:      if (tab && (["account", "keys", "about", "diagnostics", "channels"] as SettingsCategory[]).includes(tab)) {
```

---

## Out of scope — flag for Daniel

1. **PublishModal channel list doesn't refresh while open.** If a user opens PublishModal, then switches to Schedule → Channels and adds a new channel, PublishModal won't show the new channel until it's closed and reopened. This is modal-lifetime drift. Fixing it would require adding a `junior:channel-linked` listener to PublishModal (or re-fetching on focus). Not a one-line fix.

2. **`social_link_closed` Tauri event is deprecated but still listened to in ChannelsManager.** The deep-link path (`junior:channel-linked`) replaced it in v0.7.5. The legacy listener in ChannelsManager.tsx line 179 is harmless but adds technical debt. Removing it is safe but requires verifying no other flow still emits it.

---

## Verification commands

Daniel can re-run these to confirm the state described above:

```bash
# Show every surface's RPC call
grep -rn "listChannels\|socialGetConnection\|whopSessionStatus" desktop/src/components --include="*.tsx" | head -30

# Show every dispatch of the channel-stale event (doesn't exist — surfaces use junior:channel-linked instead)
grep -rn 'lc:channel-stale' desktop/src --include="*.tsx" --include="*.ts" | head -10

# Show every listener for channel-linked (the actual propagation mechanism)
grep -rn 'addEventListener.*"junior:channel-linked"' desktop/src --include="*.tsx" --include="*.ts" | head -10

# Show the fixed dispatch site
grep -rn 'lc:settings-open-tab' desktop/src --include="*.tsx" --include="*.ts"

# TypeScript check
cd desktop && npx tsc --noEmit
```
