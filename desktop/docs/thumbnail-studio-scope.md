# Thumbnails — scope (integrated, post-v0.7.30 update)

> **Integration update (2026-06-08):** Original scope assumed a separate
> `ThumbnailStudio` surface. Per integration-lens audit, the Workstation Home
> **Thumbnails** tile already exists but fires an empty toast (App.tsx:1408).
> This scope is now ONE surface with two mode-tabs inside the tile:
> **Cover Pack** (all tiers) + **AI Generate** (Agency+). Lower tiers gain a
> working cover-frame picker as a Phase-A side benefit. AI gate moves INSIDE
> the surface — visible-but-locked tab — so lower tiers see the upsell path.

AI-generated YouTube/Reels thumbnails with identity lock + brand presets. Gated
behind **Agency tier** inside the Thumbnails surface. Lives behind the
Workstation Home **Thumbnails** tile, which today fires an empty teaser toast.

Source spec: `~/Downloads/Uncle Daniel Dropbox/.../thumbnail skill/INSTALL-FOR-KIMI.md`
Architecture pattern: identity from reference images, not words. Brand from config,
not code. OpenAI `gpt-image-1` (per `catjack_asset_pipeline` HARD RULE) via the
`images/edits` endpoint when refs exist, else `images/generations`.

Becomes **IG-008 (Thumbnail Studio contract)** on ship.

## What the user gets

- 1536×1024 (16:9) brand-consistent thumbnails
- Their face appears the same in every image (identity lock via reference crops)
- Bold display text rendered on the thumbnail
- Variants from one prompt (accent wheel, optional props)
- Local gallery — no Notion / external publishing

## Tier gate (Agency only, ungated for admin-flagged users)

| Tier | What they see when they click the Thumbnails tile |
|---|---|
| `free` / `solo` / `pro` | Existing cover-frame picker (extract frame from video) + "Upgrade to Agency for AI thumbnails" CTA |
| `agency` / `growth` / `autopilot` / **admin override** | Full Thumbnail Studio |

Tier check via existing `useTier()` hook. Daniel = admin → auto-agency in dev.

## The four-bucket model (handoff per IG-006 pattern)

| Action | Bucket | RPC / surface |
|---|---|---|
| Upload identity face crops | OWN | new `save_thumbnail_identity` RPC, mirrors `save_avatar` |
| Generate a thumbnail | OWN | new `generate_thumbnail` RPC → multipart POST to OpenAI |
| Save brand preset (style, accent palette, props) | OWN | new `set_brand_preset` RPC, stored at `~/LiquidClips/brand_preset.json` |
| Pick a thumbnail as project cover | OWN | new `set_project_cover` RPC, writes `project.cover_path` |
| OpenAI key check | WATCH | reads `sidecar.secretsStatus().openai` |
| Settings → API keys (when key missing) | DELEGATE | routes via existing `lc:settings-open-tab` event (Bug 1 pattern) |
| Cost meter / monthly cap | WATCH | sidecar tracks spend in `~/LiquidClips/thumbgen_ledger.json` |

## Ship-lens phases

### Phase 1 — DESIGN map

Surface: **ThumbnailStudio** drawer (opens from Home → Thumbnails tile).

Elements:
1. **Brand preset header** — brand name, style mood badge, accent palette swatches (O · N · S — outcome/navigation/simplicity)
2. **Identity status** — "3 face crops uploaded ✓" or "Set up your identity →" (O)
3. **TITLE input** — short bold text overlay (O, ≤ 30 chars)
4. **Metaphor textarea** — scene description, NEVER face description (O)
5. **Accent picker** — 8-color dropdown (O) OR "auto" using preset wheel
6. **Quality segmented** — Low (cheap) · Medium (default) · High (S)
7. **Generate button** — primary CTA (O)
8. **Gallery** — grid of previously generated thumbnails for THIS project, click to open, "Use as cover" pill per image (O)
9. **Cost meter** — "$2.14 / $50 monthly cap" (S, demote to ⋮ menu)
10. **⋮ menu** — Brand preset editor · Identity re-upload · Export all PNGs · Delete history

Every element earns one of OUTCOME / NAVIGATION / SIMPLICITY. Anything else
cut per phase 1 discipline.

### Phase 2 — STATE inventory

Variants the surface must handle:

| State | What user sees |
|---|---|
| Tier locked (free/solo/pro) | Upgrade CTA + existing cover-frame picker |
| Agency, OpenAI key missing | "Add your OpenAI key in Settings →" with Bug-1-style routing to Settings → API keys tab |
| Agency, key OK, no identity yet | First-run wizard: "Upload 3-5 face crops to lock your identity" + drag-drop zone |
| Agency, identity OK, no brand preset | Brand preset wizard: name + style mood + accent palette |
| Agency, all set, no thumbnails yet | Empty gallery + Generate form prefilled with project title as TITLE hint |
| Agency, generating | Pending strip (mirrors cockpit pattern): teal sweep + elapsed timer + Cancel |
| Agency, generation OK | New thumbnail appears in gallery + auto-opens fullscreen overlay |
| Agency, billing_hard_limit error | Red strip: "OpenAI hard limit hit — raise your cap or wait until reset" + link to OpenAI billing |
| Agency, monthly cap reached (server-side) | Lock with "You've used 100 / 100 this month. Resets in 12 days." |
| Agency, mid-generation cancel | Cancel marker written; sidecar aborts mid-stream; thumbnail discarded |

### Phase 3 — JOURNEY audit per state

Per state, walk ENABLES / PREVENTS / BREAKS / STRANDS:

- **Identity wizard** — STRAND if user uploads <3 crops; show "We need at least 3 to lock identity reliably."
- **Generate form** — PREVENT empty TITLE (disable button) + empty metaphor (placeholder example: "a hidden door behind a graduation cap")
- **Cost meter** — STRAND if user generates with $0 left; pre-check before button click
- **Billing hard limit** — PREVENT silent fail; OpenAI's `billing_hard_limit` error is named explicitly

### Real-data walk override

Before claiming done: generate 3 thumbnails with real OpenAI key, confirm
identity matches across all 3, confirm bold text renders cleanly,
confirm the gallery updates live.

## What we reuse vs build new

| Reused | New |
|---|---|
| `useTier()` hook for gate | `ThumbnailStudio.tsx` drawer |
| `sidecar.secretGet("OPENAI_API_KEY")` | `python-sidecar/adapters/thumbgen.py` (the heart) |
| `save_avatar` pattern for face crops | `method_save_thumbnail_identity` RPC |
| Pending/error strip pattern from cockpit | `method_generate_thumbnail` RPC |
| `lc:settings-open-tab` event from Bug 1 | Brand preset wizard component |
| `humanError()` for OpenAI error wrapping | Cost ledger (`~/LiquidClips/thumbgen_ledger.json`) |
| Existing `pickOverlaySource` UI pattern for face crops | "Use as cover" → `method_set_project_cover` |

## RPC contract additions (additive, IG-002 safe)

```ts
// src/lib/sidecar.ts additions
sidecar.saveThumbnailIdentity(paths: string[]) → { count: number }
sidecar.getThumbnailIdentity() → { faces: string[] }
sidecar.setBrandPreset(preset: BrandPreset) → { preset: BrandPreset }
sidecar.getBrandPreset() → { preset: BrandPreset | null }
sidecar.generateThumbnail(params: {
  slug: string;
  title: string;
  metaphor: string;
  accent?: string;
  quality?: "low" | "medium" | "high";
  prop?: string;
}) → { path: string; cost_estimate: number; ledger: ThumbnailLedger }
sidecar.cancelThumbnailGeneration(slug: string) → { ok: boolean }
sidecar.thumbnailLedger() → ThumbnailLedger
sidecar.setProjectCover(slug: string, thumbnail_path: string) → { project: Project }

// new types
export type BrandPreset = {
  brand: string;
  style_mood: "cinematic" | "playful" | "luxury" | "editorial" | "brutalist";
  accent_palette: string[];   // up to 8
  props: string[];            // up to 5
  font_directive?: string;
};

export type ThumbnailLedger = {
  month_iso: string;          // "2026-06"
  generations: number;
  cost_usd: number;
  cap_usd: number;
  remaining: number;          // cap_usd - cost_usd
};
```

## Brand preset (the user's customization surface)

What we ask the user ONCE during first-run wizard:

| Field | Type | Default | Why |
|---|---|---|---|
| Brand name | text | Their profile name | Substituted into prompt as `{BRAND}` |
| Style mood | 1-of-5 segmented | `cinematic` | Drives `stylePrompt` template |
| Accent palette | multi-select up to 8 | `["orange", "blue", "red", "green", "purple", "yellow", "cyan", "magenta"]` | Wheel for batch + accent picker dropdown |
| Persistent props | text chips up to 5 | empty (skip) | Personality props the model occasionally includes (sunglasses, hat, etc.) |
| Font directive | text | "Bold condensed display, all caps, high-contrast" | The thumbnail typography style |

Saved at `~/LiquidClips/brand_preset.json`. Editable later via ⋮ → Brand preset.

## Cost model

- **OpenAI API**: ~$0.07/image at medium quality, ~$0.20 at high (per OpenAI's gpt-image-1 pricing)
- **Per-Agency-user monthly cap**: Server-tracked. Suggested initial: **$50 / month** (≈ 700 medium images or 250 high). Cap is configurable per tier:
  - Agency: $50/mo
  - Growth: $150/mo
  - Autopilot: $500/mo
- **Ledger reset**: 1st of month, server-side
- **Pre-check**: before each generation, sidecar pre-flights the ledger. If remaining < estimated cost, blocks with a clear message.
- **Hard limit OpenAI errors**: caught + surfaced via cockpit-style red strip

For Daniel-as-admin: the cap is uncapped via the admin override (`isAdmin` flag
in `useTier()`). All generations go through your own `~/.openai_key` until we
build the hosted compute path.

## Three-phase build

## Honest re-cost (post-question)

Original 5-day total was padded. With OpenAI already wired in the sidecar
(`openai_key_available()` + existing imports for the LLM clip-pick stage)
and the cockpit's pending/error/cancel-marker patterns already proven, the
real budget is **~3 days**:

| Phase | Was | Now | Why the cut |
|---|---|---|---|
| A · Surface shell + Cover Pack | 1.5 d | **0.75 d** | Cover Pack reuses cockpit pending pattern |
| B · Identity + brand preset | 1.5 d | **1.0 d** | Drop-zone reuses `save_avatar`. Wizard is a form + JSON write |
| C · AI gen + gallery + IG-008 | 2.0 d | **1.0 d** | OpenAI infra exists, `billing_hard_limit` is one catch branch, cancel marker copy-pasted from `.lift_cancel`, gallery reuses cockpit thumb vocabulary |
| **Total** | **5 d** | **~3 d** | |

What's left as buffer in Phase C (~1 hour):
- `images/edits` endpoint multipart boundary handling with binary face crops
- Real-data identity drift walk (the prompt rule "never describe the face" needs to hold)

---

### Phase A — Identity + brand preset (1.5 days)

1. New Settings sub-section "Thumbnail Identity" (mirrors Avatar pattern)
2. `method_save_thumbnail_identity` + `method_get_thumbnail_identity` in sidecar
3. New `BrandPresetWizard.tsx` modal
4. `method_set_brand_preset` + `method_get_brand_preset`
5. Files land at `~/LiquidClips/identity/face_*.png` + `~/LiquidClips/brand_preset.json`

**Acceptance:** user uploads 3 face crops + saves brand preset, restarts app, both persist.

### Phase B — Generation engine (1.5 days)

1. New `python-sidecar/adapters/thumbgen.py` with `generate(...)` function
2. Identity preamble + style + metaphor + accent + bold-text rule composition
3. Multipart POST to `https://api.openai.com/v1/images/edits` using `gpt-image-1`
4. Cost ledger writes to `~/LiquidClips/thumbgen_ledger.json`
5. `method_generate_thumbnail` RPC wraps it
6. Cancel marker pattern (`~/LiquidClips/.thumbgen_cancel.<slug>`) mirrors `.lift_cancel`

**Acceptance:** RPC call from sidecar.ts generates a real PNG with identity matching face crops. Cost ledger updates.

### Phase C — ThumbnailStudio UI (2 days)

1. `ThumbnailStudio.tsx` drawer (opens from Home → Thumbnails tile)
2. State machine: tier-locked → no-identity → no-preset → empty-gallery → generating → success → error
3. Pending/error strip mirrors cockpit pattern
4. Gallery grid with click-to-fullscreen overlay
5. "Use as cover" pill → `method_set_project_cover`
6. ⋮ menu: Brand preset · Identity re-upload · Export PNGs

**Acceptance:** Walk full flow — click Thumbnails tile → set identity → set preset → generate 3 thumbnails → pick one as project cover. All states render correctly.

## Lens scorecard (pre-build)

| Lens | Verdict |
|---|---|
| ship-lens (3 phases) | DESIGN map clear, STATE inventory covers 9 variants, JOURNEY audit names the strands per state. Real-data walk mandatory pre-ship. ✓ |
| integration-lens | No duplicate writers. Reuses save_avatar pattern, settings-open-tab event from Bug 1, cockpit pending/error vocabulary. ✓ |
| panel-design-lens | Surface budgets: 1 primary CTA (Generate) + 2 secondary (Upload identity, Brand preset). Vocabulary unchanged. Cost meter demoted to ⋮ menu. ✓ |
| user-journey-lens | Strands named per state (identity <3 crops, empty TITLE, billing limit, cap reached). All have explicit feedback. ✓ |
| iron-gate-lens | No existing gates touched (IG-002 additive RPC fields OK). New IG-008 created on ship. ✓ |
| snapshot-proof-lens | HTML mockup required before any code per Impeccable. ✓ |

## Open questions to confirm

1. **OpenAI cost — your wallet or hosted backend?** Recommendation: ship Phase A+B using your `~/.openai_key` (BYO). Add hosted compute proxy in a follow-up sprint (~1 week) so Agency users don't need to provide their own key. For dev + your own use: BYO works today.
2. **Identity face crops — auto-extract from existing avatar?** If you've already set an avatar (existing `method_save_avatar`), should the wizard pre-fill from that single crop? Pro: smoother onboarding. Con: 1 crop isn't enough for tight identity. Recommendation: still require ≥3 explicit uploads.
3. **Project vs profile-scoped brand preset?** Single brand preset across all projects OR per-project override? Recommendation: single profile-scoped preset (simpler), per-project override later if needed.
4. **OpenAI model — confirm `gpt-image-1`?** The spec doc says `gpt-image-2` but that doesn't exist yet. Your locked standard per `catjack_asset_pipeline` memory is `gpt-image-1`. Stick with `gpt-image-1`. ✓

## Iron-gate plan (on ship)

- Add **IG-008 — Thumbnail Studio contract** to `docs/IRON_GATES.md`
- Sentinels at:
  - `python-sidecar/adapters/thumbgen.py` (the engine)
  - `python-sidecar/sidecar.py:method_generate_thumbnail` + adjacent methods
  - `src/components/thumbnail/ThumbnailStudio.tsx` (the surface)
  - `src/lib/sidecar.ts:generateThumbnail` (the TS wrapper)
- Locked invariants:
  - Identity comes from reference images, not words. Re-describing the face is forbidden in the prompt.
  - Brand preset is the user-facing customization layer. Code stays generic.
  - OpenAI cost capped per-tier; ledger persists across sessions.
  - The display point is the in-app gallery. No external publishing.
  - `gpt-image-1` is the locked model. No drift to other image generators.

## HTML mockup obligation

Per panel-design-lens + Impeccable: before any code, build
`docs/thumbnail-studio-demo.html` showing the 9 state variants stacked
vertically. User approves the mockup → code ships against it.

This scope doc is the contract; the mockup is the visual contract. Both
must exist before Phase A starts.
