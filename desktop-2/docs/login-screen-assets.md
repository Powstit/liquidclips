# LoginScreen assets · source of truth

**Preview HTML (reference):** `desktop-2/docs/login-screen-preview.html`

## Backdrops (rotate every 12s · pin on manual pick)
- `public/brand/login-kade-hero-01.png` — light w/ pixel invaders
- `public/brand/login-kade-hero-dark-01.png` — dark w/ pixel invaders
- `public/brand/login-kade-presenter-01.png` — presenter · holo clip arc
- `public/brand/login-kade-concept-A.png` — arc
- `public/brand/login-kade-concept-B.png` — matrix parallax (dark)
- `public/brand/login-kade-concept-C.png` — coin vortex
- `public/brand/login-kade-concept-D.png` — curator
- `public/brand/login-kade-concept-E.png` — Times Square wall (dark)

## Brand marks
- `public/brand/assets/wordmark-text.png` — LIQUID / CLIPS text-only wordmark (login logo · no invader icon)
- `public/brand/assets/wordmark.png` — full lockup (invader + text) · not used on LoginScreen
- `public/brand/whop/whop_logo_lockup_white.svg` — Powered by Whop · auto-flips per theme

## Layout locks (see preview §grid)
- Grid: `minmax(340px, 22%) minmax(0, 1fr) minmax(560px, 56%)`
- Login column: centered content, symmetric 32px padding, 380px max card width
- Kade column: backdrop shows through via `background-size: 130% auto`, `background-position: 12% center`
- Marquee column: mask fade LEFT only, flush to shell RIGHT edge, 8 tiles doubled for seamless loop
- Frost pane: `mask-image` limits to left 46%, `backdrop-filter: blur(8px) saturate(0.90)` + adaptive tint

## Marquee data source
`GET /hq/carousel/clips` → array of `{ url, handle, earningsCents, platform }`.
HQ tab wire ships in [[HQ Carousel Clips tab]].

## Dark themes (Whop lockup + logo filter flip)
`data-bg="dark" | "conceptB" | "conceptE"`
