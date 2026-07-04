# Scope notes · Security hardening pass 2026-07-04

## Section: SECURITY-HARDENING mode

Locked in by claude-2's paste-back at
`~/Desktop/liquidclips-marketing-hq-v2/01_specs/mini-layers/SECURITY-HARDENING-PASTE-FOR-CLAUDE-1.md`.
Nothing else moves — no G2, no Section C, no merges — until Daniel
types `signoff security-hardening`.

Branch: `security/2026-07-04-hardening-pass` off `port/contextual-overlays-8c`.

## Phase 1 · junior-backend auth + fail-closed hardening

Commit: `08d4da2`

Delivered:
- P0 · `/deployer/broadcast-{start,tick}` · dropped body `user_id` +
  gated behind `current_user`. Prior anon POST could impersonate any
  user + mint attributed preview URLs (IDOR + affiliate-fraud).
- P0 · `/campaigns` · added `current_user` gate. Was anon-readable
  sponsored-campaign catalog (brand · funding % · RPM).
- P0 · fail-closed x-internal-secret gate extracted to
  `deps.require_internal_secret`. Env-gated (production 500 on unset,
  non-prod bypass to preserve existing test contracts that delenv
  INTERNAL_API_SECRET). Applied across 14 admin routes via
  `Depends(require_internal_secret)`.
- P0 · `main.lifespan` boot guard: production refuses to start when
  any of the 6 signature secrets is unset.
- P0 · Every webhook signature verifier is env-gated fail-closed:
  clerk · stripe-connect · ayrshare · railway · whop.
- P1 · `/onboarding/link-whop` identity binding · dropped body
  `clerk_user_id`, derives from `current_user`.

P1 deferred (post-beta):
- P1 · `/telemetry/*` auth + rate-limit — requires slowapi dep +
  FastAPI limiter wiring. Would partially defeat the purpose of
  unauth telemetry (broken clients reporting brokenness).

Test coverage: 11 new negative assertions in
`junior-backend/tests/test_hardening_negative.py`.

## Phase 2 · marketing + account-app frontend hardening

Commit: `db14ac8`

Delivered:
- P0 · marketing CORS whitelist replaces reflection. Only allowlisted
  origins receive Access-Control-Allow-Origin / Credentials headers.
- P0 · `EmbedAuthBridge` trusted-parent origin + source check. Any
  page that iframed `/embed/*` used to be able to postMessage a
  stolen JWT / spoof tier / spoof submissionIds.
- P0 · account-app middleware · explicit CSP frame-ancestors on
  `/embed/*` instead of deleting both headers.
- P1 · marketing referral cookies (`lc_ref`, `lc_source`) flipped to
  `httpOnly: true`. XSS can't read them.

Deferred (post-beta):
- P1 · `@vercel/botid` install on waitlist + referrals/click. New
  npm dep + Vercel-specific runtime config; scope: separate
  mini-layer. CORS lockdown already narrows the attack surface.

## Phase 3 · desktop-2 Tauri hardening

Commit: `64f911e` (bundled with Phase 4).

Delivered:
- P0 · `webview_eval` allowlist in `browse.rs`. Six template prefixes
  cover every legitimate use (F5 contact probe · F6 compose driver ·
  ML-4 click-to-include · `gmailComposeBridge` entrypoint). Anything
  else returns `Err("script not in allowlist")` before the JS ever
  runs — a react-side XSS can't chain into cookie exfil via Gmail.
- P0 · Cargo release-profile block verified (strip=symbols + lto=true
  + codegen-units=1 + panic=abort — landed prior to this pass).
- 4 cargo unit tests covering the allowlist (accepts prefix ·
  rejects arbitrary · tolerates leading whitespace · rejects empty).

Deferred (post-beta):
- P1 · `authStorage.ts` Keychain-first migration
- P1 · `capabilities/default.json` fs:scope narrowing
- P1 · `auth_panel.rs` deep-link token via mpsc
- P1 · `gmailComposeDriver` DOMPurify install
Each requires a Rust-plugin capability change or a new npm dep with
jsdom shim. Scope: separate mini-layer to keep the Rust build surface
reviewable.

## Phase 4 · dangerouslySetInnerHTML sweep

Commit: `64f911e`

Delivered:
- P0 · `safe-inline.tsx` helper. Tokenises the small approved
  vocabulary (`<b>`, `<strong>`, `<br>`, `<span class="X">`),
  allowlists class names to ~10 §13 brand tokens, everything else is
  React-escaped literal text. `<script>`, `onerror`, unknown tags
  can never execute.
- P0 · 5 route files swept — `cancellation-intercept`,
  `sync-mail-money-drop`, `catalog`, `wallet-detail`, `in-app-browser`
  (audit spec called out 4; grep found the 5th).
- 9 vitest assertions covering XSS neutralisation + render paths.

Post-sweep: **0 dangerouslySetInnerHTML in `routes/**`**.

## Phase 5 · gmailComposeBridge module + broadcastQueue wire

Commit: `f706187`

Delivered:
- `gmailComposeBridge.ts` created — closes the Layer-3 wire gap
  called out in the audit. `gmailComposeDriver.ts` docstring said
  `the Tauri bridge lives in gmailComposeBridge.ts` but the module
  didn't exist.
- Exports: `ALLOWED_EVAL_PREFIXES` (client mirror of Rust allowlist),
  `evalInGmail(script)` (gate + Tauri invoke), `sendViaGmailCompose`
  (driver-entrypoint composer), `createProdGmailComposeDriver`.
- 4 vitest assertions covering allowlist accept / reject / whitespace
  tolerance / driver-entrypoint prefix routing.

## Phase 6 · CSS token consolidation

Commit: `e0efb2a`

Delivered:
- 7 port CSS files + `InAppBrowser.css` (found by grep) now reference
  the canonical `--grad-fuchsia` / `--grad-paper` tokens from
  `brandTheme.css` instead of re-declaring identical literal
  gradients. A future brand-ramp shift updates every port surface
  together.
- Accepted infinitesimal drift where brand `--grad-paper` ends at
  `#15151c` vs port literals' `#14141a`. Consolidation is the
  point — brand ramp is the single source of truth.

Post-sweep: **0 `linear-gradient` literals inside `--*-grad-*` local
declarations in `routes/**`**.

## Phase 7 · Verify + PROOF receipt

Full test-suite results (see `test-results.txt`):
- junior-backend pytest: **272 passed** (baseline 261 + 11 new)
- desktop-2 vitest: **39 passed / 5 files** (baseline 26 + 13 new)
- desktop-2 cargo test: **5 passed** (baseline 1 + 4 new)
- desktop-2 tsc: clean
- account-app tsc: clean
- marketing tsc: clean

Grep verification (see `verification-greps.txt`):
- dangerouslySetInnerHTML in routes/**: **0**
- `if secret:` fail-open leftovers in junior-backend/routes: **0**
- `lc-default-salt` live default: **0** (comment memorial only)
- Real creator emails in routes: **0** (only in test fixture)
- Section-B port CSS grad-fuchsia local literals: **0**
- IRON GATE sentinels touched: **0**
- bounty occurrences in new rendered code: **0**

## Status

Section B (hardening pass) FULLY CLOSED — every P0 landed, every
P1 either addressed OR justified as post-beta with rationale.

Waiting for `signoff security-hardening`. Nothing else moves — no
G2, no Section C, no merges — until signoff.

Section B fully closed.
