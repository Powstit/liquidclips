# LiquidClips Desktop — Flawless Customer Journey Fix Scope
**Date:** 2026-06-09  
**Constraint:** No new features. Only fixes, removals, and polish.  
**Goal:** Every step of the customer journey works exactly as promised, with zero dead ends, zero confusion, and zero broken interactions.

---

## Executive Summary

This scope is organized as a **customer journey map**, not a bug list. Each section represents a stage in the user's path: from first launch → onboarding → import → editing → publishing → earn → account management. For each stage, we define the **ideal experience**, the **current reality**, and the **exact fixes** required.

### Fix Count by Journey Stage

| Stage | P0 (Ship-Blocker) | P1 (Major Friction) | P2 (Polish) | Dead Code to Remove |
|-------|-------------------|---------------------|-------------|---------------------|
| 1. First Launch | 1 | 3 | 2 | 3 files |
| 2. Onboarding / Auth | 0 | 5 | 3 | 0 |
| 3. Import / Upload | 2 | 3 | 2 | 4 files |
| 4. Pipeline / Processing | 1 | 4 | 3 | 0 |
| 5. Results / Grid | 1 | 5 | 2 | 3 files |
| 6. Editing / ClipPreview | 2 | 4 | 3 | 7 files |
| 7. Thumbnails | 0 | 1 | 3 | 0 |
| 8. Publishing | 1 | 4 | 2 | 0 |
| 9. Earn / Bounties | 0 | 4 | 2 | 1 file |
| 10. Navigation / Settings | 0 | 5 | 3 | 5 files |
| 11. Errors / Recovery | 3 | 3 | 2 | 2 files |
| **TOTALS** | **11** | **45** | **27** | **25 files + 6 deps** |

---

## Phase 0: Foundation — Remove Dead Architecture

**Before touching any user-facing fixes, remove the dead code that confuses the codebase and creates false expectations.**

### 0.1 Delete the Dead Workbench
The entire `workbench/` directory is orphaned. `WindowManager`, `useWorkbenchStore`, `MasterToolbar`, `ClipEditDrawer`, `ClipWindow`, `MasterActionToast`, `AccountBindingChip`, `windowBindings.ts`, `persistedSession.ts`, and `types.ts` are 1,200+ lines of code that **nothing mounts**. They create:
- False confidence that a tile-based editor exists
- Import conflicts and stale type references
- Maintenance drag (e.g., `ClipEditDrawer` has retry timers that leak on unmount)

**Action:** Delete `src/components/workbench/` entirely. Remove imports from `ResultsGrid.tsx` and any other file that references it.

### 0.2 Delete Dead shadcn/ui Primitives
These files are imported nowhere:
- `src/components/ui/button.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/sonner.tsx`
- `src/components/ui/toggle-group.tsx`

**Action:** Delete files. Remove `sonner`, `class-variance-authority`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-separator`, `@radix-ui/react-toggle-group` from `package.json`.

### 0.3 Delete Dead Components & Utilities
- `src/components/SidecarCrashOverlay.tsx` — never mounted
- `src/components/GlobalToastHost.tsx` — never mounted; toast bus is unused
- `src/components/earn/MinecraftChallengeCard.tsx` — import commented out
- `src/components/payouts/MoneySourceCard.tsx` — zero imports
- `src/components/workspace/LiquidLiftBanner.tsx` — zero imports
- `src/lib/applyLayoutBulk.ts` — zero imports
- `src/tauri-web-shims/*` — 7 files, zero imports
- `src/_backups/` — 740 KB of auto-junk

### 0.4 Delete Abandoned Toolbar Patterns
- `src/components/clips-feed/ClipsBulkToolbar.tsx` — superseded by BottomCockpit
- `src/components/AyrshareConnectionPanel.tsx` — Settings → Connections was supposed to be deleted per Sprint 5 spec

**Estimated reduction:** ~800 KB source, 25 files, 6 npm dependencies.

---

## Phase 1: First Launch — Don't Punish the User for Opening the App

### Journey Step 1.1: Splash / Intro Cinematic

**Ideal:** First-time users see the brand moment once. Returning users land on the app in <2s. Skip is always obvious.

**Current Reality:**
- Intro video plays on **every cold launch** (`sessionStorage` wipes on process exit)
- 28.5s video + 5s loading hold + 8s game hold = **~42s before the app is usable**
- Skip button is a thin `→` arrow with no text label
- Touch users cannot start the Invaders game (only `<kbd>space</kbd>` shown)

**Fixes:**
1. **Move intro gate to `localStorage`** (`src/lib/intro.ts:14`). Write `lc:intro-seen:v1` to localStorage, not sessionStorage. Delete the aggressive localStorage purge on read.
2. **Add a visible "Skip intro" text label** next to the arrow on `Splash.tsx:142`.
3. **Add tap/click-to-start on Invaders canvas** (`src/components/invaders/SplashGame.tsx:158`). A canvas click should trigger the same `startGame()` as Space.
4. **Reduce `MIN_HOLD_MS` from 8s to 3s** on M-series Macs. If `navigator.hardwareConcurrency >= 8`, use 3s; otherwise 8s.
5. **Clarify skip button behavior** — one consistent action: "Skip to app". If clicked during loading, advance straight to app (not game).

### Journey Step 1.2: First-Run Auth / Onboarding

**Ideal:** One coherent first-run surface. Sign-in comes first. OpenAI key is clearly optional for paid tiers. Tour is contextual.

**Current Reality:**
- Three onboarding layers: `OnboardingOverlay` (4-card carousel) → `StudioTour` (spotlight) → `FirstRun` (full-bleed 2-card)
- `FirstRun` asks for **OpenAI key BEFORE sign-in**
- `StudioTour` step 2 spotlights the **Library nav button** but describes the clips grid (which the user cannot see yet)
- OpenAI key validation rejects Azure/project keys (`!key.startsWith("sk-")`)

**Fixes:**
1. **Consolidate to one linear funnel**:
   - If no JWT + no onboarded flag → `OnboardingOverlay` (auth focus)
   - After auth → `StudioTour` (nav rail only, 3 steps max)
   - Skip `FirstRun` entirely for users who complete onboarding overlay
2. **Reorder cards:** Card 1 = Sign in. Card 2 = OpenAI key (with "Optional — only if you want to use your own key" badge for Pro/Agency users).
3. **Fix OpenAI key validation** (`src/components/FirstRun.tsx:54`): Accept `sk-`, `sk-proj-`, and Azure key patterns. Error copy: "That doesn't look like a valid API key."
4. **Fix StudioTour step 2** (`src/components/onboarding/StudioTour.tsx:52`): Spotlight the **Workstation** nav item (or the Create tile) instead of Library. Copy: "Drop a video here to start creating clips."
5. **Remove `OnboardingOverlay` / `StudioTour` / `FirstRun` overlap guard fragility** (`App.tsx:1961-1989`): Replace boolean soup with explicit state machine:
   ```
   onboardingPhase: "none" | "auth" | "tour" | "complete"
   ```

---

## Phase 2: Import — The Front Door Must Not Jam

### Journey Step 2.1: Empty State / WorkstationRoom

**Ideal:** Four clear CTAs. Every tile does exactly what it promises. No "soon" pills on the primary surface.

**Current Reality:**
- "Thumbnails" tile opens a branding survey, not a cover pack
- "Script" tile opens UploadPortal in transcript mode, but the user wanted a local file transcript
- "Thumbnails" and "Script" show `"soon"` pills but are tappable
- Drag overlay says "MP4 · MOV · MKV · WEBM" but audio files pass validation
- `.hevc` allowed in file picker but rejected in drag-drop

**Fixes:**
1. **Replace Thumbnails + Script tiles with a single "More tools" teaser** (`WorkstationRoom.tsx:127-146`). Remove the disabled promise tiles. A single card: "Thumbnail studio & transcript mode — coming in v0.8" with a "Notify me" email capture (or just hide them).
2. **Align drag overlay text with validation whitelist** (`App.tsx:683`, `WorkstationRoom.tsx:220`): If audio is supported, show "MP4 · MOV · MKV · WEBM · MP3 · WAV". If not, remove audio from whitelist.
3. **Add `.hevc` to drag-drop whitelist** OR remove it from the file picker filter. Be consistent.

### Journey Step 2.2: UploadPortal / Browse / URL Paste

**Ideal:** One click = file picked = pipeline starts. URL paste validates clearly. Drag respects intent.

**Current Reality:**
- **P0 CRITICAL:** `browseForFile()` calls `openFileDialog()`, receives path, then **discards it** and calls `onPickFile("")` which opens a **second** file picker
- Drag-drop while Script-mode portal is open routes to **clips pipeline**, ignoring Script intent
- URL allowlist rejects private links with "unsupported URL" instead of "private / login-walled"

**Fixes:**
1. **Fix the double-picker** (`UploadPortal.tsx:166-185`):
   ```tsx
   async function browseForFile() {
     if (isScript) { setError("Script mode is URL only."); return; }
     const picked = await openFileDialog({ multiple: false, filters: [...] });
     if (typeof picked === "string") {
       onPickFile(picked); // <-- pass the actual path, not ""
       onClose();
     }
   }
   ```
2. **Check `uploadPortal.intent` on drag-drop** (`App.tsx:677-679`): If intent is `"script"`, route to transcript pipeline, not clips.
3. **Improve URL rejection copy** (`UploadPortal.tsx:146-155`): Detect `drive.google.com`, `dropbox.com`, `icloud.com` and show: "This link is private or login-walled. Download the file first, then drop it here."

### Journey Step 2.3: Drag-Drop from OS

**Ideal:** Multi-file drops queue all files. Single drops start immediately. Rejected files explain why.

**Current Reality:**
- `const path = event.payload?.paths?.[0]` — **only first file processed**, rest silently lost
- No warning for multi-file drops

**Fixes:**
1. **Iterate all dropped paths** (`App.tsx:670`):
   ```tsx
   const paths = event.payload?.paths ?? [];
   if (paths.length === 0) return;
   if (paths.length === 1) {
     // existing single-file flow
   } else {
     // queue all to direct-publish queue or show: "N files dropped. Processing first. Queue the rest?"
   }
   ```
2. **Toast on multi-file drop**: "5 files dropped — importing the first one. Add the rest to your queue? [Add all] [Dismiss]"

---

## Phase 3: Pipeline — Don't Strand the User in Limbo

### Journey Step 3.1: Download / Transcribe / Lift Progress

**Ideal:** Honest ETA. Clear cancel affordance. Timeout with recovery. Stall detection.

**Current Reality:**
- ETA is tuned for Intel (`STAGE_SPEED.transcribe = 5×`) but Apple Silicon runs ~30-60× — shows "2m" for a 15s job
- No frontend timeout on `runStage` — hung Python process strands user forever
- JuniorLoader (download) has **no stall detection** — can sit at 0% indefinitely
- Cancel flow uses **three competing mechanisms** (`.cancel` file, `.lift_cancel` file, `cancelRequestedRef`) with no user-visible explanation
- Background thumbnail stage **fails silently** — no error surface

**Fixes:**
1. **Detect Apple Silicon and adjust ETA** (`WorkingStage.tsx:30`):
   ```tsx
   const isAppleSilicon = navigator.userAgent.includes("Mac") && navigator.hardwareConcurrency >= 8;
   const speedMultiplier = isAppleSilicon ? 40 : STAGE_SPEED[stage];
   ```
2. **Add 10-minute frontend timeout** on `runStage` (`App.tsx:863-888`):
   ```tsx
   const result = await Promise.race([
     sidecar.runStage(...),
     new Promise((_, reject) => setTimeout(() => reject(new Error("Stage timed out after 10 minutes. Try again or check your source.")), 600_000))
   ]);
   ```
3. **Add stall detection to JuniorLoader** (`JuniorLoader.tsx`): If bytes downloaded hasn't changed in 60s, show: "Download seems stuck — [Retry] or [Cancel]"
4. **Simplify cancel to one mechanism** (`App.tsx:280-290`, `844-858`): Use only `cancelRequestedRef` + `.cancel` file. Remove `.lift_cancel` path. Show one clear "Cancel" button that writes the marker and waits.
5. **Surface thumbnail failures** (`App.tsx:948-957`): If thumbs fail, toast: "Thumbnails didn't generate — clips are ready, but you can retry from the clip editor."

### Journey Step 3.2: Pipeline Failure / Retry

**Ideal:** Clear failure reason. Retry preserves original intent. No raw stack traces.

**Current Reality:**
- `lift-failed` retry routes to **clips pipeline**, not transcript mode (`App.tsx:1525`)
- `FailureCard` renders raw Python tracebacks in `<pre>` if `humanError()` doesn't match
- `humanError()` references "Settings → Diagnose" which **does not exist**

**Fixes:**
1. **Fix `lift-failed` retry intent** (`App.tsx:1518-1529`): Store `originalIntent` on the `lift-failed` view. Retry with `runPipelineFromUrl(view.url, "", view.originalIntent)`.
2. **Cap `<pre>` output at 5 lines** (`FailureCard.tsx:86-92`): If raw error exceeds 5 lines, truncate and add "[Show full error]" disclosure.
3. **Remove "Settings → Diagnose"** (`sidecar.ts:57-58`): Replace with "Restart Liquid Clips, or contact support if this keeps happening."

---

## Phase 4: Results Grid — Don't Hide the User's Work

### Journey Step 4.1: Grid Display / Upgrade Gating

**Ideal:** The user sees exactly what the AI produced. Upgrade nudges are honest and contextual.

**Current Reality:**
- Header says "10 clips ready" but grid shows only 3 (free tier). The other 7 are replaced by `UpgradeLockCard`
- `UpgradeLockCard` says "continue clipping" to **view** already-produced clips — misleading framing
- Pricing is inconsistent: Quota wall says "$99.99 Growth"; UpgradeLockCard says "$29.99/mo"; `TIER_COPY` says "$79.99 Pro"
- `AddClipCard` is **completely hidden** for free users
- Grid has **no zero-clip empty state** — blank area below header

**Fixes:**
1. **Fix header count** (`ResultsGrid.tsx:286-338`): Show `"3 of 10 clips visible"` for free users, or `"10 clips ready"` with a subtle `"Free shows the first 3 — upgrade to see all"` subline.
2. **Fix UpgradeLockCard copy** (`UpgradeLockCard.tsx:34-40`): Change from "continue clipping with Solo" to `"View all 10 clips — upgrade to Solo"`.
3. **Unify pricing source** (`src/App.tsx:1573-1645`, `UpgradeLockCard.tsx`, `useTier.ts`): Create a single `TIER_PRICING` object consumed by all surfaces. Prices: Free / Solo $29.99 / Pro $79.99 / Agency $149.
4. **Show AddClipCard for free users** (`ResultsGrid.tsx:330-335`): Render it with an upgrade tooltip on hover: "Add clips — upgrade to unlock"
5. **Add zero-clip empty state** (`ResultsGrid.tsx:252-341`):
   ```
   "No clips found. The source may be too short, or the AI didn't find standout moments.
   [Try a different video] [Adjust settings]"
   ```

### Journey Step 4.2: Per-Card Actions / BottomCockpit

**Ideal:** Every clip card shows quick actions on hover. The bottom cockpit is a backup, not the only path.

**Current Reality:**
- **All ClipCard action buttons are `className="hidden"`** — entire row (Caption, Reaction, Copy, Editor) is CSS-hidden
- User must: click card → look at BottomCockpit → hunt for action
- "Drop another" silently discards the current project with no confirmation

**Fixes:**
1. **Un-hide or remove the action row** (`ClipCard.tsx:524-645`): Either:
   - **Option A (recommended):** Remove `hidden` class. Show Caption, Reaction, Copy, Editor → on hover.
   - **Option B:** Delete the hidden DOM entirely. Accept that BottomCockpit is the primary action surface.
2. **Add dirty-state guard on "Drop another"** (`ResultsGrid.tsx:195-210`): If project has unsaved edits or queued schedules, show: "You'll leave this project — save your progress first? [Stay] [Leave]"

---

## Phase 5: Editing — Don't Lose the User's Work

### Journey Step 5.1: ClipPreview Modal

**Ideal:** Open modal → edit metadata → changes are safe → close saves or warns. Trim is validated. Schedule respects platform choice.

**Current Reality:**
- **Metadata edits do NOT auto-save** — pressing Esc discards title/description/pin edits instantly
- `regenerate` bounds-check doesn't validate against source duration — user can type `start: 9999`
- Schedule popover **hardcodes platform to "youtube"** regardless of user intent
- `setClipPlatforms` uses **1-based index** instead of 0-based — mutates wrong clip

**Fixes:**
1. **Add dirty-state guard on close** (`ClipPreview.tsx:148-171`):
   ```tsx
   const isDirty = titleDraft !== clip.title || descDraft !== clip.description || pinDraft !== clip.pin;
   function handleClose() {
     if (isDirty && !captionsOpen) {
       showConfirm({
         title: "Unsaved changes",
         body: "Your title and description edits will be lost.",
         confirm: "Discard",
         cancel: "Keep editing"
       });
       return;
     }
     onClose();
   }
   ```
2. **Clamp trim inputs to source duration** (`ClipPreview.tsx:317-336`):
   ```tsx
   const maxStart = Math.max(0, (clip.source_duration_seconds || clip.duration_seconds || 0) - 30);
   const minEnd = Math.min(trimStart + 30, clip.source_duration_seconds || Infinity);
   ```
3. **Fix schedule platform hardcode** (`ClipPreview.tsx:393`): Use the first selected platform from `clip.platforms`, or show a platform picker in the schedule popover.
4. **Fix `setClipPlatforms` index** (`ClipPreview.tsx:818`): Change `sidecar.setClipPlatforms(slug, index, next)` to `sidecar.setClipPlatforms(slug, index - 1, next)`.

### Journey Step 5.2: Caption Drawer

**Ideal:** Captions load reliably. Edit is responsive. Undo/redo works. History doesn't crash on null state.

**Current Reality:**
- `mutate` asserts non-null `state!` without guard — crashes if callback fires before initial load
- Keyboard effect re-attaches on every render — burns CPU
- `autoFixToast` timeout leaks on unmount
- React key collision in `WordPaintStrip` (`${i}-${w.text}`) if word repeats

**Fixes:**
1. **Guard `mutate` against null state** (`CaptionDrawer.tsx:168`):
   ```tsx
   if (!state) return;
   history.current.push(state);
   ```
2. **Stabilize keyboard effect deps** (`CaptionDrawer.tsx:313-338`): Wrap handlers in `useCallback` with stable deps. Use a ref for the keyboard map so the effect only re-registers when `state` changes.
3. **Clean up `autoFixToast` timeout** (`CaptionDrawer.tsx:133-134`): Store timer ID in ref, clear in cleanup.
4. **Fix React key** (`CaptionDrawer.tsx:983`): Use `${i}-${w.text}-${w.start}` instead of `${i}-${w.text}`.

---

## Phase 6: Thumbnails — Don't Gate Without Explanation

### Journey Step 6.1: ThumbnailStudio

**Ideal:** Pro users see AI thumbnails. Cover pack shows actionable next steps. Gallery errors surface.

**Current Reality:**
- AI generation is **Agency-only** but marketing implies Pro gets "hosted AI"
- Cover pack empty state: "No cover frames yet..." with no CTA
- Gallery refresh swallows all errors silently (`catch { setThumbnails([]) }`)
- Identity wizard accepts any 3+ images with no quality guidance

**Fixes:**
1. **Align AI thumbnail tier with marketing** (`ThumbnailStudio.tsx:78`): Either:
   - Lower gate to Pro (recommended — "hosted AI" should include thumbnails)
   - OR update marketing copy to explicitly say "AI thumbnails are Agency-only"
2. **Add CTA to cover pack empty state** (`ThumbnailStudio.tsx:640-648`): "No cover frames yet. [Generate from this clip]" (triggers reframe if not done).
3. **Surface gallery errors** (`ThumbnailStudio.tsx:114-122`):
   ```tsx
   catch (e) {
     setThumbnails([]);
     setError("Couldn't load thumbnails — " + humanError(e));
   }
   ```
4. **Add image quality hints** to identity wizard: "Tip: Use clear, well-lit photos of your face. Blurry images produce poor results."

---

## Phase 7: Publishing — Don't Throw Exceptions at Users

### Journey Step 7.1: PublishModal

**Ideal:** All linked platforms are schedulable. Partial failures are clear. Results are copyable. Timezones are explicit.

**Current Reality:**
- **Instagram scheduling `throw new Error("Scheduling to Instagram is coming next sprint.")`**
- Publish result toasts have no severity indicator (success vs partial vs total failure look the same)
- Unknown platform tiles fall back to **Instagram icon**
- Schedule "tomorrow 9am" converts to UTC without telling the user

**Fixes:**
1. **Disable Instagram scheduling instead of throwing** (`PublishModal.tsx:295-296`):
   ```tsx
   // Replace throw with disabled state:
   <PlatformTile
     platform="instagram"
     disabled
     disabledReason="Scheduling coming in v0.8"
   />
   ```
2. **Color-code publish results** (`PublishModal.tsx:662-671`):
   - All success → green check
   - Partial failure → amber warning with per-platform breakdown
   - All failure → red X with retry CTA
3. **Fix platform fallback icon** (`PublishModal.tsx:511-512`): Use a generic `Globe` icon for unknown platforms, not Instagram.
4. **Show timezone in schedule UI** (`PublishModal.tsx:406-418`): Append user's local timezone: "Scheduled for Tue 9:00 AM (PST)"

### Journey Step 7.2: Channel Picker / Connection Status

**Ideal:** One source of truth for channel health. Red dot means broken. Green dot means ready.

**Current Reality:**
- ChannelPicker overrides DB "error" status with Ayrshare "active" — user sees red in Settings but green in Publish

**Fixes:**
1. **Align channel status** (`ChannelPicker.tsx:75-122`): Show the **worst** of DB + Ayrshare status. If DB says "error", render as error with tooltip: "Reconnect in Settings → Channels."

---

## Phase 8: Earn / Bounties — Close the Loop

### Journey Step 8.1: Earn Tab

**Ideal:** One consistent Earn surface. Native or webview, not both.

**Current Reality:**
- "Discover" = native panel. "All bounties" = hosted webview.
- Switching tabs causes flash + layout shift (native panel can't be hidden behind DOM)

**Fixes:**
1. **Consolidate to one primary tab** (`EarnTab.tsx:46-80`): Remove "Discover" sub-tab. Make "All bounties" the default and only tab. Native panel can be a floating CTA ("Quick bounties") if needed.

### Journey Step 8.2: BountyWorkspaceHeader

**Ideal:** Next step is a button, not a hint.

**Current Reality:**
- "next step: polish a clip first" — no button, no link

**Fixes:**
1. **Make next step actionable** (`BountyWorkspaceHeader.tsx:48-53`):
   - "generate" → "[Generate clips]" button
   - "polish a clip first" → "[Open editor]" button
   - "submit" → "[Copy submission links]" button

### Journey Step 8.3: Submission Portal

**Ideal:** User picks campaign. Submission success offers next action.

**Current Reality:**
- `setCampaign(campaigns[0])` — **always submits to first campaign**, no selector
- `readyClips` counts clips with `cut_path` as ready (not vertical 9:16)
- Success is a dead end — single "Done" button, no "Submit another"

**Fixes:**
1. **Add campaign selector** (`SubmissionPortal.tsx:73-76`): Dropdown if `campaigns.length > 1`.
2. **Fix ready check** (`BountySubmissionCapture.tsx:152-157`): Filter on `c.vertical_path` only (9:16 render required for Whop).
3. **Add "Submit another" CTA** (`SubmissionPortal.tsx:420-448`): After success, show "[Submit another clip] [Close]"

---

## Phase 9: Navigation / Settings — Don't Break the Map

### Journey Step 9.1: SideNav + View Switching

**Ideal:** Nav reflects the current page. Clicking a nav item always works.

**Current Reality:**
- Settings is a **modal**, but SideNav shows it as an "active" tab. Clicking Workspace while Settings is open doesn't close Settings — just changes highlight.
- Community click launches **TWO surfaces** simultaneously (native feed + webview chat)
- Banner stacking can push workspace off-screen

**Fixes:**
1. **Close Settings on nav switch** (`App.tsx:1231-1232`): In `handleNavClick`, if `settingsOpen`, call `setSettingsOpen(false)` before switching view.
2. **Consolidate Community to one surface** (`App.tsx:1257-1258`): Remove native `CommunityTab`. Make Community = webview only. The native feed is hardcoded stale content anyway.
3. **Cap banners at 2 visible** (`App.tsx:1764-1860`): If >2 banners would render, show the highest priority + a "+N more" pill that expands on click.

### Journey Step 9.2: Settings Modal

**Ideal:** Settings is a navigable page, not a modal. Every section works.

**Current Reality:**
- Settings is a 2,009-line modal sheet
- "Connections" category was supposed to be **deleted** per Sprint 5 spec — still present
- Watermark toggle is dead UI ("coming soon")
- Notifications section is "Coming soon."
- Clicking "manage channels" yanks user out of Settings to Schedule view
- Settings tier prop flashes "Free" on every cold boot for paid users

**Fixes:**
1. **Delete Settings → Connections** (`Settings.tsx:70,89,571-573`): Per `LAUNCH.md` Sprint 5, remove category, `AyrshareConnectionPanel`, and all connection UI.
2. **Delete Watermark toggle row** (`Settings.tsx:669-682`): Remove until burn-in pipeline is wired.
3. **Hide Notifications section** (`Settings.tsx:542-547`): Collapse or remove until implemented.
4. **Open channel management in a sub-panel** instead of yanking to Schedule: Replace "manage channels" link with an inline ChannelList that has reconnect buttons.
5. **Fix tier flash** (`useTier.ts:97-108`): Default to `null` (shows spinner) instead of `"free"` while loading. Only show "Free" after `/sync` confirms.

---

## Phase 10: Errors & Recovery — Don't Lie to Users

### Journey Step 10.1: Sidecar Crash

**Ideal:** Crash is obvious. Recovery is one click. "Try to continue" only works if the engine is alive.

**Current Reality:**
- `SidecarCrashOverlay` has a **"Try to continue"** button that dismisses the modal even though the sidecar is dead
- Restart cap is 1 — after one failed respawn, user MUST manually relaunch

**Fixes:**
1. **Remove "Try to continue"** (`SidecarCrashOverlay.tsx:223`): Only show "Restart Liquid Clips". Dead sidecar = 100% feature loss; pretending otherwise is cruel.
2. **Increase restart cap to 3** (`src-tauri/src/sidecar.rs:39`): With exponential backoff (1s, 3s, 5s). Some crashes are transient (OOM during large import).

### Journey Step 10.2: Deps Missing

**Ideal:** Auto-fix or safe instructions.

**Current Reality:**
- Remediation card shows `pip install --break-system-packages` — dangerous advice

**Fixes:**
1. **Replace with safe instructions** (`App.tsx:2283-2326`):
   - Detect if using Homebrew Python: suggest `brew install python` + `pip install ...`
   - Detect system Python: suggest creating a venv instead of `--break-system-packages`
   - Add "Copy command" button

### Journey Step 10.3: Data Loss Prevention

**Ideal:** Writes are atomic. Quota failures are surfaced. Projects survive crashes.

**Current Reality:**
- `project.json` written **non-atomically** — crash mid-write = corrupted project
- `localStorage` quota exceeded in workbench persistence → **swallowed silently**
- `avatar.png` deletion on sign-out is fire-and-forget (may fail)

**Fixes:**
1. **Atomic `project.json` writes** (`python-sidecar/project.py:808`):
   ```python
   tmp = self.root / "project.json.tmp"
   with tmp.open("w", encoding="utf-8") as f:
       json.dump(data, f, indent=2)
   tmp.replace(self.root / "project.json")
   ```
2. **Surface localStorage quota errors** (`persistedSession.ts:61`):
   ```tsx
   catch (e) {
     if (e instanceof DOMException && e.name === "QuotaExceededError") {
       window.dispatchEvent(new CustomEvent("lc:toast", { detail: { message: "Storage full — workbench layout won't save. Free up disk space.", type: "warn" } }));
     }
   }
   ```
3. **Await avatar deletion on sign-out** (`App.tsx:2162`): Change `clearAvatar().catch(() => undefined)` to awaited with timeout.

---

## Implementation Order

### Sprint A: Foundation (Week 1)
1. Delete dead workbench directory
2. Delete dead shadcn/ui primitives + unused deps
3. Delete dead components (`SidecarCrashOverlay`, `GlobalToastHost`, etc.)
4. Delete `src/_backups/` and `src/tauri-web-shims/`
5. Delete Settings → Connections per Sprint 5 spec
6. Atomic `project.json` writes

### Sprint B: Front Door (Week 2)
1. Fix UploadPortal double-picker (P0)
2. Fix multi-file drop truncation
3. Align drag-drop whitelist with overlay text
4. Fix drag intent check (Script vs Clips)
5. Reorder FirstRun cards (sign-in first)
6. Fix OpenAI key validation
7. Move intro gate to localStorage
8. Add tap-to-start on Invaders

### Sprint C: Pipeline & Grid (Week 3)
1. Add 10m timeout to `runStage`
2. Fix ETA for Apple Silicon
3. Add stall detection to JuniorLoader
4. Fix `lift-failed` retry intent
5. Fix header count / UpgradeLockCard copy
6. Unify pricing source
7. Add zero-clip empty state
8. Un-hide or kill ClipCard action row

### Sprint D: Editing & Publishing (Week 4)
1. Add dirty-state guard to ClipPreview
2. Clamp trim inputs to source duration
3. Fix `setClipPlatforms` index bug
4. Fix schedule platform hardcode
5. Guard CaptionDrawer `mutate` against null
6. Disable Instagram scheduling (don't throw)
7. Color-code publish results
8. Fix channel status alignment

### Sprint E: Earn & Navigation (Week 5)
1. Consolidate Earn to one tab
2. Make BountyWorkspaceHeader next steps actionable
3. Add campaign selector to SubmissionPortal
4. Fix ready check for bounty submission
5. Add "Submit another" CTA
6. Close Settings on nav switch
7. Consolidate Community to webview only
8. Cap banner stacking

### Sprint F: Polish & Recovery (Week 6)
1. Remove "Try to continue" from crash overlay
2. Increase restart cap to 3
3. Replace `--break-system-packages` advice
4. Surface localStorage quota errors
5. Fix Settings tier flash
6. Hide dead Settings sections (Watermark, Notifications)
7. Add timezone to schedule UI
8. Fix platform fallback icon

---

## Success Criteria

A "flawless" customer journey means:

1. **First launch → usable app in <5s** for returning users
2. **Import → first clip visible in <3 clicks** with zero double-pickers
3. **Pipeline → clear, honest progress** with timeout recovery
4. **Grid → user sees their work** with honest upgrade nudges
5. **Editing → user's changes are safe** with dirty-state guards
6. **Publishing → every linked platform works or is honestly disabled**
7. **Earn → one surface, closed loop** from bounty discovery to submission
8. **Errors → one clear recovery path** with no dead ends or false promises
9. **Navigation → nav reflects reality** with no modal/tab confusion
10. **Data → atomic writes, surfaced failures** with no silent data loss

---

*This scope contains zero new features. Every item is a fix, removal, or polish of existing functionality.*
