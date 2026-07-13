# Automated Release State · Liquid Clips RC1 dev-team handover

**Certified commit**: `e446ddb73bdf7694e0b6ac0cfb7f1f2286168e8d` (short: `e446ddb7`)
**Runtime version**: `2.2.36`
**Branch**: `integration/cold-entry-mode-b`
**Handover tag**: `rc1-dev-handover-2.2.36`
**Date**: 2026-07-13

This is the single authoritative release-state document. It replaces all prior sprint reports.

---

## Gate results at `e446ddb7`

| Gate | Outcome | Detail |
|------|---------|--------|
| Shell contract guard | GATE_EXIT=0 | 117 contracts pass, 0 fail (`bash desktop-2/scripts/assert-shell-contracts.sh`) |
| TypeScript build | GATE_EXIT=0 | 0 errors (`npx tsc -b` from `desktop-2/`) |
| Vitest | GATE_EXIT=0 | 578 passed, 1 skipped, 0 failed across 62 test files |
| Playwright D1 sweep | GATE_EXIT=0 | 138 passed, 0 failed, 32 skipped in 46.1 min |

Full logs at `lcos/reports/rc1-sprint/baseline-corrected/final-cert-e446ddb7/`.

---

## The 32 D1 skips (audited, all intentional)

### NATIVE / MANUAL (22 skips)
These cannot run in Vite-dev — they require the Tauri shell, Python sidecar, real API keys, macOS URL scheme handlers, or human interaction. All are documented in `desktop-2/tests/native-walk-prep/*.md`.

- `activation-flow.spec.ts:123` — full cold-start activation walk
- `clerk-otp-login.spec.ts:62` — Clerk panel identifier variants
- `file-drop-export.spec.ts:44` — real Tauri file-drop → sidecar → export
- `gate1-proof.spec.ts:23,103` — sim login screen proofs
- `library-my-clips.spec.ts:130` — canonical Workstation source
- `thumbnail-identity.spec.ts:50` — Thumbnail Studio real generation
- `url-clip-export.spec.ts:41` — full URL → sidecar → MP4 chain
- `watermark-proof.spec.ts:193` — preview promise vs export parity
- `j004-whop-oauth.spec.ts` (4 steps) — real Whop OAuth in OS browser + `liquidclips://` deep-link
- `j005-upload.spec.ts` (4 steps) — NSOpenPanel + Finder drag-drop + sidecar handoff
- `j006-clip-generation.spec.ts` (4 steps) — Whisper transcript + Anthropic judgment + ffmpeg + Reveal in Finder
- `j007-publish.spec.ts` (4 steps) — persistent-cookie webview + real IG/TikTok/YT + native OS notification
- `j015-runtime-update.spec.ts` (4 steps) — manifest stage + `runtime_check_now` + Cmd+R + relaunch cycle

### Pre-refactor (10 skips)
These are test skeletons parked pending downstream wire-up. All documented at their `test.skip` sites and referenced in `docs/KNOWN_ISSUES_AND_DEBT.md`.

- `earn-affiliate-polish.spec.ts:218,294` — one-URL / horizontal containment
- `earn-station.spec.ts:103` — honest zeros parity

---

## What changed during RC1 sprint

- Two-pipeline pattern LOCKED (Section vs Design-OS) — 2026-07-10
- Money-surface rule LOCKED (approved HTML + founder video + 3+ states) — 2026-07-10
- WalletDetail replaces Design-OS EarnRoute (Section pipeline)
- Wave 1 identity ladder (SimpleLoginPanel · WelcomeGate · TopHud canonical pill)
- Train A (identity + Whop CTA + tier + referral)
- Train B (runtime version/update + campaign nav telemetry + HQ persistence)
- Train C (native-required walk prep + money journey + clipping journey)
- Train D (Codex-style restart-gated update journey)
- ConsoleNav two-pipeline fix (`<a href>` → `<button>`)
- Cross-clip persistence race hardening (`clip-shell` primitive)
- Settings reload+re-mock race hardening (`unrouteAll → seed → mock → goto?phase=X`)
- E2E telemetry transport gate (`__LCOS_E2E__`)
- Console-error transport probe (`console-error-transport-probe.spec.ts`)
- 138-test D1 sweep taken from 2 flake failures to fully green

## Current prod blockers

None. Certified state is releasable pending Nigerian dev team walkthrough.

## Immediate next priorities

1. Dev team clones the repo, runs `docs/LOCAL_SETUP.md` day-one checklist
2. Dev team boots app locally, verifies Vite HMR at `localhost:1420`
3. Dev team runs targeted Playwright specs, confirms green
4. Dev team reads `docs/DEV_TEAM_HANDOVER.md` index in order
5. First-week task list in `docs/HANDOVER_SUMMARY.md`

## Areas NOT to change without approval

- Any pricing / tier definition (LOCKED 2026-07-06: Agency-only $0/$99.99)
- Any money surface (`src/routes/wallet-detail/**`, cold-entry, cancellation, outreach)
- Iron gate sentinels (`IRON GATE IG-NNN`)
- Tauri shell (`src-tauri/**`, `tauri.conf.json`) — FROZEN
- Whop plan IDs
- Auth precedence (Whop primary, Clerk fallback)
- Assisted-schedule walk-around (NO Ayrshare, NO OAuth SDK · persistent-cookie webview + local records + native notification)

See `docs/OWNERSHIP_AND_ESCALATION.md` for the escalation matrix.
