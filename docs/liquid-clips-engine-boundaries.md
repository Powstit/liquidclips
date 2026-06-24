# Liquid Clips — Engine Independence Boundaries

**Status:** Architectural rule. Locked 2026-06-18 during Phase 5B Polish.
**Owner:** Daniel Diyepriye.
**Scope:** Every "engine" surface inside Liquid Clips desktop + future cloud
parity. Applies to UI, contracts, build/test cadence and release wiring.

This document does **not** ship code. It defines the invariant that every
engine team (current: solo) must respect. If a PR violates these boundaries,
it is rejected on review — no exceptions.

---

## TL;DR

> Every engine ships, breaks and is approved on its own.
> The shell orchestrates. The shell does **not** entangle.

A clip can be cut without ever opening Thumbnail Studio.
A thumbnail can be designed for a clip the engine has not produced yet.
A script can be written before any footage exists.
A campaign can recruit clippers before any clip publishes.
A payout can be issued without ever opening Channels.

If any of those statements becomes false, the boundary has leaked and the
offender must be refactored back behind the contract.

---

## The seven engines

| # | Engine | Owns | Does NOT own |
|---|---|---|---|
| 1 | **Clipping Engine** | source ingest, transcode, moment detection, candidate ranking, export of raw clip files. | thumbnail rendering, caption styling, scheduling, campaign brief reading, payout tracking. |
| 2 | **Thumbnail Engine** | composition canvas, safe-area enforcement, A/B variant scoring, export of poster frames. | clip detection, caption styling, schedule queueing. |
| 3 | **Script Engine** | hook / body / CTA generation, voice-over draft, beat plan, exports a text contract. | clip detection, thumbnail rendering, publishing. |
| 4 | **Caption Engine** | per-word burn, per-clip subtitle file, style packs. | clip selection, schedule, payout. |
| 5 | **Publishing Engine** | channel auth, asset upload, platform-specific format coercion, publish receipt. | clip selection, campaign matching, payout. |
| 6 | **Campaign Engine** | brief storage, mission match, recruit, submission intake, judging, reward ledger update. | clip cutting, thumbnail design, channel auth. |
| 7 | **Earnings Engine** | wallet/coin balance, payout request, payout receipt, lifetime totals, ledger reconciliation. | clip cutting, channel auth, campaign judging. |

Each engine is a **sealed product**. The shell is a host, not a parent.

---

## The five contracts

Engines talk to one another only through these five typed contracts. Each
contract is owned by the **producer** engine and may be read by any consumer.
No engine may inspect another engine's internal state.

```
ClipExport       ::= { id, sourceId, t0, t1, fileUri, duration, fps, codec }
ThumbnailExport  ::= { id, clipId | null, fileUri, w, h, score, variants[] }
ScriptDoc        ::= { id, intent, hook, body, cta, beats[], tone }
CaptionTrack     ::= { id, clipId, words[], style }
PublishReceipt   ::= { id, clipId, channel, platformPostId, publishedAt, url }
```

Plus two cross-cutting contracts the shell uses to fan events:

```
CampaignMatch    ::= { clipId | scriptId, campaignId, score, reason }
EarningsEvent    ::= { actor, source, kind, coins, occurredAt }
```

That's it. Seven types. Any other inter-engine data movement is forbidden.

---

## What the shell does

The shell is allowed to:

1. **Mount** any engine route through the Design OS Route Factory.
2. **Forward** the seven typed contracts above between engines via the event
   bus (`bridge/events.ts`).
3. **Persist** the contracts to local + sync DB so any engine can re-hydrate
   from its own slice.
4. **Decide** when to suggest the next engine ("you cut a clip — open
   Thumbnail Studio?") — but never auto-open it.

The shell is **NOT** allowed to:

1. Reach into an engine's internal panel state.
2. Re-render an engine's UI inside another engine's route.
3. Couple two engines via a private store key.
4. Block engine A's release on engine B's readiness.

---

## What independence buys us

### Build cadence
Engine A can ship a 0.7.x build while Engine B is mid-rewrite. The shell
hides any engine that fails its self-test and renders a Stop Page in its
slot. No engine release blocks another's.

### Testability
Each engine is a directory with its own `__tests__/`. The contract surface
is the only thing under integration test. Internal state is fair game for
unit tests but invisible to the rest of the codebase.

### Review surface
A code review for Thumbnail Engine never has to touch Clipping Engine code.
A reviewer sees only that engine plus the contract files it imports. No
"while you're in there" creep.

### Failure containment
A bug in Caption Engine produces no captions on a clip. It does not freeze
the Clipping Engine, does not block payouts, does not break the campaign
intake. The Stop Page renders inside that slot only.

### Marketing parity
Each engine has its own marketing surface, its own demo video, its own
"how it works" page. They are sellable as separate features even though we
ship them bundled.

---

## Rules a reviewer can apply mechanically

A PR violates the boundary if any of the following is true:

1. An engine file imports from another engine's `internal/` directory.
2. An engine file mutates another engine's Zustand slice.
3. An engine route renders a component owned by another engine.
4. An engine reads from the database tables owned by another engine
   (allowed: read via the contract; forbidden: SELECT on the other engine's
   private table).
5. A contract is changed without bumping its `version` field and adding a
   reader-side compatibility branch.
6. An engine subscribes to an event channel not in the approved bus
   registry.
7. The shell calls an engine internal function directly instead of going
   through the bus.

If any of these is true, the PR is rejected and refactored.

---

## The shell-orchestrates rule

The shell can *suggest* the next engine, but never *force* it.

Wrong:
```
clipExported → openThumbnailStudio()
```

Right:
```
clipExported → emit ClipExport → ThumbnailStudio listens on its own
              ConsoleNav surfaces a "design thumbnail?" CTA
```

The user picks. The user always picks. Every engine is reachable
independently from the console nav at any time, regardless of which other
engines have produced output.

---

## Boundary checklist for every new engine surface

Before merging an engine UI:

- [ ] Engine code lives entirely under `src/engines/<engine>/`.
- [ ] Engine owns exactly one route in the Design OS Route Factory.
- [ ] Engine exposes only contract types from its `contracts/` barrel.
- [ ] Engine subscribes only to bus channels listed in its registry block.
- [ ] Engine reads/writes only its own DB tables (joined via contract IDs).
- [ ] Engine has its own self-test that can mark it "down" and trigger a
      Stop Page in its slot without taking the shell with it.
- [ ] Engine has a removal commit path: deleting `src/engines/<engine>/` +
      its registry entry leaves the rest of the app green.

If any box is unchecked, the engine is not ready to ship.

---

## Future engines

When new engines arrive (AI Director, Series Mode, Live Mode, …) they
register the same way: their own folder, their own route, their own
contract, their own Stop Page. The shell grows by one entry in the route
registry — nothing else changes.

This rule is what lets Liquid Clips ship one engine a fortnight without
the app collapsing under its own coupling.
