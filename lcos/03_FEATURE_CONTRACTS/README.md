# 03 · Feature Contracts

One file per feature. Human-authored. Never regenerated.

Populated in P6 after the code graph (P5) is available so every feature contract can bind to real code nodes.

## Files planned (17)

Alphabetical by capability:

**capability.identity-trust**
- `auth-otp.md`
- `lc-id.md`
- `handle.md`
- `session-lifecycle.md`
- `membership-gate.md`

**capability.creator-onboarding**
- `welcome-flow.md`
- `crew-invite.md`
- `first-upload.md`
- `first-clip-celebration.md`

**capability.content-production**
- `ingest.md`
- `transcription.md`
- `clip-judgement.md`
- `cutting.md`
- `my-clips.md`
- `export.md`
- `upload-preflight.md`

**capability.campaign-distribution**
- `campaign-discovery.md`
- `submit-to-whop.md`
- `submission-compliance.md`
- `publishing.md`

**capability.affiliate-revenue**
- `wallet.md`
- `referral-qr.md`
- `affiliate-claim.md`
- `payouts.md`
- `whop-connection.md`
- `crew-pipeline.md`
- `cancellation-intercept.md`

**capability.community-retention**
- `community.md`
- `notifications.md`
- `learn-walkthroughs.md`
- `channels.md`
- `schedule.md`

**capability.operational-excellence**
- `runtime-updates.md`
- `diagnostics.md`
- `hq-control-tower.md`
- `smoke-gate.md`
- `ship-lens.md`

## Schema (locked · used for every feature file)

```
# feature.<id>

## Purpose
<one paragraph · what this delivers to the creator>

## Customer outcome
<the visible state the creator should reach>

## Owning capability
capability.<id>

## Mission link
[M1 | M2 | M3 | M4, ...]

## Entry points
- [route | button | deep link | bus event]

## Inputs
- [hook | endpoint | storage key]

## Outputs
- [rendered state | telemetry topic | storage key | HQ event]

## Valid states
- [state.id + description]

## Canonical sources of truth
- [state.id → owner]

## Implementation nodes (from 07 code graph)
- [node.id → file:line]

## API endpoints
- [endpoint.id → route]

## Storage keys
- [key → owner]

## Events
- [bus.event | lcDiag.topic]

## HQ visibility
- [hq event | dashboard tile]

## Failure states
- [state → customer-safe copy]

## Fallbacks
- [degrade path]

## Security rules
- [rule]

## Tests
- [test.id → file:line]

## Known bugs
- [BUG-id]

## Forbidden shortcuts
- [rule with rationale]

## Change impact
- [downstream capability | feature | journey | test | telemetry]
```

## Rules

- **Business intent written explicitly.** No inference from code.
- **Every field cites when possible.** file:line or node.id.
- **Change impact is required.** No feature file without a downstream statement.
