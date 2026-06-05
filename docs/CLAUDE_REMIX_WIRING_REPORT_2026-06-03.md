# Claude Handoff: Remix Entitlement + Pricing Wiring

Date: 2026-06-03
Owner: Codex

## What Was Wired

I added the Remix commercial scaffold across the existing tier surfaces without installing the external IG Research Tool and without touching the release pipeline.

Backend entitlement source:

- `junior-backend/app/features.py`
  - `remix_preview`
  - `remix_clean_export`
  - `remix_library_refreshes_monthly`
  - `remix_bulk_enhance`
  - `remix_client_libraries`

Desktop sync/type surface:

- `desktop/src/lib/backend.ts`
  - Extended `FeatureMap` so JWT/sync features can carry Remix gates.
  - Updated web-preview sync data with Solo-level Remix values.

Desktop instant tier helper:

- `desktop/src/lib/useTier.ts`
  - Added `RemixCapability`.
  - Added `canRemix(cap)` and `remixRefreshesMonthly` to `TierState`.
  - Updated tier copy so upgrade walls can mention Remix.

Account app pricing:

- `account-app/src/components/PricingCards.tsx`
  - Added plan-card Remix lines.
- `account-app/src/components/PricingComparison.tsx`
  - Added a dedicated Remix comparison section.

Marketing/help:

- `liquidclips-marketing/src/app/page.tsx`
  - Added Remix plan bullets.
- `liquidclips-marketing/src/app/help/billing-and-plans/page.tsx`
  - Added plain-language Remix plan explanations.

## Tier Matrix

| Capability | Free | Solo | Pro | Agency |
|---|---:|---:|---:|---:|
| Preview 3 reaction/adlib ideas after each generated clip | yes | yes | yes | yes |
| Clean Remix export | no | yes | yes | yes |
| Niche reaction-library refreshes | starter/0 monthly refreshes | 3/mo | 25/mo | 100/mo |
| Bulk enhance all generated clips | no | no | yes | yes |
| Client-specific Remix libraries | no | no | no | yes |

## Why This Was Done

This lets the product start selling the Remix ladder cleanly before the renderer/search implementation lands:

- Free users can understand the feature and preview possibilities.
- Solo becomes the natural conversion point for clean Remix output.
- Pro gets the creator power feature: bulk enhancement.
- Agency gets the client/library management story.

## What Was Not Installed

I did not install `~/ig-research`, Homebrew packages, Python packages, Node dependencies, Chrome remote debugging setup, or any scraper code.

Reason: Daniel previously said he wanted to confirm before installation. The current changes only prepare Liquid Clips pricing and entitlement wiring.

## Implementation Next Step

Build Remix V1 inside Liquid Clips:

1. Add post-generation Enhance pills in `ResultsGrid` / `ClipCard`.
2. Add a Remix panel in `ClipPreview`.
3. Add sidecar methods for `remix_suggest`, `remix_search`, and `remix_apply`.
4. Reuse existing overlay rendering first for PiP, stack, and split.
5. Add `audio_adlib` next because it is high value and low visual disruption.

Do not start with a standalone Research dashboard. Research should remain hidden infrastructure behind Remix.
