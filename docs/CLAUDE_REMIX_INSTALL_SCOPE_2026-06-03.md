# Claude Handoff: Remix Library + Reaction Enhancer

Date: 2026-06-03
Owner proposal: Claude or Codex can implement, but do not install the external IG Research Tool until Daniel explicitly confirms.

## Product Decision

Remix is the right use case. Do not ship this as a passive "Research" dashboard first.

Primary loop:

1. Liquid Clips generates clips.
2. Each clip gets short enhancement pills.
3. User clicks Enhance / Remix.
4. App suggests 3 reaction/adlib candidates.
5. User applies stack, split, PiP, cutaway, or audio-only adlib.
6. User previews final output and publishes/schedules.

Research exists behind Remix as the library/search engine. The visible value is "make this clip funnier / punchier before publishing."

## Existing Code This Fits

The app already has most of the rendering foundation:

- `desktop/src/components/ResultsGrid.tsx`
  - Results screen after generation.
  - Good place for post-generation `Enhance` pills and "Remix all" affordance.

- `desktop/src/components/clips-feed/ClipCard.tsx`
  - Per-clip card already has layout icons and overlay actions.
  - Add short pills here: `Punchline`, `Awkward`, `Shock`, `Adlib`, `Stack`.

- `desktop/src/components/ClipPreview.tsx`
  - Full editor side panel.
  - Best first home for the Remix panel.
  - Already has b-roll layout controls, ratio picker, audio choice, metadata, trim.

- `desktop/src/components/clips-feed/LayoutIcon.tsx`
  - Existing layout vocabulary: no overlay, stack top/bottom, split left/right, PiP left/right.
  - Reuse for Remix instead of inventing new visuals.

- `desktop/src/components/clips-feed/layout-cells.ts`
  - Existing topology model maps main/b-roll cells.
  - Good mental model for reaction cells.

- `desktop/python-sidecar/stages.py`
  - Existing `apply_overlay_to_clip()` renders b-roll overlays with ffmpeg.
  - Current render modes: stack, split, PiP.
  - Needs extension for true `cutaway`, `audio_adlib`, and `freeze_hit`.

- `desktop/python-sidecar/sidecar.py`
  - Existing RPC method `apply_overlay`.
  - Add new methods alphabetically/cleanly in `METHODS`, likely:
    - `remix_suggest`
    - `remix_search`
    - `remix_apply`
    - `remix_library_refresh`

## External Tool Role

The attached IG Research Tool is useful, but not as a standalone app surface.

Install target when approved:

- `~/ig-research/`
- Scripts:
  - scrape IG hashtag/profile posts
  - capture hook screenshots
  - download audio
  - transcribe audio
  - generate reports

Remix use:

- Build niche-specific candidate reaction libraries.
- Store candidate source metadata, transcript, screenshots, tags, and local media.
- Feed the top 3 reaction/adlib options into Liquid Clips.

It currently searches Instagram only. Broader sources can come later:

- YouTube Shorts / videos through `yt-dlp`
- TikTok if supported later
- user-uploaded reaction folders
- curated local packs
- built-in starter packs

## Proposed Local Data Model

Keep Remix library local-first under Liquid Clips, not hidden inside `~/ig-research` forever.

Suggested root:

```text
~/LiquidClips/remix/
  libraries/
    gaming/
      library.json
      media/
      screenshots/
      transcripts/
    podcast/
      library.json
      media/
```

`library.json` candidate shape:

```json
{
  "id": "reaction_abc123",
  "source_url": "https://www.instagram.com/reel/...",
  "source_platform": "instagram",
  "local_video_path": "...",
  "local_audio_path": "...",
  "transcript": "wait what...",
  "duration_s": 2.8,
  "mood_tags": ["confused", "laugh", "shock"],
  "niche_tags": ["gaming", "podcast"],
  "suggested_modes": ["pip", "cutaway", "audio_adlib"],
  "created_at": "2026-06-03T00:00:00Z"
}
```

## Clip Model Extension

Existing `Clip` has `overlay`. Add a sibling field rather than overloading overlay too much:

```ts
remix?: {
  suggestions?: RemixSuggestion[];
  applied?: RemixApplied[];
  active_path?: Partial<Record<RatioKey, string>>;
} | null;
```

Suggestion:

```ts
type RemixSuggestion = {
  id: string;
  at_s: number;
  label: "Punchline" | "Awkward" | "Shock" | "Reveal" | "Adlib";
  mode: "cutaway" | "pip" | "stack" | "split" | "audio_adlib" | "freeze_hit";
  candidate_ids: string[]; // top 3
  reason: string; // internal/tooltips; UI should show pills, not paragraphs
};
```

Applied:

```ts
type RemixApplied = {
  suggestion_id?: string;
  candidate_id: string;
  mode: string;
  at_s: number;
  duration_s: number;
  audio_mix: "main" | "reaction" | "duck_main" | "muted";
  applied_paths: Partial<Record<RatioKey, string>>;
};
```

## Render Modes

V1 practical modes:

- `audio_adlib`
  - Keep original video.
  - Insert short reaction audio at timestamp.
  - Duck main audio briefly.
  - Highest value/lowest visual disruption.

- `pip`
  - Main clip stays full frame.
  - Reaction appears bottom-left/right.
  - Reuse existing PiP overlay filter.

- `stack`
  - Main + reaction stacked top/bottom.
  - Reuse existing stack filters.

- `cutaway`
  - Main -> reaction full frame -> main.
  - Requires concat filter / segment split.
  - New renderer, do after V1 if needed.

- `freeze_hit`
  - Freeze + zoom + sound hit.
  - New renderer, high viral value, but can land after simple modes.

## Tier Gates

Current canonical tiers are Free / Solo / Pro / Agency.

Relevant current sources:

- `junior-backend/app/features.py`
- `desktop/src/lib/useTier.ts`
- `desktop/src/lib/backend.ts` `FeatureMap`
- `account-app/src/components/PricingCards.tsx`
- `liquidclips-marketing/src/app/page.tsx`

Recommended feature flags to add to backend `FEATURES_BY_TIER`:

```py
"remix_preview": true/false
"remix_clean_export": true/false
"remix_library_refreshes_monthly": int | None
"remix_bulk_enhance": true/false
"remix_client_libraries": true/false
```

Suggested matrix:

| Feature | Free | Solo | Pro | Agency |
|---|---:|---:|---:|---:|
| See enhancement pills | yes | yes | yes | yes |
| Preview Remix | yes | yes | yes | yes |
| Clean Remix export | no | yes | yes | yes |
| Watermarked Remix export | limited | no | no | no |
| Upload own reactions | limited | yes | yes | yes |
| Starter library | yes | yes | yes | yes |
| Niche library refreshes | 0 or 1 demo | 3/mo | 25/mo | 100/mo |
| Auto top-3 suggestions | basic | basic | advanced | advanced |
| Bulk enhance all clips | no | no | yes | yes |
| Client/niche libraries | no | no | limited | yes |

Keep Free valuable:

- Free users should see the 3 suggestions and preview them.
- Export should either count against existing 100 free exports with watermark, or have a smaller Remix-specific demo cap.
- Clean Remix export should require Solo+.

## UI Recommendation

Add `Remix` as a main nav tab eventually, but primary entry point should be post-generation.

Results screen:

- On each `ClipCard`, show compact pills:
  - `Punchline`
  - `Awkward`
  - `Shock`
  - `Adlib`
  - `Stack`
- Button: `Enhance`
- Badge after applied: `Remixed`
- Toggle: `Original` / `Remix`

Clip editor:

- Add a right-panel section above or near b-roll controls:
  - Header: `Remix`
  - Search pill/input: `Find reaction`
  - Candidate chips/cards: top 3 only
  - Layout chips: `Adlib`, `PiP`, `Stack`, `Cutaway`, `Freeze`
  - Buttons: `Preview`, `Apply`, `Regenerate`

Main Remix tab:

- Left: selected Liquid Clip.
- Right: searchable reaction library.
- Top chips:
  - `Gaming`
  - `Podcast`
  - `Fitness`
  - `Business`
  - `UK comedy`
  - `Regenerate library`

Avoid text-heavy report UI. Reports can exist as hidden/dev/advanced output, but the product should show pills + previews.

## Installation Plan When Daniel Confirms

1. Create external tool folder:
   - `~/ig-research/`
   - install Node dependency `chrome-remote-interface`
   - do not bundle into Tauri app yet.

2. Add a Liquid Clips sidecar bridge:
   - `desktop/python-sidecar/remix_library.py`
   - wraps `~/ig-research/projects/<niche>/raw-posts.json`, transcripts, screenshots, and media into the `~/LiquidClips/remix/libraries/<niche>/library.json` shape.

3. Add sidecar methods:
   - `remix_library_list`
   - `remix_library_refresh`
   - `remix_search`
   - `remix_suggest`
   - `remix_apply`

4. Add desktop types:
   - `RemixSuggestion`
   - `RemixCandidate`
   - `RemixApplied`
   - tier capabilities in `useTier.ts` or a new `useRemixTier.ts`.

5. Add UI:
   - ClipCard enhancement pills.
   - ClipPreview Remix panel.
   - Later: main Remix tab.

6. Add backend entitlements:
   - update `junior-backend/app/features.py`
   - update `/sync` type/client `FeatureMap`
   - update account-app pricing copy
   - update marketing pricing/help copy

7. Add analytics:
   - `remix_suggestion_shown`
   - `remix_candidate_selected`
   - `remix_previewed`
   - `remix_applied`
   - `remix_export_blocked`
   - `remix_library_refreshed`

## Risk / Scope Notes

- Do not make users read reports before they can remix. Research is infrastructure.
- Do not build broad internet search in v1. IG research + user-uploaded packs are enough.
- Do not overwrite original clip paths. Always write remix outputs as siblings.
- Do not hide render time. Remix apply should show progress/busy state.
- Keep `METHODS` merge conflict risk low by adding sidecar methods in a small alphabetical block.

## Recommended V1

V1 should ship:

- Enhancement pills after clip generation.
- Top 3 reaction candidates from a local/niche library.
- Apply as `audio_adlib`, `pip`, or `stack`.
- Preview + clean export gate by tier.
- IG Research Tool installed externally only after Daniel confirms.

This is enough to prove the product promise:

> Liquid Clips found the best moment. Remix makes it funnier before publishing.
