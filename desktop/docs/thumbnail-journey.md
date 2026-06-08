# Thumbnail Journey — the path to "perfect"

Customer journey design through four lenses. Every beat below has explicit
ENABLES / PREVENTS / BREAKS / STRANDS analysis. This is the orchestration
layer over the 11 states in `thumbnails-demo.html`.

The journey is 6 beats. Each beat earns a position because cutting it leaves
the user stranded.

```
1. DISCOVER       (tile click)
       ▼
2. HOOK           (hero page: factory roll + "make this in 3 steps")
       ▼
3. IDENTITY       (3 face crops → never re-asked)
       ▼
4. PRESET         (style mood + accents — smart default lets them skip)
       ▼
5. CRAFT          (one generation: TITLE + metaphor + accent)
       ▼
6. CHOOSE         (gallery: pick the winner → it's the cover)
```

Each beat is ≤ 30 seconds for someone who's seen the journey once. First-runner takes 3-5 minutes total (identity upload is the longest beat).

---

## Beat 1 — DISCOVER (tile click)

**Where:** Workstation Home → Thumbnails tile.
**Today:** fires empty toast `"Thumbnails are coming next…"` (App.tsx:1408).
**Should:** open the surface immediately, show Cover Pack first (works for everyone), with AI Generate tab visible (locked for free/solo/pro, unlocked for agency+ / admin).

### Lens analysis
- **ENABLES** — user opens Thumbnails and sees Cover Pack already useful (auto-extracted frames per clip).
- **PREVENTS** — the empty-toast dead-end. Lower tiers get value without paying.
- **BREAKS** — nothing; the surface replaces a non-functional toast.
- **STRANDS** — none if Cover Pack works on first open. The visible-but-locked AI tab is an upsell hook, not a strand.

### Smart default
- Open to Cover Pack for all tiers.
- AI tab visible. Free/Pro see a lock badge; Agency+ see it active.
- When user clicks the locked tab: friendly Agency upsell pane (state 03), Cover Pack remains accessible.

---

## Beat 2 — HOOK (hero page: "make this in 3 steps")

**Where:** AI Generate tab on first click for Agency users (no identity yet).
**Today:** would jump straight to the identity drop-zone.
**Should:** show a HERO PAGE first — the factory roll above + a 3-step preview underneath. **Goal: prove value BEFORE asking for the upload.**

### Why this exists
First-time users don't know identity-from-images is the secret sauce. If we ask for face crops immediately, the cognitive load is "another upload?" → bounce.

If we show 18 real thumbnails first AND then say "this is yours in 3 steps", the upload feels earned. User-journey-lens calls this the *PEAK / END* rule — the FIRST impression carries disproportionately.

### Lens analysis
- **ENABLES** — user sees the destination before being asked for inputs. Conversion from curious-click → identity-upload doubles when proof comes first.
- **PREVENTS** — bounce at the drop-zone ("why do you need my face?").
- **BREAKS** — none.
- **STRANDS** — none if the 3-step preview lets them tap directly into beat 3.

### What goes on the hero page
- **Factory roll** — 18 real thumbnails marquee-scrolling (the v2 demo already has this; `thumbnails-demo.html`).
- **3-step preview** — "Upload identity → Pick your style → Generate", each step icon-led.
- **Primary CTA** — `Start in 3 minutes →` (one button, lands them in identity).
- **Skip link** — `Skip and pick a cover frame instead` (routes them back to Cover Pack tab).

### Smart defaults
- Hero shown only when `brand_preset.json` is absent (first-run).
- After first generation, the hero collapses to a slim banner: `Latest from the factory · 18 more`.

---

## Beat 3 — IDENTITY (3 face crops)

**Where:** Step 1 of 2 wizard.
**Today:** state 05 in the demo.
**Should:** drag-drop + browse, validate ≥3 immediately, preview with circular masks, save to `~/LiquidClips/identity/`.

### Lens analysis
- **ENABLES** — user locks identity once; never re-asked for that project.
- **PREVENTS** — face drift (every generation uses the same crops via `images/edits` endpoint).
- **BREAKS** — nothing.
- **STRANDS:**
  - User uploads 1 crop → inline `Need 2 more` message, Next button disabled.
  - User uploads non-face image → 800x600 photo of a coffee cup is technically valid. Catch via face detection (Vision framework on macOS) OR via a soft warning the user can override: `No face detected — are you sure?`
  - User crops are different people → catch via embedding similarity check (optional, future).

### Smart defaults
- **Drag-drop OR browse** — both work.
- **Auto-circular preview** so the user sees what the model sees.
- **Order suggestion**: "front", "3/4", "profile" labels under the slots — but ANY 3 valid faces work.
- **No re-encoding** — accept PNG / JPG / HEIC. We trust the file system.

### Persistence
- Files at `~/LiquidClips/identity/face_<n>.png`
- Metadata at `~/LiquidClips/identity/manifest.json` so the wizard knows when ≥3 exist on next launch.

---

## Beat 4 — PRESET (brand preset: essentials + advanced)

**Where:** Step 2 of 2 wizard. Demo state 06 (will be revised for the engine's 7-field schema).
**Today:** mockup designed for 4 fields. Needs revision.
**Should:** smart-default to a 3-second skip for first-runners. The engine accepts 7 fields, but we surface only 3 as essentials; 4 more behind `Advanced ▾`.

**Engine schema fields we collect:**

| Field | Tier | Default | Why |
|---|---|---|---|
| `brand` | essential | profile name | substituted as `{BRAND}` in prompts |
| `style_mood` (engine: derived from look) | essential | `cinematic` | the strongest validated default |
| `accents` + `accentWheel` | essential | 4 colours pre-picked | feeds the accent wheel for variety |
| `build` | advanced | empty | engine's identity skeleton uses this — substituted as `{BUILD}` |
| `wardrobe` | advanced | empty | "what they're wearing" — affects all generations |
| `expression` | advanced | empty | "neutral with signature smirk" — falls back to DEFAULTS |
| `look` | advanced | empty | extra visual direction beyond style_mood |
| `props` | advanced | empty | personality props, used occasionally in batch |
| `font_directive` | advanced | empty | overrides the engine's bold-condensed rule |

### Lens analysis
- **ENABLES** — user customizes ONCE; thumbnails henceforth match their brand.
- **PREVENTS** — generic "AI looking" output. The mood + palette IS the brand signal.
- **BREAKS** — nothing.
- **STRANDS:**
  - User overthinks the form → progress bar at top showing `Step 2 of 2 · almost done`.
  - User has 0 brand identity → "Skip — use Cinematic + 4 default accents" link.

### Smart defaults
- Brand name → pre-filled from the user's profile (Clerk name).
- Style mood → **Cinematic** pre-selected (validated as the strongest default for short-form content).
- Accent palette → **4 colors pre-checked** (orange, blue, red, green — high-contrast, screen-test winners).
- Props → empty (skip).
- Font directive → empty (engine's default bold-condensed rule).

User can save in one click. Power users can spend 30 seconds tuning.

### Persistence
- `~/LiquidClips/brand_preset.json`
- Available to re-edit later via ⋮ → Brand preset.

---

## Beat 5 — CRAFT (one generation)

**Where:** AI Generate tab, post-wizard. Demo state 07.
**Today:** form designed.
**Should:** prefill aggressively so the user can hit Generate in 5 seconds.

### Lens analysis
- **ENABLES** — user generates a thumbnail with minimum input.
- **PREVENTS** — the dreaded blank-form paralysis ("now what do I type?").
- **BREAKS** — nothing.
- **STRANDS:**
  - User types the face description ("a young black man with a beard") → catch + show inline warning: *"Identity is locked from your face crops — describe the SCENE, not the face."* (Hard rule from the engine spec.)
  - User puts paragraph-length TITLE → soft cap at 30 chars with `27/30` counter going amber, then red. Block at 35.
  - User leaves metaphor blank → button disabled, hint pulses.

### Smart defaults & prefills
- **Title prefill** — project title compressed: `"She finally found a non-sticky gloss"` → `GLOSS > STICKY` (use an existing one-line LLM call to suggest, or just take last 2 noun groups).
- **Metaphor placeholder** — rotates through good examples:
  - "a hidden door behind a graduation cap"
  - "a velvet curtain pulled back, reveal of a glowing tube on satin"
  - "two parallel lanes, one paved gold, one cracked"
- **Accent picker** — preset palette + `auto` toggle (uses next in wheel for variety across generations).
- **Quality** — `medium` ($0.07) pre-selected. Power users bump to high.

### Pending feedback
- Teal sweep + elapsed timer + Cancel.
- After 15s without progress: friendly "still working — OpenAI's queue can be slow at peak."

### After-generation
- New thumbnail flies into the gallery with a 0.6s fade + ✨ JUST NOW pill (3s persistence).
- Form does NOT clear (so the user can tweak + regenerate).

---

## Beat 6 — CHOOSE (gallery + Use as cover)

**Where:** Bottom of the AI tab. Demo state 09.
**Today:** mockup designed with real PNGs.
**Should:** make the "Use as cover" pill so obvious that the user picks one in seconds.

### Lens analysis
- **ENABLES** — user promotes a thumbnail to `project.cover_path` in one click.
- **PREVENTS** — buyer's remorse: 6 thumbnails open, can't decide → catch with...
- **BREAKS** — accidentally overwriting an existing cover → confirm if `project.cover_path` is set AND the new pick isn't the current one.
- **STRANDS:**
  - User clicks one image, opens fullscreen — they need a "Use as cover" CTA there too, not just in the grid.
  - User picks → they need feedback that it landed (toast: "Cover updated · visible in Library Wall").

### Smart pattern
- **Hover any thumb → Use as cover ↗ pill fades in** (already in the v2 demo).
- **Click thumb → fullscreen lightbox** with `Use as cover` as the primary CTA in a footer bar.
- **Picked thumb gets a fuchsia ring + COVER badge.**
- **Re-picking** → silently swaps (no confirm) UNLESS the project was published with the previous cover. Then confirm.

### Variants for batch (Phase D, future)
- "Generate another with auto-accent" → re-uses last prompt, cycles accent palette.
- "Variant ▾" → low / medium / high quality re-roll same prompt.

---

## Cross-cutting concerns (all beats)

### Cost transparency
- **Visible in CTA bar** at all times during AI tab usage: `SPEND THIS MONTH $X.XX / $Y cap · $Z left`
- **Pre-flight** before clicking Generate: if estimated cost would exceed remaining, button shows `$Y.YY needed, $Z left` instead of `✦ Generate`.

### Error recovery
- **`billing_hard_limit`** → red strip + Open billing button (state 10).
- **`CancelledError`** → silent close, no toast (user pressed Cancel, they don't need confirmation).
- **Network failure** → red strip + Retry button. Last prompt persists.

### Identity drift detection (Phase E, future)
- After 5 generations, sample the output faces and embed-distance against the reference crops. If drift > threshold → soft suggestion: "Re-upload identity for tighter results?"

---

## Iron-gate plan

This document becomes part of **IG-008 (Thumbnail Studio contract)** on Phase C ship.

**Locked invariants from this journey:**
1. Cover Pack works for all tiers (free / solo / pro / agency / admin).
2. Hero page appears once before identity wizard (first-run only), then collapses to a slim banner.
3. Identity requires ≥ 3 crops; 4th+ improves quality but isn't required.
4. Brand preset is skippable with Cinematic + 4-default-accents (don't add gates here).
5. Prompt rule: TITLE + metaphor + accent only. Face description blocked at input level with educational message.
6. Cost meter is always visible in AI tab CTA bar.
7. Errors named explicitly: `billing_hard_limit`, `CancelledError`, network failure all have distinct UX.
8. `Use as cover` writes to `project.cover_path` (single writer, single field) — applies equally to Cover Pack and AI Generate outputs.

---

## Open journey decisions

1. **Hero page collapsing rule** — show until first generation? Show until 5 generations? Always collapsible by user?
   - Recommendation: show until first generation. After that, slim banner with link "see more from the factory".
2. **Identity manifest persistence** — single profile-wide identity OR per-project?
   - Recommendation: profile-wide. Same person = same identity. Edge case (multi-creator agencies) handled in Phase D.
3. **Brand preset persistence** — profile-wide OR per-project?
   - Recommendation: profile-wide for now. Per-project override is a Phase D feature.
4. **Auto-prefill TITLE from project title** — use LLM (existing OpenAI key) for 1-line compression OR rule-based?
   - Recommendation: rule-based first (last 2 noun groups, all-caps, max 30 chars). LLM version is a nice-to-have.
5. **Identity drift detection** — Phase C or Phase D?
   - Recommendation: Phase D. Not blocking initial value.

---

## Customer journey, in plain English

> A user has a clip project they've been editing in Liquid Clips. They click the Thumbnails tile. Cover Pack opens with 6 candidate frames per clip — they can already pick one. They notice "AI Generate" with an Agency badge. They click it.
>
> **HERO**. A scroll of 18 real thumbnails passes left-to-right, each more striking than the last. Below: "Make this in 3 steps." Their finger is already itching.
>
> **IDENTITY.** "Drop face crops here." 3 PNGs, 30 seconds, done. Friendly preview shows the same person from 3 angles, locked.
>
> **PRESET.** Brand name pre-filled. Style mood pre-set to Cinematic. Accents pre-checked. Save → Start generating. (Optional 30-second tune.)
>
> **CRAFT.** Title field auto-fills `GLOSS > STICKY` from their project title. Metaphor placeholder reads "a velvet curtain pulled back" — they type their own: "a runway light tracing the curve of a lip". Accent: auto. Quality: medium. ✦ Generate.
>
> **PENDING.** Teal sweep, 8 seconds elapsed, then 12. They watch.
>
> **APPEARS.** A photoreal thumbnail of THEM (face locked) with bold text and a runway-light scene. ✨ JUST NOW. They generate 2 more variants. Click the best one. Use as cover ↗.
>
> **DONE.** Cover propagates to Library Wall. They close. Total time: 4 minutes. Cost: $0.21.
>
> Next project, the journey is 30 seconds — identity + preset already set.

That's the path. Every beat earns its place, every form field has a downstream
reader, every error has a named UX, every state strand has a recovery line.
