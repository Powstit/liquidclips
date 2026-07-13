# Handover Summary · Liquid Clips RC1

For the Nigerian dev team taking over Liquid Clips.

---

## What you're inheriting

**GitHub handover commit**: tag `rc1-dev-handover-2.2.36` (branch `rc1-dev-handover`)
**Original local certification source**: `e446ddb7` (local branch `integration/cold-entry-mode-b`)
**Runtime version**: `2.2.36`
**Tag**: `rc1-dev-handover-2.2.36`

Liquid Clips is a Tauri 2 desktop app (macOS) for short-form video
clippers earning through Whop bounties. It ingests long-form video
(upload / URL), transcribes locally, uses Anthropic to pick clip
candidates, cuts via ffmpeg, and helps the user post to social.

You are inheriting a **certified-green build**:
- 138 Playwright E2E tests pass · 0 fail · 32 documented skips
- 578 vitest unit tests pass · 1 skipped · 0 fail
- TypeScript build clean
- 117 shell contract guards pass

Full state in [`AUTOMATED_RELEASE_STATE.md`](../AUTOMATED_RELEASE_STATE.md).

---

## What changed during RC1 sprint

The sprint that ended at `e446ddb7` locked several architectural
decisions and cleared the last integration flakes.

- **Two-pipeline pattern locked** (Section vs Design-OS routing).
- **Money-surface rule locked** (WalletDetail replaces Design-OS EarnRoute).
- **Wave 1 identity ladder** finished (single canonical identity pill in TopHud).
- **Trains A/B/C/D** landed:
  - A: identity hydration + Whop CTA + tier propagation + referral journey
  - B: runtime version/update truth + campaign nav telemetry + HQ persistence
  - C: native-required walk prep + money journey + clipping journey
  - D: Codex-style restart-gated update journey
- **ConsoleNav** switched from `<a href>` to `<button>` to honour the two-pipeline rule.
- **Cross-clip persistence race** hardened (use `clip-shell` primitive, not the CTA).
- **Settings reload+re-mock race** hardened (`unrouteAll → seed → mock → goto?phase=X` ordering + cache-bust URL).
- **E2E telemetry transport gate** shipped (`__LCOS_E2E__` flag).
- **Console-error transport probe** shipped (proves audit's exact-endpoint filter is honest).

Full list in `AUTOMATED_RELEASE_STATE.md` § "What changed".

---

## Current prod blockers

None. Certified state is releasable pending your walkthrough.

---

## Immediate next priorities

### Week 1

1. **Boot locally**. Follow [LOCAL_SETUP.md](./LOCAL_SETUP.md) day-one checklist. Aim to see Vite HMR at `localhost:1420` and click through the console within 1 hour.
2. **Run the gates**. Run tsc, vitest, shell guard, then a targeted Playwright spec (e.g. `full-clipping-journey.spec.ts`). All should be green. If they aren't on your machine, that's an env issue — flag it, don't push code changes.
3. **Read the pack**. In the order set by [DEV_TEAM_HANDOVER.md](./DEV_TEAM_HANDOVER.md). Ask questions in the shared channel.
4. **Do the "clip a video" walk**. Boot the built app (not just Vite dev), upload a real video file, generate clips, edit one, export. This is the canonical customer experience. If anything breaks, it's a P0.
5. **Read** [KNOWN_ISSUES_AND_DEBT.md](./KNOWN_ISSUES_AND_DEBT.md). Understand what's intentionally deferred so you don't propose "fixing" a known deferral.

### Week 2

6. Pair with Daniel on one Whop bounty submission and one real cash payout — understand the money flow end to end.
7. Onboard onto HQ (`account.liquidclips.app`) — get admin access. Read [HQ_CODEX_OPERATING_MODEL.md](./HQ_CODEX_OPERATING_MODEL.md).
8. Take ownership of an existing bug from `KNOWN_ISSUES_AND_DEBT.md` — the "pre-refactor" test skeletons are good starter tickets. Wire one up.
9. Start dry-running the Codex triage flow on synthetic HQ events. [CODEX_GUARDRAILS.md](./CODEX_GUARDRAILS.md) is the ceiling.

### Week 3+

10. Own a real production release cycle end to end (see [TEST_AND_RELEASE_RUNBOOK.md](./TEST_AND_RELEASE_RUNBOOK.md)).
11. Propose the first Self-Healing capability to ship — see [SELF_HEALING_ROADMAP.md](./SELF_HEALING_ROADMAP.md) Phase 1.

---

## Areas you MUST NOT change without approval

Pricing · tier definitions · money-surface behaviour · iron gate sentinels · Tauri shell · Whop plan IDs · auth precedence · assisted-schedule walk-around.

Full list in [OWNERSHIP_AND_ESCALATION.md](./OWNERSHIP_AND_ESCALATION.md#areas-not-to-change).

---

## When to escalate to Daniel

Product intent · pricing · payment flows · security · locked features · strategic direction. Everything else is your call.

See [OWNERSHIP_AND_ESCALATION.md](./OWNERSHIP_AND_ESCALATION.md) for the full escalation matrix.

---

## Assets on Dropbox

Video walkthroughs, prod screenshots, brand kits, decks — all live at
`Dropbox: /Liquid Clips/RC1 Handover/`. Linked inline throughout the
doc pack. Missing link → search for `TODO: Daniel · generate Dropbox
share link for X` and ping Daniel.
