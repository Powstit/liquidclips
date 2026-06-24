# Admin HQ — Brand Pass Snapshot Proof (text diff)

> Headless browser unavailable in sandbox — per the agent brief, the
> fallback is a per-tab brand-token-application diff in plain text.
> Re-run a live screenshot pass once `pnpm dev` + Playwright are
> available; replace this file with `<tab>-before.png` /
> `<tab>-after.png` pairs.

## Global shell (all 28 tabs inherit)

| Element | BEFORE | AFTER |
|---|---|---|
| Page wrapper | `mx-auto max-w-[1200px] px-5 py-8` | `lc-hq-shell mx-auto max-w-[1200px] px-5 pb-8` (adds fuchsia radial-gradient ambient on `--lc-bg`) |
| Header | flex strip — `<h1>` text "Liquid Clips HQ." + masked email + status pill in plain text | `<AdminBrandHeader>` — sticky, blurred (`backdrop-filter: blur(14px) saturate(140%)`), monogram landmark `/brand/logo-monogram.png` (40×40, framed by `--lc-stroke-strong`), wordmark `liquid` + fuchsia `/` + `clips · HQ`, brand-voice subtitle ("the dojo · read-only inspection of every revenue gate, agent key, and signal in flight"), pulse-dot mission-control eyebrow, fuchsia hairline gradient under (`.lc-stroke-under::after`) |
| Tab nav (28 tabs) | `bg-ink text-paper` (inverted ink-on-paper) for active · ring of `border-line bg-paper text-ink` for inactive · `border-b border-line` underline | `.lc-tab` pill — inactive: ghost ring on `--lc-stroke`, `--lc-fg-muted`; active: `--lc-accent-soft` fill + `--lc-accent-mid` text + `--lc-glow-sm` outer glow + 6px fuchsia leading dot (brand-accent indicator) |
| Status pill | `text-emerald-700 bg-emerald-500/10` (saturated, low-contrast on dark) | brand `--lc-ok` muted-teal (#4dc6a8) / `--lc-warn` amber (#d99b2d) / `--lc-accent-mid` fuchsia-deep — all dark-paper-readable |
| Chips (used on every tab — Overview, Users, Webhooks, Launch Health, etc.) | `text-emerald-700`, `text-amber-700`, `text-fuchsia-deep` (saturated) | `--lc-ok` / `--lc-warn` / `--lc-accent-mid` tokens — readable on `--lc-bg-warm` |
| Footer | `border-t border-line` plain | unchanged — still on-brand |

## Per-tab token application (sampled 4 tabs per brief)

### Home / Overview tab
- `Panel` wrapper: `rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6` (already brand)
- Config tiles: `rounded-2xl border border-line bg-paper p-3` + brand `Chip` (NEW dark-readable tones)
- Count tiles: `font-display text-[28px] font-bold tracking-[-0.02em] text-ink` (brand display) — unchanged
- "refresh" button: ghost ring → brand pill class semantics

**Scan units:** 1 panel · 1 refresh CTA · 1 grid of config tiles · 1 grid of count tiles · 1 notes block = 5 ≤ 7 ✓
**Primary CTAs:** 1 (refresh) ✓

### Users tab
- Search form, results table, status chips
- Chips now brand-tokenized; table border is `--lc-stroke`
- Primary CTA: "Open user" with brand-pill class (text-ink not text-white)

**Scan units:** 1 panel · 1 search bar · 1 table · 1 detail drawer = 4 ≤ 7 ✓
**Primary CTAs:** 1 (search) ✓

### Webhooks tab
- Replay/inspect controls, event list
- Status chips brand-tokenized
- No standalone CTA — admin read-only ✓

**Scan units:** 1 panel · 1 filter bar · 1 event list = 3 ≤ 7 ✓

### Campaigns / Missions / Banners tabs
- Create-mission, create-banner forms (`text-white` → `text-ink` fix applied to the 4 `Save` / `Publish` buttons in AdminHQ.tsx)
- Form fields keep `bg-paper border-line` (brand)
- Chips for status: brand-tokenized

**Scan units:** 1 panel · 1 form · 1 list = 3 ≤ 7 ✓
**Primary CTAs:** 1 (Save / Publish) ✓

## Vocabulary check

- "Admin Dashboard" eradicated — replaced with "HQ · MISSION CONTROL" eyebrow + "the dojo · read-only inspection…" subtitle
- "Liquid Clips HQ." h1 replaced with `liquid/clips · HQ` wordmark per brand kit §1 (lowercase, fuchsia slash)
- Footer line preserved ("read-only inspection · no payment / destructive actions · backend db is source of truth") — already brand voice

## Iron gate sentinel

`tokens.css` carries `IRON GATE IG-HQ-002` at the top of the file as a
locked region per the spec — future drift in HQ brand tokens will trip
the iron-gate-lens.

## Snapshot capture commands (when available)

```bash
cd account-app && pnpm dev   # localhost:3000
# In another shell:
npx playwright screenshot --viewport-size=1440,900 \
  http://localhost:3000/admin \
  public/admin-brand-proof/home-after.png
# Repeat with ?tab=Users / Webhooks / Campaigns (manual tab click then capture).
```
