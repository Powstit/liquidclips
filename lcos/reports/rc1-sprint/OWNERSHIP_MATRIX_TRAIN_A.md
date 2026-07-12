# RC1 Release Train · Train A · File Ownership Matrix

**Base commit:** `3b094b21` (post-Wave-1 merge · golden-path proof pack about to be committed)
**Dispatched:** 2026-07-12
**Integration lead:** Claude (does not implement · reviews + merges only)

Train A runs in parallel · one agent per branch · isolation:worktree. No two agents may edit the same file. If an agent needs to touch a file outside its OWNED list, it STOPS + reports.

---

## Agent A1 · Identity hydration (BUG-015 + BUG-016 piggyback)

**Branch:** `wave-a1/identity-hydration`

### OWNED (may edit)
- `desktop-2/src/design-os/state/useMe.ts`
- `desktop-2/src/design-os/state/useAuth.ts` (piggyback for BUG-016)
- **NEW** `desktop-2/src/design-os/state/useMe.hydration.test.ts`
- **NEW** `desktop-2/src/design-os/state/useAuth.drift-detection.test.ts`

### READ-ONLY (may reference, may not edit)
- `desktop-2/src/design-os/components/TopHud.tsx`
- `desktop-2/src/overlays/invaders/SplashLeaderboard.tsx`
- `desktop-2/src/design-os/state/useTierCaps.ts`

### FORBIDDEN
- Any file under `desktop-2/src-tauri/**`, `Cargo.toml`, `tauri.conf.json`, `package.json`, `python-sidecar/**`
- Any file OWNED by A2 or A3
- `lcos/09_BUG_LEDGER.md` schema section (integration lead owns schema)

---

## Agent A2 · Whop CTA visibility + Tier propagation (BUG-004 + BUG-014 + BUG-008)

**Branch:** `wave-a2/whop-tier`

### OWNED (may edit)
- **NEW** `desktop-2/src/design-os/components/WhopStatusChip.tsx`
- **NEW** `desktop-2/src/design-os/components/WhopStatusChip.test.ts`
- `desktop-2/src/design-os/components/TopHud.tsx` (mount chip only · do not touch identity ladder)
- `desktop-2/src/design-os/rooms/CommandRoom.tsx` (Home hero Whop CTA when unlinked)
- `desktop-2/src/design-os/state/useTierCaps.ts` (canonicalise tier read)
- `desktop-2/src/design-os/export/ExportPanel.tsx` (delete `userTier="free"` prop)
- `desktop-2/src/design-os/overlays/OverlayTemplateGallery.tsx` (delete `userTier="free"` prop)
- `desktop-2/src/design-os/reactions/ReactionControls.tsx` (delete `userTier="free"` prop)
- **NEW** `desktop-2/src/design-os/components/TopHud.whop-chip.test.ts`
- **NEW** `desktop-2/src/design-os/rooms/CommandRoom.home-whop-cta.test.ts`
- **NEW** `desktop-2/src/design-os/export/ExportPanel.tier-propagation.test.ts`

### READ-ONLY
- `desktop-2/src/design-os/state/useMe.ts` (reads `whopUserId`)
- `desktop-2/src/design-os/state/useAuth.ts`

### FORBIDDEN
- Any file OWNED by A1 or A3
- `useMe.ts` edits (A1 owner)
- Wave-1 identity ladder logic in TopHud (mount chip alongside, don't rewrite)
- Shell freeze paths

---

## Agent A3 · Referral journey (BUG-017)

**Branch:** `wave-a3/referral-journey`

### OWNED (may edit)
- `desktop-2/src/design-os/wallet/WalletDetail.tsx` (referral block ONLY · `line ~873` and surrounding · add `[data-referral-link]` · `[data-referral-qr]` · `[data-referral-attribution]` seams)
- **NEW** `lcos/04_JOURNEY_BIBLE/j010-referral.md` (journey file · station chain · entry/exit conditions · telemetry per station)
- **NEW** `desktop-2/src/design-os/wallet/referral.journey.test.ts`
- Backend: MAY add telemetry topics + persistence receiver if HQ persistence available; else emit + document gap.

### READ-ONLY
- `desktop-2/src/design-os/state/useMe.ts`
- Backend `/me/affiliate` endpoint

### FORBIDDEN
- Any WalletDetail code outside the referral block (six-state cancellation is C2 owner)
- Any file OWNED by A1 or A2
- Shell freeze paths

---

## Collision-free matrix (verified)

| Agent | useMe.ts | useAuth.ts | useTierCaps.ts | TopHud.tsx | CommandRoom.tsx | WalletDetail.tsx | ExportPanel/Overlay/Reaction |
|---|---|---|---|---|---|---|---|
| A1 | OWNED | OWNED | — | RO | — | — | — |
| A2 | RO | RO | OWNED | mount chip | OWNED | — | OWNED |
| A3 | RO | — | — | — | — | OWNED (block) | — |

A1 owns `useMe.ts` + `useAuth.ts` · A2 mounts a chip in `TopHud.tsx` (no touch to identity ladder) · A3 touches only the referral block in `WalletDetail.tsx`. Zero collisions.

## Dispatch rules (locked)

1. Each agent works in an isolation:worktree from base `3b094b21` (after Phase-0 commit) OR from the Phase-0 commit HEAD.
2. Each agent verifies `git rev-parse HEAD` matches the base before any commit; STOP if diverged.
3. Every commit produces an Impact Report at `lcos/reports/impact/<branch>/<sha>.md`.
4. Bug status ceiling: `FIXED_UNPROVEN`. Zero `CLOSED` transitions.
5. If an agent needs to touch a file outside OWNED, STOP + write `STOP_REPORT.md` + halt.
6. No push. No tag. No deploy. No shell touches.
7. Report back with: final SHA, files touched, tests added, telemetry topics, Impact Report path, any STOP.

## Barrier 1 · integration lead work (after all 3 agents complete)

1. Verify each agent's Impact Report is complete
2. Merge A1 → A2 → A3 into `integration/cold-entry-mode-b` sequentially (`--no-ff`)
3. Run full tests: `pytest` + `vitest` + `tsc --noEmit`
4. Regenerate LCOS graphs (`lcos/graph/*.md`)
5. Run golden-path walk for j001 + j001-station.claim-handle + j004 + j010
6. Ship-lens against merged state
7. If any gate red · STOP + report
8. If all green · dispatch Train B
