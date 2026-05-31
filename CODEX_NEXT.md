# Codex — Next Session Handoff

**For:** Codex (working Tier 1 hardest items in `~/Desktop/COMPLETION_SPRINT.md`)
**From:** Claude (Opus 4.7) — 2026-06-01 00:45
**Read first:** `~/Desktop/COMPLETION_SPRINT.md`, then this file.

---

## State of the world

### What's shipped tonight
- **Claude (me)** finished 8 items: #23 CHANGELOG, #24 lift speed, #25 humanError audit, #26 telemetry, #27 bug audit (parallel-with-you), #28 splash branding, #29 tasks cleanup, #30 READMEs. Plus a post-audit cleanup commit (`2d042eb`) fixing 5 minor regressions self-found in my work.
- **You (Codex)** shipped 6 items in `89362a9`: #1 Apple notarization pipeline foundation, #5 updater smoke (partial — needs signed artifact), #9 xattr-on-build root cause, #11 account-app v2 pricing, #21 privacy manifest, #22 entitlements audit.

### Sprint progress
- **14 of 32 items done.** 18 remaining.
- All tonight's commits pass `tsc --noEmit` + Python compile + cargo check.
- Installed app on Daniel's Mac is still **0.4.43** (signed locally with Developer ID, NOT notarized yet — your #1 work hasn't produced a notarized .dmg through CI yet).

### Open locks
*None at session end. SPRINT_LOCKS.md is clear.*

### Known small debt I left behind
- `LiquidLift_DevID.csr` + `LiquidLift_DevID.key` on Daniel's Desktop — the loose private key from the Developer ID cert generation. Daniel should move into `~/.claude-credentials/` or delete (the key is in the keychain too).
- Your release.yml line ~88 had a typo: **"Liquid Claps"** should be "Liquid Clips". Tiny but ships in the GitHub Release body copy if not fixed. I didn't touch your file — your call.

---

## What to do next (priority order)

These are YOUR remaining Tier 1 + Tier 2 items per the master sprint. All are unlocked and unblocked.

### 🔴 PRIORITY 1 — Tier 1 ship-gating items (4 left)

| # | Item | Effort | Key files | Why first |
|---|---|---|---|---|
| 2 | ⭐ Animated captions (ffmpeg + ASS) | 12-16 hr | new `python-sidecar/captions.py`, `python-sidecar/stages.py`, `src/components/ClipPreview.tsx`, `src/lib/sidecar.ts` (new RPC) | The single most-asked-for competitive feature per Kimi's UPGRADE_OPPORTUNITIES.md. Without it, users compare to OpusClip and bounce. |
| 4 | mlx-whisper Apple Silicon speedup | 6-8 hr | `python-sidecar/sidecar.py` `_do_transcribe`, `python-sidecar/requirements.txt`, possibly new `whisper_backend.py` for arm64-vs-x86_64 dispatch | 42-min audio drops from ~7-9 min → ~2-3 min. Daniel complained explicitly about speed. |
| 6 | Onboarding + first-run polish | 6-10 hr | `src/components/FirstRun.tsx`, `src/App.tsx` (sign-in flow), new `src/components/onboarding/*` | Public-launch gating. Today's FirstRun is unpolished — first-time user UX needs work. |
| 7 | Marketing site (liquidclips.app) | 8-12 hr | New `liquidclips-marketing/` repo or subfolder (Next.js + Vercel) | No public download URL without it. Includes `/privacy` and `/terms` pages — write copy based on `desktop/`'s actual data flows. |

### 🟠 PRIORITY 2 — Tier 2 items you own (3 left)

| # | Item | Effort | Notes |
|---|---|---|---|
| 3 | PublishModal Ayrshare refactor | 8-10 hr | Heavy frontend rewrite. Drop integration_id model, swap for platform checkboxes from `/social/connections`. Touches `PublishModal.tsx`, `ScheduleQueue.tsx`, `DripCalendar.tsx`. **High-conflict file: I left it untouched in #25 so you have a clean canvas.** |
| 8 | Hosted LLM proxy + tier-gate | 4-6 hr | New `junior-backend/app/routes/proxy_llm.py` + tier check (Pro+ uses our key, Free is BYO). Wire desktop `python-sidecar/llm.py` to branch on tier from `/me`. |
| 12 | Stripe Connect + Whop sign-in polish | 4-5 hr | Whop `liquidclips://whop-callback` deep-link, Stripe Connect pre-fill, AffiliateHero copy polish. |

### 🟡 PRIORITY 3 — Tier 3 items (after Tier 1)

| # | Item | Effort | Notes |
|---|---|---|---|
| 19 | Help center / docs | 4-6 hr | `/docs` subroute on marketing site. Depends on #7 done first. |

---

## 🛑 GUARD RAILS — do NOT do these

### Code rules
1. **DO NOT push to `main` without pulling first.** Two commits this session showed a near-conflict (your `89362a9` overlapped with my pending work). Always `git pull --rebase` before `git push`.
2. **DO NOT touch files I just shipped without re-checking.** Especially `desktop/src/lib/sidecar.ts` — I just added `humanError()` + fixed a regex bug there. Re-read before editing.
3. **DO NOT add a SECOND `humanError` function** in any file. There's one in `lib/sidecar.ts` (the shared export). `AyrshareConnectionPanel.tsx` has a Ayrshare-specific renamed `ayrshareError` — that's the only allowed exception.
4. **DO NOT rename or remove `_LEGACY_TIER_ALIASES`** in `app/features.py`. Channel/growth → pro + autopilot → agency. Existing customers depend on it.
5. **DO NOT bump the desktop version** (`package.json` + `tauri.conf.json`) for individual item commits. ONE bump at the end of the sprint = v0.5.0. Use `desktop/scripts/bump_patch.sh` only when ready to ship the full sprint.
6. **DO NOT add new heavy Python deps** to `python-sidecar/requirements.txt` without flagging in your handoff. The sidecar runs the user's SYSTEM Python 3.13 — every dep we add is another `check_deps` failure point on fresh installs.
7. **DO NOT introduce a second styling system** (MUI, Chakra, Tailwind plugins beyond the existing `@theme` tokens, CSS-in-JS, styled-components). The design system is locked.
8. **DO NOT introduce Redux / Zustand without a written reason in your commit message.** React state + lifted state is the rule.
9. **DO NOT remove the cancel-marker contract** (`.lift_cancel` polling in both `lift_transcript` and `ingest_url`). The generation guards in `App.tsx` (`liftGenRef`) depend on it.

### Coordination rules
10. **LOCK before editing high-conflict files.** The list is in `SPRINT_LOCKS.md`:
    - `desktop/src/App.tsx`
    - `desktop/src/components/Settings.tsx`
    - `desktop/src/components/ClipPreview.tsx`
    - `desktop/src/lib/sidecar.ts`
    - `desktop/src/lib/backend.ts`
    - `desktop/python-sidecar/sidecar.py` (METHODS dict)
    - `desktop/python-sidecar/stages.py`
    - `desktop/src-tauri/tauri.conf.json`
11. **READ `SPRINT_LOCKS.md` at session start.** Commit your lock entry. Delete when done.
12. **WRITE to `SPRINT_HANDOFF.md` at session end.** New entry at top, with commits + flags + next-item.
13. **APPEND, don't insert.** When adding a new method to `METHODS` dict in `sidecar.py`, append at the bottom alphabetically. When adding to `Settings.tsx` Sections array, append. Both agents safe to append; mid-list inserts conflict.

### What's high-risk
14. **#2 Animated captions** — burning subtitles via ffmpeg can produce a different visual on each platform's preview, and the ASS Karaoke syntax is fragile. Test the burn-in on a 30-second clip BEFORE you wire the UI. Don't ship the style picker until at least 2 presets render correctly.
15. **#4 mlx-whisper** — model conversion is a one-off step that needs to land in the build pipeline. Don't ship if it requires Daniel to run a manual convert script on first install.
16. **#3 PublishModal refactor** — depends on the Ayrshare profile-key model. Daniel needs to have a real Ayrshare account + paste his Profile Key for end-to-end testing. Don't ship the refactor without verifying at least ONE successful publish.

---

## What I want you to PROACTIVELY add to your work

### Quality gates for every commit
- `cd ~/Desktop/jnr/desktop && npx tsc --noEmit` MUST pass before commit
- `python3 -m py_compile python-sidecar/*.py` MUST pass for Python edits
- `cd src-tauri && cargo check` for Rust edits
- For new methods on sidecar.py — add to `METHODS` dict AND add the wrapper to `lib/sidecar.ts` in the SAME commit

### Telemetry expectations
- For any new user-facing surface, add a `trackEvent("...")` call using a name from the vocabulary in `lib/analytics.ts`. If your event isn't in the vocabulary, ADD IT to the `DesktopAnalyticsEvent` type union first. Don't ship a surface that's invisible to the funnel.

### Error handling expectations
- Every `catch (e)` that surfaces to the user MUST use `humanError(e)` from `lib/sidecar.ts`. Never `setError(String(e))` — it's banned. If you need Ayrshare-specific or context-specific messaging, write a NEW helper alongside (like `ayrshareError`), don't shadow the shared one.

---

## Files / docs you should know about

- `~/Desktop/COMPLETION_SPRINT.md` — master spec, 32 items
- `~/Desktop/jnr/SPRINT_LOCKS.md` — live locks
- `~/Desktop/jnr/SPRINT_HANDOFF.md` — daily handoff log
- `~/Desktop/jnr/UPGRADE_OPPORTUNITIES.md` — Kimi's competitive research (animated captions = #1 differentiator)
- `~/Desktop/jnr/CLAUDE_CONTEXT.md` — Kimi's prior handoff to Claude (history)
- `~/Desktop/jnr/CHANGELOG.md` — I just brought it current up to 0.4.43

---

## When you're done with your batch

Append to `SPRINT_HANDOFF.md` at the top with:
- Items shipped (commit shas)
- Files touched
- In-flight branch state if any
- Blockers / things waiting on Claude or Daniel
- Lock release confirmation
- Next item you'd pick up

Then ping Daniel with a one-line summary: "Codex finished items #X #Y #Z, tsc + cargo + py all green, lockfile clear, next would be #N."

---

*Last updated: 2026-06-01 00:45 by Claude Opus 4.7 (1M context). Ship safely.*
