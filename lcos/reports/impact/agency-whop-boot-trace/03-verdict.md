# 03 · Verdict

## Root-cause classification

**Verdict**: not (a) / (b) / (c) / (d) / (e) — **no fault reproducible**.

The failure signature described in the task ("Whop disconnected" and
"Whop connected + tier: agency" self-tests fail deterministically ·
`.lc-app` never mounts · `SimpleLoginPanel` copy visible) does not
reproduce inside this worktree at HEAD
`1e06972649c4626fdc7b2f4a0219fcbc15125817` on branch
`qa-harness/agency-whop-boot-trace` (branched from that SHA).

## Evidence

* Source trace (report 01) — every gate above `.lc-app` is satisfied
  by the harness's seeded state.
  * `WelcomeGate.acked` starts `true` because both `hasJwt() === true`
    (via seeded `lc.license.jwt.v1`) AND
    `localStorage["lc:welcome-acked"] === "1"` — either alone is
    sufficient.
  * `FunnelGate.sessionId === null` (no `?session=` / no funnel
    localStorage key). Returns children.
  * `AuthGate` is a pass-through (documented at `App.tsx:561-616`).
  * `MembershipGate` renders overlay-only, cannot prevent mount.
* Runtime trace (report 02) — three independent boot captures (defaults,
  whop-disconnected, whop-connected+agency) all reach
  `SECTION_HOME · section.activated` (i.e. `.lc-app` mount) followed
  by `me_hydration_succeeded` with `source: real-http`.
* Full self-test suite runs green 5/5 across 4 fresh invocations plus
  2 single-test invocations (see report 02 · reproducibility table).

## Consistency with the base commit message

The base commit's own author note says:

> Agent's isolated-worktree '5/5 pass' claim did not reproduce in main
> repo. Rather than debug further, start D1 to see if the harness is
> fit for purpose in practice · most specs use default (non-Whop)
> state.

My finding (5/5 pass in an isolated worktree) matches the prior
agent's finding. The main-repo reproduction failure was
environmental (something in the main repo's state, not the code at
`1e06972`).

## No fix applied

Per the task's forbidden-actions list, speculative field additions to
the harness are banned. Since the trace proves the harness satisfies
every gate the source reads on this boot path, and every self-test
run at this SHA is green, there is no field to add and no product
code to change.

## Recommended next step for the caller

If the main-repo checkout still shows `3/5 pass` for these self-tests,
the divergence lives in main-repo environment, not code at
`1e06972`. Candidates to investigate:

* Stale `desktop-2/node_modules` or `desktop-2/test-results/`.
* A leftover Vite dev server from a different worktree bound to the
  same port (the config caps at `PW_PORT ?? 1420`; multiple
  concurrent worktrees on the same port will silently reuse whichever
  server was started first, and its bundle may pre-date the harness
  merge).
* A `.playwright/` browser cache that doesn't match the installed
  Playwright package version.
* `localStorage` residue in an off-tree Playwright profile.

None of these are addressable in this task's OWNED files. Report back
without patching.
