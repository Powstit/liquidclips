# Agent Operating Rails

> Mandatory read-before-work doc for every coding lane on Liquid Clips desktop.
>
> Read first:
> - `desktop/docs/LOCKED_USER_FLOWS.md`
> - `desktop/docs/AGENT_OPERATING_RAILS.md`

---

## 1. Core principle

We are not building random features.

We are restoring, proving, and locking working user journeys.

- **"Code looks wired" is not acceptance.**
- A feature is accepted only after:
  1. Evidence it worked before.
  2. Diff from that working state.
  3. Minimal patch on the exact broken delta.
  4. Validation (`tsc`, invariants, assertion scripts).
  5. Daniel live-tests the installed app.
  6. Flow is updated and marked `LOCKED` in `LOCKED_USER_FLOWS.md`.

Compiler green is not product green. Daniel confirmation is the lock.

---

## 2. Forensic repair process

For every core user flow:

1. **Find last evidence it worked.**
   - generated output file / export file
   - app log / install or build timestamp
   - git commit / checkpoint
   - user-confirmed live test
   - screenshot or video proof

2. **Map evidence to:**
   - app version
   - commit hash or nearest commit
   - source file state
   - build / install timestamp

3. **Compare current source against last working state.**

4. **Patch only the smallest broken delta.**

5. **Validate.**
   - `npx tsc -b`
   - `npm run test:invariant`
   - `bash scripts/assert-no-passive-keychain.sh`
   - `bash scripts/brand-kit-drift-check.sh`
   - `bash scripts/assert-locked-flow-contracts.sh`

6. **Daniel live-tests the installed/dev app.**

7. **Update `desktop/docs/LOCKED_USER_FLOWS.md`.**
   - Mark confirmed flows `LOCKED`.
   - Mark failed flows `BROKEN / NEEDS PATCH`.
   - Mark skipped flows `WAITING`.

---

## 3. Iron gate rules

- **No broad patching.** Fix the broken line, not the whole file.
- **No "should work" acceptance.** Only Daniel live-test confirms a flow.
- **No "while I'm here" cleanup.** Every changed line must serve the current lane.
- **No UI polish while a core flow is broken unless approved.**
- **No final build unless regression risk is understood.**
- **No commit until the working-state map is clear.**
- **No push / tag / release / `latest.json` unless Daniel approves.**
- **No D1 / payment / auth / backend changes while core flows are unstable.**

---

## 4. Mandatory lane report footer

Every lane must end with:

```text
Locked flows touched:
Candidate flows touched:
Last working evidence used:
Current regression delta:
Files changed:
Files touching cross-cutting areas:
Regression risk:
Validation run:
Live test needed:
Build/install needed:
Commit/push/release touched:
```

---

## 5. App-wide reconciliation rule

Every changed file must be mapped before it ships:

```text
file → why changed → user outcome → flow affected → keep / revert / walkthrough
```

If a file is not tied to a working user journey, it is polish and needs explicit approval.

---

## 6. Option B rule — app-wide new UI candidate

When shipping the full working tree as the new UI candidate:

1. Strip debug logs first.
2. Resolve audit conflicts (e.g., `UI_DEMO_vs_LIVE_AUDIT.json` `do_not_touch_files`).
3. Run validation.
4. Do one integrated local install.
5. Daniel walks through all candidate flows.
6. Confirmed flows become `LOCKED`.
7. Only then commit the app-wide UI candidate.

No commit, push, tag, release, or `latest.json` before Daniel confirms.

---

## 7. Must-read rule

Every future lane prompt must begin with:

```text
Read first:
- desktop/docs/AGENT_OPERATING_RAILS.md
- desktop/docs/LOCKED_USER_FLOWS.md
```

If either file cannot be read, stop and report.
