# Kimi — Phase 3: Feature Delivery ONLY
**Phase 1 (social audit) and Phase 2 (reliability) are both approved + pushed.** Phase 3 is the last fix sprint before beta. Six items — features that exist in the codebase but don't actually work end-to-end.

**Scope of Phase 3:** Six fixes, six separate commits, six pieces of paste-able verification output. Nothing else.

**Estimated effort:** One day. If you're past that, you're looping.

---

## 🚨 Anti-loop rules (read every time)

1. **Don't diagnose by feel.** Grep / curl / file:line for every claim.
2. **Don't invent framework behavior.** Read `node_modules/<package>/dist/docs/` or run a smoke test before claiming how something works.
3. **Don't expand scope.** Six items only. If you find a deeper bug, append it to a section at the bottom of this file under "Out of scope — flag for Daniel."
4. **Don't claim done without paste-able grep output that matches the exit criteria.**
5. **One commit per fix.** Six fixes = six commits.
6. **No build / sign / install / deploy / ship triggers.** Edits + commits + tsc/cargo/py_compile only.
7. **tsc + py_compile MUST stay green after every commit.**
8. **Don't touch test-suite-later items** (button systems, design tokens, semantic landmarks, focus traps, App.tsx refactor). Those are explicitly out of scope per Daniel.

Phase 1 you found the actual file when my path was wrong. Phase 2 you did it twice more. Trust the file location your grep tells you, not what's written in this doc if they differ. Path corrections are welcome.

---

## F1 — Drag intent check (Script vs Clips routing)

**File:** `desktop/src/App.tsx`
**Search anchor:** Find the Tauri `tauri://drag-drop` event handler or wherever the drop payload is processed (search for `event.payload?.paths` or `paths?.[0]`).

**Current behavior:**
The user opens the upload portal in Script mode (transcript-only intent). They drag a video file onto the window. The drag handler runs the clips pipeline anyway, completely ignoring the user's intent. The Script feature is silently broken.

**What you change:**
1. Find the drop handler.
2. Check the current upload portal intent — there should be an `uploadPortal` state slice or similar that exposes `intent`. If the intent is `"script"`, route to the transcript pipeline path (search for `_onLiftTranscript` or equivalent — that's the path beta-min batch added).
3. Otherwise keep the existing clips pipeline routing.
4. Don't change the upload portal UI itself. Just the drop handler's routing.

**Why this matters:**
A user who picked Script mode and dragged a file currently gets clips. That's an intent inversion — the worst class of UX bug.

**Do NOT:**
- Change the upload portal UI.
- Add a new pipeline. Reuse the existing transcript path.
- Change behavior when no portal is open (default to clips, same as today).

**Exit criteria:**
```bash
$ grep -n 'intent === "script"\|uploadPortal\.intent' desktop/src/App.tsx | head -5
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

Must show at least one `intent === "script"` branch in the drop handler.

---

## F2 — ClipCard hover action row: un-hide OR delete

**File:** `desktop/src/components/clips-feed/ClipCard.tsx`
**Search anchor:** `className="hidden"` (will be on the action row div).

**Current behavior:**
The action row (Caption, Reaction, Copy, Editor buttons) is wrapped in a div with `className="hidden"`. The buttons exist in the JSX, the handlers are wired, the icons are imported — but users can never reach them because the row is CSS-hidden. They must use BottomCockpit instead.

**Pick ONE path:**

**Path A (recommended): un-hide on hover.** Replace `className="hidden"` with `className="opacity-0 group-hover/clipcard:opacity-100 transition-opacity"`. The parent ClipCard needs `className` to include `group/clipcard` so the hover scope works. The action row appears smoothly on hover, vanishes on un-hover. Keeps the visual cleanliness of the resting state.

**Path B: delete the dead JSX.** Find the `className="hidden"` div, delete it AND every handler that's no longer used (Caption, Reaction, Copy, Editor handlers if they're not referenced elsewhere). Don't leave hidden DOM.

**Which to choose:** If you're confident the BottomCockpit is the only intended action surface, Path B (delete). If the original design intent was hover-reveal and someone CSS-hid it during a refactor, Path A (un-hide). When in doubt, Path A — it's the additive choice.

**Do NOT:**
- Change the action handlers' behavior.
- Add new actions.
- Touch BottomCockpit.
- Leave the row half-hidden (no `opacity-0` without a hover-reveal in Path A).

**Exit criteria:**
```bash
$ grep -c 'className="hidden"' desktop/src/components/clips-feed/ClipCard.tsx
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

The grep must return `0`.

---

## F3 — ClipPreview trim clamp

**File:** `desktop/src/components/ClipPreview.tsx`
**Search anchor:** Look for the trim input handlers (search for `trim` or `setTrim` near the input change handlers, roughly lines 317-336 in the audit reference).

**Current behavior:**
Trim start/end inputs accept any value. User can type `start: 9999` on a 60-second source. The regenerate call later fails with a cryptic ffmpeg error.

**What you change:**
1. Find the source duration (search for `source_duration_seconds` or `duration_seconds` on the clip object).
2. Clamp the trim start input: it can't exceed `source_duration_seconds - 1` (leave at least 1s for end > start).
3. Clamp the trim end input: it can't be less than `trim_start + 1` and can't exceed `source_duration_seconds`.
4. Apply clamps on input change AND on submit (so a paste of "9999" gets corrected immediately, not just at submit time).

**Do NOT:**
- Add a visible error message. Silent clamping is the right UX — show the clamped value, don't lecture the user.
- Refactor the trim controls' visual design.
- Add a slider. Just clamp the numbers.

**Exit criteria:**
```bash
$ grep -n "maxStart\|minEnd\|source_duration_seconds\|Math.max\|Math.min" desktop/src/components/ClipPreview.tsx | head -10
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

Must show clamp logic against the source duration.

---

## F4 — Schedule platform picker: not hardcoded YouTube

**File:** `desktop/src/components/ClipPreview.tsx`
**Search anchor:** Look for `platform: "youtube"` near the schedule popover (roughly line 393 in the audit reference).

**Current behavior:**
The schedule popover hardcodes `platform: "youtube"` regardless of the clip's actual selected platforms. A user who routed a clip to TikTok and tries to schedule it silently schedules to YouTube instead.

**What you change:**
Pick ONE approach (Path A is simpler, Path B is more user-friendly):

**Path A (simpler): use the first selected platform from clip.platforms.** Replace the hardcoded `"youtube"` with `clip.platforms?.[0] ?? "youtube"`. If the clip has no selected platforms (shouldn't happen at the schedule step, but defensive), fall back to youtube as the legacy default.

**Path B (better UX): show a small platform picker in the schedule popover.** A radio button row with one option per selected platform. Default to the first. Submit uses whichever is selected. About 20 lines of JSX.

**Pick Path A if you're tight on time. Pick Path B if you have an extra hour.**

**Do NOT:**
- Build a multi-platform schedule (one platform per scheduled post, as today).
- Change the schedule popover layout substantially.
- Change the Ayrshare backend contract — this is a purely frontend fix.

**Exit criteria:**
```bash
$ grep -n 'platform: "youtube"' desktop/src/components/ClipPreview.tsx | head -5
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

The hardcoded `platform: "youtube"` line should be gone (replaced with the clip's platforms lookup OR the new picker).

---

## F5 — Close Settings on nav switch

**File:** `desktop/src/App.tsx`
**Search anchor:** Find the nav-click handler. May be `handleNavClick`, `onNavClick`, `setView`, or similar. Search for `setView(` or `handleNav`.

**Current behavior:**
Settings opens as a modal/sheet. When the user clicks a different nav item (Workspace, Schedule, Earn) while Settings is open, the view changes BEHIND the modal but Settings stays open. The user sees Settings still on top, then closes it manually and finds they're on a different view than expected.

**What you change:**
1. Find the nav-click handler.
2. Before switching the view, if `settingsOpen` is true (or whichever state flag tracks Settings open/closed), call the close-Settings setter first.
3. Then proceed with the view switch.

**Why this matters:**
Modal-over-page is the wrong UI in this context. Either close Settings on nav switch (this fix) or make it a route. Closing is the smaller change.

**Do NOT:**
- Convert Settings to a route.
- Animate the close transition (just close it).
- Block the nav switch if there are unsaved Settings changes — Settings auto-saves on most fields, so there's nothing to protect.

**Exit criteria:**
```bash
$ grep -B 1 -A 8 "handleNavClick\|onNavClick\|setView" desktop/src/App.tsx 2>&1 | grep -c "setSettingsOpen(false)\|closeSettings()"
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

Must show at least one call to close Settings in the nav-click flow.

---

## F6 — Replace `--break-system-packages` advice

**File:** `desktop/src/App.tsx`
**Search anchor:** `break-system-packages` (one or two occurrences, probably in a deps-remediation card or sidecar-missing-deps view).

**Current behavior:**
When the Python sidecar reports missing deps, the remediation card tells users to run `pip install --break-system-packages <packages>`. That flag overrides Python's PEP 668 safety net and can corrupt their system Python's package state.

**What you change:**
Replace the advice with safer instructions. Two options depending on what we can detect:

1. **If you can detect Homebrew Python** (the user's `python3 --version` was reported via the sidecar diagnostics, OR `which python3` returns `/opt/homebrew/bin/python3`): suggest `brew install python` and plain `pip install <packages>`.
2. **If we can't detect** (most cases): suggest a venv:
   ```
   python3 -m venv ~/.liquid-clips-venv
   source ~/.liquid-clips-venv/bin/activate
   pip install <packages>
   ```
   And tell the user to "set the venv's python as your default for Liquid Clips" via... well, that's a Settings change we don't have. So for now, just show the venv command with a note: "We're working on auto-detection — for now, copy and run these commands."

3. **Add a "Copy commands" button** that copies the suggested commands to clipboard.

The point: get rid of the dangerous flag. ANY safer alternative is fine. Don't over-engineer.

**Do NOT:**
- Auto-run the install. Just give safer instructions.
- Detect every Python flavor (homebrew vs uv vs pyenv vs conda etc.). Two paths is enough.
- Build a Python env management UI in Settings. Not in scope.

**Exit criteria:**
```bash
$ grep -c "break-system-packages" desktop/src/App.tsx
$ cd desktop && npx tsc --noEmit && echo "tsc clean"
```

The grep must return `0`.

---

## Out of scope — flag for Daniel

If you discover a deeper bug while doing the six items above, append it here. Do NOT fix it in Phase 3.

(append-only)

---

## When you're done

Reply to Daniel with exactly this format:

```
Phase 3 done.

F1 drag intent: <one-line summary> (commit: <hash>)
F2 ClipCard hover row: <Path A un-hide / Path B delete> — <one-line summary> (commit: <hash>)
F3 trim clamp: <one-line summary> (commit: <hash>)
F4 schedule platform: <Path A clip.platforms[0] / Path B picker> — <one-line summary> (commit: <hash>)
F5 Settings close-on-nav: <one-line summary> (commit: <hash>)
F6 break-system-packages: <one-line summary> (commit: <hash>)

Verification output:

$ grep -n 'intent === "script"\|uploadPortal\.intent' desktop/src/App.tsx | head -5
<paste>

$ grep -c 'className="hidden"' desktop/src/components/clips-feed/ClipCard.tsx
<paste>

$ grep -n "maxStart\|minEnd\|source_duration_seconds" desktop/src/components/ClipPreview.tsx | head -5
<paste>

$ grep -n 'platform: "youtube"' desktop/src/components/ClipPreview.tsx | head -5
<paste>

$ grep -B 1 -A 8 "handleNavClick\|onNavClick\|setView" desktop/src/App.tsx 2>&1 | grep -c "setSettingsOpen(false)\|closeSettings()"
<paste>

$ grep -c "break-system-packages" desktop/src/App.tsx
<paste>

$ cd desktop && npx tsc --noEmit && echo "tsc clean"
<paste>

Out of scope flagged: <number, 0 is fine>
```

That's the only "done" message format Daniel will accept.

---

## What you do NOT do in Phase 3

- ❌ Don't refactor App.tsx, Settings.tsx, ClipPreview.tsx, or ThumbnailStudio.tsx structurally. Targeted edits inside these files are fine.
- ❌ Don't touch button systems, design tokens, semantic landmarks, focus traps (test suite later per Daniel)
- ❌ Don't touch the dead workbench/ directory, dead shadcn primitives, or any other cleanup task (test suite later)
- ❌ Don't add new features. Each fix is something that exists but is broken.
- ❌ Don't push, deploy, build, sign, install, or tag
- ❌ Don't claim done without the grep outputs above pasted verbatim

After Phase 3 lands and Daniel approves, the codebase is beta-ready and we move to the test layer + demo + push.
