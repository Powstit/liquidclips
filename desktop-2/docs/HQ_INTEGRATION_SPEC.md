# HQ Integration Spec

Owner: Liquid Clips core • Audience: Nigerian dev team + Codex
Status: RC1 handover • Last citation sweep 2026-07-13

The wire spec between the desktop-2 app, user machines, the FastAPI
backend on Railway, HQ (Admin panel inside the account-app), and Codex.

Two golden rules first, then the event catalog, then privacy.

---

## Golden rule 1 — HQ is off the critical path

The clip pipeline (ingest → transcribe → judgment → cut → export) must
work when HQ is unreachable. Telemetry is fire-and-forget.

Concrete implementation:

- `desktop-2/src/lib/diagnosticLogger.ts` batches `lcDiag` events into
  an in-memory buffer (max 1000 entries, 2s flush interval — see
  `BUFFER_MAX` and `FLUSH_INTERVAL_MS`, lines 24–26).
- Both flushes use `keepalive: true` on the fetch — the browser
  guarantees the request survives `pagehide` / `beforeunload`
  (`diagnosticLogger.ts:95, 139`).
- A failed `/telemetry/diagnostic` POST re-buffers only on 5xx or
  network error (`diagnosticLogger.ts:97–104`). 4xx is treated as a
  permanent shape rejection.
- The `/lcos/events/ingest` fan-out uses `Promise.allSettled` and
  ignores individual failures (`diagnosticLogger.ts:128–142`) —
  `catch(() => undefined)` per event.
- `desktop-2/src/lib/telemetry/sinks/desktopErrorSink.ts` maintains a
  100-item bounded offline queue with jittered exponential backoff
  (`MAX_QUEUE = 100`, `RETRY_BASE_MS = 800`, `RETRY_MAX_MS = 60_000`).
  Items give up after ~12 attempts (`desktopErrorSink.ts:98`) so a
  long-term outage never blocks the render loop or grows the queue
  without bound.
- `EngineErrorBoundary` (`desktop-2/src/design-os/components/
  EngineErrorBoundary.tsx`) catches component crashes and shows a
  local reload button — the boundary never depends on the network to
  render its fallback.

**E2E gate.** Playwright can't reliably intercept `keepalive: true`
fetches (they use a separate browser pool that bypasses CDP route
hooks). To keep test runs quiet the harness sets
`window.__LCOS_E2E__ = true` via `addInitScript` before every
`page.goto()` — see `desktop-2/tests/e2e/_auth-harness.ts:282` and
`_auth-harness.ts:420`.

When the flag is set:

- `diagnosticLogger.flush()` skips the network POST but still drains
  the buffer and calls `persistBatch` (which itself no-ops)
  (`diagnosticLogger.ts:72–86, 116–122`).
- `loginTelemetry` (`desktop-2/src/lib/loginTelemetry.ts:88–93`) and
  `useAuditableAction` (`desktop-2/src/lib/useAuditableAction.ts:95–100`)
  no-op the same way.

Production is unaffected — `window.__LCOS_E2E__` is only set by the
Playwright harness (`diagnosticLogger.ts:69–70`).

## Golden rule 2 — Behaviour only, never content

User clip files, transcripts, and captions **never leave the machine**
unless the user explicitly opts in via a support flow (e.g. attaching a
diagnostic bundle to a ticket — see §"Diagnostic bundles" below).

Telemetry payloads carry:

- What happened (event name, success bool, stable_error_code)
- Where it happened (surface, route, feature_id, release, build)
- Correlation IDs (session_id, correlation_id, attempt_id)
- Sanitised metadata (strings clipped to 240 chars, banned keys
  redacted server-side — see `BANNED_KEY_SUBSTRINGS` at
  `junior-backend/app/routes/telemetry_ingest.py:46–57`:
  `email`, `jwt`, `token`, `secret`, `pin`, `password`,
  `authorization`, `prompt`, `transcript`, `cookie`)

Telemetry payloads do **not** carry:

- Clip binaries, previews, thumbnails
- Transcript text
- Caption text
- Personal messages, DMs, or community posts
- Emails or names (server-side email regex redaction:
  `EMAIL_RE`, telemetry_ingest.py:59; `_EMAIL_RE` at
  `telemetry.py:46`)
- JWTs (`JWT_LOOSE_RE`, telemetry_ingest.py:60)

Any topic added to `lcDiag` that could carry user text must
`.slice(0, N)` at the call site or scrub via
`desktop-2/src/lib/telemetry/redact.ts`. The server re-sanitises on
ingest so a compromised client can't bypass the contract.

---

## Event catalog

Each event category below lists:

- **Name** — the topic string on the client
- **Source** — file:line that emits it
- **Payload shape** — the runtime object attached
- **Privacy** — behaviour vs content (never content)
- **Severity** — P0 / P1 / P2 / P3 default (overridable by HQ operator)
- **Correlation** — which IDs are attached
- **Identifiers** — actor kind + id shape
- **Retry policy** — from the transport layer
- **Queue destination** — which backend table + admin tab
- **Codex lane** — default classification (per
  `HQ_CODEX_OPERATING_MODEL.md` §2)
- **Escalation** — when a human is required

### App health · `diagnostic:heartbeat` (topic `boot`)

- **Source** — `desktop-2/src/lib/diagnosticLogger.ts:173` (`bootDiag`),
  fired from `main.tsx` before ReactDOM render.
- **Payload** — `session_id`, `mode`, `dev` bool, `prod` bool,
  presence booleans for Clerk key / backend URL / Sentry DSN,
  `runtime_canary`, `runtime_version`, `runtime_source`
  (`bundled` | `staged`), `tauri_present`, `user_agent` (120 chars),
  `location_href` (200 chars), ISO timestamp. Field list at
  `diagnosticLogger.ts:173–190`.
- **Privacy** — behaviour metadata only. `user_agent` clipped to 120.
- **Severity** — P3 (informational; volume alerts only).
- **Correlation** — `session_id` from `getSessionId()`.
- **Identifiers** — anon session id (`s_<ts>_<rand>`) unless the
  envelope adapter has an internal id.
- **Retry policy** — batched flush every 2s + on pagehide/beforeunload.
- **Queue destination** — `POST /telemetry/diagnostic` (stdout only —
  `junior-backend/app/routes/telemetry_ingest.py:345`) **and** dual-
  written to `POST /lcos/events/ingest` → `lcos_event` table
  (`junior-backend/app/routes/lcos_events.py:102`). HQ tab:
  **LCOS Events** (`account-app/src/components/admin/LcosEventsTab.tsx`).
- **Codex lane** — informational; only escalated if the boot rate
  drops off relative to a baseline (ENV lane).
- **Escalation** — none by default.

### Crash · `error:boundary` (topic name varies)

- **Source** — `desktop-2/src/design-os/components/EngineErrorBoundary.tsx`
  catches component crashes; global copy lands on
  `window.__lcEngineBoundaryCrashes` (EngineErrorBoundary.tsx:68–90)
  and every failure envelope also triggers `desktopErrorSink`
  (`bootstrap.ts:50`, sink at
  `desktop-2/src/lib/telemetry/sinks/desktopErrorSink.ts:110–115`).
- **Payload** — envelope shape (see `envelope.ts:40–80`) with
  `success: false`, `stable_error_code`, `failure` (sanitized message),
  `route`, `component`, `sessionId`, `runtimeMode`.
- **Privacy** — sanitized message via `sanitizeError` (imported from
  `SectionWithFallback`); no stack from user code sent unless it fits
  the 240-char cap.
- **Severity** — P1 default (P0 if the group affects >5 users in
  <10 min — enforced by HQ tab, not client).
- **Correlation** — `session_id`, `correlation_id`, `attempt_id` from
  envelope.
- **Identifiers** — `user_ref` = internal user id when known, else
  omitted (desktopErrorSink.ts:54).
- **Retry policy** — bounded queue of 100 items, jittered exponential
  backoff 800ms → 60s, ~12 attempts before drop
  (desktopErrorSink.ts:13–15, 98–101).
- **Queue destination** — `POST /telemetry/desktop-error`
  (`telemetry_ingest.py:240`) → `DesktopErrorEvent` (raw) +
  `DesktopErrorGroup` (aggregate, fingerprint-deduped). HQ tab: **Bugs**
  (`account-app/src/components/admin/AdminHQ.tsx` TAB list line 189).
- **Codex lane** — PRODUCT (usually) or HARNESS (if the
  `feature_id` = `test-harness`).
- **Escalation** — Daniel if fingerprint touches a money surface;
  human reviewer if crash count > threshold set by HQ operator.

### Support · user-initiated

- **Source** — Support flow lives in the account app (Admin HQ tab
  **Inbox**, TABS line 198) and the desktop's support widget. Ticket
  creation is out-of-band relative to telemetry.
- **Payload** — user-authored text, attached diagnostic bundle
  (see below), release info.
- **Privacy** — user-authored text is content — user has consented
  by filing the ticket.
- **Severity** — P2 default, raised by keyword or plan tier
  (Agency > free).
- **Correlation** — `session_id` from the caller's browser or app.
- **Identifiers** — internal user id (authenticated flow).
- **Retry policy** — standard HTTP with 5xx retry.
- **Queue destination** — Inbox tab. Not currently persisted through
  `/lcos/events/ingest`.
- **Codex lane** — SUPPORT.
- **Escalation** — Daniel on billing / refund / dispute keywords.

### Failed actions

- **Source** — `desktop-2/src/lib/authedFetch.ts:110` fires
  `authed_fetch_401_intercepted` on JWT rejection. Click / API
  failures land as failure envelopes through the envelope adapter
  (`desktop-2/src/lib/telemetry/adapter.ts`).
  Login flow emits `auth_start_failed`, `auth_verify_failed`,
  `login_exchange_failed`, `login_exchange_no_jwt`,
  `login_exchange_network_error`
  (`desktop-2/src/components/auth/SimpleLoginPanel.tsx:114, 191`;
  `desktop-2/src/components/auth/ClerkOtpPanel.tsx:339, 356, 385`).
- **Payload** — envelope with `success: false`, `stable_error_code`
  (e.g. `whop_401`, `clerk_401`, `network_error`), `failure`
  (sanitized message), `http_status`.
- **Privacy** — behaviour only. No token / cookie / bearer captured.
- **Severity** — P1 (auth failures) / P2 (generic action failure).
- **Correlation** — full envelope IDs.
- **Identifiers** — anon session id (auth failures happen before
  identity is established).
- **Retry policy** — envelope adapter fan-out to four sinks; per-sink
  retry policy applies.
- **Queue destination** — `telemetry_events` table via
  `POST /telemetry/event` (`telemetry_ingest.py:151`) and also
  `lcos_event` via `/lcos/events/ingest`. HQ tab: **Sign-in Ops**
  (`account-app/src/components/admin/SignInOpsTab.tsx`) for auth
  events; **Alerts** for the rest.
- **Codex lane** — PRODUCT (if reproducible) or EXTERNAL (if
  `stable_error_code` starts with `whop_` / `clerk_` / `stripe_`).
- **Escalation** — human always for auth failures — money adjacency.

### Processing failures (ingest / transcribe / judgment / cut)

- **Source** — sidecar_call error paths (`desktop-2/src/lib/
  diagnosticLogger.ts:242–251` — `classifyError` returns
  `state_not_managed` / `bundle_missing` / `restart_cap` /
  `binding_failed` / `no_command` / `method_not_found` / `other`).
  Engine bricks (`UploadPortal`, `StageRail`, `ResultsGrid`, `ClipCard`)
  emit through `EngineErrorBoundary` metadata.
- **Payload** — envelope with `feature_id` = `j006-clip-generation`
  (or the specific stage), `stable_error_code` from the classifier,
  `duration_ms`, sanitized message.
- **Privacy** — behaviour only. No clip content, no transcript text.
- **Severity** — P0 if `sidecar_probe` returns `state_not_managed`
  (BUG-RT-012 cold-boot race — `diagnosticLogger.ts:213`) or
  `bundle_missing` (BUG-RT-001 — `diagnosticLogger.ts:215`). P1
  otherwise.
- **Correlation** — full envelope IDs; sidecar_probe adds
  `elapsed_ms`.
- **Identifiers** — internal user id when signed in.
- **Retry policy** — envelope adapter default (§App health).
- **Queue destination** — `telemetry_events` + `lcos_event`. HQ tab:
  **Clip Runs** (`account-app/src/components/admin/ClipRunsTab.tsx`).
- **Codex lane** — PRODUCT (sidecar drift) or ENV
  (`restart_cap` → resource exhaustion).
- **Escalation** — Daniel on any `state_not_managed` spike (P0).

### Auth failures (Whop 401, Clerk 401)

Covered under **Failed actions** — same wires, same retry, same lane
routing. Called out separately because both are money-adjacent and
default to human review.

### Payment mismatches (subscription state drift)

- **Source** — `WhopStatusChip` behaviour drift trifecta test at
  `desktop-2/src/design-os/components/WhopStatusChip.test.ts:84` +
  `/sync` tier resolution mismatch caught by
  `junior-backend/app/routes/sync.py`. When the desktop's cached tier
  disagrees with the backend's, `/sync` returns the truth and the
  client fires a `tier_drift` envelope.
- **Payload** — envelope with `stable_error_code = tier_drift`,
  `payload` = `{ client_tier, server_tier, whop_status, source: "sync" }`.
- **Privacy** — behaviour only.
- **Severity** — P1 (revenue-impacting) unless a Whop webhook was
  received in the last 5 min explaining the change, in which case P3.
- **Correlation** — envelope IDs + `whop_user_id` when known.
- **Identifiers** — internal user id.
- **Retry policy** — envelope adapter default.
- **Queue destination** — `telemetry_events`. HQ tab: **Revenue**
  (AdminHQ TABS line 188) + **Webhooks** (line 206).
- **Codex lane** — EXTERNAL (Whop / Clerk / Stripe) with a PRODUCT
  fallback if the state machine is at fault.
- **Escalation** — Daniel — pricing and entitlement are locked to him.

### Update health (runtime update beacon states)

- **Source** — `desktop-2/src/components/UpdateBeacon.tsx:108` fires
  `update_beacon_check_failed` with `reason`, `step`
  (`runtime_info` | `runtime_check_now`).
  `desktop-2/src/main.tsx:74` fires `update_boot_verify_error`.
  State transitions are the canonical journey — see
  `desktop-2/src/lib/updateJourney.ts` (`transitionToChecking`,
  `transitionToDownloading`, `transitionToStaged`, `markFailed`).
- **Payload** — `reason` (string, sanitized), `step`, plus a
  criticality tag from the manifest.
- **Privacy** — behaviour only.
- **Severity** — P0 if `bundle_missing` (BUG-RT-001) or the beacon
  check has failed >3 times without recovery. P2 otherwise.
- **Correlation** — session id + `manifest_url` (no user URLs — the
  manifest URL is a system asset).
- **Identifiers** — anon session id.
- **Retry policy** — beacon retries every 5 min
  (`CHECK_INTERVAL_MS = 5 * 60 * 1000`, `UpdateBeacon.tsx:72`);
  telemetry uses the diagnostic-logger flush cadence.
- **Queue destination** — `POST /telemetry/diagnostic` + `lcos_event`.
  HQ tab: **Releases** (AdminHQ TABS line 194) + **Canary** (line 220).
- **Codex lane** — PRODUCT or ENV (`bundle_missing` = product;
  network flake = ENV).
- **Escalation** — Daniel on any P0 during a rollout window.

### Feature requests (user-initiated)

- **Source** — Support flow (see §Support) tagged with
  `intent: feature_request`.
- **Payload** — user-authored text, current release, tier.
- **Privacy** — user has consented via ticket filing.
- **Severity** — P3 default.
- **Correlation** — session id.
- **Identifiers** — internal user id.
- **Retry policy** — standard HTTP.
- **Queue destination** — Inbox tab. Backlog file target flagged as
  a gap in `HQ_CODEX_OPERATING_MODEL.md` §6.
- **Codex lane** — FEATURE-REQUEST — no code change.
- **Escalation** — Daniel weekly review.

### Diagnostic bundles (full app state snapshot)

- **Source** — support flow user opt-in. Bundle assembled client-side
  from `window.__lcEngineBoundaryCrashes`, the diagnostic logger's
  in-memory buffer, `runtime_info`, and last 100 `lcos_event` topics.
- **Payload** — full behaviour trail + boot state + sanitized recent
  messages. Still no clip content.
- **Privacy** — user has explicitly opted in. The bundle passes
  through the same server-side redactor (`_sanitize_dict`,
  telemetry_ingest.py — banned keys + email + JWT regexes).
- **Severity** — P1 (support-attached) — investigation priority.
- **Correlation** — session id + support ticket id.
- **Identifiers** — internal user id.
- **Retry policy** — single upload with resume via multipart. No
  bundle is retained past the ticket close date.
- **Queue destination** — S3-style artifact bucket (currently
  unimplemented in the backend routes I could enumerate — see gap
  below). Referenced from the Inbox tab.
- **Codex lane** — SUPPORT (investigation) + optional PRODUCT PR if
  the bundle reveals a bug.
- **Escalation** — human always; bundles carry consented content.

---

## Gaps flagged during citation sweep

- **Diagnostic bundle upload endpoint** is not implemented in
  `junior-backend/app/routes/**` under any of `telemetry`,
  `telemetry_ingest`, `lcos_events`, `admin_support`. Nigerian team
  should confirm or build (target route: `POST /support/bundle`).
- **`FEATURE-REQUEST` classification** currently only lives in the
  Inbox tab. There is no `feature_request` event topic emitted by the
  desktop app today. Add a lightweight `lcDiag("feature_request_submitted", ...)`
  in the support widget if you want HQ aggregation.
- **`update:critical` beacon topic** — the criticality tag exists on
  the manifest shape (`UpdateBeacon.tsx:66–70`) but the client does
  not yet fire a dedicated topic when a critical update is served.
  Recommend a `lcDiag("update_beacon_critical_served", { manifest_version })`
  emission.
- **Rate limits** — `POST /telemetry/diagnostic` and
  `POST /lcos/events/ingest` are unauthenticated (by design — a
  broken client must still report). Neither has a documented
  per-IP or per-session rate limit. Add one before opening the
  endpoint to public-network origins.

---

## Verification checklist

- [ ] Golden rule 1 references `keepalive: true`, offline queue, and
      `__LCOS_E2E__` gate with citations
- [ ] Golden rule 2 lists banned server-side key substrings and
      confirms no clip / transcript / caption content
- [ ] Every event category names source file:line, payload shape,
      privacy tier, severity, correlation, retry policy, queue
      destination, Codex lane, and escalation
- [ ] Backend receive endpoints named with prefix + file citation
      (`/telemetry/diagnostic`, `/telemetry/event`,
      `/telemetry/desktop-error`, `/lcos/events/ingest`)
- [ ] Gaps flagged for diagnostic bundle upload, feature-request
      topic, critical-update topic, and rate limits
