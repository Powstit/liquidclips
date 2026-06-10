# LiquidClips Desktop — Import Flow & Editing Suite Audit Report
**Date:** 2026-06-09  
**Scope:** `/Users/dipdip/Desktop/jnr/desktop` — Import flow, editing suite (workbench), backend sidecar, and state management  
**Constraint:** No code was modified during this audit.

---

## Executive Summary

This audit identified **6 critical bugs**, **8 high-severity issues**, and **dozens** of medium/low UX, performance, and security concerns across the import pipeline and editing suite. The most severe issues involve:

1. **Data loss / corruption** in the direct-publish queue and workbench persistence layers due to race conditions and non-atomic file writes.
2. **Crashes / hangs** from Python `AttributeError` in overlay baking and indefinite `urlopen` timeouts in the thumbnail engine.
3. **Security gaps** including unvalidated file paths passed to `ffprobe`, arbitrary HTTPS downloads, and sensitive user data persisting after sign-out.

---

## 1. Critical Bugs

### C1. `project.data` AttributeError Breaks Overlay Baking (Python Sidecar)
- **File:** `python-sidecar/sidecar.py` (lines 1298, 1310)
- **Issue:** `method_apply_overlay` references `project.data.get("clips", ...)`, but the `Project` dataclass has **no `.data` attribute** (it uses `.clips`). Both success and error paths crash with `AttributeError`. The frontend shows a failure toast even when the overlay was actually baked successfully; conversely, real ffmpeg errors are lost and replaced by a Python traceback.
- **Fix:** Replace `project.data.get("clips", ...)` with `project.clips`.

### C2. Direct-Publish Queue Race Condition Causes Silent Data Loss
- **File:** `src/components/upload/useDirectPublishQueue.ts` (lines 52–111)
- **Issue:** The mount effect reads the queue from disk asynchronously. If the user clicks **Browse** or pastes (calling `addPaths`) *before* that read finishes, `itemsRef.current` is still `[]`. `persist` writes the new items to disk, but then the late read finishes and overwrites `itemsRef.current` with the stale disk state, **silently orphaning newly added clips**.
- **Fix:** Gate all mutators until initial hydration completes, or queue pending operations and flush them after hydration.

### C3. Batch Remove Deletes Wrong Clips (Index Shift Bug)
- **File:** `src/components/workbench/masterActions.ts` (lines 79–91, 242–270)
- **Issue:** `fanOut` iterates selected windows sequentially. After the first `sidecar.removeClip` succeeds, `current.clips` shrinks, but subsequent iterations still use the **original** `clipIdx`. The identity-matching fallback first reads `targetClip = current.clips[idx]` using the stale index, so it already grabs the wrong clip. If duplicate clips exist (same bounds + title), `findIndex` may also match the wrong one.
- **Fix:** Sort selected windows in **descending** `clipIdx` order before iterating, or rebuild the window map after each removal.

### C4. Wrong Clip Index Passed to `setClipPlatforms`
- **File:** `src/components/ClipPreview.tsx` (line 818)
- **Issue:** `sidecar.setClipPlatforms(slug, index, next)` uses the **1-based** `index` prop. Every other sidecar call in this file correctly uses `index - 1`. This mutates the wrong clip's platform array (or throws if `index` is out of bounds).
- **Fix:** Change `index` to `index - 1`.

### C5. Indefinite Hang in Thumbnail Engine
- **File:** `python-sidecar/thumbnail_engine.py` (lines 208, 216)
- **Issue:** `urllib.request.urlopen(req)` is called **without a `timeout`** argument. Default is to block forever. If OpenAI's API stalls, the entire Python sidecar hangs indefinitely. The Rust layer only has a 3600s safety-net timeout, leaving the user with no feedback for up to an hour.
- **Fix:** Add `timeout=60` (or similar) to both `urlopen` calls.

### C6. Race Between Clip Navigation and In-Flight Saves
- **File:** `src/components/ClipPreview.tsx` (lines 120–131, 139–159)
- **Issue:** `useEffect` resets form state when `clip` changes, but `saveMeta`, `regenerate`, and `performRemove` are **not cancelled**. If the user navigates ←/→ while `saveMeta` is in flight, the old RPC resolves and calls `onProjectChange(r.project)` against the newly-selected clip, causing stale data to overwrite the current project.
- **Fix:** Add operation cancellation tokens (e.g., `AbortController` or an incrementing generation counter) and ignore stale RPC responses.

---

## 2. UX Issues

### U1. UploadPortal Discards User's File Pick
- **File:** `src/components/cockpit/UploadPortal.tsx` (lines 166–185)
- **Issue:** `browseForFile` calls `openFileDialog`, receives `picked`, then ignores the path and calls `onPickFile("")`. In `App.tsx` this triggers a **second** OS file picker. The user must pick twice; the first selection is lost.
- **Severity:** High

### U2. Multi-File Drops Are Silently Truncated
- **File:** `src/App.tsx` (line 670)
- **Issue:** `const path = event.payload?.paths?.[0]` takes only the first path. A user who drops five finished clips gets only one processed; the rest are lost with no warning.
- **Severity:** High

### U3. No Error Boundary at App Root
- **File:** `src/App.tsx`
- **Issue:** There is no `ErrorBoundary` anywhere in the tree. A single thrown error in `ClipPreview`, `BottomCockpit`, or any child crashes the entire app to a **white screen**.
- **Severity:** High

### U4. UnifiedDropZone `onDrop` Ignores Dropped File
- **File:** `src/components/UnifiedDropZone.tsx` (lines 156–160)
- **Issue:** The browser `onDrop` handler calls `onPickFile("")` instead of reading `e.dataTransfer.files`. The overlay says "▸ drop to cut", but dropping a file here merely triggers an empty `onPickFile` (which opens the OS picker). The DOM drop target promises an action it does not perform.
- **Severity:** Medium

### U5. DropZone Promises Drop Capability It Doesn't Implement
- **File:** `src/components/DropZone.tsx` (lines 50–62)
- **Issue:** Copy says "Drop a video file" and "drag a file anywhere", but there is **no `onDrop` handler**. Actual OS drops are handled globally by `App.tsx`, while browser drag events are ignored. The copy oversells the capability.
- **Severity:** Medium

### U6. Context Menu Clipped Off Viewport Edge
- **File:** `src/components/workbench/WindowManager.tsx` (lines 420–491)
- **Issue:** `ContextMenu` uses fixed positioning at `state.x, state.y`. A right-click near the viewport edge clips the menu off-screen with no scroll or reposition strategy.
- **Severity:** Medium

### U7. Confirm Dialog Misrepresents File Deletion
- **File:** `src/components/workbench/WindowManager.tsx` (lines 496–509)
- **Issue:** Body text: *"The clip's files on disk go too."* This depends entirely on `sidecar.removeClip` implementation. If the backend only removes the JSON entry, the user is misled. If files *are* deleted, the dialog should match current backend behavior.
- **Severity:** Medium

### U8. Trim Inputs Silently Corrupt Invalid Input
- **File:** `src/components/ClipPreview.tsx` (lines 891–899)
- **Issue:** `parseFloat(e.target.value) || 0` turns `"abc"` or an empty string into `0` without feedback. The user may accidentally trigger a 0-second re-cut.
- **Severity:** Medium

### U9. `deps-missing` View Recommends `--break-system-packages`
- **File:** `src/App.tsx` (lines 2283–2327)
- **Issue:** The remediation card tells users to run `pip install --break-system-packages`. This is alarming and potentially dangerous advice for non-technical users.
- **Severity:** Medium

### U10. Hardcoded Pricing Strings
- **File:** `src/App.tsx` (lines 1574–1645)
- **Issue:** "Solo · $29.99/mo", "Growth · $99.99/mo", "Autopilot · $199.99/mo" are hardcoded. If the backend changes pricing, the desktop app lies to the user until the next build.
- **Severity:** Medium

### U11. Invalid Tailwind Variant Makes Check Icon Invisible
- **File:** `src/components/upload/ClipReadyCard.tsx` (lines 399–401)
- **Issue:** The check icon uses `group-hover/opt:opacity-60`, but the parent button lacks `group` and `/opt` is not a configured variant. The checkmark is **invisible** on hover.
- **Severity:** Low

### U12. No Focus Trap in Workbench Onboarding
- **File:** `src/components/workbench/WorkbenchOnboarding.tsx` (lines 53–107)
- **Issue:** Keyboard users can Tab out of the onboarding overlay into the real workbench tiles underneath, escaping the tour without dismissing it.
- **Severity:** Medium

### U13. Resume Bulk Schedule Uses Wrong Queue Snapshot
- **File:** `src/components/upload/DirectPublishQueue.tsx` (lines 345–350)
- **Issue:** `resumeBulkSchedule` snapshots the current queue without checking whether it matches the abandoned run. If the user removed or re-ordered items after abandoning, "Resume" walks the *new* queue from the top, potentially re-scheduling clips that were already handled.
- **Severity:** Medium

### U14. Autoplay Blocked on Non-Muted Clips
- **File:** `src/components/ClipPreview.tsx` (line 649)
- **Issue:** `<video autoPlay loop muted={!!clip.overlay?.music_bed} />` is only muted when `music_bed` exists. On non-muted clips, the browser blocks autoplay, leaving the user staring at a black frame.
- **Severity:** Medium

### U15. Workbench Onboarding Keyboard Focus Not Moved to DOM
- **File:** `src/components/workbench/WindowManager.tsx` (lines 336–338)
- **Issue:** `cycleFocus` updates `focusedId` in the store, but never calls `.focus()` on the actual tile DOM node. Keyboard users see a visual focus change but `activeElement` stays on `document.body`.
- **Severity:** Medium

---

## 3. Performance Issues

### P1. App.tsx is a Massive Re-render Bomb
- **File:** `src/App.tsx`
- **Issue:** ~30 `useState` hooks in a single root component. Any state change (e.g., `setDropError`, `setInboxOpen`) re-renders the entire application shell, including `SideNav`, `Cockpit`, `RoomShell`, and all modals. No `React.memo`, no state colocation, no context splitting.
- **Severity:** High

### P2. Workbench Persistence Reads localStorage on Every Mutation
- **File:** `src/components/workbench/useWorkbenchStore.ts` (line 105)
- **Issue:** `snapshotToPersisted` calls `readPersisted()` (which `JSON.parse`s localStorage) **synchronously on every state mutation** inside the debounced persist path. For >10 windows this causes visible jank during moves/resizes.
- **Severity:** High

### P3. `publishNow` Materializes Large Files in Renderer Heap
- **File:** `src/lib/backend.ts` (lines 433–446)
- **Issue:** `readFile(args.filePath)` loads the **entire video file** into a `Uint8Array` in the webview's JS heap. The 500MB guard is loose; a 450MB file still allocates 450MB in the renderer, which can **OOM-crash the Tauri webview** with no recovery.
- **Severity:** High

### P4. `Array.from(selected).sort(...)` Creates New Array Every Render
- **File:** `src/components/ResultsGrid.tsx` (line 148)
- **Issue:** `selectedIdxs` is a newly allocated array on every render, causing `BottomCockpit` to receive a new prop reference and re-render even when the semantic selection hasn't changed.
- **Severity:** Medium

### P5. `useTier.ts` Re-fetches on Every Window Focus
- **File:** `src/lib/useTier.ts` (lines 193–203)
- **Issue:** `window.addEventListener("focus", ...)` triggers a full `/sync` + `/me` roundtrip every time the user alt-tabs back. On a flaky connection this causes visible loading states and network contention.
- **Severity:** Medium

### P6. N+1 Full Project Hydration in List View
- **File:** `python-sidecar/sidecar.py` (lines 302–432)
- **Issue:** `method_list_projects` calls `Project.load()` for every project, which parses `project.json`, validates source paths, resolves symlinks, and reconstructs the full dataclass. For 100+ projects this is slow and blocking.
- **Severity:** Medium

### P7. Keyboard Listener Re-registered on Every Store Change
- **File:** `src/components/workbench/WindowManager.tsx` (lines 288–301)
- **Issue:** The `useEffect` dependency array includes `windowList`, which is a new array on every `windowsMap` mutation. This causes the global `keydown` listener to be detached/reattached constantly, burning CPU and risking missed keystrokes.
- **Severity:** Medium

### P8. LocalQueue 30-Second Polling Interval
- **File:** `src/components/upload/LocalQueue.tsx` (line 142)
- **Issue:** The component polls the file-backed queue every 30 seconds indefinitely while mounted. For users who leave the app open for hours, this creates unnecessary CPU/disk churn with no file-watcher or event bus.
- **Severity:** Low

### P9. CaptionDrawer Keyboard Effect Re-attached on Every Render
- **File:** `src/components/captions/CaptionDrawer.tsx` (lines 313–338)
- **Issue:** Dependency array includes `state?.syncStatus`, `handleUndo`, `handleRedo`, etc. The global `keydown` listener is torn down and re-added on every keystroke or state tick.
- **Severity:** Medium

### P10. Zustand Stores Lack Selectors
- **Files:** `useWorkbenchStore.ts`, `avatar.ts`
- **Issue:** Components subscribing to these stores receive the entire state object and re-render on any change. A component that only needs `url` still re-renders when `loading` flips.
- **Severity:** Medium

### P11. Engine Restart Heartbeat Has No In-Flight Guard
- **File:** `src/App.tsx` (lines 256–274)
- **Issue:** The `tick()` async function has no guard against overlapping execution. If `sidecar.ping()` hangs (>4s), the interval fires again, spawning concurrent pings and compounding resource exhaustion when the sidecar is already struggling.
- **Severity:** High

### P12. `withTimeout` Does Not Abort Underlying Sidecar Call
- **File:** `src/lib/sidecar.ts` (lines 160–170)
- **Issue:** When the timeout fires, `Promise.race` rejects with `SidecarTimeoutError`, but the underlying `sidecarCall` (and thus the Python process invocation) continues running in the background. For a 60s `importReadyClips` or 5-minute `ingestUrl` timeout, this leaks CPU and Python process time.
- **Severity:** High

---

## 4. Security Concerns

### S1. Path Injection → Arbitrary File Read / Copy
- **Files:** 
  - `src/components/ClipPreview.tsx` (lines 396–412, 414–448)
  - `src/components/upload/ClipReadyCard.tsx` (line 202)
  - `src/components/workbench/WindowManager.tsx` (context-menu reveal/save-copy)
- **Issue:** `revealPath` comes unchecked from `clip.vertical_path` / `cut_path` or the persisted queue JSON. A malicious project JSON or tampered queue can set `vertical_path` to e.g. `~/.ssh/id_rsa`. `openExternal(dir)` reveals the containing folder, and `copyFile(revealPath, dest)` copies attacker-chosen files to a destination the user picks via the save dialog.
- **Severity:** High

### S2. `method_probe` Passes Unvalidated Paths to `ffprobe`
- **File:** `python-sidecar/sidecar.py` (lines 133–163)
- **Issue:** No `_validate_source_path` or `_validate_imported_clip_path` call. A compromised frontend could pass `/etc/passwd`, `/dev/random`, or a symlink to sensitive files. `ffprobe` will attempt to read them.
- **Severity:** High

### S3. Reaction Download Accepts Any HTTPS Origin
- **File:** `python-sidecar/sidecar.py` (lines 1711–1758)
- **Issue:** `method_reaction_download` only checks for `https://` prefix. There is **no** domain whitelist, size limit, or content-type validation. If the frontend is tricked into passing a malicious URL, the sidecar downloads arbitrary files into `~/LiquidClips/Reaction Library/`. Combined with no size limits, this is a disk-space exhaustion vector.
- **Severity:** High

### S4. `method_save_avatar` Reads Arbitrary Filesystem Paths
- **File:** `python-sidecar/sidecar.py` (lines 197–236)
- **Issue:** No validation that `src_path` lives in an allowed root. A malicious caller can read any image file on disk and have it resized/copied to the avatar slot.
- **Severity:** Medium

### S5. `method_thumbnail_save_identity` Copies Arbitrary Files
- **File:** `python-sidecar/sidecar.py` (lines 2984–3037)
- **Issue:** User-supplied `sources` paths are expanded and copied into `~/LiquidClips/identity/`. Only existence and suffix are checked. An attacker can copy sensitive files into the identity folder, which is later read and uploaded to OpenAI as reference images.
- **Severity:** Medium

### S6. Sensitive Activity Data Persists After Sign-Out
- **File:** `src/contracts/useActivityEvents.ts` (lines 35, 59–65)
- **Issue:** `lc:activity-events:v1` stores channel link events, publish results, and payout info in localStorage. `performAtomicSignOutWipe` (`App.tsx`) does **not** clear this key. The next user on the same Mac can read the previous user's activity history.
- **Severity:** High

### S7. Tier Cache Not Cleared on Sign-Out
- **Files:** `src/lib/useTier.ts`, `src/lib/backend.ts`
- **Issue:** `TIER_CACHE_KEY = "lc:cached_tier"` and `CACHED_TIER_KEY = "junior:cached-tier:v1"` survive sign-out. A subsequent user briefly sees the previous user's tier (including admin tier) before `/sync` resolves.
- **Severity:** Medium

### S8. Clipboard Paste Accepts Arbitrary Paths
- **File:** `src/components/upload/DirectPublishQueue.tsx` (lines 196–200)
- **Issue:** `pasteFromClipboard` trusts clipboard text that ends in `.mp4`/`.mov`/`.webm`. A malicious actor could trick a user into pasting a sensitive file path (e.g., `/Users/admin/.ssh/id_rsa.mp4`) which would then be rendered via `convertFileSrc` and passed to the sidecar.
- **Severity:** Medium

### S9. Non-Atomic `project.json` Writes Risk Corruption
- **File:** `python-sidecar/project.py` (line 808)
- **Issue:** If the process crashes mid-write, `project.json` is truncated. On next load, `json.load` fails and the project is quarantined or lost. `direct_publish_queue.py` already uses temp-file + atomic rename, but `Project.save()` does not.
- **Severity:** High

### S10. Rust Navigation Filter Fails Open on Empty Origin
- **File:** `src-tauri/src/earn_panel.rs` (lines 235–242)
- **Issue:** If `embed_origin()` returns an empty string, the navigation filter allows **all** origins. The comment says it "always returns a valid URL in practice," but defensive code should fail-closed.
- **Severity:** Low

### S11. Admin Email Fallback Hardcoded in Frontend
- **File:** `src/lib/useTier.ts` (lines 85–95)
- **Issue:** `ADMIN_EMAIL_FALLBACK` contains founder email addresses in plaintext. Exposes internal accounts and creates a bypass vector if any are compromised.
- **Severity:** Low-Medium

### S12. ASS Caption Files Written Next to Imported Source Files
- **File:** `python-sidecar/stages.py` (line 1237)
- **Issue:** For imported clips, `clip_ass = Path(cut_path).with_name(Path(cut_path).stem + ".ass")` writes the subtitle file as a sibling to the user's original file (e.g., `~/Movies/myclip.ass`). This pollutes source directories, fails on read-only mounts, and risks filename collisions.
- **Severity:** Medium

### S13. `predictor.py` Phones Home to `httpbin.org`
- **File:** `python-sidecar/predictor.py` (lines 227–246)
- **Issue:** The speedtest uploads a 2 MB junk payload to `httpbin.org`, leaking the user's IP and timestamp. Fails silently behind corporate firewalls and burns bandwidth.
- **Severity:** Medium

### S14. `humanError` / `sanitize` Regexes Miss Windows Paths & JWT Fragments
- **Files:** `src/lib/sidecar.ts` (lines 44–101), `src/lib/telemetry.ts` (lines 18–29)
- **Issue:** Sanitize strips basic emails and Unix paths, but misses Windows `C:\Users\...` variants with spaces, IP addresses, JWT fragments in error strings, and query parameters containing PII.
- **Severity:** Medium

---

## 5. Recommended Fixes

### Immediate (Ship-Blocking)

| # | Fix | Files | Rationale |
|---|-----|-------|-----------|
| 1 | Replace `project.data` with `project.clips` in `method_apply_overlay` | `python-sidecar/sidecar.py` | Overlay baking is completely broken for success and error paths. |
| 2 | Serialize direct-publish queue operations behind a hydration gate | `src/components/upload/useDirectPublishQueue.ts` | Silent data loss on rapid user action during mount. |
| 3 | Sort batch removals in descending index order | `src/components/workbench/masterActions.ts` | Prevents wrong-clip deletion and silent data loss. |
| 4 | Fix 1-based vs 0-based index bug in `setClipPlatforms` | `src/components/ClipPreview.tsx` | Mutates wrong clip or crashes. |
| 5 | Add `timeout=60` to thumbnail `urlopen` calls | `python-sidecar/thumbnail_engine.py` | Prevents indefinite sidecar hangs. |
| 6 | Add cancellation tokens to `ClipPreview` RPCs | `src/components/ClipPreview.tsx` | Prevents stale saves from corrupting the current project. |

### Short-Term (Next Sprint)

| # | Fix | Files | Rationale |
|---|-----|-------|-----------|
| 7 | Validate all file paths against project scope before `ffprobe`, `copyFile`, `openExternal` | `python-sidecar/sidecar.py`, `src/components/ClipPreview.tsx`, `src/components/workbench/WindowManager.tsx` | Closes path-traversal / arbitrary-file-read vectors. |
| 8 | Add domain whitelist + size cap to reaction downloads | `python-sidecar/sidecar.py` | Prevents arbitrary file download and disk exhaustion. |
| 9 | Write `project.json` atomically (temp + rename) | `python-sidecar/project.py` | Prevents corruption on crash/kill. |
| 10 | Clear `lc:activity-events:v1` and tier caches on sign-out | `src/App.tsx`, `src/lib/useTier.ts` | Prevents cross-user data leakage. |
| 11 | Fix `browseForFile` to not discard the picked path | `src/components/cockpit/UploadPortal.tsx` | Eliminates double file-picker UX. |
| 12 | Iterate all dropped paths or warn the user | `src/App.tsx` | Prevents silent loss of multi-file drops. |
| 13 | Add a root `ErrorBoundary` | `src/App.tsx` | Prevents white-screen crashes. |
| 14 | Stream uploads via sidecar instead of `readFile` | `src/lib/backend.ts` | Prevents OOM crashes on large video uploads. |
| 15 | Cache persisted session blob in memory (not localStorage) | `src/components/workbench/useWorkbenchStore.ts` | Eliminates jank from disk I/O on every mutation. |

### Medium-Term (Polish)

| # | Fix | Files | Rationale |
|---|-----|-------|-----------|
| 16 | Add in-flight guard to engine-restart heartbeat | `src/App.tsx` | Prevents compound resource exhaustion. |
| 17 | Memoize heavy prop derivations (`selectedIdxs`) | `src/components/ResultsGrid.tsx` | Reduces unnecessary re-renders. |
| 18 | Portal popovers and add viewport overflow guard to context menus | `src/components/workbench/WindowManager.tsx`, `src/components/workbench/MasterToolbar.tsx` | Prevents UI clipping. |
| 19 | Use `threading.Lock()` for shared progress counters | `python-sidecar/stages.py` | Fixes backward-jumping progress and stuck spinners. |
| 20 | Wrap `cv2.VideoCapture` in `try/finally` | `python-sidecar/stages.py` | Prevents FD leaks on corrupt imports. |
| 21 | Replace `httpbin.org` speedtest with static defaults or own backend | `python-sidecar/predictor.py` | Removes privacy leak and firewall issue. |
| 22 | Move ASS files into project directory unconditionally | `python-sidecar/stages.py` | Keeps user source directories clean. |
| 23 | Add focus trap to onboarding overlay | `src/components/workbench/WorkbenchOnboarding.tsx` | Improves keyboard accessibility. |
| 24 | Debounce `useTier` focus re-fetch | `src/lib/useTier.ts` | Reduces network churn. |
| 25 | Improve `humanError` / `sanitize` to catch Windows paths and JWTs | `src/lib/sidecar.ts`, `src/lib/telemetry.ts` | Reduces PII leakage in logs/errors. |

---

## 6. Priority Order

### P0 — Ship Blocking (Fix This Week)
1. **C1** — `project.data` AttributeError in overlay baking (`sidecar.py`)
2. **C2** — Direct-publish queue mount race (`useDirectPublishQueue.ts`)
3. **C3** — Batch remove index shift (`masterActions.ts`)
4. **C4** — Wrong clip index in `setClipPlatforms` (`ClipPreview.tsx`)
5. **C5** — Indefinite thumbnail engine hang (`thumbnail_engine.py`)
6. **C6** — Un-cancelled RPCs on clip navigation (`ClipPreview.tsx`)

### P1 — High Impact / Security (Next Sprint)
7. **S1** — Path injection / arbitrary file read (`ClipPreview.tsx`, `WindowManager.tsx`)
8. **S2** — Unvalidated paths in `method_probe` (`sidecar.py`)
9. **S3** — Arbitrary HTTPS reaction downloads (`sidecar.py`)
10. **S6** — Activity data persists after sign-out (`useActivityEvents.ts`)
11. **S9** — Non-atomic `project.json` writes (`project.py`)
12. **P3** — `publishNow` OOM from `readFile` (`backend.ts`)
13. **U1** — UploadPortal double-picker (`UploadPortal.tsx`)
14. **U2** — Multi-file drop truncation (`App.tsx`)
15. **U3** — Missing ErrorBoundary (`App.tsx`)

### P2 — Performance & Stability
16. **P1** — App.tsx massive re-render bomb
17. **P2** — localStorage read on every workbench mutation
18. **P11** — Engine heartbeat overlap (`App.tsx`)
19. **P12** — Timeout leaks sidecar calls (`sidecar.ts`)
20. **P6** — N+1 project hydration (`sidecar.py`)

### P3 — UX Polish & Medium Security
21. **S4** — Unvalidated avatar paths (`sidecar.py`)
22. **S5** — Unvalidated identity source paths (`sidecar.py`)
23. **S7** — Tier cache not cleared on sign-out
24. **S8** — Clipboard paste accepts arbitrary paths
25. **U4–U15** — DropZone copy, context menu clipping, trim input corruption, onboarding focus, etc.
26. **P4–P10** — Memoization, polling, keyboard listener churn, Zustand selectors

### P4 — Low Priority / Tech Debt
27. **S10** — Rust navigation filter fails open
28. **S11** — Hardcoded admin emails
29. **S13** — `httpbin.org` speedtest
30. **S14** — Incomplete PII sanitization regexes
31. **U11** — Invalid Tailwind variant

---

## Appendix: Files Audited

**Frontend (Import Flow)**
- `src/components/cockpit/UploadPortal.tsx`
- `src/components/upload/useDirectPublishQueue.ts`
- `src/components/upload/DirectPublishQueue.tsx`
- `src/components/upload/ClipReadyCard.tsx`
- `src/components/upload/LocalQueue.tsx`
- `src/components/UnifiedDropZone.tsx`
- `src/components/DropZone.tsx`

**Frontend (Editing Suite)**
- `src/components/workbench/ClipEditDrawer.tsx`
- `src/components/workbench/ClipWindow.tsx`
- `src/components/workbench/WindowManager.tsx`
- `src/components/workbench/useWorkbenchStore.ts`
- `src/components/workbench/masterActions.ts`
- `src/components/workbench/persistedSession.ts`
- `src/components/workbench/types.ts`
- `src/components/workbench/MasterToolbar.tsx`
- `src/components/workbench/WorkbenchOnboarding.tsx`
- `src/components/ClipPreview.tsx`
- `src/components/captions/CaptionDrawer.tsx`
- `src/components/clips-feed/ReactionControls.tsx`
- `src/components/OverlayTemplateGallery.tsx`

**Backend / Sidecar**
- `python-sidecar/sidecar.py`
- `python-sidecar/project.py`
- `python-sidecar/stages.py`
- `python-sidecar/captions.py`
- `python-sidecar/thumbnail_engine.py`
- `python-sidecar/whisper_backend.py`
- `python-sidecar/direct_publish_queue.py`
- `python-sidecar/predictor.py`
- `python-sidecar/events.py`
- `src-tauri/src/lib.rs`
- `src-tauri/src/sidecar.rs`
- `src-tauri/src/browse.rs`
- `src-tauri/src/earn_panel.rs`

**State Management & Shared**
- `src/App.tsx`
- `src/lib/sidecar.ts`
- `src/lib/backend.ts`
- `src/lib/useTier.ts`
- `src/lib/avatar.ts`
- `src/lib/telemetry.ts`
- `src/contracts/useLibraryProject.ts`
- `src/contracts/useOnboardingStep.ts`
- `src/contracts/useActivityEvents.ts`
- `src/components/ResultsGrid.tsx`
- `src/lib/useMultiSelect.ts`
