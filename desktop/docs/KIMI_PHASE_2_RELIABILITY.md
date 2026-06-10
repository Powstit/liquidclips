# Kimi — Phase 2: Reliability ONLY
**Phase 1 (social audit) is approved.** Phase 2 covers reliability — four items that prevent crashes and silent data loss. Daniel will approve this before you start Phase 3.

**Scope of Phase 2:** Four fixes, four separate commits, four pieces of paste-able verification output. Nothing else.

**Estimated effort:** Half a day. If you're past that, you're looping.

---

## 🚨 Anti-loop rules (re-read every time)

1. **Don't diagnose by feel.** Grep / curl / file:line for every claim.
2. **Don't invent framework behavior.** Read `node_modules/<package>/dist/docs/` or run a smoke test before claiming how something works.
3. **Don't expand scope.** Four items only. If you find a deeper bug, append it to a section at the bottom of this file under "Out of scope — flag for Daniel."
4. **Don't claim done without paste-able grep output that matches the exit criteria.**
5. **One commit per fix.** Four fixes = four commits.
6. **No build / sign / install / deploy / ship triggers.** Edits + commits + tsc/cargo/py_compile only.
7. **tsc + cargo check + py_compile MUST stay green after every commit.**
8. **Don't touch Phase 3 items** (drag intent, ClipCard hover row, trim clamp, schedule platform, Settings close-on-nav, break-system-packages). They get their own doc next.

Phase 1 you did well — you wrote the audit, found the drift, fixed it cleanly. Same discipline here, four times.

---

## R1 — Sidecar restart cap 1 → 3 with exponential backoff

**File:** `desktop/src-tauri/src/sidecar.rs`
**Line:** Search for `const SIDECAR_RESTART_CAP: u32 = 1;` (around line 39).

**Current behavior:**
The Python sidecar can crash (out-of-memory during large imports is the common case). Today, on crash:
1. Rust shell catches the exit
2. Respawns the sidecar ONE time
3. If that one respawn fails, the crash overlay shows and the user must manually relaunch the whole app

**What you change:**
1. Bump cap from `1` to `3`.
2. Between respawn attempts, sleep with backoff: 1 second before attempt 2, 3 seconds before attempt 3 (linear is fine — don't overthink).
3. Keep the existing crash overlay behavior — only show it when the cap is exhausted.

**Why this matters:**
One transient crash (e.g. sidecar got OOM-killed mid-import) is recoverable. Three respawns with growing delays covers the common-but-transient crash family. Five would be overkill (deterministic crashes would just spam-restart). Zero (current state) means every transient crash forces a manual relaunch.

**Do NOT:**
- Add a "Try to continue" path. The current "Restart Liquid Clips" + "Try to continue" pair stays as-is (already intentionally kept per code comment).
- Change the crash overlay UI.
- Add a respawn-counter that persists across app sessions. This is per-session only.
- Try to detect crash type (OOM vs panic vs anything). Treat all crashes the same way.

**Exit criteria:**
Paste the following grep + cargo check output in your "done" message:

```bash
$ grep -n "SIDECAR_RESTART_CAP\|restart.*backoff\|tokio::time::sleep" desktop/src-tauri/src/sidecar.rs | head -10
$ cd desktop/src-tauri && cargo check 2>&1 | tail -5
```

The grep must show `SIDECAR_RESTART_CAP: u32 = 3` and a sleep call between respawn attempts. cargo check must be exit 0.

---

## R2 — JuniorLoader stall detection

**File:** `desktop/src/components/JuniorLoader.tsx`

**Current behavior:**
JuniorLoader shows a download progress UI. If the download stalls (network drops, captive portal, slow CDN), the UI just sits at whatever percentage it last reached. No timeout, no retry, no cancel-and-retry affordance. Users force-quit the app.

**What you change:**
1. Track bytes-downloaded over a rolling 60-second window. Use a ref so you don't trigger re-renders on every progress tick.
2. If the bytes-delta is 0 for 60 consecutive seconds while status is `"downloading"` (i.e. still actively trying), set a `stalled` state.
3. When `stalled` is true, swap the progress UI for a stall affordance: "Download seems stuck — try again, or cancel."
4. Two buttons: **Retry** (restarts the download — use the existing retry path) and **Cancel** (writes the existing `.cancel` marker — don't invent a new cancel mechanism).
5. When bytes-delta becomes non-zero again, clear the `stalled` state and show the progress UI again. Don't hide-and-re-show in a way that flickers — only the bottom affordance changes.

**Why this matters:**
Today a stalled download is indistinguishable from a slow download. Users on flaky hotel wifi, partial captive portals, or congested networks have no escape except force-quit. With this fix, after 60 seconds of no progress they get a clear out.

**Do NOT:**
- Add a network-status check (no `navigator.onLine` polling). We're measuring observed bytes, not network state.
- Change the existing cancel mechanism. The `.cancel` marker file is the contract.
- Add an automatic retry. The user decides when to retry.
- Wire this into a notification system or toast bus. It's a local affordance inside JuniorLoader.
- Trigger this for completed downloads. Only fire while status === `"downloading"`.

**Exit criteria:**
```bash
$ grep -n "stall\|stalled\|bytesDelta\|seems stuck" desktop/src/components/JuniorLoader.tsx | head -10
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

The grep must show at least: a stall state ref, a 60-second check, the "seems stuck" copy, and Retry + Cancel buttons.

---

## R3 — localStorage quota error surfacing

**File:** `desktop/src/lib/persistedSession.ts` (or wherever workbench persistence writes to localStorage — start there, follow the calls if you need)

**Current behavior:**
When workbench state is persisted to localStorage, the setItem call is in a try/catch (or just an unwrapped call) that swallows failures. If the user's disk is full, the browser throws `QuotaExceededError`, the write fails, and the user has no idea their layout won't survive a relaunch.

**What you change:**
1. Find every `localStorage.setItem` in `persistedSession.ts` (and adjacent files in the same persistence layer).
2. Wrap them in try/catch if not already.
3. In the catch, check if the error is a `QuotaExceededError` (or `DOMException` with name `"QuotaExceededError"`).
4. Dispatch the existing toast event: `window.dispatchEvent(new CustomEvent("lc:toast", { detail: { message: "Storage full — workbench layout won't save. Free up disk space.", type: "warn" } }))`.
5. Keep the existing swallowed-on-other-errors behavior — only surface for the quota class. Other errors (Safari private mode etc.) shouldn't toast users out of context.

**Why this matters:**
Silent data loss is the worst user experience. A user who notices their layout isn't saving has nothing to act on. With this toast, they can free disk space and the persistence resumes working.

**Do NOT:**
- Implement a fallback storage (no IndexedDB swap, no in-memory degrade).
- Compress the data to fit. Just surface the failure.
- Toast for every other localStorage error class. ONLY `QuotaExceededError`.
- Toast on every retry within the same session. Throttle to once per session if you want (add a `hasToastedQuota` flag in module scope). If that's hard, once-per-write is acceptable.

**Exit criteria:**
```bash
$ grep -rn "QuotaExceededError" desktop/src/lib desktop/src/components --include="*.ts" --include="*.tsx" | head -10
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

Must show at least one QuotaExceededError check in the persistence layer + the toast dispatch.

---

## R4 — CaptionDrawer mutate null guard

**File:** `desktop/src/components/CaptionDrawer.tsx`

**Current behavior:**
The CaptionDrawer has a `mutate` function (the editor's state-modify path). It uses `state!` non-null assertion. In rare cases (user opens the drawer during initial state load), `state` is null and the assertion crashes the editor.

**What you change:**
One line. At the top of the `mutate` function (or wherever the `state!` assertion happens), add:
```tsx
if (!state) return;
```
Then continue with the existing logic.

That's it. Defensive guard, no refactoring.

**Why this matters:**
Prevents a real crash class. Users opening the caption drawer during the wrong loading window currently get a white screen and have to relaunch.

**Do NOT:**
- Refactor the state model.
- Change the history stack push logic.
- Add a loading spinner to the drawer.
- Touch the keyboard effect, the autoFixToast, or any other lens-flagged item. Those belong in a later UI/UX sprint (test suite later per Daniel's words).

**Exit criteria:**
```bash
$ grep -B 1 -A 3 "function mutate\|const mutate" desktop/src/components/CaptionDrawer.tsx | head -10
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

Must show the `if (!state) return;` guard in the mutate function body.

---

## Out of scope — flag for Daniel

If you discover a deeper bug while doing the four items above, append it here. Do NOT fix it in Phase 2.

(append-only)

---

## When you're done

Reply to Daniel with exactly this format:

```
Phase 2 done.

R1 restart cap: <one-line summary> (commit: <hash>)
R2 stall detection: <one-line summary> (commit: <hash>)
R3 localStorage quota: <one-line summary> (commit: <hash>)
R4 CaptionDrawer null guard: <one-line summary> (commit: <hash>)

Verification output:

$ grep -n "SIDECAR_RESTART_CAP" desktop/src-tauri/src/sidecar.rs
<paste>
$ cd desktop/src-tauri && cargo check 2>&1 | tail -3
<paste>

$ grep -n "stalled\|seems stuck" desktop/src/components/JuniorLoader.tsx | head -10
<paste>

$ grep -rn "QuotaExceededError" desktop/src/lib desktop/src/components --include="*.ts" --include="*.tsx" | head -10
<paste>

$ grep -B 1 -A 3 "function mutate\|const mutate" desktop/src/components/CaptionDrawer.tsx | head -10
<paste>

$ cd desktop && npx tsc --noEmit && echo "tsc clean"
<paste>

Out of scope flagged: <number, 0 is fine>
```

That's the only "done" message format Daniel will accept.

---

## What you do NOT do in Phase 2

- ❌ Don't touch ClipCard hover row, trim clamp, drag intent, schedule platform, Settings close-on-nav, or `--break-system-packages` (that's Phase 3, separate doc)
- ❌ Don't refactor App.tsx, Settings.tsx, ClipPreview.tsx, or ThumbnailStudio.tsx
- ❌ Don't touch button systems, design tokens, semantic landmarks, focus traps (test suite later per Daniel)
- ❌ Don't rebuild anything. Each fix is small, localized, surgical.
- ❌ Don't push, deploy, build, sign, install, or tag
- ❌ Don't claim done without the grep outputs above pasted verbatim

Same discipline as Phase 1. You delivered that one clean. Do it four more times.
