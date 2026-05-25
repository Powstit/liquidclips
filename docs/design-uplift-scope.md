# Junior — Design-Language Uplift Scope

**Status:** SCOPE ONLY — no code, no assets generated, no deploy. This is the plan for the last polish pass before v1.0 deployment.
**Surfaces:** Desktop (Tauri 2, primary) · account-app (Next.js) · marketing (static HTML) · partner-app (Next.js).
**Date:** 2026-05-25.

## Non-negotiable brand guardrails (carry into every change below)

These come from `desktop/CLAUDE.md` §3.3 / §3.10 and must survive the uplift:

- **ONE fuchsia, ONE ink, ONE paper.** No new accent hues. Everything elevated is built from the existing fuchsia ladder (`fuchsia` / `fuchsia-bright` / `fuchsia-deep` / `fuchsia-soft` / `fuchsia-glow`) plus ink/paper. The single sanctioned non-brand colour already in the codebase is `#DC2626` for destructive/error and `#F59E0B`/`#EAB308` for "in progress / warning" — do not multiply these.
- **No emojis in UI.** Past tense for done, plain verb for in-progress, no exclamation marks.
- **No second styling library, no UI framework with its own tokens.** Tailwind 4 `@theme` is the system. New motion is CSS keyframes + a tiny count-up hook; Rive only if a splash genuinely needs it.
- **Asset pipeline (owner HARD RULE):** every raster icon / logo / illustration / splash art comes from **gpt-image-1** via the OpenAI API. CSS/Rive only *animates*; it never *creates* art. Simple inline UI glyphs (the `/` mark, chevrons, the existing `PlatformIcon` simple-icons SVGs) stay as inline SVG.

---

## 1. Design-language assessment

### What the system is today (the good)

| Layer | Current state | Files |
|---|---|---|
| Colour | Disciplined fuchsia ladder + ink/paper/line + 2 text greys. Identical token set mirrored across all 4 surfaces. | `desktop/src/index.css`, `account-app/src/app/globals.css`, `marketing/index.html` `:root`, `partner-app/.../globals.css` |
| Type | Fraunces (display), Geist (sans), Geist Mono (mono/eyebrows). Used consistently. | all surfaces |
| Brand mark | Fuchsia pill + paper tile + ink `/` slash, rendered in CSS not as an image. Cross-surface continuity. | `desktop/src/components/Logo.tsx` |
| Motion (partial) | `pulse-dot`, `blink` everywhere; checkout has a real mini motion system (`jnrIn`/`jnrPulse`/`jnrFloat` + `prefers-reduced-motion`); Splash has a custom sweep bar; `JuniorLoader` has a typewriter. | `checkout/page.tsx`, `Splash.tsx`, `JuniorLoader.tsx` |
| Component vocabulary | `rounded-full` pills, `rounded-2xl/3xl` cards, hover `border-fuchsia`, a recurring "premium" fuchsia glow `shadow-[0_10px_30px_rgba(255,26,140,0.3)]` on primary CTAs. | desktop-wide |

### The specific gaps vs "billion-pound"

1. **No elevation scale — shadows are ad-hoc strings.** A tally of desktop alone shows **15+ distinct one-off `shadow-[...]` values** and one-off `drop-shadow`. The fuchsia-glow CTA shadow is copy-pasted in 16 places with no token. There is no resting/raised/floating/modal depth ladder, so cards, toolbars, modals, and CTAs all sit at slightly inconsistent, hand-tuned depths. This is the single biggest "looks hand-made, not designed" tell.
2. **Flat brand assets.** The app icon (`src-tauri/icons/app-icon.png`) is a flat fuchsia rounded square with a black slash — correct mark, zero depth/gradient/light. No splash art, no tier icons, no empty-state illustration, no onboarding art. The marketing "dock mockup" literally uses **emoji** (`🎬 ✏️ 💬 📁`) as stand-in neighbour app icons (`marketing/index.html` ~L1616-1622) — visible on a page whose whole point is "look how premium our icon is."
3. **Leftover emoji glyphs in UI** (violates §3.10 + reads cheap): `tiktok: "♪"` in `ScheduleQueue.tsx` (L8) and `DripCalendar.tsx` (L11); `✉` in `partner-app ShareButtons.tsx` (L47); the `🎬` etc. dock emoji above. The real monochrome `PlatformIcon` already exists and should back all of these.
4. **Weak active-state hierarchy.** Nav tabs are a 2px underline bar (`App.tsx` `NavTab`, `EarnTab` sub-nav). Functional but flat — no glow, no lift, no transition choreography. Active = "slightly less grey," not "lit up."
5. **Static numbers.** Dashboard `Stat` tiles, `AffiliateCard` Tiles, partner `StatTiles` (MRR / lifetime earned / referrals), and clip `virality` / `avg score` all render instantly as plain text. For a money + virality product these are the emotional payload and they currently have no life.
6. **Splash/loading is minimal.** `Splash.tsx` is a logo + a sweeping bar + cycling lowercase ticks. `WorkingStage` (the transcribe→cut→reframe pipeline — the app's signature moment) renders stage status with **ASCII glyphs** (`✓ × › ○`) and a thin bar. No skeletons anywhere; loading states are `Reading…_` text.
7. **Spacing/radius rhythm is mostly consistent but undocumented** — `rounded-xl/2xl/3xl` and `rounded-full` are used by feel. One stray `rounded-[9px]` (Logo). Gradients appear in exactly two places (checkout hero, one dashboard card) and aren't a system.
8. **Glass/blur is used but thin** — `backdrop-blur-md` on the clips toolbar and Settings header only. A consistent "frosted overlay" treatment for modals/sheets would raise perceived quality.

---

## 2. Elevation system (within ONE-fuchsia/ink/paper)

The strategy: introduce **named tokens** so the existing ad-hoc values collapse into a ladder, then apply them. Everything below is expressible in Tailwind 4 `@theme` + a handful of utility classes; no new colours.

### 2.1 Depth / shadow ladder (P0)

Add to each `@theme` block (`desktop/src/index.css`, `account-app/globals.css`, `partner-app/globals.css`) and the marketing `:root`. Two families: **neutral** (ink-based, for structure) and **glow** (fuchsia-based, for active/primary).

| Token | Value | Use |
|---|---|---|
| `--shadow-e0` | `0 1px 0 rgba(10,10,15,0.03)` | hairline rest (rows, list items) |
| `--shadow-e1` | `0 2px 12px rgba(10,10,15,0.05)` | resting card (replaces the `0_2px_12px` variants) |
| `--shadow-e2` | `0 8px 28px rgba(10,10,15,0.08)` | hovered/raised card, popover menus |
| `--shadow-e3` | `0 20px 60px rgba(10,10,15,0.18)` | modal / sheet / sticky toolbar |
| `--glow-sm` | `0 6px 18px rgba(255,26,140,0.15)` | active tab, focused input, selected tile |
| `--glow-md` | `0 10px 30px rgba(255,26,140,0.28)` | primary CTA hover (replaces the 16× copy-paste) |
| `--glow-lg` | `0 0 0 1px rgba(255,26,140,0.4), 0 14px 44px rgba(255,26,140,0.22)` | hero / splash / "money" moments |

Effort: **S** to add tokens; **M** to migrate the ~25 inline shadow strings to tokens across desktop. Migration is mechanical and safe to do incrementally (token + class first, then swap call-sites surface by surface).

### 2.2 Glow system (P0)

A single utility convention so glow is intentional, not decorative:

- **Active nav tab:** keep the 2px underline but make it `bg-fuchsia` with `box-shadow: var(--glow-sm)` on the bar + a 150ms ease transition; add a subtle `text-ink` → `text-fuchsia-deep` on the label. Applies to `App.tsx NavTab`, `EarnTab` sub-nav, `ResultsGrid` tabs.
- **Primary CTA:** `bg-ink hover:bg-fuchsia` + `hover:shadow-[var(--glow-md)]` — this is already the de-facto pattern, just tokenise it.
- **Focus ring:** replace bare `focus:border-fuchsia` with `focus:border-fuchsia focus:shadow-[var(--glow-sm)]` on inputs (DropZone URL/brief, Settings key input, PublishModal datetime, Earn search). Accessibility win + premium feel.
- **Selected state:** publish platform tiles already use `shadow-[0_8px_24px_rgba(255,26,140,0.25)]` when picked — point them at `--glow-sm`/`--glow-md`.
- **Rule:** glow is reserved for *active / selected / primary / focused*. Never on resting structure (that uses neutral `e1/e2`). This keeps the page calm and makes the lit element obvious.

### 2.3 Gradient usage (P1)

Currently two ad-hoc gradients. Promote to a small set, fuchsia-only:

- `--grad-fuchsia: linear-gradient(135deg, #FF1A8C 0%, #C70066 55%, #FF66B8 100%)` (already used in checkout hero — tokenise it).
- `--grad-paper: linear-gradient(180deg, #FAF7F2 0%, #F5EFE7 100%)` for large surfaces (splash background, empty-state canvas) to kill the "flat paper" look without adding colour.
- Usage rule: gradients only on **brand/hero surfaces and generated art backplates**, never on text or small UI. Body stays solid paper.

### 2.4 Refined type scale (P1)

Type is good; formalise the steps so screens stop hand-picking sizes. Proposed display ladder (Fraunces): `display-xl 56/1.05`, `display-l 44`, `display-m 28`, `display-s 20`. Body (Geist): `16 / 14 / 13`. Mono eyebrow: `11 uppercase 0.12em` (already the de-facto standard). Add `--tracking-eyebrow: 0.12em` and `--tracking-display: -0.025em` tokens so the `tracking-[-0.025em]` repetition becomes a token. Effort: **S** (mostly documentation + a few alignments; the values already cluster here).

### 2.5 Radius + spacing rhythm (P1)

Codify the existing feel: `--radius-pill: 9999px`, `--radius-card: 16px (rounded-2xl)`, `--radius-card-lg: 24px (rounded-3xl)`, `--radius-control: 12px`, `--radius-chip: 8px`. Fix the stray `rounded-[9px]` in Logo to `--radius-chip`. Spacing: standardise card padding on `p-5 / p-7` (already common) and section gaps on `gap-6 / gap-8`. Effort: **S**.

### 2.6 Glass / blur (P2)

One frosted treatment: `bg-paper/85 backdrop-blur-[20px]` for sticky headers/toolbars (Settings header already does this) and `bg-ink/60 backdrop-blur-sm` for modal scrims (PublishModal scrim is currently `bg-ink/60` with no blur — add blur). Apply to: modal backdrops (PublishModal, Settings, NotificationSheet, ScheduleQueue), sticky `ClipsBulkToolbar`. Effort: **S**.

### Example component treatments (before → after)

- **ClipCard** (`clips-feed/ClipCard.tsx`): rest `shadow-[var(--shadow-e1)]` → hover `shadow-[var(--shadow-e2)]` + `-translate-y-[2px]` (200ms). Virality pill keeps its fuchsia ladder mapping but the 90+ tier gets `shadow-[var(--glow-sm)]` so "this one will pop" reads instantly.
- **Primary CTA** (everywhere): `class="btn-primary"` → `bg-ink hover:bg-fuchsia hover:shadow-[var(--glow-md)] transition-all duration-200`.
- **Active nav tab:** underline bar gains `shadow-[var(--glow-sm)]`; inactive→active uses a sliding/fading bar (see §4.6).

---

## 3. gpt-image-1 asset list

All prompts are written for **gpt-image-1**. House style to prepend to every prompt: *"Minimal, premium, editorial. Brand palette ONLY: fuchsia #FF1A8C with deep #C70066 and glow #FF66B8, near-black ink #0A0A0F, warm paper #FAF7F2. No other colours. No text unless specified. No drop-shadow baked into transparent assets. Crisp vector-like edges, flat-with-subtle-depth, Apple-grade restraint. No emoji aesthetic, no clip-art, no gradients on small marks."*

| # | Asset | Purpose | Surface | Dimensions | Transparent? | Effort |
|---|---|---|---|---|---|---|
| A1 | **App icon (master)** | macOS/Windows app icon source → sliced to `.icns`/`.ico` + all `icons/*` PNGs | Desktop (dock, installers) | 1024×1024 | No (full-bleed rounded tile) | M |
| A2 | **Wordmark lockup** | High-res `junior/employee` lockup for marketing hero, splash, OG image | marketing, account, splash | 2400×600 | Yes | S |
| A3 | **Tier icons ×4** | Free / Solo / Growth / Autopilot badges (pricing, upgrade walls, Settings plan row) | account-app, desktop | 512×512 each | Yes | M |
| A4 | **Empty-state illustration** | DropZone "drop a video" canvas art | Desktop | 1200×900 | Yes | M |
| A5 | **Onboarding illustration** | FirstRun hero panel | Desktop | 1200×900 | Yes | S |
| A6 | **Splash art** | Desktop launch sequence backplate (animated by CSS/Rive on top) | Desktop | 1600×1000 | No | M |
| A7 | **Platform glyph backplates (optional)** | Only if a richer platform tile is wanted; otherwise keep existing inline `PlatformIcon` | Desktop publish | 256×256 ×4 | Yes | S (optional) |
| A8 | **Marketing dock neighbour icons ×3** | Replace `🎬 ✏️ 💬` emoji in the dock mockup with neutral generated app-icon tiles | marketing | 256×256 ×3 | No | S |
| A9 | **OG / social card** | Link-share image for all `jnremployee.com` surfaces | marketing/account/partner | 1200×630 | No | S |
| A10 | **Pipeline stage icons ×4** | transcribe / cut / reframe / thumbs marks to replace `✓ × › ○` ASCII in WorkingStage | Desktop | 256×256 ×4 | Yes | M |

> Note: A1 replaces the current flat icon. Keep the exact mark (fuchsia tile, ink `/`) — the brief to gpt-image-1 is *depth and light on the SAME mark*, not a redesign.

### Ready-to-run prompts

**A1 — App icon master**
> [house style] A macOS app icon: a rounded-square tile (squircle, ~22% corner radius) filled with a rich fuchsia #FF1A8C surface that has a single soft top-left light source and a very subtle deeper fuchsia #C70066 falloff toward the bottom-right — premium and dimensional but still minimal. Centered, a single bold near-black ink #0A0A0F forward-slash "/" mark, slightly italic, occupying ~55% of the height, with a barely-perceptible inner depth so it reads as carved, not painted. Full-bleed, no transparency, no text. Clean, Apple-grade, suitable at 16px and 1024px.

**A2 — Wordmark lockup**
> [house style] A horizontal wordmark on transparent background reading "junior/employee" in a clean geometric monospace, near-black ink #0A0A0F, with ONLY the slash "/" in fuchsia #FF1A8C. Tight, confident letter-spacing. No icon, no box, no shadow. Crisp edges for use at large sizes.

**A3 — Tier icons (run 4×, swap the bracketed line)**
> [house style] A single minimal badge icon on transparent background representing a software subscription tier, flat with subtle dimensional light, fuchsia + ink + paper only, no text. Tier: [FREE = a clean open outline ring, mostly paper with a thin fuchsia edge]. (Solo = one solid fuchsia rounded bar. Growth = three ascending fuchsia bars. Autopilot = a fuchsia orbit/loop mark suggesting hands-off automation.) Geometric, restrained, instantly legible at 24px.

**A4 — Empty-state illustration**
> [house style] A minimal editorial illustration for a "drop a video here" empty state on transparent background: an abstract long film strip or timeline flowing in from the left and resolving into a few short vertical clip cards on the right, implying long-video-becomes-short-clips. Ink line-work on paper with one or two fuchsia accents only. Calm, spacious, lots of negative space, no people, no text.

**A5 — Onboarding illustration**
> [house style] A welcoming minimal illustration for a first-launch screen, transparent background: an abstract desk/workspace motif — a single video file gliding into a fuchsia processing core — rendered as clean ink line-work on paper with fuchsia accents only. Optimistic, premium, no text, no clutter.

**A6 — Splash art**
> [house style] A full-bleed launch screen backplate (no transparency): a soft fuchsia #FF1A8C to deep #C70066 to glow #FF66B8 diagonal gradient field with a faint radial light bloom top-right, very subtle, mostly dark-fuchsia and calm so light UI elements and a centered "/" mark can animate on top. Cinematic, restrained, no text, no objects.

**A7 — Platform glyph backplates (optional)**
> [house style] A set of four neutral rounded-square icon tiles on transparent background, paper #FAF7F2 surface with a thin ink edge and a single soft top-light, each empty in the center (glyph composited separately). Dimensional but minimal. (Generate as one sheet or 4 files.)

**A8 — Marketing dock neighbour icons**
> [house style] Three generic, neutral macOS-style app icon tiles on transparent background (squircle, soft top-light, subtle depth) in muted paper/ink tones with no recognisable brand and no emoji — abstract stand-ins for "other apps in a dock." Quiet and tasteful so the fuchsia Junior icon beside them is clearly the standout.

**A9 — OG / social card**
> [house style] A 1200×630 social share card, no transparency: warm paper background, the "junior/employee" wordmark (ink with fuchsia slash) upper-left, and on the right an abstract fuchsia film-strip-to-clips motif. One line of breathing room. Premium, editorial, minimal. Reserve lower-third clear space for headline text added later in code.

**A10 — Pipeline stage icons**
> [house style] Four minimal monochrome process-step glyphs on transparent background, ink line-work with a fuchsia accent dot, no text: (1) transcribe = a soundwave resolving into text lines, (2) cut = a clean scissor/cut mark on a timeline, (3) reframe = a wide frame collapsing into a vertical 9:16 frame, (4) thumbs = a small grid of frames. Consistent stroke weight, legible at 20px.

---

## 4. Motion system

**Approach decision:**
- **Default = CSS keyframes** (matches the existing `jnrIn/jnrPulse/jnrFloat` precedent and the "no second library" rule). Extend that system rather than reinvent it.
- **Count-up numbers = one tiny `useCountUp` hook** (~30 lines, `requestAnimationFrame`, easeOutCubic) — no library. Shared across desktop + web.
- **Rive = splash ONLY, and only if** the desired launch sequence (mark draws in, slash pulses, bar fills) can't be done cleanly in CSS. Default recommendation: **do the splash in CSS** over generated art A6; reserve Rive as a stretch. Rive animates the gpt-image-1 art; it never draws the art.
- **MANDATE:** every animated treatment ships behind `@media (prefers-reduced-motion: reduce)` that drops to a static/instant state. checkout already does this — make it the template. Count-up degrades to the final value instantly.

| Treatment | What | Approach | Files | Effort |
|---|---|---|---|---|
| **Splash launch sequence** (P0) | mark fades+scales in over A6 backplate, slash pulses, progress bar fills under cycling ticks | CSS keyframes (extend existing `splash-bar`) | `Splash.tsx` | M |
| **Pipeline loading screen** (P0) | transcribe→cut→reframe→thumbs as lit stage rail; current stage glows; A10 icons replace ASCII; live caption ticker | CSS + token glow | `WorkingStage.tsx` | M |
| **Skeleton loaders** (P1) | shimmer placeholders for clips grid, connections list, bounty cards, dashboard stats while data loads (replaces `Reading…_` text) | one `@keyframes shimmer` + `.skeleton` util | ResultsGrid, PublishModal, EarnTab, dashboard | M |
| **Animated numbers** (P0) | virality scores, avg score, dashboard `Stat`, AffiliateCard tiles, partner `StatTiles` (MRR/earned), Earn payout amounts count up on mount/change | `useCountUp` hook | ClipCard, ClipsBulkToolbar, dashboard/page, AffiliateCard, StatTiles | M |
| **Glowing tab transition** (P1) | active underline bar slides + glows between tabs instead of hard-cutting | CSS transition on a shared bar / layout transition | App.tsx NavTab, EarnTab nav, ResultsGrid tabs | S |
| **Page/route transition** (P2) | gentle `jnrIn` fade-up on view/route mount (desktop view switches + web pages) | reuse `jnrIn` | App.tsx main, account-app pages | S |
| **Button micro-interactions** (P1) | primary CTAs lift + glow on hover (token `--glow-md`), press scales 0.98, success ticks animate | CSS, tokenised | global | S |

**`useCountUp` contract (for implementer):** `useCountUp(target: number, { durationMs = 900, decimals = 0, prefix = "", suffix = "" })` → formatted string; respects reduced-motion by returning the final value immediately; re-runs when `target` changes (so live MRR/virality updates animate the delta). For currency tiles, animate the numeric portion only and keep the `$`/`£` symbol static.

---

## 5. Per-surface punch-list (top 3–5, highest impact first)

### Desktop (PRIMARY)
1. **Tokenise depth + glow** (§2.1/2.2) and migrate the 25+ inline shadows → instant consistency lift across every screen.
2. **Pipeline loading screen** (`WorkingStage`): replace `✓ × › ○` ASCII with A10 icons + glowing current-stage rail + count-up on clip counts. This is the app's signature moment.
3. **Splash launch sequence** over A6 art.
4. **Animated virality / avg-score numbers** in ClipCard + ClipsBulkToolbar; 90+ clips get `--glow-sm`.
5. **Kill leftover emoji:** `♪` in ScheduleQueue.tsx (L8) and DripCalendar.tsx (L11) → `PlatformIcon id="tiktok"`. Empty-state art (A4) in DropZone.

### account-app
1. **Animated dashboard `Stat` tiles + AffiliateCard tiles** (`useCountUp`) — exports remaining, MRR, lifetime earned. Money should move.
2. **Tier icons (A3)** into PricingCards + the PublishModal/account upgrade walls.
3. **Tokenise depth/glow** in globals.css; apply glow to primary CTAs + focus rings.
4. **Skeletons** on dashboard cards / pricing while server data resolves; route-mount `jnrIn`.
5. **AdminHQ** (`components/admin/AdminHQ.tsx`, 972 lines): apply the elevation tokens + animated KPI numbers so the internal HQ feels first-class.

### marketing (static HTML)
1. **Replace the emoji dock** (`🎬 ✏️ 💬 📁`, ~L1616-1622) with generated neutral icons (A8) + the real Junior icon (A1) — the icon-showcase section sells "premium icon" while showing emoji.
2. **Drop in A1 favicon + A2 wordmark + A9 OG card** (favicon is currently an inline-SVG slash — fine, but the OG/social card is missing).
3. **Tokenise glow** on `.btn-primary` hover (already close) + hero radial bloom uses `--grad-fuchsia`.
4. **Add `prefers-reduced-motion` guard** to the hero `@keyframes pulse` / chat animation (affiliates.html already has the JS guard pattern to copy).

### partner-app
1. **Animated `StatTiles`** (MRR / this month / total earned) with `useCountUp` + currency-symbol-static — the affiliate's emotional payload.
2. **Replace `✉` emoji** in ShareButtons.tsx (L47) with an inline mail SVG (and audit `𝕏`/`▷` siblings for consistency — prefer real glyphs/SVG).
3. **Tokenise depth/glow**; qualification milestone tiles (the `2` / `11,000`) count up.
4. **Skeleton + `jnrIn`** on dashboard load.

---

## 6. Implementation sequencing

**Dependency rule:** tokens before components; generated assets before the components that consume them.

1. **Phase 0 — Tokens (no visual risk).** Add depth/glow/gradient/radius/type tokens to all four `@theme`/`:root` blocks. Pure additions; nothing changes until used. *Ship-safe immediately.*
2. **Phase 1 — Asset generation.** Run gpt-image-1 for A1–A10. Slice A1 → `icons/*` (`.icns`/`.ico` + all PNG sizes) via the existing icon tooling. Assets land in repo; not wired yet. *(Separate task — this scope does not generate them.)*
3. **Phase 2 — `useCountUp` hook + animated numbers.** Self-contained, high emotional ROI, low blast radius. Desktop + web in parallel.
4. **Phase 3 — Shadow/glow migration + button/tab/focus micro-interactions.** Mechanical, surface-by-surface, each commit independently shippable.
5. **Phase 4 — Signature screens.** WorkingStage pipeline (needs A10) + Splash (needs A6). Highest craft, depends on Phase 1 assets.
6. **Phase 5 — Skeletons + page transitions + emoji purge + dock-icon swap.** Polish tail; each item independent.

**Safe to ship incrementally:** Phases 0, 2, 3, 5 require no asset dependency and can land in any order. Phases 1→4 are the only hard dependency chain. Reduced-motion guards ship *with* each animated treatment, never after.

---

## Executive summary — 6 highest-leverage moves

1. **Build a depth + glow token ladder** (`--shadow-e0..e3`, `--glow-sm/md/lg`) and migrate the 25+ copy-pasted inline shadows. One change, consistency across every screen — the biggest "designed not hand-made" jump.
2. **Make the numbers move.** A 30-line `useCountUp` hook on virality scores, dashboard exports, and affiliate MRR/earnings turns the product's emotional payload (money + virality) from dead text into the moment people screenshot.
3. **Elevate the two signature screens** — the transcribe→cut→reframe pipeline (`WorkingStage`, replacing ASCII `✓×›○` with generated A10 icons + a glowing stage rail) and the launch splash over gpt-image-1 art (A6). These are where users feel the craft.
4. **Regenerate the flat app icon (A1) with depth/light** on the exact same mark, slice it to `.icns`/`.ico`, and **purge every emoji** — the marketing dock (`🎬✏️💬`), the `♪` TikTok glyphs, the `✉` share button — replacing each with generated icons or the existing monochrome `PlatformIcon`.
5. **Add a real glow-on-active system** — tabs, primary CTAs, focused inputs, selected tiles — so the lit element is always obvious, strictly reserving fuchsia glow for active/selected/primary and keeping resting structure on neutral elevation.
6. **Sequence tokens → assets → numbers → migration → signature screens**, with `prefers-reduced-motion` mandatory on every animation; Phases 0/2/3/5 ship incrementally with zero asset dependency so polish lands continuously instead of in one risky drop.
