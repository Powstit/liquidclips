# Ship-lens · two-lane enforcement · Chapter 8 (2026-07-10)

Companion doc to `desktop-2/docs/ship-lens-rules.json`. Explains the
seven rules the ship-lens reviewer applies against every diff so
money-surface parity is enforced without over-reaching into Design OS
tool surfaces.

## Two lanes

**Section pipeline** (`src/routes/**`, `src/sections/**`, hash-nav
resolution) owns money surfaces. It runs the DESIGN + STATE + JOURNEY
phases AND the seven money-surface rules below.

**Design OS pipeline** (`src/design-os/routes/**`) owns tool surfaces.
It runs the DESIGN + STATE + JOURNEY phases ONLY. Rules 1, 2, 3, 5,
and 5b are silently skipped for Design OS routes. Rule 4 (no
`*_rendered` events) STILL applies — that one covers the whole diff.

## The seven rules

| # | Severity | Applies to           | What it checks                                                                                                                          |
| - | -------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | P0       | money surfaces       | Route file references an approved mockup path (`docs/mockups/approved/<name>.html`).                                                    |
| 2 | P0*      | money surfaces       | If the mockup has a `<video>` tag, the route renders `<SafeVideo>`/`<video>` AND references an MP4 in /brand/founder/, /brand/walkthroughs/, or /demos/. Skipped when the mockup has no video. |
| 3 | P1       | money surfaces       | Route exposes 3+ visible states (`data-state=` OR typed `useState<Union>` with 3+ literals).                                             |
| 4 | P0       | ALL files in diff    | No new `*_rendered` events emitted anywhere.                                                                                             |
| 5 | P1       | money surfaces       | JourneyMapTab.tsx row exists whose citation matches the surface AND resolves to `pipeline: "section"` + `surface_type: "money"` + non-null `mockup_path`.  |
| 5b | P1       | **Wallet only** (routes/wallet-detail/WalletDetail.tsx) | `SectionWithFallback` mount enforcement. Wallet MUST be wrapped in `SectionWithFallback` with the design-OS `EarnRoute` as fallback (`sections/account/AccountSection.tsx`). Other money surfaces (Outreach, Campaigns, Learn, Cancellation, Catalog) intentionally do NOT mount this — they have no legacy fallback surface. See `desktop-2/CLAUDE.md` "Fallback resilience · scoped to Wallet only". |
| 7 | P1       | money surfaces       | Money surface render body is wrapped by Watchdog + EngineErrorBoundary directly OR through a wrapped Section shell.                     |

## Rule 6 · Design-OS exemption

Design OS routes (`src/design-os/routes/**/*.tsx`) BYPASS rules 1, 2,
3, 5. Rule 5b applies only to Wallet (see the Wallet-only scope in the
table above). Rule 4 still applies (no `*_rendered` telemetry
anywhere). Rule 7 is applied at the Section shell layer for money
surfaces mounted through the outer AppShell hash — Design OS routes
have their own error boundary conventions (KadeRepairScreen, etc.)
covered by the shipped phases 1-3.

## Self-test evidence (2026-07-10 · Chapter 8 landing)

Verified on the merged `integration/cold-entry-mode-b @ a4d5762`
baseline:

| Target                                              | Rule                                          | Result       |
| --------------------------------------------------- | --------------------------------------------- | ------------ |
| `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` | 1 (mockup ref)                              | PASS         |
| WalletDetail                                        | 2 (video tag + MP4 source)                    | PASS (SafeVideo + `/brand/founder/founder-wallet.mp4`) |
| WalletDetail                                        | 3 (3+ states via `data-state=`)               | PASS (4)     |
| WalletDetail                                        | 4 (no `*_rendered`)                           | PASS         |
| WalletDetail                                        | 7 (Watchdog wrap · inherited from Section)    | PASS         |
| `desktop-2/src/design-os/routes/Workstation.tsx`    | 1, 2, 3, 5, 5b                                | SKIP (Design OS exempt) |
| Workstation                                         | 4 (no `*_rendered`)                           | PASS         |
| Synthetic fake surface (mockup ref, no video)       | 2 (video required by wallet-detail mockup)    | **P0 FLAG** as expected |
| `Analytics.tsx`, `Campaigns.tsx`, `AgencyCampaigns.tsx` (Design OS regression) | 4 | PASS (all clean) |

## Where the rules live

- **Rulebook** (canonical machine-checkable JSON): `desktop-2/docs/ship-lens-rules.json`.
- **Reviewer prompt** (loads the rulebook and applies it): `~/.claude/agents/ship-lens-reviewer.md` (Step 2b · added Chapter 8).
- **Companion prose** (this file): `desktop-2/docs/ship-lens-two-lane-enforcement.md`.

## Rule 5b scope note (Phase 2 finalization · Option B · 2026-07-10)

Rule 5b is **live for Wallet only**. Wallet is the only Section-pipeline
money surface with a genuine older customer surface (`design-os/routes/
Earn.tsx`) that can act as a legacy fallback if the new route throws.
The `SectionWithFallback` primitive is mounted around WalletDetail in
`sections/account/AccountSection.tsx` and proven by the 12 vitest tests
in `src/components/SectionWithFallback.test.tsx` plus the parity
assertions in `sections/account/AccountSection.test.ts`.

Other Section-pipeline surfaces (Outreach · Campaigns · Learn ·
Cancellation · Catalog) are **exempt** from Rule 5b. Mounting
`SectionWithFallback` around them would be documentation theatre — no
legacy fallback surface exists, so a crash would still show the
`EngineErrorBoundary` inline error card either way. We claim only what
actually ships.
