# `src/sections/` — orphaned pre-design-OS tree

**None of these files reach a running install.** The shipping shell
(`src/App.tsx` → `src/design-os/**`) does not mount anything from
`sections/`. Everything here is the pre-design-OS UI kit kept only
for design reference during the v2.2 → design-os migration.

Batch 3A of Step 3 verified reach by grep: zero imports of
`sections/**` from `src/App.tsx`, `src/shell/**`, `src/design-os/**`,
`src/main.tsx`, or `src/overlays/**`. See
`docs/fixture-inventory.md`.

Batch 3C is the compile-time boundary: every fixture whose ONLY
consumers live here has been renamed to `.preview.ts` / `.preview.tsx`,
and the production-fixture scanner
(`scripts/production-fixture-scan.sh`) now refuses any import of a
`.preview.` module from OUTSIDE this directory. That guarantees a
future refactor cannot silently re-mount a preview surface without
tripping the CI gate.

## Do not

- Import from `sections/**` in App.tsx or any design-os route.
- Move code out of here without re-classifying its fixture inputs
  first (real backend, empty state, error state).

## Do

- Use as a design-preview reference when scoping the real replacement.
- Delete individual files if you're sure nothing else in this tree
  references them — the scanner will confirm.
- Migrate a file OUT by re-implementing it against real backend rows
  and moving it into `src/design-os/routes/` alongside its live
  counterparts.
