# Codex — Next Session Brief (FINAL TODAY-SPRINT)

**For:** Codex
**From:** Claude (Opus 4.7) — 2026-06-01 09:00
**Read first:** `~/Desktop/COMPLETION_SPRINT.md`, then this file.

---

## What just shipped (your overnight batch — embraced in `450be51`)

- ✅ #1 + #9 Apple notarization end-to-end + xattr fix — CI signs, notarizes, staples, spctl-verifies, uploads draft release. Pubkey-vs-secret canary preflight included.
- ✅ #7 Marketing site (`liquidclips-marketing/`) — home + privacy + terms, Vercel-ready.
- ✅ #8 Hosted LLM proxy + tier-gate — backend route + desktop fallback path.
- ✅ #10 Tier rename — Founder removed from public surfaces, legacy aliases preserved.
- ✅ #11 Account-app v2 pricing copy.
- ✅ #21 Apple Privacy Manifest.
- ✅ #22 Entitlements audit (dropped unused dyld entitlement).

Verified: `tsc --noEmit` clean across desktop + account-app; `py_compile` clean across backend. No regressions found. **Excellent work.**

---

## Sprint state — what's left to finish today

**Total: 28/32 done (88%).** 4 items remain.

### Yours (Codex) — 3 items, ~6 hours

1. **#4 Transcribe speed (mlx-whisper)** — biggest user-visible perf win still on the board.
2. **#5 Auto-updater real-world test** — now unblocked because #1 ships signed artifacts.
3. **#6 Onboarding flow + first-run polish** — last UX gap before launch.
4. **#19 Help center docs (on marketing site)** — final polish, can ship under `liquidclips.app/help`.

### Mine (Claude) — 2 items, ~10 hours

- **#14a Earnings leaderboard** (in progress now)
- **#14b Hosted compute Pro+ tier** (scoped, after #14a)
- **#12 Stripe/Whop polish** (last)

---

## ⛔ Guardrails — DO NOT touch these files (Claude is in them today)

Until Claude releases the lock in `~/Desktop/jnr/SPRINT_LOCKS.md`:

- `desktop/src/components/earn/AffiliateHero.tsx`
- `desktop/src/components/earn/EarnTab.tsx` (or wherever the leaderboard mounts)
- `desktop/src/components/earn/Leaderboard.tsx` (NEW — Claude is creating)
- `desktop/src/lib/backend.ts` (Claude adding `leaderboardGet()`)
- `junior-backend/app/routes/affiliate.py` (Claude adding `/leaderboard/earnings`)
- `junior-backend/app/main.py` (Claude registering the new router IF leaderboard ships as a new file)

Lock pattern Claude is using:
```
[CLAUDE · 2026-06-01 HH:MM] item #14a Earnings leaderboard — editing <files>
```

If you see Claude's lock active, work a different item. **Locks older than 4 hours are stale — feel free to clear.**

---

## ✅ Safe-to-edit for you today (no Claude conflict possible)

- `desktop/python-sidecar/sidecar.py` METHODS dict (for #4 mlx) — Claude is NOT in the sidecar today.
- `desktop/python-sidecar/` any new files (e.g. `mlx_whisper.py`, `onboarding.py`).
- `desktop/src/components/onboarding/` (whole directory — Claude not touching).
- `desktop/src/App.tsx` ONLY for the first-run check + onboarding route mount (low risk; coordinate via lockfile if you touch it for more than that).
- `liquidclips-marketing/` (all — Claude isn't in marketing today).
- `desktop/CHANGELOG.md` — append-only.

---

## Per-item briefs

### #4 mlx-whisper transcribe speedup

**Goal:** drop a 42-min YouTube transcribe from ~3-4 min → ~2 min on Apple Silicon (M-series).

- Library: `mlx-whisper` (Apple's MLX-native port). Install via the bundled framework Python (`/Library/Frameworks/Python.framework/Versions/3.13/bin/pip install mlx-whisper`).
- Model: bundle `mlx-community/whisper-tiny.en` or the larger `whisper-base.en` — choose by trial; tiny is currently faster than base on faster-whisper, but mlx flips that.
- Wire into `desktop/python-sidecar/sidecar.py`:
  - Add a `mlx_whisper` codepath in `lift_transcript` when `platform.machine() == "arm64"` AND `mlx_whisper` is importable.
  - Fall back to faster-whisper on any error (don't strand non-M users).
  - The `first_segment_event` heartbeat suppression pattern still applies — mlx-whisper yields segments differently, so test the progress emission carefully.
- Don't bundle the mlx model in the DMG (would inflate it ~150MB+). Lazy-download on first use to `~/Library/Application Support/LiquidClips/models/mlx-whisper/`.
- Telemetry: emit `pipeline_transcribe_completed` with `{ engine: "mlx" | "faster-whisper" }` so we can A/B in PostHog.

**Validation:** transcribe the same 5-min and 42-min sample with both engines, compare wall-clock + accuracy (CER if possible).

### #5 Auto-updater real-world test

Now ships — the canary preflight in `release.yml` proves your pubkey + secret match.

- Push a `v0.4.99` tag, watch the workflow build + sign + notarize + draft.
- Edit the draft release to `v0.4.99` (publishes).
- On Daniel's 0.4.43 install: confirm the in-app updater detects, downloads, signature-verifies, and prompts to restart.
- Document the exact tag-and-publish flow in `desktop/CLAUDE.md`.

**Watch for:** the `tauri.conf.json` `plugins.updater.endpoints` URL must resolve to the GitHub releases latest.json. If absent, the updater fails silently.

### #6 Onboarding flow + first-run polish

Currently a fresh install drops user into the workspace with no context. Spec:

- Detect first-run via the absence of any keychain entries (no LICENSE_JWT, no OPENAI_API_KEY).
- 4-card walkthrough overlay:
  1. "Welcome to Liquid Clips" — value prop + one CTA
  2. "Sign in to unlock 100 free clips" — pops Clerk sign-in
  3. "Paste your OpenAI key (or upgrade to Pro for hosted AI)" — links to Settings
  4. "Try your first clip" — loads a sample YouTube URL into the dropzone
- Skip button on every card.
- Persist completion in keychain (`LIQUIDCLIPS_ONBOARDED=v1`) so reinstalls re-run it.
- Telemetry: `onboarding_card_1_shown`, `onboarding_card_4_completed`, `onboarding_skipped_at_card_N`.

Component layout suggestion: new `desktop/src/components/onboarding/` directory, single `<OnboardingOverlay />` mounted in `App.tsx` near `<AchievementToast />`. Reuse the glass-scrim CSS from `InvadersOverlay.tsx`.

### #19 Help center docs

Add a `liquidclips-marketing/src/app/help/` route tree:

- `/help` — table of contents
- `/help/getting-started` — first lift walkthrough
- `/help/connecting-socials` — Ayrshare Profile Key flow
- `/help/upgrading` — tier matrix + how to switch
- `/help/troubleshooting` — common errors (the humanError() catalog is your raw material)

MDX preferred over plain markdown. Lean on the existing marketing site's typography stack.

---

## Workflow protocol

1. **Read `SPRINT_LOCKS.md` BEFORE editing any high-conflict file.**
2. **Take a lock** in `SPRINT_LOCKS.md`, commit just the lock file, then start work.
3. **Release the lock** in the same commit as your work, OR as a follow-up `lock: release ...` commit if you forgot.
4. **Append your handoff** to `SPRINT_HANDOFF.md` at top with timestamp + items touched + validation + known caveats.
5. **No `git push --force`** to main. We're on `main` direct (no PR flow today) — be careful.
6. **`tsc --noEmit` MUST pass** on desktop + account-app + marketing before commit. `py_compile` MUST pass on backend.
7. **Do not bump desktop version** per-item. Daniel handles a single `0.5.0` bump at the end.

---

## When you're done

Drop a one-line PING in `SPRINT_HANDOFF.md` like:

```
## 2026-06-01 HH:MM — CODEX DONE
Items shipped: #4, #5, #6, #19. Ready for v0.5.0 bump.
```

Then Daniel + I take over the build + release + recording.

**Let's finish today.**
