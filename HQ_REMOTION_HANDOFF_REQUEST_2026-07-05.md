# HQ · Remotion drop-in request (2026-07-05)

**From:** Claude Me (CM lane · app-side)
**For:** HQ · whoever owns the Remotion pipeline (Claude 1 / Codex / Kimi — whichever it was)
**Type:** Please share your Remotion setup so I don't reinvent it inside the desktop app

---

## The use case (why I'm asking)

Daniel wants **agencies to put their logo (with optional light motion) on every clip** — both clips their clippers post AND their own clips.

Concretely: an agency uploads a logo (PNG/SVG), picks a position (corner / bottom / center) + optional motion preset (fade-in / pulse / slide reveal), and that overlay is composited into every clip's exported MP4.

Currently the desktop app has hardcoded static overlay templates and the sidecar's watermark filter is `drawtext=Liquid Clips`. There's no agency-branded output. Fixing that.

## Why Remotion + why I'm asking you for it

You already made the tool-adoption call for the cold-email preview pipeline (Stages 2-4 of `cold-email-pipeline-spec.md` — Remotion renders the 20s personalised preview MP4 per lead). Rather than duplicate the vetting + install + config work inside `desktop-2`, I want to reuse whatever you built.

**One tool. One house-style. Two features (cold-email preview + in-app agency overlay).**

## What I need from you (drop-in-if-possible)

Ideally I get a small bundle I can `cp -R` into `desktop-2/remotion/` and adapt. In priority order:

### 1. Your `remotion.config.ts`
- Encoder settings you picked
- Pixel format / codec choices
- Whether alpha channel is enabled (I need alpha for the app-side use case; you might already have it or not)
- Any browser executable pin (Chromium version)

### 2. Your render-CLI wrapper
- The exact command signature you spawn (e.g. `npx remotion render --props ... --output ...`)
- How you pass props (JSON on stdin / file / CLI flag)
- Expected error format / exit-code contract
- How you handle timeouts

### 3. Any logo-forward compositions you already have (nice-to-have)
- If a composition already renders a static or animated logo overlay, I'll adapt it
- If not, I'll write new ones — but seeing your composition file structure helps me match your patterns

### 4. Version + workspace pin
- Which Remotion version + peer deps you locked
- Any monorepo / workspace tricks so I install matching versions

### 5. Storage pattern (informational only)
- You use Vercel Blob for renders — the app-side use case writes to `~/LiquidClips/exports/<slug>/` locally, so I won't reuse Vercel Blob, but knowing your naming pattern helps if we ever want app→cloud sync of custom overlays later

## What's DIFFERENT about my use case (so you know what to expect)

I'm NOT trying to run your pipeline as-is. The runtime is different, the output shape is different, the templates are different. Sharing to save you the "why won't this work out of the box" question:

| Your pipeline (cold-email preview) | My use case (agency logo overlay) |
|---|---|
| Runs on Railway worker | Runs in local Python sidecar (`desktop/python-sidecar/sidecar.py`) on user's Mac |
| Outputs full-frame 20s MP4 (the whole video) | Outputs alpha-channel WebM overlay only (composited over the user's real clip in ffmpeg) |
| Composition = fake Liquid Clips UI with YouTube storyboard frames popping into a tile grid | Compositions = 4-5 logo positions × 3-4 motion presets (Corner Pulse · Lower-third Slide · Fade Reveal · Static · Ticker) |
| Trigger: HQ queue push per lead (batched 3000/day) | Trigger: user clicks Export on a single clip |
| Output storage: Vercel Blob | Output storage: `~/LiquidClips/exports/<slug>/` locally |
| Live preview: none (headless only) | Live preview: `@remotion/player` in a new "MotionOverlay Studio" panel inside Settings → Agency → Brand |

**Shared:** the Remotion CLI + composition-authoring pattern + the tool decision itself. That's the reuse win.

## Where I'll integrate it

Directory plan:

```
desktop-2/
├─ remotion/
│  ├─ remotion.config.ts        ← from you
│  ├─ compositions/
│  │  ├─ CornerPulse.tsx        ← new, agency logo + pulse
│  │  ├─ LowerThirdSlide.tsx    ← new
│  │  ├─ FadeReveal.tsx         ← new
│  │  ├─ Static.tsx             ← new
│  │  └─ Ticker.tsx             ← new
│  └─ index.ts                  ← registerRoot()
├─ src/design-os/routes/
│  └─ MotionOverlayStudio.tsx   ← new Settings tab · Player preview + save
└─ ...

junior-backend/app/
├─ models.py                     ← add agency.brand_overlay_config json column
└─ routes/agency.py              ← new POST /agency/{id}/brand-overlay endpoint

desktop/python-sidecar/
└─ sidecar.py                    ← extend method_start_overlay_bake to
                                     spawn Remotion CLI + ffmpeg composite
```

Sidecar step (roughly):
```python
def method_bake_agency_overlay(params):
    # 1. resolve agency.brand_overlay_config
    # 2. spawn: npx remotion render <template_id> --props=<json> --output overlay.webm
    # 3. ffmpeg -i clip.mp4 -i overlay.webm -filter_complex "[0][1]overlay=W-w-24:H-h-24" out.mp4
    # 4. emit progress via existing overlay-bake event pipe
```

## When I need this

Not blocking Cohort 0 ship (which is v2.2.26 tonight / tomorrow). This is the agency retention feature — sprint 2, but I'd rather start with your patterns in hand than reinvent.

**Please reply with:**
- Path(s) in the Dropbox where I can grab the drop-in bundle
- OR paste the config + wrapper + a sample composition inline in a `PASTE_BACK.md` in the LiquidClips handoff folder
- OR ping me if the runtime differences mean you'd rather I just start fresh (that's fine — I'll match your version pin at minimum)

Thanks — saving me a day of vetting means agencies get their brand on clips a day sooner.

— CM lane
