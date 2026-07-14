LCOS DOCTOR (LITE) · 2026-07-12 · source_sha 3b094b21 · doc_freshness ok
Journey: j010-referral
Step: 01-referral-affordance
Result: WEAK-FAIL (invariant-observability gap)

Q1 · Which golden paths blocked: none — the referral affordance IS present in the code (WalletDetail.tsx:873 "R3 (2026-07-11) · Referral link + QR block"), but the walk could not confirm it renders because no route emitted `#/wallet` at the moment we probed.
Q2 · Which business capabilities degraded: capability.affiliate-revenue — the referral link is the only free-user monetisation surface; if the mount is silent, the growth flywheel breaks and there's no way for LCOS to know.
Q3 · Which canonical states affected: state.affiliate-code · state.referral-link (not enumerated in 06_CANONICAL_STATE_REGISTRY.md).
Q4 · Which journeys fail: j010 (this journey).
Q5 · Which telemetry should have detected: `referral_link_copied` telemetry topic does NOT exist. `referral_qr_shown` does NOT exist. Gap: gap:telemetry-missing-for-referral-events.
Q6 · Which tests should have failed: no existing regression test asserts the referral link/QR block renders when a customer with `affiliateId != null` opens the wallet.
Q7 · Which sibling bugs by root cause: none (this is a coverage gap, not a bug).
Q8 · Permanent architectural fix: BC-004 (business journey with no canonical owner) — the referral journey is one of the 15 in `lcos/04_JOURNEYS.md` awaiting authorship. Fix pattern: write the j010-referral journey file with owning capability (affiliate-revenue), station chain (mount → link-visible → link-copied → OS-share), expected telemetry per station, acceptance test IDs.

Bug class: BC-004 (journey with no canonical owner) · BC-005 candidate (canonical stubs owed).
Root cause: The walk selector `[data-referral-link]` does not exist in code. The WalletDetail referral block uses no stable testid. Test-observability gap, not a customer-visible bug.
Canonical owner: (owed) — `capability.affiliate-revenue` implies ownership but no journey file exists.
Business consequence: Trust=NONE (customer sees it fine when they get to the route); Revenue=LOW (growth flywheel measurement blind); Support=NONE.
Confidence: HIGH · this is a coverage gap, not a runtime bug.

Could this have been detected automatically?
  - By existing tests: no · j010-referral has no test.
  - By telemetry: no · no referral topic in the registry.
  - By an invariant scanner: no · INV-009 route-to-journey scanner not yet fired.
  - By Doctor Lite: yes · flagged as gap.

Ledger action:
  - NEW journey file owed: `lcos/04_JOURNEY_BIBLE/j010-referral.md`
  - NEW test seam owed: add `data-referral-link` + `data-referral-qr` to WalletDetail R3 block
  - NEW telemetry topics owed: `referral_link_copied`, `referral_qr_shared`
