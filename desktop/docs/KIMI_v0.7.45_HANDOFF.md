# Kimi — v0.7.45 Handoff

**You're working in `~/Desktop/jnr` on master/main. Daniel + Claude opened this doc for you mid-flight. Read top-to-bottom once, then keep it open as a reference.**

Last update: 2026-06-10 17:15 UTC · Claude HEAD: `41b7ca8`.

---

## Where you are right now

| # | Task | Status |
|---|---|---|
| **P0** | Mass-delete library clips | ✅ DONE — tsc green, all snags closed in working tree |
| **P1** | Reaction bake progress UI | ✅ DONE — `useReactionBakeProgress.ts` + `stages.py` event emitter + `ReactionControls.tsx` UI all landed in working tree |
| **P2** | Imported clip renders source + cut clips in workbench | 🟡 ACTIVE — start now |
| **P3** | Social connection (3-bug bundle) + clickable platform badges | ⚪ UNBLOCKED — spec below. Daniel confirmed all three social-connection failure modes (a+b+c) are real. Start after P2 lands. |

---

## Claude's commits since you went heads-down

Listed newest first. None of these touch your active surfaces (LibraryTab / LibraryWall / LibraryCard / sidecar.py / sidecar.ts), so rebasing should be clean.

| Hash | Subject |
|---|---|
| `11e3a45` | docs(paperwork): close 3 lens-audit P2 items |
| `6eb0300` | **wip(kimi): snapshot mass-delete in-flight work for lens-agent audit** ← this is where Claude snapshotted your WIP. Reset or rebase off it. |
| `966e4ea` | fix(bug-hunt): batch — 12 findings from bug-hunt-lens |
| `70e2e1b` | fix(shell-open): defensive sweep — migrate 24 plugin-shell imports to openSmart |
| `f6a5250` | fix(shell-open): route filesystem paths through opener plugin, not shell |
| `126f30f` | docs(scope): auto-generated newsletter feature for SEO |
| `ad1ba30` | fix(contrast): batch 2 — polish-tier (5 hits) |
| `5392ff5` | fix(contrast): batch 1 — 7 invisible-text bugs found by contrast-lens v2 |
| `e642d91` | fix(library): UndoToast bg-ink/95 → bg-paper-elev/95 |
| `efc508a` | feat(marketing): /start onboarding page |
| `c7a4a1f` | fix(IG-008): two-layer scroll wrap |

**Heads-up before you commit your P0 properly:**

1. **`6eb0300` is Claude's WIP snapshot of YOUR work.** Reset / amend / cherry-pick it however you like — it's there so the lens agents could see complete state. The commit message acknowledges it's yours. Replace with your real P0 commit.
2. **A new helper exists at `desktop/src/lib/openSmart.ts`** that routes URLs → shell-plugin and filesystem paths → opener-plugin. If your mass-delete UI needs to "open folder" or anything similar, use `openSmart` (already imported as `openExternal` in LibraryCard.tsx per the recent sweep). Don't use the old `@tauri-apps/plugin-shell` import — it's gone from the codebase.
3. **24 files were migrated from `plugin-shell` → `openSmart` in `70e2e1b`.** If your mass-delete branch was forked before that commit, `git rebase main` will resolve cleanly because the import-line change is mechanical.

---

## P0 — close-out items (verified 2026-06-10 17:15)

**Status:** ✅ All TS snags closed in working tree. `npx tsc --noEmit -p desktop/` → 0 errors. Nice work.

One judgment call remains:

| Snag | File:line | Status |
|---|---|---|
| **IG-002 grouping vs convention** | `python-sidecar/sidecar.py:3372` | ⚠️ JUDGMENT — `library_bulk_delete` is grouped with the tombstone trio (request/undo/finalize_delete_project). The METHODS docstring says "Add NEW methods at the bottom" for diff-clarity, BUT semantic grouping IS more readable in context. Defer to Daniel before merge — he can either accept the grouping (and we update the docstring rule) or ask you to move it. NOT a runtime bug. |

Tsc + the other 4 snags all closed: `filtered` ordering ✓, LibraryWall props ✓, Square import ✓, `toggleSelectMode` state ✓.

---

## P1 — Reaction bake progress ✅ DONE (verified 2026-06-10 17:15)

In your working tree:

- ✅ NEW FILE: `desktop/src/lib/useReactionBakeProgress.ts` — 37 lines, mirrors the lift-transcript listener pattern, has a stale-generation guard via `genRef.current !== myGen` (good — survives a re-bake before the previous progress stream closes)
- ✅ MODIFIED: `desktop/python-sidecar/stages.py` (+18 lines) — emits `sidecar:overlay_progress` events at meaningful stages
- ✅ MODIFIED: `desktop/src/components/clips-feed/ReactionControls.tsx` (+34 lines) — UI hookup, progress bar render
- ✅ MODIFIED: `desktop/src/lib/sidecar.ts` — exports `onOverlayProgress` + `OverlayProgress` type

Daniel will walk this on the v0.7.45 install. **Commit it as `fix(P1): reaction bake progress — useReactionBakeProgress hook + stages.py emitter + ReactionControls UI` and move on to P2.**

---

## P2 — Imported clip renders source + cut clips

**The bug:** When a user imports a ready clip via the Import tile (workstation home), the workbench opens to an "empty" state — they don't see what was imported. Daniel wants the import flow to render the imported source video AND the cut clips below it (same view-kind=results UI that fresh-cut projects use, just with `clips_count: 1` and the original source as the only child).

**Where to look:**
- `App.tsx` — search for `handleImportDirect` and the `setView({ kind: "results" })` transition that follows. The import path probably skips the view-kind swap that fresh-cut projects use.
- `LibraryCard.tsx` — the "1 imported clip" overlay is the label pattern; just make sure the workbench actually OPENS to show both the source AND the clips beneath it.

**Iron gates near this work:**
- IG-001 — Import pipeline. The Python side of import (`import_ready_clips`) is locked. **Don't change the RPC contract.** Frontend-only fix: change how the import handler transitions to the results view after the RPC returns successfully.

**Verification:**
- Import a 60-second clip
- Confirm the workbench opens to a results view showing the source as a parent project AND the clip as a child
- `npx tsc --noEmit -p desktop/` clean

---

## P3 — Social connection (3 bugs) + clickable platform badges

Daniel confirmed 2026-06-10: the "2 bugs" he mentioned hours ago are the **social-connection** cluster, and he ALSO wants the previously-deferred **clickable platform badge** task rolled in. Four sub-tasks total. Land them as one commit batch since they share the Schedule/Channels surface.

### P3.a — "Connect a channel" button doesn't open AddChannelModal cleanly

**Symptom:** Daniel reports the connect flow is broken. Could be either: button click doesn't open `AddChannelModal` at all, OR the modal opens but the OAuth handshake fails before redirecting back to the desktop.

**Files to inspect:**
- `desktop/src/components/schedule/ChannelsManager.tsx` — the Schedule → Channels surface, owns the "Connect" button
- `desktop/src/components/schedule/AddChannelModal.tsx` — the modal itself + Ayrshare OAuth handoff
- `desktop/src/lib/backend.ts` — search for the Ayrshare token endpoint used by the modal
- Backend: `junior-backend/app/routes/channels.py` — the `link_url` endpoint that AddChannelModal calls

**What to verify:**
1. The Connect button's `onClick` actually fires (no event-bubble swallow from a parent click handler)
2. `addChannelModal.tsx` renders when `open` flips to `true`
3. The Ayrshare `link_url` returned from backend is a valid `https://` URL (not empty, not `null` — would now silently route to opener-plugin per the `openSmart` migration, masking the real bug)
4. After OAuth completes, the channel appears in the list (reconcile path)

**Fix surface:** narrow. If `link_url` ever comes back empty or relative, surface an error toast immediately instead of silently failing. Use `humanError(e)` for the toast message.

**Iron gates near this work:** none. Schedule tab is not iron-gated.

### P3.b — Stale connection status (channels show "Connected" when they're not)

**Symptom:** A channel's status pill says green/Connected, but a publish attempt fails because Ayrshare considers the token expired or the user revoked at the platform level.

**Context:** v0.7.32 added a backend reconcile loop (`junior-backend/app/routes/channels.py` — periodic Ayrshare poll) that updates `connected_at` and `last_error` on the Channel row. There's also a frontend defensive override on stale status (per the v0.7.32 ship blockers doc). One of those paths is misfiring.

**Files to inspect:**
- `desktop/src/components/schedule/ChannelsManager.tsx` — where the per-channel status pill renders
- `desktop/src/lib/backend.ts` → `meChannels` (or whatever fetches the channel list) — does it ask the backend for fresh status or read from a cache?
- Backend `junior-backend/app/routes/me.py` — the `/me/channels` endpoint response shape

**What to verify:**
1. Frontend polls or refetches channels on a cadence (~30-60s) or on focus
2. Backend reconcile updates the Ayrshare status into the response payload
3. The pill renders the LIVE status from the latest fetch, not from a stale ref or persisted store
4. If `last_error` is non-null AND `error_at > connected_at`, render the pill as 🟡 STALE not 🟢 CONNECTED

**Fix surface:** add a "this status is N seconds old" indicator OR force a refetch on tab focus.

**Iron gates near this work:** none.

### P3.c — BottomCockpit "Connect a channel" CTA routing

**Symptom:** The "Connect a channel" CTA inside the BottomCockpit / empty-state should route to Schedule → Channels. v0.7.42 commit `f88a7c8` fixed the previous misroute (was pointing at the now-deleted Settings → Connections tab). Daniel says it's STILL not landing correctly somewhere.

**Files to inspect:**
- `desktop/src/components/cockpit/BottomCockpit.tsx` — IG-005/006 locked, but the CTA's routing target is a prop drilled from App.tsx — DON'T edit BottomCockpit.tsx itself, edit the prop wiring in `App.tsx`
- `desktop/src/App.tsx` — find the BottomCockpit mount, confirm the `onConnectChannel` (or equivalent) prop routes to `setTab("schedule")` + `setScheduleSubtab("channels")` (or however the Schedule → Channels deep-link is plumbed)
- Other "Connect" CTAs in publish flow / empty states — same routing pattern, likely same bug

**What to verify:**
1. Clicking "Connect a channel" from ANY surface lands on Schedule → Channels with focus
2. If the tab was already on Schedule, the subtab swap fires (no-op detection shouldn't swallow the action)

**Iron gates near this work:** **IG-005 + IG-006** — BottomCockpit.tsx is locked. The fix is at the CALLER (App.tsx prop wiring), not inside BottomCockpit. **Grep `IRON GATE` before any edit.**

### P3.d — Clickable platform badges on ClipCard (rolled in from P4)

**Symptom:** Platform badges (TikTok, YouTube, IG, etc.) appear on each ClipCard but are visual-only. Daniel wants clicking a badge to route into the Schedule flow with that platform pre-selected.

**Files to inspect:**
- `desktop/src/components/clips-feed/ClipCard.tsx` — IG-007 locked outer `<article>` structure. The badges live INSIDE the article. Add `onClick` to the badges; do NOT alter the article wrapper.
- `desktop/src/components/clips-feed/PlatformBadge.tsx` — the badge component itself
- `desktop/src/App.tsx` — same Schedule-deep-link pattern as P3.c

**What to verify:**
1. Clicking a badge routes to Schedule with the platform pre-filtered/selected
2. Hover state: `cursor-pointer` + slight scale (preserve IG-007 visual lock — no border change, no fill change)
3. Keyboard accessibility: the badge becomes a `<button>` or has `role="button"` + `tabIndex={0}` + Enter/Space handler
4. If the clip has multiple platforms, clicking any one of them brings up Schedule with THAT one selected (not all)

**Iron gates near this work:** **IG-007** — ClipCard outer `<article>` is locked. Edit ONLY the badge JSX inside. The badge already has its own className; adding onClick + role doesn't violate the visual lock.

### P3 acceptance criteria (all four sub-tasks)

- `npx tsc --noEmit -p desktop/` clean
- `python3 ~/.claude/skills/contrast-lens/scan.py desktop/src/components | grep "FAIL ("` → 3 (no new contrast regressions)
- Daniel walks each on the v0.7.45 install:
  1. Connect a fresh channel — modal opens, OAuth completes, channel appears
  2. Revoke a channel at the platform level, refresh — status pill flips to STALE within 60s
  3. Click "Connect a channel" from cockpit, library empty state, AND publish flow — all land on Schedule → Channels
  4. Click a TikTok badge on a ClipCard — Schedule opens with TikTok pre-selected

---

## DO NOTs (carried forward from your last handoff)

- ❌ Don't push to remote (Daniel's no-push-without-confirmation rule).
- ❌ Don't `npm run tauri build` / `scripts/local-install.sh` / `scripts/ship.sh` until Daniel says "build", "install", or "ship" explicitly in the same turn (build-gate).
- ❌ Don't touch iron-gated files for non-contracted edits: IG-001 (Import RPC + Splash), IG-002 (sidecar RPC contract), IG-003 (Splash cinematic), IG-004 (auth/activation), IG-005 (BottomCockpit), IG-006 (cockpit handoff), IG-007 (ClipCard outer `<article>`), IG-008 (RoomShell + WorkstationRoom). Grep `IRON GATE` before each edit.
- ❌ Don't touch `liquidclips-marketing/*` — Claude owns it.
- ❌ Don't touch `desktop/docs/SHIP_v0.7.32_BLOCKERS.md` — paperwork landed in `11e3a45`.
- ❌ Don't refactor or migrate — surgical fixes only.

## DOs

- ✅ Bump `package.json` + `src-tauri/tauri.conf.json` patch version via `bash desktop/scripts/bump_patch.sh` after each P1/P2/P3 closes (you'll likely land 0.7.46 by the end).
- ✅ Commit each P as a separate commit with a clear `fix(P1):` / `fix(P2):` / `fix(P3):` prefix.
- ✅ Add `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` if you used Claude during the work (omit if it was all you).
- ✅ Run `npx tsc --noEmit -p desktop/` after each commit. The goal is zero new errors. Existing errors from your P0 chain (LibraryWall props, `filtered` ordering) should drop to zero once you complete the P0 close-out items above.
- ✅ Re-run `python3 ~/.claude/skills/contrast-lens/scan.py desktop/src/components` after touching any UI — goal is the current count (3 FAILs) stays at 3.
- ✅ If anything you build adds an `<img>` or `<video>` in user-content paths, give it an `onError={(e) => { e.currentTarget.style.display = "none"; }}` fallback (the bug-hunt sweep in `966e4ea` standardized this pattern across 7 files).

---

## When everything's done

Ping Daniel with: "P0 + P1 + P2 + P3 closed. v0.7.4X committed. Ready for your walk."

Daniel will:
1. Pull your branch into main (or you merge it yourself if you've been on master)
2. Build + install v0.7.4X locally
3. Walk the cockpit (P0 mass-delete, P1 bake progress, P2 import render, P3 2 bugs)
4. Deploy `liquidclips-marketing` so `/start` (currently 404) goes live
5. Pick B4 manifest disposition (atomic / tag-only / hybrid) — the last gate before public ship

Last useful command:

```bash
# Verify your work didn't regress anything Claude landed
cd ~/Desktop/jnr
python3 ~/.claude/skills/contrast-lens/scan.py desktop/src/components | grep "FAIL ("
cd desktop && npx tsc --noEmit
```

Both should be clean (3 contrast FAILs are pre-existing IG-003 + 1 false positive). Anything new = regression you introduced.

Good luck.
