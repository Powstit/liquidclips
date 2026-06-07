# Real-data walk — Import flow (v0.7.13)

Mirrors the "Real-data walk" section from the ship-lens audit Daniel approved
for v0.7.13. The walk exercises Import end-to-end across the happy paths +
every state the lens flagged. Run sequentially. Tick PASS/FAIL inline; do not
edit a passed step retrospectively.

Setup:

1. Install the v0.7.13 build (`bash scripts/local-install.sh`).
2. Open `~/LiquidClips/projects/` in Finder — keep visible.
3. Open Console.app filtered on `Liquid Clips` for live JS/Rust errors.
4. Have these test files ready on disk:
   - `~/walk-assets/clean.mp4` (any short 1080x1920 mp4, < 10 MB)
   - `~/walk-assets/with-emoji-🎬-in-name.mp4` (same content, renamed)
   - `~/walk-assets/pack-12/clip-01.mp4` … `clip-12.mp4` (12 mp4 files)
   - `~/walk-assets/corrupt.mp4` (truncate: `head -c 4096 clean.mp4 > corrupt.mp4`)
   - `~/walk-assets/empty.mp4` (`: > empty.mp4`)
   - One `.mp4` on a connected network share (SMB/AFP); note its mount path.

Companion script: `bash scripts/walk-import.sh` runs every assertion that can
be checked from the terminal. Run it after the walk to back the manual ticks.

---

## Step 1 — Clean single-file import (happy path)

- **Action:** Click the Import tile on the empty Workbench.
- **Assert:** macOS file picker opens with "Finished clips" filter
  (.mp4/.mov/.webm only).
- **Action:** Pick `~/walk-assets/clean.mp4`. Click Open.
- **Assert:** Import tile shows a busy spinner (T1.3 loading state) within 200 ms.
- **Assert:** Within 5 s, Workbench transitions to a populated view with the
  imported clip rendered in ResultsGrid.
- **Assert:** Success toast appears AND survives a view switch to Library and
  back (T1.1).
- **Verify:**

```bash
ls -t ~/LiquidClips/projects/ | head -1
ls "$HOME/LiquidClips/projects/$(ls -t ~/LiquidClips/projects/ | head -1)/clips/"
ls "$HOME/LiquidClips/projects/$(ls -t ~/LiquidClips/projects/ | head -1)/thumbnails/"
```

  All three commands return non-empty results. Thumbnail file size > 0.

- [ ] PASS  [ ] FAIL

---

## Step 2 — Emoji-filename single-file import

- **Action:** Click the Import tile again.
- **Action:** Pick `~/walk-assets/with-emoji-🎬-in-name.mp4`.
- **Assert:** Project slug created on disk has NO unescaped emoji bytes — slug
  is ASCII-safe.
- **Assert:** ResultsGrid renders the clip with no garbled card title.
- **Verify:**

```bash
LATEST=$(ls -t ~/LiquidClips/projects/ | head -1)
echo "$LATEST" | LC_ALL=C grep -P '[^\x00-\x7F]' && echo "FAIL: non-ASCII in slug" || echo "OK"
```

- [ ] PASS  [ ] FAIL

---

## Step 3 — 12-clip pack import

- **Action:** Click the Import tile.
- **Action:** Multi-select all 12 mp4s in `~/walk-assets/pack-12/`. Click Open.
- **Assert:** Import tile spinner persists for the whole batch (no flash).
- **Assert:** ResultsGrid renders exactly 12 clips, ordered as picked.
- **Assert:** LibraryCard for this project shows "imported pack" badge
  (regression: Fix #2a v0.7.7).
- **Verify:**

```bash
LATEST=$(ls -t ~/LiquidClips/projects/ | head -1)
ls "$HOME/LiquidClips/projects/$LATEST/clips/" | wc -l   # expect 12
```

- [ ] PASS  [ ] FAIL

---

## Step 4 — Corrupt mp4 import

- **Action:** Click the Import tile.
- **Action:** Pick `~/walk-assets/corrupt.mp4`.
- **Assert:** Within the T1.4 60s timeout window, importer surfaces a human
  error via `humanError()` (T1.5) — NOT a raw stack trace.
- **Assert:** Workbench returns to empty view, NOT a half-rendered project tile.
- **Assert:** No partial project dir left behind under `~/LiquidClips/projects/`.

- [ ] PASS  [ ] FAIL

---

## Step 5 — Empty mp4 import

- **Action:** Click the Import tile.
- **Action:** Pick `~/walk-assets/empty.mp4`.
- **Assert:** Importer rejects with "File appears empty" (or equivalent
  humanError) within 2 s.
- **Assert:** No project dir created.

- [ ] PASS  [ ] FAIL

---

## Step 6 — Cancel mid-pick

- **Action:** Click the Import tile.
- **Action:** Hit Cancel in the macOS file picker.
- **Assert:** Workbench remains on empty view. No spinner. No toast. No
  project dir.
- **Assert:** Import tile is immediately clickable again (no stuck loading
  state — T1.3 guard releases).

- [ ] PASS  [ ] FAIL

---

## Step 7 — Sidecar dies mid-pick

- **Action:** In Activity Monitor, locate `python3 sidecar.py`. DO NOT kill yet.
- **Action:** Click the Import tile. While the picker is open, kill the sidecar
  PID (`kill -9 <pid>`).
- **Action:** Pick `~/walk-assets/clean.mp4`. Click Open.
- **Assert:** Within 60 s (T1.4 Promise.race timeout) the UI surfaces "Sidecar
  unavailable — restart Liquid Clips" via humanError, not infinite spinner.
- **Assert:** Import tile clickable again after the error toast.

- [ ] PASS  [ ] FAIL

---

## Step 8 — Network drive import

- **Action:** Click the Import tile.
- **Action:** Pick a `.mp4` on the mounted network share.
- **Assert:** Either (a) copies into project dir successfully and ResultsGrid
  renders the clip, OR (b) surfaces a humanError if the share read times out.
  Never an infinite spinner. Never a partial dir.
- **Verify:**

```bash
LATEST=$(ls -t ~/LiquidClips/projects/ | head -1)
cat "$HOME/LiquidClips/projects/$LATEST/project.json" | grep -c '"imported": true'
```

  Returns `>= 1` if the import succeeded.

- [ ] PASS  [ ] FAIL

---

## Step 9 — Double-click guard

- **Action:** Click the Import tile, then immediately click it again before the
  picker opens.
- **Assert:** Exactly one file picker opens (T1.3 double-click guard).
- **Action:** Cancel the picker.
- **Assert:** Import tile re-enables.

- [ ] PASS  [ ] FAIL

---

## Step 10 — localStorage wipe + restore

- **Action:** Quit Liquid Clips fully (Cmd-Q).
- **Action:** Run:

```bash
rm -rf "$HOME/Library/Application Support/app.liquidclips.desktop/EBWebView/Default/Local Storage"
```

- **Action:** Relaunch Liquid Clips.
- **Assert:** App boots to Workbench empty state. OnboardingOverlay shows
  (T1.2 gate: `view.kind === "empty"` AND no projects).
- **Action:** Click Import. Pick `~/walk-assets/clean.mp4`.
- **Assert:** Existing projects from earlier steps still visible in Library
  (server-of-truth is the filesystem, not localStorage).
- **Assert:** New imported project lands successfully.

- [ ] PASS  [ ] FAIL

---

## Step 11 — Onboarding suppressed when projects exist

- **Action:** With projects on disk from prior steps, navigate to Library →
  Workbench.
- **Assert:** OnboardingOverlay does NOT show, even though Workbench may
  briefly show empty before view loads (T1.2: gate requires both empty view
  AND zero projects).

- [ ] PASS  [ ] FAIL

---

## Step 12 — `<video>` error handlers fire

- **Action:** From step 1's imported project, manually rename the source mp4 in
  `~/walk-assets/clean.mp4` to `clean.mp4.bak`.
- **Action:** Reopen the project from Library.
- **Assert:** ClipWindowPoster / ResultsGrid card shows a "Source unavailable"
  placeholder (T1.6 + T1.7 onError handlers fired), not a black box.
- **Action:** Rename file back to restore.

- [ ] PASS  [ ] FAIL

---

## Step 13 — Caption bake on an imported clip — T2.6 NO DATA LOSS

THIS IS THE CRITICAL STEP. T2.6 was the data-loss risk: caption bake used to
overwrite-via-atomic-replace on the user's original file. v0.7.13 fix copies
the source into `project/clips/` first and re-points `vertical_path`.

- **Action:** Compute baseline hash:

```bash
md5 ~/walk-assets/clean.mp4 > ~/walk-assets/clean.mp4.md5.before
cat ~/walk-assets/clean.mp4.md5.before
```

- **Action:** Click Import tile. Pick `~/walk-assets/clean.mp4`.
- **Action:** Open the imported clip in ResultsGrid. Click the captions chip.
- **Action:** In the Captions Drawer, change one line, change the style, set a
  custom palette colour, hit Save / Bake.
- **Assert:** Bake completes (5-30 s depending on length). Drawer closes.
  ClipPreview pill shows the new style.
- **Verify (THE CRITICAL ASSERTION):**

```bash
md5 ~/walk-assets/clean.mp4 > ~/walk-assets/clean.mp4.md5.after
diff ~/walk-assets/clean.mp4.md5.before ~/walk-assets/clean.mp4.md5.after \
  && echo "PASS: original UNCHANGED" \
  || echo "FAIL: ORIGINAL FILE OVERWRITTEN — T2.6 REGRESSED"
```

- **Verify:** A new file exists inside the project, NOT at the original path:

```bash
LATEST=$(ls -t ~/LiquidClips/projects/ | head -1)
ls -lh "$HOME/LiquidClips/projects/$LATEST/clips/"
```

  Expect at least one `.mp4` here, and `project.json`'s clip
  `vertical_path` now points inside the project dir.

- [ ] PASS  [ ] FAIL

---

## Step 14 — Re-bake idempotency

- **Action:** Open the same clip from step 13 again. Edit one line. Re-bake.
- **Assert:** Bake succeeds. No "file in use" / "permission denied" error.
- **Verify:**

```bash
LATEST=$(ls -t ~/LiquidClips/projects/ | head -1)
md5 ~/walk-assets/clean.mp4   # still matches the .before hash
```

- [ ] PASS  [ ] FAIL

---

## Step 15 — Final automated assertion sweep

- **Action:** Run the companion script:

```bash
bash /Users/dipdip/Desktop/jnr/desktop/scripts/walk-import.sh
```

- **Assert:** Every line printed begins with `✓`. Script exits 0. Any `✗ FAIL`
  line marks this walk as FAILED regardless of manual ticks above.

- [ ] PASS  [ ] FAIL

---

## Result

- PASS count: ___ / 15
- FAIL count: ___ / 15
- Walk run by: ___________
- Walk date: ___________
- v0.7.13 build hash: ___________

A walk is shippable only when all 15 steps PASS. Any FAIL blocks v0.7.13
release; file an issue against the failing step's tag (T1.x / T2.6 / Fix
#2a / etc.) before resuming the walk.
