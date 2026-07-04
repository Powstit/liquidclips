# Scope notes · Layer 3 · Gmail DOM automation (F6)

## Applied Daniel's 2026-07-04 unblock

Received on this turn — quoted decisions:

1. Real-Gmail E2E **de-scoped** (option c). Replaced with jsdom + unit
   tests + synthetic captcha / rate-limit / circuit-breaker cases.
   Real-Gmail walk is Daniel's manual step at `signoff G1`.
2. `webview_eval` **in scope** for Layer 3 · I own the whole chain
   (TS driver + Rust bridge + queue + tests + backend cross-check).
3. F5 fallback-to-top-20-most-active-contacts noted for Layer 2.

## What changed (scope-in only)

- `desktop-2/src-tauri/src/browse.rs` · added `webview_eval` command
  (~22 lines). Fire-and-forget `wv.eval` — Tauri v2 doesn't expose the
  return value; the driver's polling scripts emit a Tauri event with
  the result they need. Nothing else in browse.rs touched.
- `desktop-2/src-tauri/src/lib.rs` · one-line addition to
  `invoke_handler!` registering `browse::webview_eval`.
- `desktop-2/src/lib/gmail/selectorFallback.ts` · pure selector-fallback
  finder + the 6 locked selector tables (compose_button, to_field,
  subject_field, body_field, send_button, send_confirmation_toast,
  captcha_interstitial) with THREE fallbacks each.
- `desktop-2/src/lib/gmail/rateLimit.ts` · 24h rolling counter, keyed by
  UTC day in localStorage.
- `desktop-2/src/lib/gmail/circuitBreaker.ts` · 3× SELECTOR_MISS in a
  5-min sliding window → open + HTML dump. NEVER auto-resumes.
- `desktop-2/src/lib/gmail/timing.ts` · 60-140ms per-char + 6-12s
  between-sends jitter with seedable RNG.
- `desktop-2/src/lib/gmail/gmailComposeDriver.ts` · full compose flow
  wiring the four modules above. Injectable deps for jsdom testing.
- `desktop-2/src/lib/gmail/broadcastQueue.ts` · queue with localStorage
  persistence, run loop, pause-on-captcha, pause-on-rate-limit,
  pause-on-circuit-open. Explicit `.resume()` — no auto-resume.
- `desktop-2/src/lib/gmail/broadcastTemplate.ts` · locked warm-peer
  template renderer from the F6 spec.
- `desktop-2/src/lib/gmail/gmailComposeDriver.test.ts` +
  `broadcastQueue.test.ts` · 15 vitest tests covering the 6 named
  assertions + 3 extras (persistence, resume, jitter bounds).
- `desktop-2/scripts/layer3-artifact-harness.mjs` · captures the
  circuit-breaker log + HTML dump + 50-sends queue-state screenshot
  for the receipt.
- `desktop-2/vitest.config.ts` + `package.json` · vitest install
  (devDep, `test` script). Only test-runner touch.
- `desktop-2/package.json` · added vitest, jsdom, @vitest/coverage-v8
  as devDeps — proof explicitly requires "vitest run" output, so
  the dep add is authorized.
- `junior-backend/app/models.py` · new `DeployerBroadcastTick` model.
- `junior-backend/app/routes/deployer.py` · new endpoints:
  `POST /deployer/broadcast-start` (mints preview URLs per target),
  `POST /deployer/broadcast-tick` (records a send + returns 24h caps).
- `junior-backend/app/main.py` · registers `deployer.router`.

## What did NOT change (scope-out honored)

- No broadcast UI mockup port (`sync-mail-money-drop.html` port is
  Section B work · out of scope for Layer 3).
- No changes to `BrowseOverlay.tsx` architecture beyond adding
  `webview_eval` command.
- No F5 contact-scan work (Layer 2).
- No `browse.rs` changes beyond the one new command (commerce
  intercept + navigation filter untouched).

## What's deferred to Daniel's manual step

- Real burner-Gmail Playwright E2E — Daniel walks 3 warm-peer sends
  himself as part of `signoff G1`. He confirms Sent folder + no
  spam flag on his own machine.
- Live desktop app screenshot of the queue overlay in `tauri dev`
  — my proof screenshot is the synthetic inspector view (proves
  state shape + counts + fallback-selector marker), which is what
  the sprint doc asked for on the "dev UI" language. The polished
  overlay port lives in Section B.

## Regression proof

Backend suite: `261 passed, 3 warnings` (unchanged from Layer 1;
deployer route added but no test broken).
Vitest suite: `15 passed, 2 test files`, run duration 2.40s.
