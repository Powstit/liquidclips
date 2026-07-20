# Iron Gates Registry · Liquid Clips desktop-2

LOCKED 2026-07-20 · Single index of every regression fence. Each gate has 4-5 layers per `feedback_never_regress_4_layer_defense.md`. Run all fences via `scripts/iron-gates.sh {fast|pr|release}`.

## Fences

| Gate ID | Invariant | Owning files | Layer 2 script | Layer 3 vitest | Negative control | Tier |
|---|---|---|---|---|---|---|
| **IG-UNWRAP-CMD** | No bare `.unwrap()` inside `#[tauri::command]` bodies | `src-tauri/src/*.rs` | `scripts/lint-no-bare-unwrap-commands.sh` | `src/lib/tauriCommandsUnwrapAudit.test.ts` | Rust panic hook writes `~/LiquidClips/.last-crash.json` | fast |
| **IG-RUST-PANIC** | No bare panic risk in production Rust outside command bodies | `src-tauri/src/*.rs` · `scripts/rust-panic-baseline.txt` | `scripts/lint-rust-panic-production.sh` | `src/lib/rustPanicProductionAudit.test.ts` | `scripts/fixtures/rust-panic-negative/unsafe.rs` (must fail) · `scripts/fixtures/rust-panic-positive/safe.rs` (must pass) | fast |
| **IG-CAPS-AUDIT** | Frontend plugin import ↔ Rust registration ↔ capability grant parity | `src-tauri/src/lib.rs` · `src-tauri/Cargo.toml` · `src-tauri/capabilities/default.json` | `scripts/lint-tauri-capabilities-audit.sh` (advisory) | `src/lib/tauriCapabilitiesAudit.test.ts` (hard fail) | — | fast |
| **IG-ASYNC-CMD** | Every `#[tauri::command]` is `async fn` (or has `SYNC-OK:` sentinel) | `src-tauri/src/*.rs` | `scripts/lint-tauri-async-commands.sh` | `src/lib/tauriAsyncCommandsAudit.test.ts` | — | fast |
| **IG-IPC-CONTRACT** | Rust cmd fns ↔ generate_handler! ↔ manifest ↔ invoke() literals stay in sync | `scripts/ipc-manifest.json` · `src-tauri/src/*.rs` · `src/**/*.{ts,tsx}` | (bash TBD) | `src/lib/ipcContractAudit.test.ts` + `.negative.test.ts` | 8 negative regex controls in `.negative.test.ts` | fast (vitest) |
| **IG-SIDECAR-CATCH** | No silent `void sidecar.x()` or bare `void invoke()` in high-stakes calls | `src/lib/sidecarSafe.ts` · every consumer | `scripts/lint-no-silent-sidecar.sh` | `src/lib/sidecarCatchAudit.test.ts` | AppShell.tsx onReject runtime observer | fast |
| **IG-AUTH-KEYCHAIN** | Only `authStorage.ts` invokes `secret_{get,set,delete}_jwt` | `src/lib/authStorage.ts` · every consumer | `scripts/lint-auth-broker.sh` | `src/lib/authBrokerAudit.test.ts` | Kill switch `lc:disable-keychain.v1` (default ON) + SessionResetButton recovery affordance | fast |
| **IG-AUTH-KEYCHAIN L5** | No `codesign --force --deep` / `rsync … /Applications` / `security *-generic-password` in shipping scripts outside allowlist | `scripts/lint-forbidden-shortcuts.sh` (allowlist) | `scripts/lint-forbidden-shortcuts.sh` | — | Allowlist is the negative surface | fast |
| **IG-COMPOSER-VISUAL** | MockComposerBody ↔ MockComposer.css data-* attribute pairings + z-index war invariants | `src/design-os/routes/MockComposerBody.tsx` · `src/design-os/routes/MockComposer.css` · `src/design-os/routes/Composer.tsx` | (source-text audit — no bash) | `src/design-os/routes/MockComposer.visualContract.test.ts` | 13 assertion rows include StickyKade z-index, greeting binding, mode/speed/turbo/layout data-* pipeline, slot A/B/C, nav data-active | fast (vitest) |
| **IG-COMPOSER-MISS-DIAG** | `capability_route_miss` telemetry carries `query_text` + frame.hook doesn't claim aspect intents | `src/design-os/routes/Composer.tsx` · `src/design-os/routing/router.ts` | `scripts/lint-composer-miss-diag.sh` | `router.placeholderCommands.test.ts` | — | fast |
| **IG-SESSION-RESET (IG-014-B/C/D)** | Auth keychain purge helper contract + WelcomeGate dual listener | `src/lib/authStorage.ts` · `src/components/auth/*.tsx` | `scripts/lint-session-reset-guard.sh` | `src/lib/authStorage.session-reset.test.ts` · `useAuth.test.ts` · `useAuth.drift-detection.test.ts` | — | fast |
| **IG-OTP-A/B/C** | Observable OTP mailer + honest /start response + non-silent frontend advance | backend `email.py` · `src/components/auth/SimpleLoginPanel.tsx` | `scripts/lint-otp-observable.sh` | `SimpleLoginPanel.otp.test.ts` | — | fast |
| **IG-GOLDEN-JOURNEY** | Sidecar-claimed export path must disk-verify before UI shows success; release evidence must match SHA + version | `src/lib/verifyExportedFile.ts` · `src/lib/goldenJourneyEvidence.ts` · `src/design-os/routes/ExportRoute.tsx` | (release-tier · not fast) | `src/lib/verifyExportedFile.test.ts` (10 tests) · `src/lib/goldenJourneyEvidence.test.ts` (14 tests) | Fabricated evidence · non-existent path · synthetic preview stub · fs throws · stale evidence | release |

## Tiers

| Tier | Wired to | Includes | Wall clock |
|---|---|---|---|
| **fast** | `.githooks/pre-commit` | All lint scripts + fast vitest audits | ~5 s |
| **pr** | manual (`iron-gates.sh pr`) | fast + full vitest + `tsc --noEmit` + brand-kit drift + shell contracts | ~30 s |
| **release** | manual (`iron-gates.sh release`) | pr + Playwright user-lens + `cargo check` | ~2-5 min |

## Grandfathered exceptions

Each exception is listed with an approved reason:

- **`scripts/rust-panic-baseline.txt`** — 2 grandfathered Rust panic sites: `lib.rs:482` (HTTP builder fallback) and `lib.rs:668` (main run.expect). Both unrecoverable init paths. Frozen shell prevents in-place sentinel; baseline is the escape hatch.
- **`scripts/lint-forbidden-shortcuts.sh` ALLOWLIST** — 5 files allowed to reference forbidden strings: the release signing script, the SessionResetButton user-affordance, this scanner itself, the session-reset lint guard (greps for the string as part of its own contract), and the session-reset vitest.

## Deferred work (requires greenlight)

- **Fence 2 · Cargo.toml deps** — `tauri-plugin-shell` and `tauri-plugin-clipboard-manager` are registered in `lib.rs:459-460` but not present in `Cargo.toml`. Next shell tag will fail `cargo build`. Blocked on `desktop-2/CLAUDE.md` shell freeze — needs explicit greenlight to add matching deps.
- **Fence 6 CI wire-up** — real ffmpeg export + evidence JSON generator + native macOS auth smoke on clean profile. Needs a CI runner with ffmpeg + a macOS runner slot. Currently release-tier is vitest + Playwright + cargo check only.
- **ExportRoute wire-up** — `verifyExportedFile` exists but ExportRoute.tsx still hasn't been rewired to THROW on `verified: false`. That is a real user-visible behavior change (previously silently showed success). Pending greenlight.

## Adding a new fence

1. Write the lint script under `scripts/lint-*.sh` with positive + negative fixtures.
2. Write a vitest twin under `src/lib/*Audit.test.ts` for the belt-and-braces layer.
3. Wire into `.githooks/pre-commit` AND `scripts/iron-gates.sh fast`.
4. Add a row to this table.
5. Add the LOCKED memory reference so agents know the fence exists.
