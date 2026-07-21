# SYSTEM_UPDATE · desktop-2 · 2026-07-22

Runtime bundles **2.2.71 → 2.2.76** shipped in one long session.
Composer now delivers on user commands AND has the full mockup cockpit
that expands out of the SimpleComposer greeter when Kade engages.

## Runtime bundles shipped this session

| # | Focus |
|---|---|
| 2.2.71 | Composer wire · sidecar delivery · IG-COMPOSER-HOSTED-INTENT + 4-layer defense |
| 2.2.72 | Visibility layer · wire-status pill · KADE SAID mirror · runtime pill · Diagnostic link |
| 2.2.73 | Local-first router · hosted LLM only for miss-fallback · KadeIntent pydantic v2 |
| 2.2.74 | MasterComposerPreview iframe of the approved kade-composer-simulator mockup |
| 2.2.75 | MasterComposer React port with real state wiring (staff-only preview) |
| 2.2.76 | **The full-glory idle→engaged swap** · SimpleComposer greeter opens into MasterComposer cockpit via native View Transitions API |

## Backend fix (deployed to Railway)

**`junior-backend/app/routes/proxy_llm.py`** · KadeIntent pydantic model
refactored (v3) to a `list[_ResolvedParam]` for the OpenAI structured-
output wire, then converted back to `dict[str, str]` for the public
response. OpenAI's strict mode rejects arbitrary-key maps · this is the
canonical workaround.

Also fixed the sibling `ClipBundle` model in the same file.

**Verified end-to-end via `/tmp/probe-inside-railway.py`:**
- `/me` · 200 (danieldiyepriye@gmail.com · autopilot tier · founder=True)
- `/proxy/llm/intent` · 200 · `action=execute · capability=discovery.scrub · count=5` in 1.2s
- `/proxy/anthropic/clip-bundle` · 200 · 3 real clips with virality 85/82/etc in 17s

## Architecture landing · Sprint 2.5 composer

The composer is now ONE route (`#/composer` / route id `composer`) that
renders the right shell for the session state.

```
ComposerRoute
├─ hosts useComposerBrain (owns bus subscriptions + handleSubmit)
├─ reads isComposerEngaged(useComposerSession)
└─ renders SimpleComposerShell (idle) or MasterComposerShell (engaged)
    inside document.startViewTransition() for the native morph
```

**Data layer:**
- `src/design-os/state/useComposerSession.ts` — Zustand slot holds ALL
  composer state (sessionCtx · activeSlug · progress · clips · history ·
  awaitingSource · lastReply · kadeMood · lastIntentStatus + actions +
  `shellOverride` for the Kade | Classic HUD toggle)

**Logic layer:**
- `src/design-os/routes/useComposerBrain.ts` — hosts `handleSubmit`,
  `pickFile`, `submitUrl`, `executeCapability`, and every `useEvent`
  subscription (engine:progress/complete/error, kade:mood/speak). Fires
  ONCE at the route level. Both shells receive the brain via prop.

**View layer (pure shells · zero local state):**
- `src/design-os/routes/SimpleComposerShell.tsx` — greeter · hero Kade +
  command bar + quick actions + KADE SAID mirror + Open cockpit button
- `src/design-os/routes/MasterComposerShell.tsx` — cockpit · left nav
  rail + top HUD + Kade canvas + timeline stub + right Base Window JSON
  panel + Kade/Classic toggle + Clear ↺ button

**Route wrapper:**
- `src/design-os/routes/ComposerRoute.tsx` — hosts the brain, reads
  `isComposerEngaged(state)`, calls `document.startViewTransition` on
  swap. CSS at `ComposerRoute.css` handles panel bloom + Kade morph
  timing (~380ms per side, 60/120ms staggers).

**Legacy files kept as staff safety nets:**
- `SimpleComposer.tsx` — old direct-mount composer (superseded but
  functional). Not registered as a live route anymore.
- `MasterComposer.tsx` — old React port (superseded). Still registered
  at `#/composer-master?staff=1` for A/B comparison.
- `MasterComposerPreview.tsx` — iframe of the raw mockup HTML. Still
  registered at `#/composer-preview?staff=1` for design comparison.

These stay for a week as fallback. If ComposerRoute proves stable, we
delete them in Sprint 3.

## Iron Gates added this session

| Gate | Layer count | Fast tier |
|---|---|---|
| **IG-COMPOSER-HOSTED-INTENT** | 4 · sentinel + lint + vitest + runtime fallback | yes |
| **IG-COMPOSER-MODE-SWAP** | 4 · sentinel + lint (12 guards) + vitest (11 assertions) + runtime fallback | yes |

All 22 fast-tier fences green. Registry: `docs/IRON_GATES_REGISTRY.md`.

## Tests

- `tsc --noEmit` · exit 0
- `bash scripts/iron-gates.sh fast` · all 22 fences PASS
- `vitest run` · full suite green including 11 new mode-swap assertions
- Backend probe (`/tmp/probe-inside-railway.py`) · all 3 stages 200

## Rollback

**Manifest rollback (fastest · one command):**
```bash
curl -X POST https://api.liquidclips.app/runtime/promote \
  -H "Content-Type: application/json" \
  -d '{"version":"2.2.75","channel":"stable"}'
```
All users get 2.2.75 back on next relaunch.

**If the ComposerRoute wrapper breaks entirely:** point the composer
route id at the legacy SimpleComposer instead:
```typescript
// src/design-os/routing/SimulatorRouter.tsx
const ComposerRoute = lazy(() =>
  import("../routes/SimpleComposer").then((m) => ({ default: m.SimpleComposerRoute })),
);
```
And ship a runtime bundle bump.

## Journey verification checklist (morning walkthrough)

1. `/Applications/Liquid Clips.app` → boot → runtime auto-fetches 2.2.76 → reload
2. Navigate to Composer
3. Confirm: SimpleComposer greeter renders (hero Kade · command bar · quick actions · KADE SAID mirror in sidebar)
4. Type `make me 5 clips` OR click any quick-action button
5. Watch the cockpit unfold — Kade morphs from centre to canvas · nav rail slides in from left · HUD drops from top · right JSON panel slides in from right · ~400ms total
6. Source picker appears · pick a local `.mp4` OR paste a regular YouTube URL
7. Progress bar fills · clip cards render horizontally on completion
8. Click **Clear ↺** in the HUD → cockpit collapses back to greeter (reverse animation)
9. Click **Kade** / **Classic** in the HUD to force either shell manually

## Known gaps for Sprint 3+

Per `devteam/09_CURRENT_BUGS_AND_INSTABILITY.md`:
- BUG-002: Whop `whop_user_id` not stamped on paid signup (Connect-to-Whop CTA sticks)
- BUG-004: Solo/Pro/Founder legacy tiers still visible in code
- BUG-005: Screen-recording ergonomics (Home tile vs Composer button)
- Feature-1..5 mockup overlays (clip window picker · screen record HUD · watermark inline · skill recording · CapCut editor)
- Windows EV cert (Cohort-1 blocker)
