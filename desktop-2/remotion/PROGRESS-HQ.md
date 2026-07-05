# PROGRESS — HQ session (2026-07-03)

**Owner:** HQ (marketing-engine Claude). Status of the preview engine after this session.

## Done
- **Picked up the scaffold** from `07_remotion-preview-engine/` + full brand kit (`02_brand-kit`). Copied to a clean local working dir `~/liquidclips-engine/preview-engine/` (never run npm inside Dropbox).
- **Real frames working end-to-end.** Wrote `~/liquidclips-engine/lc-frames-curl.mjs` — a curl-backed port of the storyboard extractor. **Node's global `fetch` is broken in this environment (undici/TLS); curl works.** Pulled 8 real frames from MrBeast "$456,000 Squid Game In Real Life!" (`0e3GPea1Tyg`), baked into `public/frames/frame_00..07.jpg` (320×180, no yt-dlp, no download).
- **HTML fast-iteration mockup** at `mockup/index.html` — the full 20s timeline in pure HTML/CSS/JS, mirroring the Remotion timing tokens (600f @ 30fps), with a scrubber + `?t=SECONDS` deep-link. This is the design source of truth we iterate before touching `.tsx`.
- **Closed the biggest branding gap: Kade was missing from the composition.** He now lives in the sidebar and works through his real poses across the timeline: `kade-reading-brief` → `kade-cutting-clips` → `kade-create-clips` → `kade-success` → `kade-celebration`, with a live status line.
- **Brand-kit compliance pass** (per `brand-skill.md`): `liquid/clips` wordmark w/ fuchsia slash, fuchsia-only accent, warm ink `#f4f1ea` (no pure white), Inter + Geist Mono, pixel Invader landmark (title bar + CTA pill), HUD bracket corners on the input panel, `working-shimmer` progress (not a spinner), cockpit-tile clip grid w/ spring pop-in, fuchsia-halo CTA, CRT scanline overlay.
- **Daniel reviewed + approved the look** ("better than good").

## Next (HQ, in order)
1. **Port the approved HTML look back into the `.tsx` components** (WindowChrome/InputPanel/ProgressBar/ClipGrid/CtaCard) — add Kade, HUD brackets, Invader, scanlines. Straight copy; timing tokens already match.
2. **Render the real MP4** via `scripts/render.ts` + the 3 QC stills (frames 30/200/490).
3. **Per-lead wiring:** `@handle` → latest video → `lc-frames-curl` → props → render.
4. **Upload → Vercel Blob** → emit `preview_url`; queue worker; deploy to the isolated `liquidclips` Railway project.
5. **Cold-email template** — Daniel is sending the brief.

## Notes for App team
- Frame manifest contract unchanged (HANDOFF-002): `{videoId,title,duration_s,tile,frames:[{url,t_seconds}]}`.
- Headless Chrome is killed under this sandbox; live browser + `dangerouslyDisableSandbox` headless both work for QC.
