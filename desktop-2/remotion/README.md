# Liquid Clips Preview Engine

Renders per-lead 20-second MP4 previews for the cold email growth engine. Each MP4 looks like a screen recording of Liquid Clips chopping a specific creator's video into 8 short-form clips, using real frames pulled from YouTube's free storyboard sprites.

Full pipeline context: `~/Desktop/liquidclips-marketing-SPEC.md`
Handoff for the next Claude session: `HANDOFF_TO_CLAUDE.md`

## Quick start

```bash
npm install
npm start                                                         # open Remotion Studio
npx tsx scripts/fetch-storyboard.ts dQw4w9WgXcQ ./sample-data/frames
npx tsx scripts/render.ts sample-data/example-props.json out/demo.mp4
```

## Layout

- `src/Preview.tsx` — 600-frame Remotion composition
- `src/components/` — WindowChrome · InputPanel · ProgressBar · ClipGrid · CtaCard
- `src/lib/tokens.ts` — Liquid Clips brand tokens (mirrored from desktop-2)
- `public/brand/` — real Liquid Clips brand PNGs + SVGs
- `scripts/fetch-storyboard.ts` — YouTube storyboard fetcher + sharp slicer
- `scripts/render.ts` — Railway worker entry (bundle + render MP4)
- `sample-data/example-props.json` — seed props for a test render

## Status

**Scaffolded, not shipped.** See `HANDOFF_TO_CLAUDE.md` for what's left.
