# Handoff — Liquid Clips Preview Engine

**You (the next Claude session) are picking up a Remotion scaffold that Daniel needs finished.**

This project renders per-lead 20-second MP4 previews for the Liquid Clips cold email growth engine. The full context, cost model, and pipeline architecture live at `~/Desktop/liquidclips-marketing-SPEC.md`. **Read that spec before you start.** This file only covers what's left in *this* codebase.

---

## What's already scaffolded

- `package.json` — Remotion 4 + React 18 + Sharp for storyboard slicing
- `remotion.config.ts`, `tsconfig.json`, `.gitignore`
- `src/index.ts` + `src/Root.tsx` — Remotion composition registry
- `src/Preview.tsx` — top-level 600-frame composition (20s @ 30fps, 1920×1080)
- `src/components/`
  - `WindowChrome.tsx` — traffic-light bar + Liquid Clips sidebar with real glyph + wordmark PNGs + fuchsia-highlighted nav
  - `InputPanel.tsx` — creator's video thumbnail card, slides in
  - `ProgressBar.tsx` — Transcribing → Analysing → Clipping, animated fuchsia bar
  - `ClipGrid.tsx` — 8 clip tiles staggered pop-in, "+ 92 more clips locked"
  - `CtaCard.tsx` — full-screen final card with claim URL
- `src/lib/tokens.ts` — canonical Liquid Clips brand tokens (mirrored from `/Users/dipdip/code/jnr/desktop-2/src/brand/brandTheme.css` — do not drift)
- `src/lib/types.ts` — `PreviewProps` type + `DEFAULT_PROPS` for studio previews
- `public/brand/` — real Liquid Clips glyph, wordmark, made-with SVG, atmosphere backdrop copied from the desktop-2 repo
- `scripts/fetch-storyboard.ts` — pulls YouTube storyboard sprite sheets and slices them into N JPEG frames using Sharp
- `scripts/render.ts` — Railway worker entry: reads props JSON, bundles Remotion, renders MP4
- `sample-data/example-props.json` — one seed props file (currently uses picsum for frames — replace with real fetched storyboard frames before Daniel reviews)

---

## What you must finish

### 1. Get it running locally (30 min)
```bash
cd ~/Desktop/liquidclips-preview-engine
npm install
npm start   # opens Remotion Studio at http://localhost:3000
```
Verify the composition renders end-to-end without React errors. The Studio timeline should show the 600-frame Preview.

### 2. Wire the storyboard fetcher into the render flow (1 hour)
Currently `sample-data/example-props.json` uses picsum URLs. Real flow:
1. Given a YouTube `videoId`, run `npx tsx scripts/fetch-storyboard.ts <videoId> ./sample-data/frames-<videoId>`
2. Take the 8 output JPEGs, upload to a public host (Vercel Blob in production; local file:// URLs during dev)
3. Update `frameUrls` in props JSON to point at those hosted URLs
4. Because Remotion's Chromium sandbox blocks `file://` cross-origin, you may need to serve local frames via a small `express` static server on `localhost:8080` and reference `http://localhost:8080/frame-00.jpg`
5. Alternative (recommended): bake the fetched frames into `public/frames/` and reference via `staticFile("frames/frame-00.jpg")` — no server needed

### 3. Render one real MP4 end-to-end (30 min)
Pick any YouTube video (e.g. `dQw4w9WgXcQ`), fetch storyboard, write props JSON, run:
```bash
npx tsx scripts/render.ts sample-data/example-props.json out/demo.mp4
```
Play the MP4 in QuickTime. It should feel like a 20-second screen recording of Liquid Clips chopping that video. Give the resulting `out/demo.mp4` to Daniel.

### 4. Design polish pass (2 hours) — the important one
The scaffold is functional but flat. Before Daniel signs off, run this checklist against **every** frame in the timeline:

- **Brand-kit skill:** load `~/.claude/skills/liquid-clips-brand-kit/SKILL.md` and verify every colour, radius, and font token comes from `src/lib/tokens.ts`. No stray hex values. Pixel-invader energy, cockpit chrome, HUD brackets.
- **Ship-lens skill:** run the DESIGN phase — does every element earn its place? Cut anything that doesn't.
- **Snapshot-proof-lens skill:** render 3 frames (30, 200, 490) as PNG stills via `npx remotion still` and open them in Preview to eyeball proportions.
- **Bespoke craft skill:** no CC0 stock, no Lucide defaults, no CSS gradient meshes. All visuals from `/public/brand/` or from the fetched storyboard.

### 5. Optional but high-value (2 hours)
- Add a subtle **CRT scanline overlay** on the entire composition — matches the cockpit chrome aesthetic per the Liquid Clips brand kit
- Add a **fuchsia halo** behind the CTA card ring — same brand vocabulary
- Add a **HUD bracket** in the top-right corner of the InputPanel — brand kit primitive
- Make the InputPanel thumbnail push into the ClipGrid with a subtle **liquid mask transition** at frame 100–130 — sells the "your video → clips" moment

---

## Skill invocations you MUST run before saying "done"

Per `/Users/dipdip/.claude/projects/-Users-dipdip/memory/MEMORY.md`, none of these are optional:

1. **`ship-lens`** — DESIGN + STATE + JOURNEY phases against the rendered MP4
2. **`snapshot-proof-lens`** — screenshot the rendered MP4 alongside `/Users/dipdip/code/jnr/desktop-2` real UI screenshots to verify brand parity
3. **`liquid-clips-brand-kit`** — vocabulary check for cockpit tile / HUD brackets / halos / pixel invader / chrome
4. **`completion-discipline`** — before you tell Daniel it's done, table out: item · state · direct proof · regression proof · remaining gap
5. **`bespoke-craft`** — pre-build gate for any brand/marketing visual asset

---

## What is out of scope for this session

- **YouTube Data API integration** — that's Junior-backend work, not this repo
- **Whisper / Claude clip-title generation** — happens in the real 100-clip render (Stage 4), not the preview
- **Blob upload** — Railway worker glue; write it, but leave Vercel Blob credentials to Daniel
- **Landing page / preview URL routing** — lives in `liquidclips-marketing` Next.js repo, not here
- **Whop paywall wiring** — already exists in Junior backend

If you notice any of those, note them in a `NEXT_SESSION.md` for the next handoff. Do not scope-drift.

---

## Files Daniel absolutely wants to see before sign-off

- `out/demo-mrbeast.mp4` — full 20-second preview using a real famous YouTuber
- `out/still-frame-30.png`, `out/still-frame-200.png`, `out/still-frame-490.png` — three key frames as PNG for the snapshot lens
- Updated `sample-data/example-props.json` with real fetched frame paths (not picsum)

---

## Don't do this

- Don't run `npm install` and then dump `node_modules/` into Dropbox / Google Drive
- Don't push to GitHub — this project has no repo yet, and Daniel wants to review before it becomes public
- Don't invent new brand colours — mirror only what's in `src/lib/tokens.ts`
- Don't stub OpenAI / Anthropic keys here — this repo doesn't need them
- Don't claim "done" without producing the three PNG stills + the demo MP4

---

## When Daniel opens this handoff

Say:
> "The scaffold at `~/Desktop/liquidclips-preview-engine/` compiles. To see a real preview: `cd ~/Desktop/liquidclips-preview-engine && npm install && npm start`. I've got X more hours of work to finish real-storyboard wiring and the polish pass — do you want me to keep going or hand you the demo MP4 first?"

Then wait for his answer.
