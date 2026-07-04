# Scope notes · Layer 2 · Google OAuth + Gmail contact scan (F5)

## Applied Daniel's 2026-07-04 unblock

1. Real-Gmail proofs · de-scoped (matches Layer 3 pattern). Real-Gmail
   walk = Daniel's manual step at `signoff G1`.
2. F7 dependency · STUBBED. `youtubeCrossRef.ts` exposes
   `stubBatchLookup` with a `TODO(claude-1-layer-4)` marker. Every F5
   test passes a mock `batchLookup` — flow proven at YT-match counts
   0, 3, 8.
3. Google Cloud client_id · STUBBED. Read from
   `import.meta.env.GOOGLE_OAUTH_CLIENT_ID` (VITE_ prefix also
   accepted). Marker: `TODO(daniel-provide-client-id)` in
   `googleOAuth.ts`.

## What changed (scope-in only)

- `desktop-2/src/lib/f5/googleOAuth.ts` · OAuth wrapper. Reads
  client_id from env, exposes `runOAuth(deps)` with a mockable driver.
  Typed OAuthResult with DENIED · MISCONFIGURED · NETWORK · TIMEOUT
  error branches.
- `desktop-2/src/lib/f5/contactScan.ts` · People API + Gmail sent-box
  fetch with exponential-backoff-with-jitter retry (max 3, base 500ms).
  Domain extraction + email normalisation. Returns typed ScanError.
- `desktop-2/src/lib/f5/youtubeCrossRef.ts` · F7 stub. Real
  `POST /yt/batch-lookup` is Layer 4 · this module is the mockable
  boundary for now.
- `desktop-2/src/lib/f5/rosterBuilder.ts` · pure fn implementing the
  fallback-to-top-20-most-active rule. YT_MATCH_FLOOR = 5. Roster
  target size = 20. Every row labelled with `source: 'youtube' |
  'fallback'` + human-readable `sourceLabel`.
- `desktop-2/src/lib/f5/scanner.ts` · top-level state machine:
  idle → oauth → scanning → crossref → ready, plus denied /
  misconfigured / error branches. Emits progress events with counts
  per state.
- `desktop-2/src/lib/f5/scanner.test.ts` · 11 vitest tests covering:
  · contact fetch mock (dedupe + sent-count merge)
  · 3 fallback branches (0 · 3 · 8 YT matches)
  · OAuth denied path
  · OAuth misconfigured path (missing client_id)
  · OAuth happy-path scope propagation
  · 429 rate-limit exhausted
  · transient 500 recovery
  · state-machine happy-path transitions
  · state-machine denied transitions
- `desktop-2/scripts/layer2-artifact-harness.mjs` · receipt harness
  producing oauth-roundtrip-log · state-machine diagram · denied
  inspector HTML + puppeteer PNG.

## What did NOT change (scope-out honored)

- No F6 automation touched (Layer 3).
- No roster UI mockup port (Section B work).
- No F7 YouTube worker built (Layer 4).
- No Rust `google_oauth.rs` file yet — the spec suggests
  tauri-plugin-oauth for the real driver, but per the unblock message
  the TS-side is what tests. Rust bridge lives with Layer 4's F7 wire
  and Daniel's live OAuth setup at signoff.

## What's deferred to signoff G1

- Real burner-Gmail OAuth flow.
- Real People API + Gmail sent-box fetch against Daniel's account.
- Real YouTube worker integration (Layer 4 in G2).
- `TODO(claude-1-layer-4)` marker in youtubeCrossRef.ts routes to
  the real `POST /yt/batch-lookup` when Layer 4 lands. F5 needs no
  rewrite — the module boundary is stable.
- `TODO(daniel-provide-client-id)` marker in googleOAuth.ts routes
  to the Google Cloud console setup Daniel spins up at signoff.

## Regression proof

Vitest: `26 passed, 3 test files` (was 15 · +11 new for F5).
Backend: unchanged (Layer 2 is desktop-2-only).
