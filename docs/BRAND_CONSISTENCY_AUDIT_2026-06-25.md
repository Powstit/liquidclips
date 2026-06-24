# Liquid Clips · Brand Consistency Audit · 2026-06-25

> Scope: every surface a real human can reach across `liquidclips.app`,
> `account.liquidclips.app`, the desktop legacy app (`v0.7.79`), the desktop-2
> redesign (in-main, not yet shipped), and the HQ admin shell.
>
> Method: read-only — `grep`, `find`, `curl` against live hosts, and the
> mandatory `desktop/scripts/brand-kit-drift-check.sh` IG-012 gate.
> No code changes.

## TL;DR

- **Cohesion verdict: DRIFTING.** Five P0 drifts visible to customers + nine P1
  drifts visible to admin + maintenance debt. The token contract is honoured
  inside the IG-012 sentinels (canonical desktop / desktop-2 / admin tokens.css
  all agree), but every customer-facing surface bleeds outside the contract:
  marketing invents its own private fuchsia ladder, account-app Clerk modal
  renders in a light-cream theme on a dark site, desktop ships **89 lucide
  imports** + 11 yellow / red / green tailwind literals, and the desktop window
  HTML title still reads `junior/employee` — the pre-rebrand name.
- **Drift count: 24 total** · P0 (visible to customer) **5** · P1 (visible to
  admin) **9** · P2 (code cleanup) **10**.
- **Mandatory gates:**
  - IG-012 brand-kit drift check (`bash desktop/scripts/brand-kit-drift-check.sh`) → **PASS** (green)
  - Iron-gate sentinels intact (`IG-012` in 7 files, `IG-HQ-002` in admin tokens) → **PASS**
  - Snapshot-proof: live HTML inspected for marketing (200), account (200), founding (200), connect-desktop (200), upgrade (200), dashboard (200). Favicon endpoint inspected.

## Per-surface assessment

### 1 · Marketing · `liquidclips.app`

**Status:** **DRIFTING (P0)**

**Evidence:**
- `src/app/layout.tsx` loads `Inter` + `JetBrains_Mono` (`--font-sans`,
  `--font-mono`). Brand-kit-skill canonical mono is **Geist Mono**, not
  JetBrains Mono. The hero you read on liquidclips.app is in a mono font the
  brand kit doesn't sanction.
- `src/app/funnel.css` defines a private `--w1-*` ladder with **off-canonical
  fuchsia `#ff2bb0`** (canonical is `#ff1a8c`), **off-canonical cyan
  `#2dd6ee`** (canonical `#00e5ff`), and a non-brand ink `#ecebf2` (canonical
  `#f4f1ea`). 39 hex literals in funnel.css drift from the
  `:root` ladder in `globals.css`. Hero / KadeScans / ClipVault / Workbench
  windows all paint with the wrong fuchsia.
- `WorkbenchWindow.tsx` hard-codes `v0.8.0` (titlebar) and `HeroStage.tsx` /
  `InformationConsole.tsx` show `v0.8`. Shipping desktop is `v0.7.79`. The
  customer reads a version that doesn't exist.
- Marketing `<title>` of `<head>` is fine, but `rel="icon"` →
  `/brand/favicon-source-512.png` (a 512 px PNG source — Safari + Chrome
  prefer `favicon.ico`). `curl https://liquidclips.app/favicon.ico` returns
  **404**. The browser tab on the main marketing domain has no favicon.
- No `theme-color` meta. Chrome / Safari address bar falls back to OS grey.
- `.lc-w4-traffic` (macOS-style traffic lights in the WorkbenchWindow) paints
  `#ff5d6c` red + `#f59e0b` amber + `#00d97e` green — three colours the brand
  kit explicitly forbids ("no amber/lime/blue/green accents elsewhere").
  Defensible as macOS iconography but still off-brand.

**Drift:**
- [P0] private fuchsia ladder + JetBrains Mono in customer-facing hero
- [P0] favicon 404 + theme-color missing
- [P1] hard-coded `v0.8.0` in WorkbenchWindow

---

### 2 · Account-app · `account.liquidclips.app/*` (customer surfaces)

**Status:** **DRIFTING (P0)**

**Evidence:**
- `src/app/layout.tsx` ClerkProvider `appearance.variables` uses **v6 Clerk
  token names** (`colorBackground: "#FAF7F2"`, `colorText: "#0A0A0F"`, etc).
  Clerk shipped v7 in this repo (`"@clerk/nextjs": "7.3.7"`), where the
  surface is `colorForeground` / `colorMutedForeground` / `colorInput` /
  `colorInputForeground`. **The v6 names are silently ignored on v7.** The
  Sign-In modal renders in Clerk default light theme on top of `bg-paper
  #0B0B10`. White cream modal on a near-black site — pure
  "looks like a different company" failure.
- Marketing's layout uses the **v7 token names correctly** (`#0b0b10` bg,
  `#f4f1ea` fg). So the same Clerk widget renders properly dark on
  marketing and broken light on account-app. Both hosts share the same auth
  experience — the divergence between them is visible to every signed-in
  user the moment they bounce.
- `src/components/Nav.tsx` Sign-up button = `bg-ink` (warm white) with
  `text-paper` on hover-to-fuchsia. Marketing has no Sign-up CTA in nav —
  it's `Download`. **Different primary CTA pattern across the two web hosts.**
- `src/components/Logo.tsx` = fuchsia pill plate with a slash tile glyph.
  **No pixel invader.** Marketing logo + desktop logo both lead with the
  pixel invader. Account-app's brand mark is structurally different.
- No `<Footer>` component. Marketing has a full footer (Marquee +
  product / earn / ops console links + invader). Account-app pages end at
  `<main>`. A signed-in user lands on `/dashboard` and sees no footer —
  the brand vanishes below the fold.
- `src/app/layout.tsx` loads `Fraunces` font via `next/font/google` but the
  variable `--font-fraunces` is **never used** anywhere in `src/`. Wasted
  font load + leftover from the light era.
- `viewport.themeColor = "#0A0A0F"` — off by one from canonical paper
  `#0B0B10`.
- No `openGraph` metadata in layout — `og:image` 404 at
  `account.liquidclips.app/brand/og-default.png`. Sharing
  `account.liquidclips.app/dashboard` on any social channel yields a blank
  preview.
- `app/upgrade/UpgradeCheckout.tsx` "checkout not configured" card uses
  literal `bg-[#EAB308]/10` (raw yellow hex). Should be `--lc-warn` or the
  fuchsia-deep warning token from `globals.css`.

**Drift:**
- [P0] Clerk modal renders light-cream on dark site (v6 tokens on v7 SDK)
- [P0] Different logo (no invader) vs marketing + desktop
- [P0] No footer = brand vanishes below the fold
- [P1] No OG image / sharing has no preview
- [P1] `themeColor` off by one (`#0A0A0F` vs `#0B0B10`)
- [P2] Fraunces font loaded but never used

---

### 3 · HQ admin · `account.liquidclips.app/admin/*`

**Status:** **DRIFTING (P1)**

**Evidence:**
- `src/app/admin/_brand/tokens.css` is a proper IG-HQ-002 sentinel block —
  `--lc-bg`, `--lc-fg`, `--lc-accent`, etc. all alias to the canonical
  `--paper`/`--ink`/`--fuchsia` ladder. ✓
- `AdminBrandHeader.tsx` uses the brand wordmark + monogram correctly with
  `var(--lc-accent)` slash. Pixel-invader monogram lives at
  `/brand/logo-monogram.png`. ✓
- BUT — admin sub-pages drift heavily:
  - `app/admin/_security/page.tsx`: `bg-yellow-100 text-yellow-900 border-yellow-300` + `bg-green-100 text-green-900` + `bg-red-100 text-red-900`. Raw cream/green/red banners inside the HQ dark shell.
  - `app/admin/_security/PinSetup.tsx`: `bg-green-100 text-green-800` + `text-green-700` (saved state) + `text-red-700` (failed state). Brand kit explicitly bans green; success = fuchsia-deep + check.
  - `app/admin/_security/AuthCodeSetup.tsx`: same pattern.
  - `app/admin/ai-terminal/Terminal.tsx`: `border-red-500/40 bg-red-500/10 text-red-100` for error state. Raw red instead of `var(--lc-fail)`.
- Recovery page uses the canonical AdminBrandHeader so the top reads
  brand-locked, but the body uses Tailwind primitives instead of `.lc-*`
  classes.

**Drift:**
- [P1] _security pages render cream / lime / red banners inside the dark dojo shell
- [P1] AI Terminal error state uses raw `bg-red-500`
- [P2] admin sub-pages bypass `.lc-pill-primary` / `.lc-tab` and inline custom styles

---

### 4 · Desktop legacy · `desktop/` (`v0.7.79`, currently the public download)

**Status:** **DRIFTING (P0)**

**Evidence:**
- `desktop/index.html` line 6: `<title>junior/employee</title>` — the
  **pre-rebrand name**. Tauri's `productName="Liquid Clips"` masks this in
  the macOS window chrome, but the HTML title leaks into VoiceOver, web
  inspector, Activity Monitor's WebKit process labels, and any future
  release that drops the Tauri window-title override.
- `desktop/index.html` loads `Fraunces` + `Geist` + `Geist Mono` from
  Google Fonts. `desktop/src/index.css` declares
  `--font-display: "Inter"` and `--font-sans: "Inter"`. **Inter is never
  loaded.** Every heading cascades to `ui-sans-serif` / `system-ui`. The
  user sees SF Pro on macOS — not Inter, not Geist, not Fraunces. Marketing
  uses Inter + JetBrains Mono. Account-app uses Geist. Desktop renders in
  the macOS system font. **Three different font stacks across three
  customer surfaces, none of which actually paint Inter.**
- 89 `lucide-react` imports across `src/components/*` — direct violation of
  the `bespoke-craft` skill ("no Lucide defaults where a brand-kit file
  exists"). Every Settings / Workspace / ResultsGrid / BrowseRewardsPanel /
  ConfirmDialog / GlobalToastHost / FailureCard icon is a generic Lucide
  glyph. Marketing has 0 lucide imports. Desktop-2 has 18 (better, but not
  zero).
- 15 raw Tailwind colour literals (`bg-red-500`, `bg-green-500`, `bg-red-50`,
  `bg-red-100`, `text-red-700`, `text-amber-600`):
  - `components/ui/button.tsx` "destructive" variant = `bg-red-500 text-white`. Should use `var(--color-danger)` token.
  - `components/ui/button.tsx` "publish" variant = yellow gradient `#ffd34d → #ffab2e text-[#241500]`. Brand kit explicitly bans amber.
  - `components/ui/button.tsx` "default" variant = `text-white`. Should be `text-ink` (warm white `#f4f1ea`, NOT pure `#fff`).
  - `components/platforms/ConnectionDot.tsx`: active = `bg-green-500`, error/paused = `bg-red-500`. Visible on every Settings → Connected platforms panel. Brand kit: "Success → fuchsia-deep + check icon (no green)".
  - `components/ThumbnailStudio.tsx`: 6 hits — `bg-red-50`, `text-red-700`, `text-amber-600`, `bg-red-900`.
  - `components/cockpit/BottomCockpit.tsx`: `border-red-400/30`, `bg-red-400/8`, `text-red-300` (error notice bar).
- 208 `text-white` / `bg-white` hits across `desktop/src` + `account-app/src`.
  Brand kit ink is warm white `#f4f1ea`, **NOT `#fff`** (literal comment in
  `tokens.css` line 17). Pure white reads colder than ink → contrast cliff.

**Drift:**
- [P0] `<title>junior/employee</title>` — pre-rebrand name leak
- [P0] Inter declared but never loaded → renders in system font
- [P0] `Button` primitive ships yellow + red variants forbidden by brand kit
- [P0] `ConnectionDot` uses `bg-green-500` — green is banned by brand kit
- [P1] 89 lucide imports — bespoke-craft skill violation
- [P1] 208 `text-white` hits across desktop + account-app
- [P1] 15 raw Tailwind colour literals across customer surfaces

---

### 5 · Desktop-2 · in-main redesign (not yet shipping)

**Status:** **ON-BRAND** (best of the six surfaces)

**Evidence:**
- `desktop-2/src/brand/brandTheme.css` is a clean canonical IG-012 mirror
  with every brand token, semantic state token, elevation ladder, gradient,
  radius rhythm, and tracking value. ✓
- `desktop-2/index.html` loads **Inter + Geist Mono** from Google Fonts —
  the only surface whose loaded fonts match the declared CSS variables.
- `desktop-2/src/brand/Logo.tsx` follows the desktop-legacy pattern (glyph
  + slashed wordmark) but extends it to xl / xxl for the IntroSplash. ✓
- 0 Tailwind colour literals. 18 Lucide imports (still too many — should be
  0 per bespoke-craft — but down from 89).
- Brand-aware mode flip: `body[data-app-mode="agency"]` swaps `--lc-accent`
  to turquoise `#14B8A6`. This is documented in-CSS as the agency vs
  clipper personality split.

**Drift:**
- [P2] 18 lingering Lucide imports — should be replaced before this surface
  ships to customers
- [P2] HTML `<title>` reads `"Liquid Clips 2.0 — Shell Simulator"` —
  becomes a P0 if this surface ever ships externally without bumping the
  title to `liquid/clips`

---

### 6 · Embed surfaces · `account.liquidclips.app/embed/*`

**Status:** **ON-BRAND**

**Evidence:**
- `src/app/embed/layout.tsx` line 60: `className="fixed inset-0 z-[200]
  overflow-y-auto bg-paper text-ink"`. Inherits canonical tokens from
  account-app `globals.css`. ✓
- The earn embed uses `.library-card` + `.library-card-corner` patterns
  defined in `account-app/src/app/globals.css` lines 78-99 — explicitly
  mirrored from desktop's cockpit chrome to "lay out identically to the
  native Workstation tile". ✓
- Inherits the same Clerk light-cream drift as the account-app shell IF a
  signed-out user lands on the embed — but the embed is reachable only via
  the desktop child webview where the user is already signed in, so the
  Clerk modal never paints. P0 contained to host-shell paths.

**Drift:** none independently — inherits account-app's drifts when they
apply (Clerk modal, missing footer). Itself = ON-BRAND.

---

## Cross-surface comparisons

### A · Tokens

| Surface | `--paper` (bg) | `--ink` (fg) | `--fuchsia` | display font (loaded) | mono font (loaded) |
|---|---|---|---|---|---|
| Marketing | `#0b0b10` (`globals.css`) + private `--w1-room: #09080d` in funnel.css | `#f4f1ea` + private `--w1-ink: #ecebf2` | `#ff1a8c` (`:root`) + private `--w1-fx: #ff2bb0` | Inter (Google Fonts) | **JetBrains Mono** (drift — kit says Geist Mono) |
| Account-app | `#0B0B10` | `#F4F1EA` | `#FF1A8C` | **Geist** (Google Fonts via next/font) | **Geist Mono** ✓ |
| HQ admin | `var(--paper, #0b0b10)` aliased to `--lc-bg` | `var(--ink, #f4f1ea)` aliased to `--lc-fg` | `var(--fuchsia, #ff1a8c)` aliased to `--lc-accent` | Geist (inherited from account-app shell) | Geist Mono ✓ |
| Desktop (legacy) | `#0b0b10` (`@theme`) | `#f4f1ea` | `#ff1a8c` | declares `"Inter"`, **loads Fraunces + Geist + Geist Mono** → Inter never actually paints | Geist Mono ✓ |
| Desktop-2 | `#0b0b10` (`brandTheme.css`) | `#f4f1ea` | `#ff1a8c` | **Inter** (loaded ✓) | Geist Mono ✓ |
| Embed | inherits `#0B0B10` from account-app `globals.css` | inherits `#F4F1EA` | inherits `#FF1A8C` | Geist | Geist Mono |

**Three different fonts paint customer-facing UI:** marketing → Inter +
JetBrains Mono; account-app + embed + admin → Geist + Geist Mono; desktop
legacy → SF Pro system (Inter not loaded); desktop-2 → Inter + Geist Mono.
**Brand kit canonical = Inter + Geist Mono.** Only desktop-2 honours it.

### B · Typography

| Role | Marketing | Account-app | Desktop legacy | Desktop-2 |
|---|---|---|---|---|
| Display family | Inter (via `--font-sans`) | Geist (via `--font-geist`) | declared Inter, loads Fraunces / Geist | Inter ✓ |
| Display weight | 600 | 600 | 600 | 600 ✓ |
| Display tracking | `-0.02em` to `-0.025em` ✓ | `-0.025em` ✓ | `-0.025em` ✓ | `-0.025em` ✓ |
| Body family | Inter | Geist | (system fallback) | Inter ✓ |
| Eyebrow tracking | varies in funnel.css | `0.18em` ✓ | `0.12em` ✓ | `0.18em` ✓ |
| Mono family | **JetBrains** | Geist Mono ✓ | Geist Mono ✓ | Geist Mono ✓ |

### C · Brand assets

| Asset | Marketing | Account-app | Admin | Desktop | Desktop-2 |
|---|---|---|---|---|---|
| Logo glyph | `/brand/invader.png` (pixel alien) | **NO INVADER** — slash-tile fuchsia pill plate | `/brand/logo-monogram.png` (invader) | `assets/brand/glyph.png` (pixel alien) | `/brand/assets/glyph.png` (pixel alien) |
| Logo wordmark | `liquid` + slash class + `clips` | `liquid` + slash text + `clips` (font-mono) | `liquid` + slash + `clips · HQ` (lc-display) | `liquid` + fuchsia slash + `clips` (font-display) | `liquid` + fuchsia slash + `clips` (font-display) |
| Kade sprites | 7 webp poses, includes `kade-idle.webp`, `kade-shooter.webp` | none | none | none | 12 webp poses, NO `kade-idle.webp` |
| Pixel invader | yes (4+ sites) | only in admin | yes | yes | yes (`/brand/invaders/`) |
| Favicon | `/brand/favicon-source-512.png` (PNG, **`/favicon.ico` 404 live**) | `/favicon.ico` (200 live, 256×256) | inherits account-app | n/a (Tauri) | n/a (Tauri shell sim) |
| Apple touch icon | `/brand/apple-touch-icon-180.png` | `/brand/apple-touch-icon.png` | inherits account-app | n/a | n/a |
| OG image | `/brand/og-default.png` (1536×1024, 200) | **404 live** | inherits account-app | n/a | n/a |
| Theme color meta | missing | `#0A0A0F` (off by 1 from `#0B0B10`) | inherits account-app | n/a | n/a |

### D · Voice

| Pattern | Marketing | Account-app | Admin | Desktop |
|---|---|---|---|---|
| Primary nav CTA | "Download" | "Sign up" (fuchsia pill) | "lc-pill-primary" custom | "Open" inline |
| Secondary nav | "Sign in" (text link) | "Sign in" (text link) ✓ | "lc-pill-ghost" | inline pill |
| Empty-state language | "Insert coin · clipper" / arcade voice | "checkout not configured" (literal admin tone leaking to customer) | "the dojo · read-only inspection" ✓ | mixed — varies per surface |
| Error tone | n/a | "failed: {state.message}" (cold, dev-y) | "Failed: {message}" (cold) | "Pipeline failed" (brand-locked) + lucide AlertTriangle |
| Footer copyright | "© 2026 Liquid Clips · MADE BY A CLIPPER" + invader + "TOP SCORE: 0,000,000" | **NONE** | n/a | n/a |

### E · Components

| Primitive | Marketing | Account-app | Admin | Desktop |
|---|---|---|---|---|
| Button — primary | `.nav-cta` class (funnel.css) | inline Tailwind pill on Nav.tsx | `.lc-pill-primary` ✓ | `Button` cva (variants include forbidden yellow + red) |
| Button — destructive | n/a | inline | `.lc-pill-ghost` | `bg-red-500 text-white` (off-brand) |
| Card | bespoke per-window (lc-w1, lc-w2, etc) | inline `rounded-3xl border-line` | varies — some `.lc-card`, some inline | hud-frame + bespoke `LibraryCard` etc |
| Border-radius rhythm | varies | varies | `--lc-radius-chip 8` / `control 12` / `card 16` ✓ | `--radius-chip` ✓ |
| Modal | n/a (full-bleed funnel) | Clerk modal (broken light theme) | `_mutations/ConfirmModal.tsx` inline | `ConfirmDialog.tsx` + lucide AlertTriangle |
| Focus ring | n/a | none defined | `lc-` does not enforce focus ring | Tailwind default `focus-visible:ring-2` |

### F · Navigation

| Element | Marketing (`Header` in Chrome.tsx) | Account-app (`Nav.tsx`) |
|---|---|---|
| Logo | invader + wordmark | slash-tile pill + wordmark (no invader) |
| Items | `navLinks` array → How / Pricing / Refer / Help | none — only Sign-in / Sign-up / Download / Dashboard |
| Primary CTA | "Download" (`/download`) | "Sign up" (fuchsia pill) |
| Auth state | not shown | `<Show when="signed-out">` / `<Show when="signed-in">` ✓ |
| Background | none (rendered inside `lc-w1-shell`) | `bg-paper/85 backdrop-blur-[20px]` ✓ |

### G · Brand drift catchers

- `text-blue` / `text-red` / `text-green` literals — **26 hits** across customer surfaces (11 account-app, 15 desktop). Should be tokens.
- Lucide imports — **89 in desktop, 18 in desktop-2, 0 in marketing & account-app.**
- Lorem ipsum — **zero in user-facing surfaces** ✓ (one hit in `desktop-2/tests/e2e/brand-consistency.spec.ts` is the test ASSERTION).
- "TODO" in UI text — **zero visible** ✓ (only in comments).
- Hard-coded version mismatches — marketing claims `v0.8.0` in WorkbenchWindow + `v0.8` in HeroStage / InformationConsole; actual ship is `v0.7.79`. P1.

---

## Top brand drift (ranked)

### P0 · visible to customer

1. **Clerk modal renders light-cream on a dark site (account-app).**
   `src/app/layout.tsx` lines 53-71 use v6 Clerk token names
   (`colorBackground`, `colorText`, `colorInputBackground`, etc.). Clerk v7
   silently ignores them. Sign-In modal on `account.liquidclips.app/sign-in`
   paints in Clerk default light theme over `bg-paper`. Marketing's identical
   modal at `liquidclips.app/sign-in` uses v7 names (`colorForeground`,
   `colorInput`) and renders correctly dark. Same product, two themes.
   **Fix:** copy marketing's v7 token block into account-app layout. 10 lines.

2. **Marketing hero paints with a non-canonical fuchsia ladder.**
   `liquidclips-marketing/src/app/funnel.css` defines `--w1-fx: #ff2bb0`
   (drift from `#ff1a8c`), `--w1-cy: #2dd6ee` (drift from `#00e5ff`),
   `--w1-ink: #ecebf2` (drift from `#f4f1ea`). 39 hex literals diverge from
   the `:root` ladder in the same file's `globals.css`. The page customers
   see FIRST shows a different fuchsia from every other surface.
   **Fix:** delete the `--w1-*` block; consume the canonical ladder.

3. **Desktop `<title>junior/employee</title>` — pre-rebrand name.**
   `desktop/index.html` line 6. Tauri masks this in the macOS window chrome
   but it leaks into VoiceOver, the WebKit inspector, Activity Monitor's
   process row, and any future surface that doesn't override the document
   title. **Fix:** change to `liquid/clips`. 1 character.

4. **Desktop Button primitive ships forbidden colour variants.**
   `desktop/src/components/ui/button.tsx`:
   - `publish` variant = yellow gradient (`#ffd34d → #ffab2e`). Brand kit
     explicitly bans amber.
   - `destructive` variant = `bg-red-500 text-white`. Should be
     `var(--color-danger)` token + `text-ink`.
   - `default` variant = `text-white` on fuchsia. Should be `text-ink`
     (warm white `#f4f1ea`).
   **Fix:** swap to token references; delete `publish` variant if unused.

5. **Desktop `ConnectionDot.tsx` uses `bg-green-500` for active platforms.**
   Brand kit explicitly says "Success → fuchsia-deep + check icon (no
   green)". The Settings → Connected Platforms panel ships a generic green
   pulse dot.
   **Fix:** swap `bg-green-500` → `bg-fuchsia-deep`, add check glyph.

### P1 · visible to admin

1. **`_security` pages render cream / green / red banners inside dark
   dojo shell.** `app/admin/_security/page.tsx` + `PinSetup.tsx` +
   `AuthCodeSetup.tsx`: `bg-yellow-100 / bg-green-100 / bg-red-100`. Looks
   like Bootstrap inside Liquid Clips HQ.
2. **AI Terminal error state uses `bg-red-500/10 text-red-100`.**
   `app/admin/ai-terminal/Terminal.tsx` line 265. Should be `--lc-fail`.
3. **Marketing claims `v0.8.0` on WorkbenchWindow** while ship is
   `v0.7.79`. Three hits: `funnel/WorkbenchWindow.tsx` line 62,
   `funnel/InformationConsole.tsx` line 144, `funnel/HeroStage.tsx`
   line 159.
4. **Account-app has no footer.** Marketing has a full Marquee + 4-column
   footer + invader + "TOP SCORE". Signed-in users on `/dashboard` see
   nothing below `<main>`.
5. **Account-app has no OG image / OG metadata.** Sharing
   `account.liquidclips.app/dashboard` or `/upgrade` on Slack / Twitter /
   iMessage produces a blank preview.
6. **Marketing favicon serves a 512px PNG; `/favicon.ico` 404s.**
   Browser tab on `liquidclips.app` has no proper favicon.
7. **`themeColor` mismatch** — account-app `#0A0A0F` vs canonical paper
   `#0B0B10`. Off by 1 hex digit. Address bar colour drift on iOS.
8. **89 Lucide imports across desktop.** Per `bespoke-craft` skill: "no
   Lucide defaults where a brand-kit file exists". The pixel-invader brand
   has bespoke iconography (`/brand/icons/*`) — Lucide undercuts it.
9. **208 `text-white` / `bg-white` hits across desktop + account-app.**
   Brand kit ink is warm white `#f4f1ea`, NOT `#fff`. Every white text on
   fuchsia reads colder than the brand designs intend.

### P2 · code cleanup

1. Account-app loads `Fraunces` via `next/font/google` but never references
   `--font-fraunces`. Wasted KB on every page load.
2. Marketing uses `JetBrains_Mono` instead of brand-kit canonical
   `Geist Mono`.
3. Desktop loads `Fraunces` + `Geist` + `Geist Mono` from Google but
   declares `--font-display: "Inter"`. Inter never loaded → display
   cascades to system. Either load Inter or change declarations to Geist.
4. Account-app Logo lacks the pixel-invader landmark — pull the monogram
   into `components/Logo.tsx` so the brand mark is identical across hosts.
5. Marketing `.lc-w4-traffic` macOS-style red/amber/green dots —
   defensible iconography but consider neutralising to ink/fuchsia/cyan to
   stay inside the kit.
6. Desktop-2 still has 18 lucide imports — replace before this surface
   ships.
7. Desktop-2 HTML title `"Liquid Clips 2.0 — Shell Simulator"` becomes a
   P0 if/when this ever ships externally; bump to `liquid/clips` on cut.
8. HQ admin sub-pages bypass `.lc-pill-primary` / `.lc-tab` and inline
   custom styles — formalise the primitive usage.
9. ThumbnailStudio.tsx hits 6 raw `bg-red-*` / `text-red-*` /
   `text-amber-600` literals.
10. BottomCockpit.tsx has a `border-red-400` error notice bar — should be
    `var(--color-danger)`.

---

## Brand cohesion verdict

**DRIFTING.** Not BRAND-LOCKED.

The IG-012 token contract is honoured **inside the sentinels** — canonical
desktop, desktop-2, admin tokens.css all agree on the fuchsia ladder, paper
ladder, ink ladder. The drift is at the **edges** of the contract: in
files that aren't gated.

A customer touching all four hosts in a single session would experience:

1. Hit `liquidclips.app` — see Inter + JetBrains Mono with a hot pink hero
   that's a different fuchsia (`#ff2bb0`) from anywhere else.
2. Click "Sign up" → land on `liquidclips.app/sign-in` Clerk modal → dark
   theme renders correctly.
3. After signup, get bounced to `account.liquidclips.app/dashboard` →
   nav swaps to a slash-tile logo (no invader), font changes to Geist,
   page has no footer, and if they sign out and back in, the Clerk modal
   renders LIGHT CREAM on a dark background.
4. Download desktop → app window shows `Liquid Clips` (Tauri) but VoiceOver
   reads `junior/employee`. Settings page shows green "active" dots, a
   yellow "Publish" gradient button, and 89 Lucide icons. Display headings
   render in macOS SF Pro because Inter never loaded.
5. None of the four surfaces share a footer pattern. Only one (marketing)
   has a brand sign-off ("© 2026 Liquid Clips · MADE BY A CLIPPER" +
   invader).

The system has the **vocabulary** for brand lock — `--lc-*` tokens,
`.lc-display` / `.lc-body` / `.lc-eyebrow` typography classes, IG-012 gate,
the brand-kit skill — but most surfaces bypass the vocabulary and inline
Tailwind primitives.

**To reach BRAND-LOCKED, the 5 P0 fixes above are the unblock list.**
Total estimated effort: a single 2-3h focused sprint. The drift is
mechanical, not structural; no surface needs a redesign, just a token
swap.

---

*Audit run with iron-gate intact + IG-012 drift-check green.
No code changes. No push. Worktree branch only.*
