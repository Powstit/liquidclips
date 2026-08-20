# ⚠️ STALE — DO NOT BUILD FROM THIS WITHOUT SYNCING FIRST

This is a **frozen, out-of-date copy** of the Liquid Clips video engine.

**The live, actively-developed copy lives at `/python-sidecar/` (repo
root), which is what `desktop-2` actually runs.** This copy exists only
because the legacy `desktop/` app has its own local reference to a
sidecar, and it was never wired to share the root copy.

## Why this matters

This copy is missing fixes already shipped to the live engine, including
(as of 2026-08-20):

- The ffmpeg retry fix for a non-deterministic `libavfilter` crash during
  audio extraction (`fix(sidecar): retry ffmpeg on non-deterministic
  filter-graph crash`, commit `9b2a9be8`) — **not present here**. Any
  build from this copy can still hit that crash.
- Dylib bundling validation added to CI after a `libssl`/`libcrypto`
  version-mismatch bug caused a sidecar-boot crash in production —
  **not present here**.
- Everything else committed to the root `python-sidecar/` since
  `desktop/`'s last real commit, 2026-07-13 (`handover(rc1): clean tree
  for Nigerian dev team`) — a one-time snapshot export, not an ongoing
  sync. Nothing landing in root `python-sidecar/` since then has been
  ported back here.

## Why it's still here instead of deleted

`desktop/` was handed off as a clean-tree snapshot to an external dev
team on 2026-07-13. It's not part of the active desktop-2 release
cadence, but it's kept in the repo rather than deleted in case it's
ever needed again. If that ever happens: **diff this against
`/python-sidecar/` (repo root) and port forward every fix before
building or shipping anything from `desktop/`.**

## Bottom line

- Building `desktop-2`? You're not using this file. Ignore it.
- Rebuilding legacy `desktop/`? **Stop and sync this against
  `/python-sidecar/` first**, or you will reintroduce already-fixed
  crashes.
