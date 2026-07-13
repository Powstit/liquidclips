# Liquid Clips · Dev Team Handover · Index

Welcome. This is the central index for the Nigerian dev team taking over
Liquid Clips development. Read in the order below.

**Certified commit**: `e446ddb7`
**Tag**: `rc1-dev-handover-2.2.36`
**Date**: 2026-07-13

---

## Read order

Follow this order — later documents assume earlier ones.

1. [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md) — what Liquid Clips is, who it serves, what runs live vs mocked. **Start here.**
2. [ARCHITECTURE_MAP.md](./ARCHITECTURE_MAP.md) — how the system fits together (Mermaid). What's local vs remote. Two-pipeline pattern.
3. [FEATURE_INVENTORY.md](./FEATURE_INVENTORY.md) — the full feature matrix. Every route · component · backend dependency · status · coverage.
4. [LOCAL_SETUP.md](./LOCAL_SETUP.md) — clone → boot → HMR in 15 minutes.
5. [TEST_AND_RELEASE_RUNBOOK.md](./TEST_AND_RELEASE_RUNBOOK.md) — how tests run · how releases ship · what "certified" means.
6. [KNOWN_ISSUES_AND_DEBT.md](./KNOWN_ISSUES_AND_DEBT.md) — every intentional skip · TODO · deferred refactor. No hidden debt.
7. [OWNERSHIP_AND_ESCALATION.md](./OWNERSHIP_AND_ESCALATION.md) — who owns what · when to escalate to Daniel.
8. [HQ_CODEX_OPERATING_MODEL.md](./HQ_CODEX_OPERATING_MODEL.md) — the triage flow · specialist lanes · risk levels · 40k-user scale plan.
9. [HQ_INTEGRATION_SPEC.md](./HQ_INTEGRATION_SPEC.md) — the wire spec between app / HQ / Codex.
10. [CODEX_GUARDRAILS.md](./CODEX_GUARDRAILS.md) — the rules Codex agents follow.
11. [SELF_HEALING_ROADMAP.md](./SELF_HEALING_ROADMAP.md) — planned self-repair (roadmap, not current prod).
12. [SELF_EXTENDING_ROADMAP.md](./SELF_EXTENDING_ROADMAP.md) — planned user-installed extensions (roadmap).

Then read:

- [HANDOVER_SUMMARY.md](./HANDOVER_SUMMARY.md) — first-week task list · what to try first · what NOT to change.
- Root [`AUTOMATED_RELEASE_STATE.md`](../AUTOMATED_RELEASE_STATE.md) — certified gate results at `e446ddb7`.

---

## Dropbox

Every large binary asset (video walkthroughs, prod screenshots, brand kits,
decks, journey captures, HQ dashboards) lives at:

**Root**: `Dropbox: /Liquid Clips/RC1 Handover/`

Reference format inside these docs:
```
[label](dropbox://<team-share-URL>)
```

Where a Dropbox share URL is still pending Daniel's generation, docs
mark it as `TODO: Daniel · generate Dropbox share link for X`.

---

## Non-negotiable rules

The following are locked. Do not change without Daniel's written approval.

- **Shell FROZEN** — no `src-tauri/**` edits, no `tauri.conf.json`, no new deps in `desktop-2/package.json`.
- **Two-pipeline pattern** (Section vs Design-OS) · LOCKED 2026-07-10.
- **Money-surface rule** (approved HTML + founder video + 3+ states) · LOCKED 2026-07-10.
- **Agency-only pricing** ($0 sign-up / $99.99/mo) · LOCKED 2026-07-06. Founder / Solo / Pro / Enterprise DEFERRED until 100 Agency users.
- **Iron gates** (`IRON GATE IG-NNN` sentinels) — pre-commit hook enforced.
- **Assisted-schedule walk-around** — persistent-cookie webview + local records + native OS notification. NO Ayrshare · NO OAuth SDK.
- **Whop primary auth, Clerk fallback** — do not flip precedence.

Full list in [OWNERSHIP_AND_ESCALATION.md](./OWNERSHIP_AND_ESCALATION.md#areas-not-to-change).

---

## First command for the dev team

```
git clone https://github.com/Powstit/liquidclips.git
cd liquidclips
git checkout rc1-dev-handover-2.2.36
cat desktop-2/docs/DEV_TEAM_HANDOVER.md
```

Then follow [LOCAL_SETUP.md](./LOCAL_SETUP.md) day-one checklist.
