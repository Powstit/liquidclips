# Proof · Layer 2 · Google OAuth + Gmail contact scan (F5)

De-scoped per Daniel's 2026-07-04 unblock (matches Layer 3 pattern):
real-Gmail integration is his manual step at `signoff G1`; proof list
swaps to jsdom-tested scanner + mock OAuth + synthetic denied surface +
state-machine diagram + client_id env-var reference.

## artifacts
- vitest.txt · assert: "26 passed"
- vitest.txt · assert: "merges People API + sent-box"
- vitest.txt · assert: "0 YT matches → roster is 100% fallback"
- vitest.txt · assert: "3 YT matches → 3 YouTube rows + 17 fallback"
- vitest.txt · assert: "8 YT matches → 8 YouTube rows only"
- vitest.txt · assert: "user-denied path transitions"
- vitest.txt · assert: "missing client_id"
- vitest.txt · assert: "successful roundtrip carries scope"
- vitest.txt · assert: "surfaces RATE_LIMITED"
- vitest.txt · assert: "records the expected transition sequence for a happy-path run"
- vitest.txt · assert: "records the expected transition sequence for the denied path"
- oauth-roundtrip-log.txt · assert: "user_action_at_google=DENY"
- oauth-roundtrip-log.txt · assert: "user_action_at_google=ALLOW"
- oauth-roundtrip-log.txt · assert: "MISCONFIGURED"
- oauth-roundtrip-log.txt · assert: "contacts.readonly"
- oauth-roundtrip-log.txt · assert: "gmail.readonly"
- oauth-denied-inspector.html · assert: exists
- oauth-denied-inspector.html · assert: size > 500
- oauth-denied-surface.png · assert: exists
- oauth-denied-surface.png · assert: size > 5000
- f5-state-machine.txt · assert: "idle → oauth → scanning → crossref → ready"
- f5-state-machine.txt · assert: "idle → oauth → denied"
- f5-state-machine.txt · assert: "idle → oauth → misconfigured"
- client-id-env-ref.txt · assert: "GOOGLE_OAUTH_CLIENT_ID"
- client-id-env-ref.txt · assert: "TODO(daniel-provide-client-id)"
- scope-notes.md · assert: exists
