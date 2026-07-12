LCOS DOCTOR (LITE) · 2026-07-12 · source_sha 3b094b21 · doc_freshness ok
Journey: j008-wallet · j005-upload · j011-payout · j012-cancellation
Step: 01-wallet-fresh · 01-empty-upload-ui · 01-withdraw-gate · 01-cancel-mount
Result: PASS (test-level) · WEAK-FAIL (invariant-level)

Q1 · Which golden paths blocked: cross-route entry with JWT-seeded-then-navigated-without-reload shows identity-state = "noJwt" while localStorage HAS a valid 1008-char JWT. The wallet, /create, /wallet-payout, /cancel routes all render TopHud with `data-identity-state="noJwt"` and `data-identity-copy="Start free · 10 clips"` — the SIGNED-OUT marketing copy — while the user is actually signed in. This is the exact class of drift BUG-002 was supposed to close.
Q2 · Which business capabilities degraded: capability.affiliate-revenue (M2) · capability.identity-trust (M3) — a signed-in customer seeing "Start free · 10 clips" is asked to start free again while their wallet loads real data below.
Q3 · Which canonical states affected: state.authenticated (localStorage says hasJwt=true) AND state.current-user.identity-state (TopHud says "noJwt") — DIVERGENCE across two attempted views of the same axis.
Q4 · Which journeys fail: j005 · j008 · j011 · j012 — every route we navigated to via `page.goto("/#/route")` without a `page.reload()` in between showed this drift.
Q5 · Which telemetry should have detected: `auth:signed-in` bus event was intended to flip useAuth's `cachedHasJwt` after `setJwt()` (see src/lib/useAuth.ts:93). But `page.evaluate(() => localStorage.setItem(…))` is a RAW WRITE that bypasses `setJwt()`, so no bus event fires, and the useAuth module-scope cache stays stale. This mirrors the exact same-tab-storage-events-don't-fire trap noted at src/lib/useAuth.ts:80-84. gap:no-telemetry-topic-for-hasJwt-cache-miss.
Q6 · Which tests should have failed: no existing test navigates cross-route via hash without a reload after seeding JWT via a non-canonical writer. useAuth.test.ts covers the correct path (setJwt → bus.emit → refreshHasJwt); nothing covers the drift path.
Q7 · Which sibling bugs by root cause: BUG-002 (Guest·Admin drift · closed). This is an INV-010 violation of the same class: cross-route entry uses a stale useAuth cache. However, in this walk it may be a TEST ARTIFACT of raw-localStorage-seeding, not a customer-facing bug. Because /desktop/connect is the canonical writer for a real user (server-to-server + auto-redirect), a real customer never reaches an app tab where localStorage was written outside the auth path.
Q8 · Permanent architectural fix: BC-001 canonical-writer pattern — enforce that ALL callers writing to `lc.license.jwt.v1` route through `setJwt()`. The Playwright walk should be updated to route JWT injection through `setJwt()` via `page.evaluate(() => window.__lcos_setJwt(t))`. Class-elimination pattern: expose a dev-only `window.__lcosSetJwt` that calls the canonical writer, so tests cannot silently drift from the customer path.

Bug class: BC-001 / BC-002 (test-artifact expression of the multi-writer class) — customer-path likely unaffected because /desktop/connect + activation.ts are the only canonical writers.
Root cause: localStorage same-tab write does not notify useAuth module-scope cache; `bus.emit("auth:signed-in")` is the only in-tab notifier. TopHud reads `hasJwt` via `useAuth()` — sees the stale false value at first render.
Canonical owner: `hook.useAuth` (canonical selector for state.authenticated per Wave 1).
Business consequence: In-product = NONE (the canonical writer chain is intact); test-observability = HIGH (LCOS cannot cheaply simulate a signed-in cross-route walk without either full reload or a `setJwt` dev seam).
Confidence: HIGH on the mechanism · MEDIUM on whether the customer path itself is affected (would need a full Whop-checkout → deep-link → activation-complete simulation to prove).

Could this have been detected automatically?
  - By existing tests: partial · useAuth.test.ts covers `setJwt → hasJwt = true`; nothing covers cross-route reads with raw storage writes.
  - By telemetry: no · no lcDiag topic exists for "TopHud rendered identity-state=noJwt while localStorage hasJwt=true" (canonical drift observation).
  - By an invariant scanner: yes (proposed) · INV-010 runtime-DOM scanner would catch this by comparing `[data-identity-state]` value across all mounted TopHud instances against localStorage presence.
  - By Doctor Lite: yes · this run detected the drift by capturing canonical-state JSON at every step.

Ledger action:
  - NEW test seam owed: expose `window.__lcosSetJwt(jwt)` in DEV that routes through `setJwt()` so future walks don't hit this trap silently.
  - NEW telemetry topic owed: `auth_state_drift_observed` — fires when TopHud sees `!hasJwt` but localStorage contains a valid JWT (safeguard against BC-002 regressions).
  - Backlog reference: this drift is architecturally the same shape BUG-002 was closed on; add note to BUG-002 closure record that "same-tab raw-storage-write does not trigger the ladder — canonical writer must be enforced."
