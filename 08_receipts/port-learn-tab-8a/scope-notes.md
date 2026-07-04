# Scope notes · Port · Learn tab (#8a)

## Section B port #8a · new /learn route

Source: `05_html-mockups/approved/demo-video-placement.html` (grid
view only · 8b + 8c pick up contextual overlays).

Target files:
- `desktop-2/src/routes/learn/LearnTab.tsx` · component
- `desktop-2/src/routes/learn/LearnTab.css` · styles
- `desktop-2/src/routes/learn/index.ts` · export barrel

Shell wire-in:
- `SECTION_LEARN` added to `sectionIds.ts`
- `LearnTab` component registered in `sectionRegistry.ts` with
  `route: "learn"` · `label: "Learn"` · `navVisible: true`
- Nav badge mapping added in `brandAssets.ts` pointing at
  `/brand/nav-badges/learn.png` (REUSED — was already on disk)

Single-word "Learn" label per `liquid_clips_nav_naming` memory.

## 7 demos in the grid

| # | Title                        | Where it lives              | Kade poster                | MP4                             |
|---|------------------------------|-----------------------------|----------------------------|---------------------------------|
| 01 | Pick a video to clip         | Build tab · hero            | kade-cutting-clips         | 01-clipping.mp4                 |
| 02 | Login & activation           | First-launch onboarding     | kade-reading-brief         | 02-login-activation.mp4         |
| 03 | The money moment             | Post-payment · sync-mail    | kade-earn-mode             | 03-money-moment.mp4             |
| 04 | Wallet & payouts             | Earn tab · wallet detail    | kade-success               | 04-wallet-payouts.mp4           |
| 05 | Cancellation save            | Settings · Plan · Cancel    | kade-hover                 | 05-cancellation-save.mp4        |
| 06 | In-app browser               | Sovereign workbench         | kade-community-mode        | 06-in-app-browser.mp4           |
| 07 | Cold email preview card      | Campaign builder · preview  | kade-campaign-mode         | 07-cold-email-preview.mp4       |

## Card behaviour (matches mockup + claude-2 fixes)

- `<video muted playsinline preload="metadata" autoplay loop
  poster="…">` — autoplays muted on mount so cards animate
  when the route paints.
- **First click**: unmute + `currentTime = 0` + play + set
  `is-focused` (dim the play badge)
- **Second click**: pause / resume toggle
- Keyboard (Enter / Space) mirrors click
- Hover: `translateY(-2px)` + fuchsia border + `--glow-sm`
- Num badge top-left (01–07 · fuchsia rim) · play badge
  top-right (fuchsia circle · fades on focus)
- Meta: title · fuchsia "WHERE IT LIVES" tag · 2-line
  description · dashed-top "Thumbnail slot ready · Daniel
  to drop custom art" hint

## claude-2's poster-fallback fixes mirrored

Verified in port-diff.txt:
- `.lt-poster-fallback { pointer-events: none; z-index: 0 }` ✓
- `.lt-video-slot video { z-index: 1 }` ✓
- `.lt-video-slot.is-playing .lt-poster-fallback { opacity: 0 }` ✓
- `autoplay muted` on the `<video>` element (route paints animate) ✓
- `onPlaying` handler sets `is-playing` class · fires when the
  first frame arrives

## Brand-kit §13 compliance

- **§13c Whop lockup** · exact SVG in the Learn tab header
  (`<img src="/brand/whop/whop_logo_lockup_white.svg">`).
- **§13d Halo bleed math** · resting 16px · peak 28px · 40px
  sticky clearance. Header padding-top is 40px · Whop pill
  centered on the top border of the header · peak 28px halo
  = 42px effective bleed · fits inside the 40px+ pad.
- **§13e App-native viewport** · 3-col grid at 1280×820 with
  ~370px cards + 18px gaps (max-width 1200px centered) · falls
  to 2-col at 1120px min-window · 1-col at 720px mobile
  preview.
- **§13g Kade posters** · all 7 mapped come from the approved
  24 · verified present on disk in `/brand/kade/` · never
  invented.

## Panel-design-lens

Scan units on the Learn tab: 4 (Whop pill · eyebrow · title
+ sub · grid). Each card counts as a single scan unit within
the grid.

No primary CTA on the Learn tab — each card IS its own action
target (click → unmute + focus). Matches Daniel's note.

## Iron gates

- IG-005 (workspace UI) untouched.
- No `src-tauri/` changes.
- Existing SectionRegistry contract preserved · new entry
  slotted at the end · `navVisible: true` so it appears in
  the side nav.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files (all F5/F6 tests untouched)
- No new npm deps

## Daniel's walk

1. `cd desktop-2 && npm run tauri:dev`
2. Click "Learn" in the sidenav (below whatever was previously
   the last visible section)
3. Route mounts · 7 demo cards autoplay muted with Kade
   posters showing until first frame lands
4. Click card 01 → unmute + restart · Kade poster fades ·
   video plays with sound
5. Click card 03 (money moment) → same behaviour · Kade
   earn-mode poster hidden
6. Verify grid at 1280×820: 3-col · at 1040 min-window:
   still 3-col fits · at 720 preview: 1-col stack
7. `signoff port-learn-tab-8a` when satisfied.

## Section B queue after this halt

- Port #8b · contextual overlays 1-4 (Build tab · Login-
  activation · Sync-mail-money-drop · Wallet-detail)
- Port #8c · contextual overlays 5-7 (Cancellation-intercept
  · BrowseOverlay · Campaign-builder)
