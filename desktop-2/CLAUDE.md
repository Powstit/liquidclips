# Liquid Clips · Desktop 2 · agent guide

Desktop 2 is the Tauri 2 shell (macOS) that ships the customer-facing
Liquid Clips app. The shell is FROZEN — no Rust / Cargo / tauri.conf /
sidecar / package.json / new native commands / shell rebuild without
an explicit greenlight. Every UI change lands as pure-frontend edits.

Read this file before touching anything under `desktop-2/`.

## The money-surface rule (LOCKED 2026-07-10)

> Money surfaces (wallet, cold-entry, outreach, cancellation, catalog)
> must have an approved HTML mockup + founder video + explicit states.
> Tool surfaces (workstation, editor, community, channels, schedule,
> settings, analytics) don't.

Ship-lens enforces this per pipeline:

- **Section-pipeline routes** (`src/routes/**` + `src/sections/**`) fail
  without an approved mockup + founder video + 3+ states (loading,
  empty, error at minimum · money surfaces additionally require the
  cinematic scrubber states declared in the approved HTML).
- **Design-OS-pipeline routes** (`src/design-os/routes/**`) run the
  current lens (behavioral only). They don't need an approved mockup
  because they're tool surfaces.

See `desktop-2/docs/mockups/approved/` for the canonical mockup source
of every money surface. See `src/routes/` for the Section pipeline.
See `src/design-os/routes/` for the Design OS pipeline.

Adding a new money surface without an approved HTML in
`docs/mockups/approved/` is a lens failure. Adding an HTML there
without a matching founder video (`public/brand/founder/*.mp4`) is a
lens failure. Adding either without the 3+ explicit states surfaced in
the built React route is a lens failure.

## Two-pipeline pattern (LOCKED 2026-07-10)

Every user-facing surface resolves through one of two pipelines:

1. **Section pipeline** — money surfaces + cross-cutting shells
   (Wallet · Cold entry · Outreach · Cancellation · Catalog · Account ·
   Diagnostics · HQ Bridge · Learn). Owned by `src/routes/**` +
   `src/sections/**`. Registered in `src/shell/sectionRegistry.ts`.
   Reachable via the outer hash (`#/account`, `#/outreach`, `#/browse`).
2. **Design OS pipeline** — tool surfaces + Kade-driven ergonomic
   routes (Home cockpit · Workstation · Campaigns · Analytics ·
   Channels · Settings · Support · Submissions · Thumbnail Studio ·
   Login onboarding). Owned by `src/design-os/routes/**`. Registered
   in `src/design-os/routing/SimulatorRouter.tsx` (`SURFACE_FOR` +
   `ALIAS_FOR`). Reachable via Design OS `bus.emit("nav:click", …)`
   from `ConsoleNav`.

## Fallback resilience · scoped to Wallet only (LOCKED 2026-07-10)

The `SectionWithFallback` wrapper catches a Section-pipeline crash and
mounts an older-but-working replacement. It is **wired around WalletDetail
only** (`sections/account/AccountSection.tsx`) because the Wallet is the
only money surface with a genuine legacy fallback — the design-OS
`EarnRoute` is the older wallet implementation.

Other Section-pipeline surfaces (Outreach, Campaigns, Learn,
Cancellation, Catalog) do **not** mount `SectionWithFallback` because
no older customer surface exists to fall back to. If any of those
throws, `EngineErrorBoundary` still catches the crash and shows the
inline error card — but there is no lower-tier surface to render.

**Do not claim app-wide fallback resilience.** The claim is scoped to
Wallet. Ship-lens rule 5b enforces this scope; adding
`SectionWithFallback` around a route that has no real fallback surface
is not resilience, it is theatre.

## Read these before touching desktop-2

1. `docs/mockups/APPROVED_SOURCE.md` — the money-surface mockup source.
2. `docs/mockups/approved/*.html` — the actual approved mockups.
3. `../CLAUDE.md` — repo-root cross-cutting rules.
4. `../desktop/CLAUDE.md` — legacy desktop (Tauri + Python sidecar),
   many primitives still live there and are reused via `src/lib/*`
   ports.

## Hard boundaries (Lane A · product surface)

Do NOT touch:

- `src/components/SectionWithFallback.tsx` (Lane B territory).
- `src/design-os/routes/EarnRoute.tsx` — deprecated behind the money-
  surface rule; the Earn nav item now resolves through the Section
  pipeline (WalletDetail).
- Anything under `../junior-backend/` (backend is Lane B).
- Anything under `../account-app/` admin tabs (Lane B).

## Cross-cutting quick reference

- Watchdog + EngineErrorBoundary wrap every user-reachable route.
- HQ events land on `lcDiag` from `src/lib/diagnosticLogger.ts` —
  behavioral only. No `*_rendered` events.
- Perf contract: static posters · no `backdrop-filter: blur()` in new
  code · no infinite CSS animations in new code · transitions ≤100ms ·
  transform / opacity only · `contain: layout paint style` where safe ·
  no polling · no route-level remounts.
- No fixture data. Use real hooks (e.g. `useWalletLedger()` in
  `src/lib/wallet.ts`). Render honest empty states when a field is
  missing from the API rather than fabricating.
