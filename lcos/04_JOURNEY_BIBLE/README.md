# 04 · Journey Bible

One file per critical journey. Human-authored. Never regenerated.

Populated in P6 alongside `03_FEATURE_CONTRACTS/`.

## Journeys planned (15)

**Onboarding**
- `j001-fresh-user-otp-identity.md` — install → welcome → OTP → identity resolved
- `j002-returning-user.md` — cold boot with stored JWT → hydrated identity
- `j003-crew-onboarding.md` — post-verify Crew flywheel gate

**Money onboarding**
- `j004-connect-whop.md` — click Connect Whop → OAuth → return → me refreshed → all surfaces updated
- `j005-first-payout-eligibility.md` — reach withdraw eligibility → sign agreement → payout unlocked

**Content production**
- `j006-first-upload-url.md` — URL paste → ingest → transcribe → judge → cut → My Clips
- `j007-first-upload-file.md` — file picker → preflight → same downstream chain
- `j008-my-clips-open-clip.md` — reveal in Finder + open + copy path
- `j009-export-single-clip.md` — pick preset → render → export

**Distribution + revenue**
- `j010-submit-to-whop.md` — pick campaign → permission_type → POST → HQ event
- `j011-affiliate-referral-shared.md` — copy link/QR → external open → referral tracked
- `j012-wallet-view-balance.md` — Wallet route → summary → ledger → payout status
- `j013-cancellation-intercept.md` — attempt cancel → real ledger shown → keep

**Operational**
- `j014-runtime-update.md` — new bundle staged → beacon → user clicks Reload → new bundle live
- `j015-session-expiry-recovery.md` — expired JWT → authedFetch 401 → auto-signout → route preserved → OTP → back

## Schema (locked · used for every journey file)

```
# journey.<id> · <name>

## Purpose
<what the customer accomplishes>

## Owning capability
capability.<id>

## Mission link
[M1 | M2 | M3 | M4, ...]

## Prerequisites
- <state | prior journey>

## Stations (ordered)
For each station:
- Station: <station.id> — <description>
- Responsible system: <feature.id>
- Source code node: <node.id → file:line>
- Expected input: <inputs>
- Expected customer-visible state: <UI copy or screenshot ref>
- Expected event ordering: [lcDiag topic | bus.event, in order]
- Success signal: <event | UI change | file on disk>
- Failure outcome: <customer-safe copy> · <recovery path>
- Telemetry proof: <event → HQ tile>
- Regression test: <test.id>

## Current status
GREEN | AMBER | RED

## Last verified
<date · commit SHA · Doctor run id>

## Known bugs blocking
- [BUG-id]

## Recovery / degrade path
<how the journey degrades gracefully>

## HQ dashboard
- <tile name → 08_RUNTIME_GRAPH node>
```

## Rules

- **Every station has expected event ordering.** If it doesn't, the journey isn't testable.
- **Status is set by Doctor Mode, not by prose.** GREEN requires live proof + telemetry + test.
- **Recovery path is mandatory.** No journey without a fallback story.
