# Screens Simulator — Embeddable Every-Screen Iframe

**Requested:** Daniel · 2026-07-08 (pre-launch, day-of payment tests)
**Owner:** HQ · **Consumer:** any marketing surface (liquidclips.app,
partner landing pages, cold-email footers, IG bio link, Whop bounty pages)
**Deadline hint:** ships this week; day-of-launch nice-to-have

## Why this matters

Today's marketing site can only show one hero video and a static
screenshot strip. This blocks two conversion levers:

- Partners embedding a live tour of the app on their own pages
- Whop bounty pages showing "here's the app you'll be paid to post
  clips in" without the visitor having to install

An iframe is the lowest-friction distribution unit — anyone with an HTML
editor can paste `<iframe src="…">` on any surface. That's the "so it
can go on anywhere" ask.

## Hosting URL (HQ picks)

Recommend: `https://liquidclips.app/screens/` (subpath, same Vercel
project as the marketing site) OR `https://screens.liquidclips.app/`
(subdomain, own project — easier iterate loop).

## Embed contract (what marketing gets)

```html
<iframe
  src="https://liquidclips.app/screens/"
  width="1280"
  height="820"
  loading="lazy"
  allow="autoplay"
  style="border:0;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.15);"
  title="Liquid Clips · every screen"
></iframe>
```

Aspect ratio must match the Tauri window (1280×820, 32:21). Deep-link
per screen via `?screen=<slug>` so cold-email links can drop the reader
straight onto the paywall or the earnings tab.

## Screen roster (order + slugs)

Every user-facing surface in `desktop-2/src/`. Group into three
narrative acts so the auto-cycle tells a story rather than a menu.

**Act 1 · The Open**
1. `intro-splash` — Seedance cinematic (10s, use looping still if too
   heavy for iframe · testid `intro-splash`)
2. `intro-loading` — brand mark + loading bar + v2.2.29 pill (testid
   `intro-splash` stage 2)
3. `welcome-lanes` — three-lane picker: Clipper / Agency / LC-ID (route
   `WelcomeRoute.tsx`)

**Act 2 · The Workbench**
4. `home` — TopHud + four hero tiles (testids `home-tile-1` …
   `home-tile-4` + `home-earn-strip`)
5. `build` — main clip editor (design-os route `build`, source video
   left, timeline centre, Kade guide right)
6. `clips-library` — `library-stage` grid of rendered clips
7. `earn` — `earn-stage` campaigns strip (`earn-open-affiliate`) +
   `campaigns-stage` (LC-scored bounty cards) + WalletPanel
8. `settings` — `settings-connect-whop`, `settings-carrot-onboard`,
   admin gate `settings-open-hq`

**Act 3 · The Money Moment**
9. `paywall-ransom` — Agency $99.99/mo pop when they hit the 10-clip
   free tier ceiling (`AssetRansomPaywallTestHook.tsx`)
10. `whop-checkout` — the in-app persistent-cookie webview (never leaves
    the app · `InlineWhopCheckout.tsx`)
11. `earn-flywheel` — wallet + campaign winner receipt (post-payout
    state of `earn-stage`)

Each screen is a full 1280×820 PNG. Source of truth: Playwright
screenshots against `tauri dev` on desktop-2 v2.2.29. Sequence numbered
above; slug is what the URL query param takes.

## MVP architecture (one-day build)

- Single-page Next.js route or plain HTML at `/screens/index.html`.
- 11 PNG screenshots in `/screens/frames/*.png` (naming: `01-intro-splash.png`,
  etc.).
- Vanilla JS cycler: 5000ms per frame, pause on hover, arrow-key nav,
  URL `?screen=<slug>` deep-links.
- Nav chrome: bottom dot strip + prev/next chevrons + "1 of 11" caption
  + Liquid Clips wordmark top-left.
- No fonts, no fetch, no analytics dependency — must be a fully
  self-contained iframe payload that loads in <200ms on cold cache.

## Screenshot capture recipe

```bash
cd /Users/dipdip/code/jnr/desktop-2
npm run dev         # http://localhost:1420
npx playwright screenshot \
  --viewport-size 1280,820 \
  --full-page=false \
  "http://localhost:1420/?screen=welcome" \
  ~/liquid-clips-screens/03-welcome-lanes.png
```

Playwright already knows the design-os routes from
`tests/e2e/*.spec.ts`. HQ can copy the same auth/JWT seed pattern out of
those fixtures — no need to re-solve the WelcomeGate.

## Nice-to-haves after MVP ships

- Auto-refresh on desktop release: CI writes a `manifest.json` with
  screenshot URLs, iframe reads it, always shows current build.
- Deep-link per bounty: `?screen=whop-checkout&campaign=<id>` drops on
  a specific campaign card.
- Analytics: HQ decides whether to bake in PostHog or leave the iframe
  telemetry-free (recommend telemetry-free — third-party surfaces
  can't be trusted to disclose).

## Version + arch reminder

Screenshots must be from v2.2.29 (splash version pill visible = quick
visual smoke that HQ has the right build). Build on Intel host
(host-arch, no `--target aarch64…`) per the
`daniel_mac_arch_intel.md` memory.

## DMG background (paired asset)

Sitting in `assets/dmg-background-distribution-wins.png` in this same
handoff. 1536×1024 landscape · Kade aiming a launch cannon at the
Applications folder · fuchsia trajectory arc · paper/ink brand palette
· "DISTRIBUTION WINS" tagline. Crop to 660×400 for the DMG chrome
(right third = Applications folder icon position; left third = .app
icon position; middle third = trajectory arc + tagline).

Suggested tauri.conf.json wiring (when we bring notarization + DMG back
in-app on Intel host):

```json
"bundle": {
  "macOS": {
    "dmg": {
      "background": "brand-assets/dmg/dmg-background-distribution-wins.png",
      "windowSize": { "width": 660, "height": 400 },
      "appPosition":         { "x": 180, "y": 200 },
      "applicationFolderPosition": { "x": 480, "y": 200 }
    }
  }
}
```

Positions above assume the tagline sits vertically-centred; test on
retina + non-retina.
