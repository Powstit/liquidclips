# B4 — Manifest disposition brief (decide in 30 sec)

**Date:** 2026-06-10 (pre-v0.7.45-ship)

## State on the wire RIGHT NOW

| Channel | Version | Audience |
|---|---|---|
| `updates.liquidclips.app/latest.json` (auto-updater) | **v0.4.33** (2026-05-27, ~14 days stale) | Existing installed users — silently upgraded on app launch |
| `api.jnremployee.com/updates/latest.json` (auto-updater mirror) | **v0.4.33** (same) | Same |
| GH Releases latest | **v0.7.42** (today 09:08) | New downloaders via `liquidclips.app/download` |
| Local install on your Mac | **v0.7.44** | You |
| Source HEAD | **v0.7.45** | This ship |

## The decision matrix

| Path | What happens | Pros | Cons | Demo-tomorrow fit |
|---|---|---|---|---|
| **(a) Atomic** — run `./scripts/ship.sh 0.7.45 "notes"` | Bumps + builds + signs + uploads to BOTH manifest hosts + tags + pushes. Existing v0.4.33 users auto-upgrade to v0.7.45 on next app launch. | One command. Existing users on the new build immediately. | **HUGE jump** (v0.4.33 → v0.7.45 = 12 versions). If anything breaks for existing users mid-demo, you'll be debugging during the demo. No rollback window. | ⚠️ Risky |
| **(b) Tag-only** — `git tag v0.7.45 && git push origin v0.7.45` | CI builds + signs + notarizes + publishes the public DMG to GH Releases. Existing v0.4.33 auto-updater users stay on v0.4.33 until you flip the manifest. New downloaders get v0.7.45. | New demo audience (`liquidclips.app/download`) gets clean v0.7.45. Existing users untouched — can't break their day. Rollback = don't flip the manifest. | Existing users miss everything from today (Earn crash fix, mass-delete, contrast, openSmart, P0-P3). Two channels diverge until you flip. | ✅ Lowest risk for demo |
| **(c) Hybrid** — tag-only NOW, run `ship.sh` later | Day-0 (today): same as (b), demo audience gets v0.7.45. Day-1 (tomorrow after demo + ~12hr bug watch): run `ship.sh 0.7.45 "notes"` to flip auto-updater. Existing users upgrade then. | Best of both. Demo audience gets clean ship. Existing users wait 12hr while you watch for crash reports. If something breaks for new users, you fix + roll a v0.7.46 BEFORE existing users get pulled along. | Two-step. You have to remember to flip the manifest tomorrow. | ✅ Best for demo + safety |

## Recommendation: **(c) Hybrid**

Reasoning: your demo tomorrow brings NEW users via `liquidclips.app/download`. They need the v0.7.45 DMG on GH Release — that's tag-only. Existing v0.4.33 users are NOT in the demo audience; they can wait 12hr while you watch for fires. After the demo, if no fires, run `ship.sh 0.7.45 "notes"` to flip the auto-updater.

**Failure mode option (c) protects against:** demo reveals a P0 you didn't catch on the walk → you rev to v0.7.46 + tag-push that → demo audience gets the fix → existing users still on v0.4.33 never see the broken v0.7.45.

## When you're ready

- "tag-only" or "tag" → I run `git tag v0.7.45 && git push origin v0.7.45`, watch CI, drop the GH Release URL when CI finishes.
- "atomic" or "ship" → I run `./scripts/ship.sh 0.7.45 "<notes>"` after you give me the notes.
- "hold" → I do nothing until you decide.

## What's NOT in scope for B4

- The Vercel marketing site deploy of `/start` — that's a separate `vercel --prod --yes` in `liquidclips-marketing/`. Independent of the desktop ship.
- The `account.liquidclips.app` Clerk satellite — already live since this morning, no ship action.
- Newsletter scope — deferred to v0.7.46+ per `desktop/docs/NEWSLETTER_FEATURE_SCOPE.md`.
