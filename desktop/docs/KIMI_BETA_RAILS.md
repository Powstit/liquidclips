# Kimi — Beta Rails (v0.7.43+)
**For Kimi (or any agent finishing the beta).** Read this BEFORE any code.

Daniel's words verbatim:
> "the app cant break cant crash and deliver on every feature everything else
> we can work on in a test suite"

So this scope is **RELIABILITY + FEATURE DELIVERY only**. Everything else
(button systems, design tokens, semantic landmarks, App.tsx refactor,
onboarding consolidation, Cmd+K Command Bar, native Earn, accessibility
landmarks) belongs in a later test/refactor sprint. Do NOT drift into them.

---

## 🔒 Rails

1. **No build / sign / install / ship without Daniel saying so** (per `build-gate` skill). Edits + commits + tsc/py_compile are fine.
2. **Don't touch the 6 ch-row / PlatformBadge files I just merged** — they're stable.
3. **tsc + py_compile MUST stay green after every commit.**
4. **"I fixed it" without the empirical verification command output pasted is NOT done.**
5. **No force-push to public repo without explicit Daniel OK.**
6. **One commit per item** so each fix can be reverted independently if it breaks something on demo day.
7. **No new features.** Every item below is "this exists but doesn't work" or "this could crash."

---

## Part A — Reliability (4 items)

### A1. Sidecar restart cap 1 → 3 with exponential backoff
**File:** `src-tauri/src/sidecar.rs`
**Current:** `const SIDECAR_RESTART_CAP: u32 = 1;`
**Scope:** Bump cap to 3. Add exponential backoff (1s, 3s, 5s) between respawn attempts. After cap exhausted, show the crash overlay as today.
**Why:** One transient OOM during a large import forces a manual relaunch. Three attempts with backoff covers the common-but-transient crash family without spam-restarting on a deterministic crash.
**Do NOT:** Add a "Try to continue" path (already intentionally kept per code comment). Don't touch crash-overlay UI.
**Exit:** `grep "SIDECAR_RESTART_CAP" src-tauri/src/sidecar.rs` → `3`. Backoff logic present in respawn function. `cargo check` green.

### A2. JuniorLoader stall detection
**File:** `src/components/JuniorLoader.tsx`
**Current:** Zero stall detection — a stuck download sits at 0% forever.
**Scope:** Track bytes-downloaded delta over a 60-second rolling window. If delta is 0 for 60s while status is "downloading", swap the spinner for a "Download seems stuck — [Retry] or [Cancel]" affordance. Retry restarts the download. Cancel writes the existing `.cancel` marker.
**Why:** Users with flaky networks (hotel wifi, partial captive portals) currently have no escape from a hung download. They force-quit and re-import.
**Do NOT:** Add a network-detection layer. Don't change the existing cancel mechanism. Don't add WebSocket/long-poll — just measure progress deltas.
**Exit:** `grep -c "stall\|seems stuck" src/components/JuniorLoader.tsx` > 0. Manual test: simulate a stalled download (block network on app open) and verify the affordance appears within 60s.

### A3. localStorage quota error surfacing
**File:** `src/lib/persistedSession.ts` (or wherever workbench persistence writes)
**Current:** `localStorage.setItem` failures are silently swallowed. Users with a full disk see edits randomly not save.
**Scope:** Wrap the setItem call in try/catch. On `QuotaExceededError`, dispatch `lc:toast` event with the message "Storage full — workbench layout won't save. Free up disk space."
**Why:** Silent data loss is the worst-case user experience. Surfacing the failure lets users act (clear cache, free disk).
**Do NOT:** Implement a fallback storage (no IndexedDB swap). Don't compress the data. Just surface the failure and stop silently lying.
**Exit:** `grep -c "QuotaExceededError" src/lib/persistedSession.ts` > 0. tsc green.

### A4. CaptionDrawer mutate null guard
**File:** `src/components/CaptionDrawer.tsx`
**Current:** `state!` non-null assertion. If `mutate` fires before initial load completes (rare but real), crash.
**Scope:** Add `if (!state) return;` at top of `mutate`. Push to history only after the guard.
**Why:** Defensive — prevents a real crash class in the editing surface.
**Do NOT:** Refactor the CaptionDrawer state model. One-line fix only.
**Exit:** `grep -B 1 -A 3 "function mutate\|const mutate" src/components/CaptionDrawer.tsx` shows the guard. tsc green.

---

## Part B — Feature delivery (6 items)

### B1. Drag intent check (Script vs Clips routing)
**File:** `src/App.tsx`
**Current:** Drag-drop while Script-mode upload portal is open routes to the clips pipeline anyway. Script feature is broken in practice.
**Scope:** In the drop handler, check `uploadPortal.intent`. If `"script"`, route to the transcript pipeline (`_onLiftTranscript`). Otherwise existing clips pipeline.
**Why:** The Script-mode portal opens with the intent flag set; the drag handler ignores it and routes everything to clips. Users who chose Script and dragged a file get clips instead.
**Do NOT:** Change the upload portal UI. Don't add new pipelines.
**Exit:** Manual test — open Script portal, drag a video, verify it lands in transcript mode not clips. `grep -c 'intent === "script"\|uploadPortal.intent' src/App.tsx` > 0.

### B2. ClipCard hover action row — un-hide OR delete
**File:** `src/components/clips-feed/ClipCard.tsx`
**Current:** Action row (Caption, Reaction, Copy, Editor buttons) has `className="hidden"`. Features exist in code but users can never reach them — they must use BottomCockpit only.
**Scope (recommended):** Remove the `hidden` class. Show the row on `:hover` via Tailwind `group-hover:opacity-100`. Keep BottomCockpit as the primary surface, but stop hiding the secondary affordance.
**Alternate scope:** If you decide the BottomCockpit is the only surface and ClipCard actions shouldn't exist, delete the JSX block entirely + delete the unused handlers. **Don't leave hidden DOM.**
**Why:** Hidden DOM is technical debt + suggests broken features when discovered by a curious user pressing Inspect.
**Do NOT:** Change the action behaviors. Don't add new actions. Don't change BottomCockpit.
**Exit:** `grep -c 'className="hidden"' src/components/clips-feed/ClipCard.tsx` → 0. Manual test — hover a ClipCard, verify actions appear OR don't (depending on which path you chose).

### B3. ClipPreview trim clamp
**File:** `src/components/ClipPreview.tsx`
**Current:** Trim inputs accept any value. User can type `start: 9999` on a 60-second source. Feature broken on the upper bound.
**Scope:** Clamp trim inputs to source duration:
```tsx
const maxStart = Math.max(0, (clip.source_duration_seconds || clip.duration_seconds || 0) - 1);
const minEnd = Math.min(trimStart + 1, clip.source_duration_seconds || Infinity);
```
Apply clamps on input change + on submit.
**Why:** Currently a user can corrupt their trim and the regenerate call fails with a cryptic ffmpeg error.
**Do NOT:** Change the trim UI affordances. Just validate.
**Exit:** Manual test — try typing `start: 9999` on a 60s clip, verify it clamps to 59. tsc green.

### B4. Schedule platform picker — not hardcoded YouTube
**File:** `src/components/ClipPreview.tsx`
**Current:** Schedule popover line ~393 hardcodes platform to `"youtube"` regardless of clip.platforms.
**Scope:** Use the first selected platform from `clip.platforms`, OR (better) show a small platform picker in the schedule popover that lets the user pick which platform to schedule for. Default to first selected.
**Why:** Users routing a clip to TikTok and trying to schedule it currently schedule to YouTube silently.
**Do NOT:** Build a multi-platform schedule (one platform per scheduled post, as today). Don't change the schedule popover layout substantially.
**Exit:** Manual test — assign a clip to TikTok only, open schedule, verify it shows TikTok. `grep 'platform: "youtube"\|platform.*=.*"youtube"' src/components/ClipPreview.tsx` → only legitimate uses.

### B5. Close Settings on nav switch
**File:** `src/App.tsx`
**Current:** Clicking a nav item (Workspace / Schedule / Earn) while Settings is open does NOT close Settings. Users get confused which surface they're on.
**Scope:** Find the nav-click handler (`handleNavClick` or similar — may have been renamed). Before switching view, if `settingsOpen`, call `setSettingsOpen(false)`.
**Why:** Settings is currently rendered as a modal sheet. Tab switches behind it leave the user in a state where the highlight changed but the visible surface didn't.
**Do NOT:** Convert Settings to a route. Just close it on nav switch.
**Exit:** Manual test — open Settings, click another nav item, verify Settings closes. tsc green.

### B6. Replace `--break-system-packages` advice
**File:** `src/App.tsx` (search for `break-system-packages`)
**Current:** Remediation card tells users to run `pip install --break-system-packages …` — this flag overrides Python's safety net and can destabilize their system Python.
**Scope:** Detect whether user is on Homebrew Python (check `which python3` returns `/opt/homebrew/...`) or system Python. If Homebrew, suggest `brew install python` + plain `pip install`. If system Python, suggest creating a venv: `python3 -m venv ~/.liquid-clips-venv && source ~/.liquid-clips-venv/bin/activate && pip install ...`. Add a "Copy command" button.
**Why:** `--break-system-packages` is dangerous advice. PEP 668 added the safety net for good reason.
**Do NOT:** Auto-run the install yourself. Just give safer instructions.
**Exit:** `grep "break-system-packages" src/App.tsx` → 0 matches. Manual test — open the deps-missing remediation card, verify safe instructions show.

---

## Part C — Social connection audit (mandatory pre-beta)

### C1. Audit + verify connection state propagation

Daniel wants social media connections "wired on every relevant surface as its
apart of all features." Current state: every surface IMPORTS the right
primitive, but we haven't verified state actually propagates between them.

**Scope:** Walk every surface that touches a social account. For each, verify the state contract:

| Surface | File | What it reads | What it writes |
|---|---|---|---|
| 1. Settings → Connections | `src/components/Settings.tsx` (mounts AyrshareConnectionPanel) | `socialGetConnection()`, `whopSessionStatus()`, channels list | "Disconnect" writes; "Add channel" writes |
| 2. Schedule → Channels | `src/components/schedule/ChannelsManager.tsx` | `listChannels()` | toggle pause/unpause; delete; link |
| 3. PublishModal Routes | `src/components/PublishModal.tsx:446` (ChannelPicker) | `listChannels()` | per-clip platform/channel selection |
| 4. ClipPreview platforms | `src/components/ClipPreview.tsx:13` (PlatformBadgePicker) | `clip.platforms` | `setClipPlatforms` RPC |
| 5. AddChannelModal | `src/components/schedule/AddChannelModal.tsx` | OAuth callback / paste flow | creates a new channel row |
| 6. EarnTab (Whop) | `src/components/earn/EarnTab.tsx` | Whop session status | nothing — read-only |

**What to verify per surface:**

a. **Same source of truth.** Every surface should read channel state from the same RPC (`listChannels()` or `backend.listChannels()`). No surface should cache stale state and lie. If you find two surfaces reading from different sources, file the inconsistency.

b. **State change propagation.** When one surface updates state (delete a channel in Settings, toggle pause in Schedule, complete OAuth in AddChannelModal), every other surface must reflect the change within one render cycle. The pattern is the `lc:channel-stale` event dispatched by ChannelRow. Verify the listener exists everywhere that needs to know.

c. **Broken state honesty.** When Ayrshare reports an account is disconnected (DB status = "error"), every surface must show it as broken. The ChannelPicker fix earlier landed worst-of (DB + Ayrshare) — verify it's still that way in `ChannelPicker.tsx`. Settings, Schedule, PublishModal must all show the same red state at the same moment.

**Exit criteria:**
- A one-page audit doc at `desktop/docs/SOCIAL_CONNECTION_AUDIT.md` listing each of the 6 surfaces, what RPC it reads, what events it listens for, and a ✓/✗ on whether state propagates.
- Any drift identified gets a one-line fix in the same sprint (renaming events, adding a listener, swapping a stale cache for the canonical RPC).
- Manual test: open the desktop app, disconnect Instagram in the Ayrshare web dashboard, hit /sync from Settings, verify ALL of (Settings, Schedule → Channels, PublishModal Routes, ClipPreview platforms) show Instagram as broken/red within ~10 seconds.

**Do NOT:**
- Rebuild the connection flow. Don't add new RPCs.
- Don't touch the OAuth bring-up for Instagram / YouTube / TikTok unless you find a real bug.
- Don't add a new "connection health" surface — the existing surfaces are enough.

---

## How Daniel verifies you're done

Run these commands. Paste output verbatim in your "done" message:

```bash
# Reliability
grep -E "SIDECAR_RESTART_CAP|EXP_BACKOFF" desktop/src-tauri/src/sidecar.rs | head -2
grep -c "stall\|seems stuck" desktop/src/components/JuniorLoader.tsx
grep -c "QuotaExceededError" desktop/src/lib/persistedSession.ts
grep -B 1 "if (!state) return" desktop/src/components/CaptionDrawer.tsx | head -3

# Feature delivery
grep -c 'intent === "script"' desktop/src/App.tsx
grep -c 'className="hidden"' desktop/src/components/clips-feed/ClipCard.tsx
grep -c "maxStart\|source_duration_seconds" desktop/src/components/ClipPreview.tsx
grep -E 'platform: "youtube"' desktop/src/components/ClipPreview.tsx | wc -l
grep -A 5 "handleNavClick\|onNavClick" desktop/src/App.tsx | grep -c "setSettingsOpen(false)"
grep "break-system-packages" desktop/src/App.tsx

# Compile gates
cd desktop && npx tsc --noEmit && python3 -m py_compile python-sidecar/sidecar.py

# Social audit
ls desktop/docs/SOCIAL_CONNECTION_AUDIT.md
```

If any of these come back wrong, the corresponding item is not done.

---

## Estimated effort

- Part A (reliability): ~half day
- Part B (feature delivery): ~1 day
- Part C (social audit): ~half day

Total: **about 2 days of focused work, no drift.**

Daniel will create the demo after these land. Beta push follows demo.
