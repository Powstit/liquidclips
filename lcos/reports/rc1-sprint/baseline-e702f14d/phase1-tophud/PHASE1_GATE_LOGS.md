# Phase 1 Gate Logs · Preserved Copy

Local `.log` files are `.gitignore`d (`*.log`). This document mirrors
their content so the receipt survives in git.

Timestamp: 2026-07-12 (local machine)
Base commit at time of run: `30be2f77` (TopHud polish merge)
Wrapper: `/Users/dipdip/code/jnr/lcos/scripts/gate-run.sh`

---

## Gate 1 · `tsc -b --noEmit` (INCORRECT invocation · reproduces TS6310)

Command: `npx tsc -b --noEmit`

```
tsconfig.json(25,18): error TS6310: Referenced project '/Users/dipdip/code/jnr/desktop-2/tsconfig.node.json' may not disable emit.

GATE_EXIT=1
```

Root cause: `--noEmit` propagates to every project in a `-b` build,
forcing it onto the composite `tsconfig.node.json` (which requires
`composite: true` + emit to write its `.tsbuildinfo` sentinel). TS6310
fires because the referenced project ends up with `noEmit: true`.

**Not a config bug. QA command defect.**

---

## Gate 2 · `tsc -b` (CANONICAL invocation · per package.json build script)

Command: `npx tsc -b`

```
GATE_EXIT=0
```

(No output on stdout/stderr — clean compilation.)

Verified twice:
- `tsc-b-canonical.log`
- `tsc-b-canonical-fresh.log` (after `rm *.tsbuildinfo` for cold-cache proof)

---

## Gate 3 · vitest TopHud cluster

Command: `npx vitest run src/design-os/components/TopHud`

```
 RUN  v4.1.9 /Users/dipdip/code/jnr/desktop-2


 Test Files  6 passed (6)
      Tests  70 passed (70)
   Start at  18:29:57
   Duration  2.98s (transform 1.12s, setup 0ms, import 1.20s, tests 590ms, environment 11.35s)


GATE_EXIT=0
```

Files exercised (all pass):
- `TopHud.canonical-identity.test.ts` (new · added by TopHud polish · 8 tests)
- `TopHud.identity-ladder.test.ts`
- `TopHud.identity.test.ts`
- `TopHud.pill.test.ts` (formerly A2 · was failing pre-polish)
- `TopHud.version.test.ts`
- `TopHud.whop-chip.test.ts` (formerly A2 · was failing pre-polish)

Re-run after fresh `tsc -b` (recorded in `vitest-tophud-post-tsc.log`):

```
 RUN  v4.1.9 /Users/dipdip/code/jnr/desktop-2


 Test Files  6 passed (6)
      Tests  70 passed (70)
   Start at  18:40:53
   Duration  2.60s (transform 885ms, setup 0ms, import 929ms, tests 539ms, environment 9.78s)


GATE_EXIT=0
```

---

## Config verdict (both files intentionally unchanged)

`desktop-2/tsconfig.json` (25 lines · root · type-check only):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    ...
    "noEmit": true,   // ← root is type-check only; Vite bundles
    ...
    "strict": true,
    "noUnusedLocals": true,
    ...
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`desktop-2/tsconfig.node.json` (11 lines · composite for vite.config.ts):

```json
{
  "compilerOptions": {
    "composite": true,   // ← composite reference emits .tsbuildinfo
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

This is the standard **Vite React starter template** dual-config
pattern. Do not modify to accommodate a defective QA command.
