# Locked User Flows

> Forensic-lock discipline for core features.
>
> A flow is only LOCKED after Daniel confirms it works in the installed/live app.
> Future patches must not touch or regress locked flows unless explicitly approved.
>
> No broad patching. No "should work" acceptance. No final build unless locked-flow regression risk is understood.

---

## 1. Feature forensic process

For each core flow:

1. **Locate last real evidence it worked:**
   * generated output file
   * export file
   * app log
   * install/build timestamp
   * git commit/checkpoint
   * user-confirmed live test
   * screenshot/video proof if available

2. **Map evidence to:**
   * app version
   * commit hash or nearest commit
   * source file state
   * build/install timestamp

3. **Compare current source against last working state.**

4. **Patch only the broken path.**

5. **Daniel live-tests the installed/dev app.**

6. **If Daniel confirms it works, mark the flow LOCKED.**

7. **Every future lane must report:**
   * locked flows touched: yes/no
   * candidate flows touched: yes/no
   * regression risk
   * how it was validated

---

## 2. Lock rules

* A flow is only **LOCKED** after Daniel confirms it works in the installed/live app.
* Compiler validation is not product validation.
* Agents cannot mark flows locked by code-reading alone.
* Any future patch touching a locked flow must say so before editing.
* If a locked flow breaks, stop all other lanes and fix that regression first.
* Every lane report must include: **"Locked flows touched: yes/no."**
* Locked flows are not architecture suggestions; they are end-to-end user paths that are known-good and must stay intact.
* A candidate flow with no live-confirmation evidence stays `WAITING` or `BROKEN`.

---

## 3. Current locked flows

> No flows are locked yet. All candidate flows below are waiting for Daniel confirmation.

---

## 4. Candidate flows waiting for confirmation

### FLOW 001 — URL → Clips generation

**Steps:**

1. Studio Home
2. Click Create
3. Paste YouTube URL
4. Choose Clips / "Clip it for shorts"
5. Pipeline starts
6. ResultsGrid shows generated clips

**Expected:**

* URL is treated as source input.
* Browser panel does not open.
* YouTube webview does not open.
* `runPipelineFromUrl` is used.
* Clips appear.

**Evidence located:**

| Field | Value |
|---|---|
| Last successful project | `i-tried-the-uber-for-private-jets-yq8ca2-y4fq` |
| Output path | `/Users/dipdip/LiquidClips/projects/i-tried-the-uber-for-private-jets-yq8ca2-y4fq/` |
| Inbox source file | `/Users/dipdip/LiquidClips/inbox/I tried the ＂UBER＂ for PRIVATE JETS! [Yq8CA2-y4FQ].mp4` |
| Created at | 2026-06-14 19:56:01 BST (`created_at`: 1781128081.670358) |
| Pipeline completed | Yes — all stages `done` (ingest → audio → transcribe → llm → cut → reframe → thumbs) |
| Clips generated | 5 clips in `/clips/` |
| Metrics completed | `.metrics.json` ends at `1781128292` matching thumbs stage |
| Nearest commit | `704935b` — `fix(auth): remove passive sidecar keychain reads from Earn and Settings` |
| App version | `0.7.64` |
| Source state at last success | `runPipelineFromUrl` → `sidecar.startIngestUrl`; `guardQuota` checked JWT + OpenAI key but had no `remainingExports === 0` block; `WorkstationRoom` still used direct Create/Import tiles (pre-StudioHome pivot) |

**Earlier corroborating evidence:**
| Field | Value |
|---|---|
| Project | `n3on-meets-the-youngest-billionaire-ever-sc8a6lk9kgy` |
| Created at | 2026-06-11 00:22:10 BST |
| Nearest commit | `84f0ff8` — `fix(App): mount GlobalToastHost` |
| App version | `0.7.47` |

**Comparison against current broken state (v0.7.78 uncommitted):**

| Area | v0.7.64 (last known good) | v0.7.78 (current) |
|---|---|---|
| Entry surface | `WorkstationRoom` Create/Import tiles | `StudioHome` four-tile grid |
| Quota guard | JWT + OpenAI key only | JWT + OpenAI key + `remainingExports === 0` hard block |
| `remainingExports` state | write-only | read + passed to `StudioHome` / `UploadPortal` |
| URL handler wiring | `onCreate={() => setUploadPortal({ open: true, intent: "clips" })}` | same handler shape, but now inside `StudioHome` via `WorkstationRoom` |
| Pipeline call | `sidecar.startIngestUrl` | `sidecar.startIngestUrl` (unchanged) |
| Browse panel state | independent of `view` | independent of `view` (unchanged) |

**Hypothesis:** The clips pipeline itself is still wired correctly. The visible YouTube/browser panel is most likely an already-open Browse Rewards panel that persists while the flow runs. The v0.7.78 StudioHome pivot and quota-guard changes are the main deltas, but neither directly opens a browser.

**Fix applied (v0.7.78):** `App.tsx onCreate` now calls `closeBrowsePanel()` before opening `UploadPortal`. This removes the squeeze distraction and ensures a stale Earn/Community/BrowserEdgeTab panel cannot confuse the Create flow. Earn and Community surfaces are unaffected — they can still open the panel normally.

**Live retest result:** Daniel reports Create → paste URL / create clip still does not reliably start clip generation.

**P0 patch #2 (this lane):** Removed the client-side `remainingExports === 0` hard block in `App.tsx guardQuota`. The block was reading React state that can be stale (set once at boot / after exports) and walling users before the authoritative server check. Quota enforcement now falls through to `maybeCheckQuota()` → `/usage/video-started`, which raises the quota wall only when the backend actually returns a 402. This restores the v0.7.64 gate behavior while keeping the Studio Home / UploadPortal quota display honest.

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 002 — Finder file drop → Clips

**Steps:**

1. Drag a supported video/audio file into the app window.
2. Drop overlay appears.
3. Drop the file.
4. Intent picker opens.
5. Choose Clips / "Clip it for shorts".
6. Pipeline starts and clips are generated.

**Expected:**

* Drag is recognized by the native Tauri drag listener.
* Drop overlay renders correctly.
* File is accepted.
* Intent picker opens with the file as the source.
* Clips pipeline can start.

**Evidence located:**

| Field | Value |
|---|---|
| Last working project | `background-idle-pack` |
| App version | `0.7.64` |
| Nearest commit | `704935b` — `fix(auth): remove passive sidecar keychain reads from Earn and Settings` |
| Broken delta found | None |

**Status:** `AUDITED / NO PATCH NEEDED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 003 — LibraryClipStrip → ProjectCard

**Steps:**

1. Open Projects.
2. Find the "from library" strip (LibraryClipStrip).
3. Drag a clip from the strip onto a ProjectCard.
4. Card updates to show the attached clip.

**Expected:**

* Drag starts from LibraryClipStrip tile.
* Drop target is a ProjectCard.
* Card updates after drop.
* No crash or stale state.

**Evidence located:**

| Field | Value |
|---|---|
| Last successful membership | `millionare-in-30days ← watts1080-x-1350-5-pack clip` |
| Membership file | `/Users/dipdip/Library/Application Support/app.liquidclips.desktop/project_memberships.json` |
| App version | `0.7.64` |
| Nearest commit | `704935b` — `fix(auth): remove passive sidecar keychain reads from Earn and Settings` |
| Broken delta found | None |

**Status:** `AUDITED / NO PATCH NEEDED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 004 — Social icons → Channels

**Steps:**

1. Navigate to Schedule or any surface that shows platform / social icons.
2. Click a Schedule rail icon.
3. Click a "routed to" chip.
4. Click a ConnectFirstPrompt chip.

**Expected:**

* Schedule rail icons route to Channels.
* Routed-to chips route to Channels.
* ConnectFirstPrompt chips route to Channels.
* Decorative rows do not pretend to be clickable.

**Evidence located:**

| Field | Value |
|---|---|
| App version | `0.7.78` (uncommitted) |
| Nearest commit | `aea1cd6` — `polish(projects): motion entry on modals + iPhone Springboard drag/drop` |
| Broken delta | `ResultsGrid` → `PublishModal` had no `onOpenSchedule` wiring; `PublishModal` → `ChannelPicker` "Add channel" routed only to `onOpenSettings` (Settings) |

**Fix applied (v0.7.78):**

* `App.tsx` passes `onOpenSchedule={() => { setScheduleInitialSub("channels"); setView({ kind: "schedule" }); }}` to the `ResultsGrid` mount.
* `ResultsGrid.tsx` adds `onOpenSchedule?: () => void` prop and forwards it to `PublishModal`.
* `PublishModal.tsx` `ChannelPicker` `onAddChannel` handler now prefers `onOpenSchedule`, falling back to `onOpenSettings` only when `onOpenSchedule` is absent.
* `ConnectFirstPrompt` fallback `(onOpenSchedule ?? onOpenSettings)?.()` now routes to Schedule → Channels when wired.

**Live retest result:** Daniel reports Schedule social media connection is still not smooth, platform icons still do not perform the correct action, and Schedule/connected social accounts feel disconnected. Root cause traced to FLOW 013 (multiple independent connection sources).

**P0 patch #2 (this lane):**

* Removed every `?? onOpenSettings` fallback used for social-connection routing.
* Added `onOpenSchedule` wiring into `BottomCockpit` so Schedule/Publish popover "Connect a channel" routes to Schedule → Channels.
* Passed `onOpenSchedule` from `ResultsGrid` into `BottomCockpit`.
* Removed now-unused `onOpenSettings` prop from `PublishModal`, `ClipReadyCard`, `DirectPublishQueue`, and `SchedulePage`.
* Corrected `DirectPublishQueue` error banner label from "Schedule → Loadout" to "Schedule → Channels".
* After FLOW 013 patch: all surfaces now read from the shared `usePlatformConnections` hook, so Schedule rail/chips and Channels manager stay in sync.

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 005 — Free export watermark

**Steps:**

1. Use the app as a free-tier user.
2. Run a clip pipeline to completion.
3. Export a clip.

**Expected:**

* Free user sees watermark warning before export.
* Exported file contains the Liquid Clips watermark.

**Evidence located:**

| Field | Value |
|---|---|
| Last completed pipeline project | `i-tried-the-uber-for-private-jets-yq8ca2-y4fq` |
| App version at pipeline | `0.7.64` |
| Nearest commit | `704935b` — `fix(auth): remove passive sidecar keychain reads from Earn and Settings` |
| Broken delta | `StudioHome.tsx` and `UploadPortal.tsx` gated free-tier messaging on `userTier === "free" && remainingExports !== null`; while `remainingExports` is `null` during boot `/sync`, free users saw the paid pill |

**Fix applied (v0.7.78):**

* Removed the `remainingExports !== null` gate from both free-tier branches.
* Rendered `remainingExports ?? "—"` as the count placeholder so free users always see the watermark/quota warning, even while `/sync` is in flight.

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 006 — Paid no-watermark export

**Steps:**

1. Use the app as a paid-tier user (Solo / Pro / Agency).
2. Run a clip pipeline to completion.
3. Export a clip.

**Expected:**

* Paid user does not see the free watermark warning.
* Exported file is clean (no watermark).

**Evidence located:**

| Field | Value |
|---|---|
| Finding | No separate broken delta proven in this forensic pass. |
| Note | Paid-tier pill path was unaffected by the FLOW 005/007/008 sync-window bug. |

**Status:** `AUDITED / NO PATCH NEEDED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 007 — 0 clips quota wall

**Steps:**

1. Use the app as a free-tier user with 0 remaining exports.
2. Attempt to start a clips pipeline (URL or file).

**Expected:**

* Free user at 0 clips is blocked before generation starts.
* Quota wall appears.
* Upgrade / recheck path refreshes tier and removes the wall if the user has paid.

**Evidence located:**

| Field | Value |
|---|---|
| Broken delta | Same free-tier messaging gate as FLOW 005 (`remainingExports !== null`) |

**Fix applied (v0.7.78):**

* Same quota/free-tier messaging fix as FLOW 005.
* Must verify 0 remaining exports still blocks before generation.

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 008 — Upgrade/recheck tier refresh

**Steps:**

1. Free user hits quota wall.
2. User upgrades or clicks recheck.
3. App refreshes tier from backend.

**Expected:**

* Tier refreshes in state, useTier, and AvatarPanel.
* Quota wall closes if user is now paid.
* Watermark cache invalidates.

**Evidence located:**

| Field | Value |
|---|---|
| Broken delta | Same free-tier display/sync-window fix as FLOW 005 |

**Fix applied (v0.7.78):**

* Same free-tier display/sync-window fix.
* Must verify recheck refreshes tier and lifts quota wall after paid upgrade.

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 009 — PublishModal platform selection

**Steps:**

1. Open PublishModal for a clip.
2. View platform list.

**Expected:**

* Connected platforms can be selected.
* Disconnected platforms are disabled or route to Channels.
* No fake clickable state on disconnected platforms.

**Evidence located:**

| Field | Value |
|---|---|
| App version | `0.7.78` (uncommitted) |
| Nearest commit | `aea1cd6` — `polish(projects): motion entry on modals + iPhone Springboard drag/drop` |
| Broken delta | `ResultsGrid` → `PublishModal` missing `onOpenSchedule` wiring caused connection-empty states to fall back to Settings |

**Fix applied (v0.7.78):**

* ResultsGrid → PublishModal → ChannelPicker connection routes now prefer Schedule → Channels.
* `DirectPublishQueue` path was already correct and untouched.

**Live retest result:** Daniel reports PublishModal platform selection and connected-account routing still do not work cleanly. Root cause traced to FLOW 013 (multiple independent connection sources).

**P0 patch #2 (this lane):**

* `PublishModal` empty state and `ChannelPicker` "Add channel" now use `onOpenSchedule` only (no Settings fallback).
* `ClipReadyCard` connect gate routes via `onOpenSchedule` only.
* After FLOW 013 patch: `PublishModal` now reads from the shared `usePlatformConnections` hook and uses `isEffectivelyActive` against the Ayrshare snapshot, matching `ChannelPicker`.

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 013 — Social channel source-of-truth unification

**Steps:**

1. Open Schedule.
2. View connected/unconnected social accounts.
3. Open PublishModal or ClipReadyCard.
4. View platform connection state.
5. Connect or disconnect a platform.
6. Return to Schedule / PublishModal / ClipReadyCard.

**Expected:**

* Schedule, PublishModal, ClipReadyCard, ChannelPicker, and connected accounts all use one coherent source of truth for connected social channels.
* Connection state updates propagate to all surfaces without manual refresh.
* No surface shows stale disconnected/connected state.

**Evidence located:**

| Field | Value |
|---|---|
| Live user report | Schedule and connected social accounts feel disconnected. |
| Canonical source audit | `usePlatformConnections.ts` already merges `listChannels()` + `socialGetConnectionStrict()`; `ResultsGrid` already consumes it. `SchedulePage`, `ChannelsManager`, `ChannelPicker`, `PublishModal`, and `DirectPublishQueue` each maintained their own fetches, so rail counts, routed chips, platform tiles, and picker rows could disagree. |
| Broken delta | No single surface was wrong; multiple independent data sources + no mutation broadcast meant connects/disconnects did not propagate across open surfaces. |

**Fix applied (v0.7.78):**

* `usePlatformConnections` is now the single React-side source of truth for channels + Ayrshare connection state.
* Hook auto-refreshes on `junior:channel-linked`, `social_link_closed`, `lc:connections-mutated`, and `lc:desktop-auth-ready` so every consumer stays in sync.
* `SchedulePage`, `ChannelPicker`, `PublishModal`, and `DirectPublishQueue` now read from `usePlatformConnections` instead of their own backend fetches.
* `ChannelsManager` dispatches `lc:connections-mutated` after create / delete / toggle / OAuth completion so Schedule counts/chips and PublishModal pickers update without manual reload.
* `PublishModal` channel list uses `isEffectivelyActive` with the Ayrshare snapshot, matching `ChannelPicker` and preventing "Ayrshare says linked but DB says pending" mismatches.

**P0 patch #3 (this lane):**

* `src/lib/activation.ts` now dispatches `lc:settings-open-tab` (channels) and `lc:connections-mutated` immediately after receiving the `liquidclips://channel-linked` deep link. This returns the app to **Schedule → Channels** and refreshes every consumer of `usePlatformConnections` without a manual restart.
* `docs/APP_CONTRACTS.md` created to document the social OAuth return contract.
* `scripts/assert-locked-flow-contracts.sh` updated with Contract 7 (OAuth return) and Contract 8 (no hardcoded provider OAuth URLs).

**Status:** `FIX APPLIED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 010 — Settings no passive keychain

**Steps:**

1. Open Settings.
2. Do not open API keys tab initially.

**Expected:**

* Opening Settings does not trigger a keychain prompt.
* API keys are only read when the API keys tab opens.

**Evidence located:**

| Field | Value |
|---|---|
| Source audit | `Settings.tsx` is unchanged against HEAD (`704935b`). API-key keychain reads are gated behind `category === "api-keys"` in a dedicated `useEffect`. |
| Mount-time probes | Use only `hardwareInfo`, `checkDeps`, `syncStatus`, and update check — no keychain. |
| WhoAmISection | Uses in-memory cached JWT + `sidecar.licenseJwtPresence()` presence mirror, not a keychain unlock. |
| Validation script | `scripts/assert-no-passive-keychain.sh` / `tests/no-passive-keychain.test.mjs` pass. |
| Broken delta found | None |

**Status:** `AUDITED / NO PATCH NEEDED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 011 — Reaction add/edit/bake

**Steps:**

1. Add reaction source.
2. Choose layout.
3. Bake overlay.
4. Preview/export.

**Expected:**

* Reaction source is accepted.
* Layout selection works.
* Bake overlay completes.
* Preview/export shows the reaction.

**Evidence located:**

| Field | Value |
|---|---|
| Source audit | `ReactionControls.tsx` remains the single writer for `clip.overlay`. Background bake listeners filter by `slug+idx`; free-tier moat re-checks `tierRef` after explicit `refreshTier()`; compact/full modes wired. |
| `ClipCard.tsx` | Uncommitted diff removed duplicate inline reaction bake path; Sparkles button now routes through `onOpenEditor`, preserving the single-writer invariant. |
| `OverlaySourcePicker.tsx` | Gates provider search behind missing-key / upgrade banners and routes missing-key state to Settings → API keys. |
| Broken delta found | None |

**Status:** `AUDITED / NO PATCH NEEDED / WAITING FOR DANIEL LIVE TEST`

---

### FLOW 012 — Projects create/add/move clips

**Steps:**

1. Create a project.
2. Add clips from library.
3. Move clips between projects.
4. Open project detail.

**Expected:**

* Project creates successfully.
* Clips attach from library.
* Move operation updates both projects.
* Project detail renders correctly.

**Evidence located:**

| Field | Value |
|---|---|
| Source audit | `ProjectsTab.tsx` / `ProjectCard.tsx` / `ProjectDetail.tsx` / `LibraryClipStrip.tsx` implement single-clip drag (`kind: "library-clip"`) into `ProjectCard` and `ProjectDetail`. `addMembership`, `moveMembership`, `removeMembership` paths are intact. `ProjectDetail` registers the active Tauri drop target via `dropContext`. |
| `dropContext.ts` | Unchanged. |
| Broken delta found | None |

**Status:** `AUDITED / NO PATCH NEEDED / WAITING FOR DANIEL LIVE TEST`

---

## 5. Validation commands every lane must run

Before any patch is considered complete, run:

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
bash scripts/brand-kit-drift-check.sh
bash scripts/assert-locked-flow-contracts.sh
```

## 6. Regression checklist every lane must run

Before any patch is considered complete, the lane owner must answer:

* Did this patch touch `App.tsx`?
* Did this patch touch `UploadPortal`?
* Did this patch touch `IntentPicker`?
* Did this patch touch `runPipelineFromUrl`?
* Did this patch touch sidecar ingest / export calls?
* Did this patch touch drag / drop listeners?
* Did this patch touch quota / watermark / tier logic?
* Did this patch touch Schedule / Channels routing?
* Did this patch touch Projects / LibraryClipStrip?
* **Which locked flows could be affected?**
* **Locked flows touched: yes / no.**

If the answer to the last question is `yes`, the patch must:

1. List the affected locked flows in the lane report.
2. Include a manual test plan for those flows.
3. Wait for Daniel confirmation before merging.

---

## 7. Mandatory lane report footer

Every lane must end with:

```text
Locked flows touched:
Candidate flows touched:
Files touching cross-cutting areas:
Regression risk:
Validation run:
Live test needed:
Build/install needed:
```

---

## 8. Change-control rules

* Do not refactor code that lives inside a locked flow unless the refactor is required to fix a bug in that same flow.
* Do not rename props, handlers, or state keys used by a locked flow without explicit approval.
* Do not add new async side effects inside a locked flow without proving they cannot delay or break the existing path.
* If a locked flow must change (new design, new backend contract, etc.), demote it to `WAITING` first, make the change, and reconfirm with Daniel before locking it again.
* When in doubt, mark the flow `WAITING` and ask.

---

## 9. Hard rules

* No broad patching.
* No "should work" acceptance.
* No final build unless locked-flow regression list is understood.
* No commit until working flows are locked or explicitly accepted as pending.
* No D1/payment/auth/backend while FLOW 001 is broken.
* No latest.json.
* No release.
