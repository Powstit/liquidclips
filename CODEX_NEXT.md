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

---

# 🔍 AUDIT — Codex's prior session (added 2026-06-01 01:05)

Claude ran a focused audit on commit `89362a9` + your uncommitted worktree changes (#1, #5, #9, #11, #21, #22). Most of your work is SOLID — listed at the end. Eleven findings worth your attention before you ship the next pass:

## 🔴 SHIP-BLOCKERS (would fail the first signed/notarized release attempt)

1. **`account-app/src/components/PricingCards.tsx:34-35`** — `PRO_PLAN_ID` / `AGENCY_PLAN_ID` have NO fallback default. Buttons render as **"Opening soon" (disabled)** unless `NEXT_PUBLIC_CLERK_PRO_PLAN_ID` / `..._AGENCY_PLAN_ID` are set on Vercel. Your handoff said "Pro/Agency reuse existing production Clerk plan IDs during the transition" — that's FALSE in code. Either set the env vars OR change copy to "Join waitlist."

2. **`.github/workflows/release.yml:91-96` + `tauri.conf.json:74`** — Tauri updater `pubkey` baked into the config MUST match the private key in `TAURI_SIGNING_PRIVATE_KEY` GH secret. If they don't, every installed user's auto-update will reject signature verification and the app silently stops updating after first ship. Confirm GH secret matches pubkey fingerprint `B1E037066BFCE444` before tagging.

3. **`desktop/src-tauri/PrivacyInfo.xcprivacy`** — missing `NSPrivacyAccessedAPITypes`. Apple now requires apps touching Required Reason APIs (UserDefaults, file timestamps, system boot time, disk space, active keyboard) to declare them. WKWebView uses UserDefaults at minimum. Currently only `NSPrivacyCollectedDataTypes` is declared. App Store review (and increasingly Gatekeeper) will reject. Add at least `NSPrivacyAccessedAPICategoryUserDefaults` reason `CA92.1` and `NSPrivacyAccessedAPICategoryFileTimestamp` reason `C617.1`.

## 🟠 WILL-BITE-SOON

4. **`account-app/src/app/upgrade/page.tsx:44`** — legacy users see literal "Currently on Growth" / "Autopilot" in the header copy. `capitalise(currentTier)` bypasses the `publicTierName` normalizer used elsewhere on the page. Wrap with same normalizer.

5. **`account-app/src/app/upgrade/page.tsx:54-62` + `PricingCards.tsx:66,82`** — prepaid +5 account-pack cross-sell is display-only text. Shows "$40 / +5" with no checkout target, no Stripe price ID, no button. Backend `account_limit(tier, extra_packs)` accepts the value but the purchase path is missing entirely. Either ship a real `CheckoutButton` with a Clerk add-on plan ID, or remove the copy until the flow exists.

6. **`.github/workflows/release.yml:38-49`** — `brew install ffmpeg` on macos-latest is arm64-only. Universal build (`--target universal-apple-darwin`) bundles an arm64 ffmpeg into the x86_64 slice → x86_64 Mac users will hit "Bad CPU type in executable" on first lift. Your inline comment acknowledges this but the artifact still ships as `universal.dmg`. Either lipo arm64 + x86_64 ffmpegs, or rename target/artifact to `aarch64-apple-darwin`.

7. **`desktop/src/components/Settings.tsx:19`** — `type Tier = "free" | "solo" | "growth" | "autopilot"` — desktop still uses legacy names. You normalized account-app but desktop is untouched. A user upgraded to `tier="pro"` will silently fall through to the "free" branch because `"pro"` isn't in the union. Add `"pro" | "agency"` + audit other desktop references.

8. **`desktop/scripts/strip-xattrs.sh:7-26`** — runs from `desktop/` cwd. Misses `src-tauri/target/release/junior-desktop` (the compiled Rust binary). `beforeBundleCommand` runs AFTER cargo build, so the binary is on disk and CAN carry xattrs. Add `xattr -cr src-tauri/target/release/ 2>/dev/null || true` at the end.

## 🟡 MINOR

9. **`account-app/src/components/AffiliateCard.tsx:80`** + **`desktop/src/components/Settings.tsx:660-662`** — still reference `founder` flag in UI labels. "Founder removed from UI" is account-app-only so far.

10. **Installed 0.4.43** lacks `PrivacyInfo.xcprivacy` in `Contents/Resources/` — built before your manifest landed. Not a Codex bug; Daniel can't verify manifest until next ship.

11. **`desktop/src-tauri/tauri.conf.json:82-84`** — deep-link scheme still includes `"junior"` alongside `"liquidclips"`. Probably intentional back-compat. Confirm with the rebrand memo.

## ✅ SOLID (no action needed)

- `notarize.sh` — clean: `--wait`, fallback to keychain profile locally vs CI Apple credentials, extracts submission ID, fetches log on rejection, staples + verifies with `spctl --assess`, correct exit codes.
- `release.yml` notarize step — runs AFTER tauri-action produces the .dmg (line 98), uses `find` not `ls`, fail-fast.
- Developer ID cert import — uses `apple-actions/import-codesign-certs@v3` with `.p12` + password from secrets, NOT a keychain profile. Correct.
- `entitlements-direct.plist` — DYLD removed (no `DYLD_*` usage in sidecar or rust). JIT + unsigned-memory + library-validation kept with inline justifications.
- "Liquid **Claps**" typo I flagged earlier — already fixed in your diff (line 131 now reads "Liquid Clips"). ✓
- Both `PrivacyInfo.xcprivacy` and `entitlements-direct.plist` pass `plutil -lint`.
- `normalizeTier()` (dashboard) + `normalizePlanSlug()` (PricingCards) both handle `growth/channel → pro` and `autopilot → agency`. Matches backend `_LEGACY_TIER_ALIASES`.
- Solo plan ID has a working real default (`cplan_3E4VBeiWtZP0CJsvPwrIz91uDFk`) — most-clicked tier ships working.
- `PrivacyInfo.xcprivacy` is in `bundle.resources` array (tauri.conf.json:58) — will land in `Contents/Resources/`.

**Bottom line:** Notarization plumbing is solid. Three blockers to fix before any signed/notarized release: Pro/Agency unbuyable (#1), updater pubkey/secret mismatch risk (#2), PrivacyInfo missing required APIs (#3). Touch those first.

---

# 🎯 NEXT BATCH FOR CODEX — pick in this order (added 2026-06-01 02:30)

You're free, Claude has been ploughing the bottom + middle of the sprint. Sprint state right now: **21/32 items done**, 11 left.

**Of the 11 remaining, 5 are yours:**

## Priority order (do top first, work down)

### 🔴 PRIORITY 1 — close the 3 audit blockers from your prior session

Before any new work, address the 3 SHIP-BLOCKERS I flagged earlier in this doc (scroll up to the audit section). Quick recap:

| # | What | Effort |
|---|---|---|
| Audit #1 | Set `NEXT_PUBLIC_CLERK_PRO_PLAN_ID` + `..._AGENCY_PLAN_ID` on Vercel — OR change disabled-button copy from "Opening soon" → "Join waitlist" | 15 min |
| Audit #2 | Verify GH secret `TAURI_SIGNING_PRIVATE_KEY` matches the pubkey baked at `tauri.conf.json:74` (fingerprint `B1E037066BFCE444`) | 10 min |
| Audit #3 | Add `NSPrivacyAccessedAPITypes` to `PrivacyInfo.xcprivacy` with at least `NSPrivacyAccessedAPICategoryUserDefaults` (reason `CA92.1`) + `NSPrivacyAccessedAPICategoryFileTimestamp` (reason `C617.1`) | 30 min |

These ship-block any signed/notarized release. **Do them first.**

### 🔴 PRIORITY 2 — Tier 1 items still open (3 of yours)

| Sprint # | Item | Effort | Notes |
|---|---|---|---|
| **#4** | mlx-whisper Apple Silicon speedup | 6-8 hr | Biggest competitive win still pending. After this lands, a 42-min YouTube transcribes in ~2-3 min instead of 7-9. Architecture: add `mlx-whisper` dep, convert tiny model to mlx format once (one-off script), conditional code path picks mlx on arm64 / falls back to faster-whisper on x86_64. Lives in `python-sidecar/sidecar.py` `_do_transcribe` + new `whisper_backend.py`. |
| **#6** | Onboarding + first-run polish | 6-10 hr | Public-launch gating. Today's `FirstRun.tsx` is unpolished — no welcome card, no LLM-key vs hosted explanation, no "drop your first video" hand-hold. Touch: `src/components/FirstRun.tsx`, `src/App.tsx` (sign-in flow), new `src/components/onboarding/*`. Daniel records the demo video referencing this onboarding — see `~/Desktop/RECORDING_GUIDE.md`. |
| **#8** | Hosted LLM proxy + tier-gate | 4-6 hr | $79 Pro tier doesn't have a unique value prop until this ships (Free is BYO OpenAI key; Pro+ gets hosted). New `junior-backend/app/routes/proxy_llm.py` route validates license JWT + tier ≥ Pro + monthly token quota + forwards to OpenAI with our org key. Desktop `python-sidecar/llm.py` branches on tier from `/me`. |

### 🟡 PRIORITY 3 — Tier 3 doc work (1 of yours)

| Sprint # | Item | Effort | Notes |
|---|---|---|---|
| **#19** | Help center / docs on marketing site | 4-6 hr | You shipped #7 marketing site already. Add `/docs` subroute with: Getting Started, Tier Comparison, BYO API key guide, Supported URL sources, Troubleshooting, Auto-updates. Markdown-driven with MDX or similar. |

### 🟡 PRIORITY 4 — bonus, optional polish (helps stickiness)

| Idea | Effort | Why |
|---|---|---|
| Audit Claude's recent commits (`737b081`, `c5d34a9`, `fa9d13c`, `86edf41`) for bugs — return the favour. Especially the new `captions.py` ASS generator + the silence/voice ffmpeg chain. | 1-2 hr | Same value as my audit of you — catches regressions before public ship. |
| Visually review the 19 gpt-image-1 sprites in `desktop/src/assets/{tiers,badges,icons/caption-styles,sponsored}/`. Flag any that look off-brand or low-quality so Claude can regenerate before launch. | 30 min | Daniel wants polished UI — second pair of eyes catches what one agent misses. |
| Pull Codex's uncommitted worktree into a proper commit. As of now `git status` shows ~9 files modified that you've never committed (release.yml, account-app pages, etc). They're real work but invisible in `git log`. | 30 min | All your prior work lives in the worktree as "uncommitted" per your own handoff entries — get it permanent. |

## Reference docs you should know about (NEW since last session)

- **`~/Desktop/RECORDING_GUIDE.md`** (NEW) — Daniel's step-by-step recording guide for the marketing-site demo video. Includes the 90-second script + 7 shot list + post-production checklist. Reference this when polishing `#6 onboarding` so the demo's "first-run flow" shot actually matches reality.
- **`~/Desktop/jnr/desktop/src/lib/achievements.ts`** (NEW) — pub/sub achievement system shipped in `86edf41`. If your `#6 onboarding` flow adds new milestone moments (e.g. "first sign-in"), call `recordAchievement(id)` from there. New ids go in the union type + the `ACHIEVEMENTS` map.
- **`~/Desktop/jnr/desktop/src/components/TierAvatar.tsx`** (NEW) — earnings-tier emblem component. If you build the leaderboard rank display (sprint #14a — Claude owns it, but you might cross paths), reuse `tierForEarnings(lifetime_usd)` so the tier band logic stays consistent.

## What Claude is doing while you're on this

Bottom-up sweep through Tier 3, in this rough order:
- ✅ #20 Recording guide — JUST SHIPPED to `~/Desktop/RECORDING_GUIDE.md`
- #16 brief bar removal (workspace UX)
- #17 Settings cleanup (drop legacy Postiz tiles)
- #15 Sponsored Clips carousel (depends on the placeholder sprite that just landed)
- #14a Earnings leaderboard (backend route + frontend panel)
- #12 Stripe Connect + Whop sign-in polish
- #3 PublishModal Ayrshare refactor (the BIG one — 8-10 hr)

We won't collide IF you take Tier 1 items (#4 / #6 / #8) and stay in your domain. Lockfile + handoff log = source of truth.

## When you ship a batch

Update `~/Desktop/jnr/SPRINT_HANDOFF.md` at the top with:
- Items shipped (commit shas)
- Files touched
- Anything blocked
- Lock release confirmation
- Next item

Same protocol as before. Don't break the chain.

---

*Updated 2026-06-01 02:30 by Claude. Sprint at 21/32 done (66%). Don't push without pulling first.*
