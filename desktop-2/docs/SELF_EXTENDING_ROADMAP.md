# Self-Extending Roadmap · Liquid Clips Desktop

> **This is a roadmap, not current production.** No extension point ships
> today. This document scopes the direction and locks the safety rules
> so that when the primitive lands, it lands with the guardrails in
> place. **Self-healing first, self-extending later** — see the ordering
> note at the bottom.

`Dropbox: /Liquid Clips/RC1 Handover/self-extending/`

---

## Vision

Users request custom features — a new caption style, a new watermark
template, a new export preset, a new filter for the Whop bounty feed —
and Liquid Clips installs them via **approved extension points**. Each
extension is an **isolated module** with a **permission boundary**, a
**compatibility gate**, and a **regression gate**. Extensions are
**local / user-specific by default**. Any extension can be **rolled back
with one click**. An extension only leaves the user's install and
promotes into core after a **human maintainer review**.

The rule that keeps this safe: extensions never touch money surfaces,
never mutate iron gates, never bypass ship-lens, and never leave the
sandbox unless a human maintainer explicitly promotes them.

---

## Extension points (planned)

The list below is the initial allow-list. Anything outside it fails the
extension-loader contract at install time.

| # | Extension point | What a custom extension can do |
|---|---|---|
| 1 | **Custom caption styles** | Add a caption template (font, colour, per-word highlight, animation curve) that appears alongside the built-in styles in the Workstation caption drawer |
| 2 | **Custom watermark templates** | Add a watermark placement + brand-lock preset that appears in the Export panel (never overrides the free-tier LC animated watermark) |
| 3 | **Custom export presets** | Add a preset (aspect · bitrate · container · captions on/off) to the Export dropdown |
| 4 | **Custom Whop bounty filters** | Add a saved filter to the Whop bounty feed (`BrowseOverlay`) — bounty type, payout range, brand, submission window |

All four extension points are **read-plus-append**: they never remove or
override built-in behaviour, only extend it.

---

## Permission model (planned)

An extension is granted the minimum surface it needs.

- **Default:** user-scoped. The extension is installed for one user on
  one machine. Its config lives under
  `~/Library/Application Support/app.liquidclips.desktop/extensions/<id>/`
  and never touches any other user's local state.
- **Never touches:** iron gates, money-surface behaviour, Rust shell,
  Whop plan IDs, auth precedence, payment code, or any file under
  `src-tauri/**`.
- **API access:** each extension declares its required subset of a
  narrow, versioned extension API (planned name: `lc.ext.v1`). If it
  asks for something not on the allow-list, the loader refuses to
  install it.
- **No network by default.** An extension that wants to call an external
  API declares the URL patterns up-front. The loader refuses install
  until the user confirms.
- **No file-system access by default.** Extensions that need to read /
  write files go through a scoped `lc.ext.fs` API that is confined to
  the extension's own directory.

---

## Isolation (planned)

Each extension runs inside its own sandboxed module boundary. The exact
mechanism is TBD (Web Worker · `<iframe sandbox>` · dynamic import with
a limited context) — the requirement is stronger than the mechanism.

- An extension crash **never** crashes the host surface. This piggybacks
  on the shipped `EngineErrorBoundary` + `Watchdog` (see
  `desktop-2/CLAUDE.md:95` and `desktop-2/src/lib/watchdog/`).
- An extension **cannot** import from `src/lib/wallet.ts`,
  `src/lib/billing/*`, `src/routes/wallet-detail/*`, or any file the
  money-surface rule protects. The loader enforces this by AST-scanning
  the extension bundle at install time.
- An extension has its own diagnostic namespace (`lcDiag("ext:<id>",
  …)`) so its events never mix with core telemetry.

---

## Compatibility gates

An extension declares the version(s) of `lc.ext.v1` it targets. The
loader:

1. Refuses install if the declared version is newer than the host
   supports.
2. Warns on install if the declared version is older than the current
   host — the extension may still work but is opting out of newer
   guarantees.
3. Freezes the extension when the host bumps `lc.ext.v1` to a breaking
   version. The user sees a "This extension is paused pending an
   author update" toast — not a crash.

The API is versioned exactly the same way the runtime bundle is
versioned via `updates.liquidclips.app/latest.json`. No exceptions.

---

## Regression gates

Every extension ships with an automated test suite. The loader **runs
that suite in the sandbox before completing install** — a green run is
the last gate before the extension appears in its extension point.

- Failure → install is aborted, the extension never becomes reachable,
  and an HQ event is emitted.
- Green → install completes, the extension appears in its extension
  point, and the user sees a subtle "New extension available"
  affordance the first time that surface renders.
- The suite re-runs on every host bump so a bump that breaks an
  extension freezes the extension rather than shipping it broken.

The test-harness contract will mirror the shipped Playwright + vitest
pattern already used across `desktop-2/tests/**` — see
`docs/TEST_AND_RELEASE_RUNBOOK.md`.

---

## Rollback

Every extension has a one-click disable.

- Location: `Settings → Extensions → <extension name> → Disable`
- Effect: the extension unmounts from its extension point immediately.
  Its config stays on disk, so re-enable is instant.
- Uninstall (separate action) removes both the extension and its
  config.
- The rollback is user-scoped — disabling on one machine does not
  affect any other install.

---

## Human review for core promotion

An extension only leaves the user's install and enters the core app
after a human maintainer approves it.

- **Path:** the extension author opens a promotion request. A human
  maintainer reviews scope, code, tests, and privacy claims. If
  approved, the extension is folded into `src/**` behind a feature
  flag, then rolled out to a percentage of users, then promoted to
  default.
- **Never automatic.** No amount of green regression runs or install
  count promotes an extension to core on its own.
- **Money-surface extensions never promote.** By construction, the
  extension-point allow-list excludes money surfaces, so promotion
  candidates are always caption / watermark / preset / filter code.

---

## Ordering — self-healing first, self-extending later

Self-healing has to ship before self-extending. Two reasons:

1. **Self-extending increases the failure surface.** Every extension
   is another Node that can crash. Without the Sovereign-Operator
   Watchdog (v1 shipped 2026-07-06) instrumenting every crash and
   the Phase 1 backend + HQ dashboard from
   `SELF_HEALING_ROADMAP.md` shipping first, an extension crash
   becomes a support ticket instead of a repaired Node.
2. **Self-extending relies on the same regression harness self-healing
   uses.** The extension regression gates re-use the vitest +
   Playwright pattern. That harness's canonical runner is
   `lcos/scripts/gate-run.sh` (documented in
   `docs/TEST_AND_RELEASE_RUNBOOK.md`) — self-healing sprints ripen
   that runner first.

Sequence:

- **Now:** self-healing Phase 1 (instrumentation) — see
  `docs/SELF_HEALING_ROADMAP.md`.
- **Post-Cohort 0:** self-healing Phase 2 (safe auto-repair).
- **After Phase 2 stable:** self-extending v1 — scope the four extension
  points, ship the loader + isolation + compatibility gate.
- **After self-extending v1 stable:** self-healing Phase 3 (proactive
  prevention) + self-extending v2 (extension marketplace, if the model
  works).

---

## References

- `desktop-2/CLAUDE.md:10-35` — money-surface rule (extensions never
  cross this line)
- `desktop-2/CLAUDE.md:82-91` — Lane A hard boundaries (extensions never
  cross these either)
- `desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md` — the isolation +
  interception model that extensions plug into
- `desktop-2/src/lib/watchdog/*` — the shipped primitive extensions
  will wrap around
- `docs/SELF_HEALING_ROADMAP.md` — the sibling roadmap that must ship
  first
- `docs/TEST_AND_RELEASE_RUNBOOK.md` — the harness extensions will use
- `[Extension architecture whiteboard](dropbox:///Liquid%20Clips/RC1%20Handover/self-extending/architecture.pdf)` — `TODO: Daniel · generate Dropbox share link for self-extending architecture whiteboard`

## Verification checklist

Files inspected while writing this doc:

- [x] `/Users/dipdip/code/jnr/desktop-2/CLAUDE.md`
- [x] `/Users/dipdip/code/jnr/desktop-2/docs/PROTOCOL_SELF_HEALING_NODES.md`
- [x] `/Users/dipdip/code/jnr/desktop-2/src/lib/watchdog/Watchdog.tsx`
- [x] `/Users/dipdip/code/jnr/desktop-2/src/components/SectionWithFallback.tsx`
- [x] `/Users/dipdip/code/jnr/desktop-2/docs/SELF_HEALING_ROADMAP.md` (companion)
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/HANDOVER_PLAN_QUEUED.md` (rule source)
