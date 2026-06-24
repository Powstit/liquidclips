# Phase 6E · Thumbnail Studio Extraction Audit

**Status:** Audit report. No code modified.
**Date:** 2026-06-18
**Scope:** Inventory both sides — (A) the active legacy thumbnail engine + UI at `/Users/dipdip/code/jnr/desktop/`, (B) the Dropbox fallback files at `~/Downloads/Uncle Daniel Dropbox/` and `~/Desktop/`, (C) the Design OS plug-points at `/Users/dipdip/code/jnr/desktop-2/` — and map every reusable brick to its Phase 6F destination.
**Scope-out:** No backend / auth / payment / release changes. No Design OS shell changes. No asset generation. No CLI / display server / package system code ported, ever.

---

## 0 · Executive summary

The active legacy Thumbnail Studio is **shipped, mature, and bills real users**. It lives in `desktop/src/components/ThumbnailStudio.tsx` (a 1,600-LOC fixed-modal surface) and `desktop/python-sidecar/thumbnail_engine.py` (324 LOC of OpenAI image-edit calls + cost ledger). Thirteen `sidecar.thumbnail*` RPCs span getters, setters, single-image generate, batch start/cancel pair (IG-010), and ledger read. The flow has shipped **224 thumbnails on the owner's account** (per the comment at `thumbnail_engine.py:71`).

Two Dropbox fallback artefacts exist:
- **`codethumbnail.md`** — a Python contract spec for a one-function `thumbgen.py` module. Cleanly written, explicitly forbids CLI/display server/package management. **Aligns with Daniel's rules verbatim.**
- **`INSTALL-FOR-KIMI.md`** + Node `thumbgen.js` reference — a turnkey CLI app with Express display server, npm packaging, etc. **Violates every "Don't build" rule in the contract.** Do NOT port.

A third file at `~/Desktop/thumbnail_engine.py` is a near-duplicate of the legacy Python engine, **missing the v0.7.31 P2-21 empty-body error fix** and the `urllib.request.urlopen(..., timeout=60)` guard. Treat as stale.

**Two critical contract issues surface:**
1. **`gpt-image-2` model name.** Legacy default + Node reference both use `gpt-image-2`. The contract spec (`codethumbnail.md` line 14, 111-112, 252) explicitly forbids it as "not real." Daniel's brief reiterates: **use `gpt-image-1`**. The legacy already has the fallback wired (`sidecar.py:4429` catches 404 / `model_not_found` and retries with `gpt-image-1`). Phase 6F must flip the default — but verify Daniel hasn't been billing real users on a label the OpenAI dashboard might rename. **Sticky decision.**
2. **Cancellation polling.** The contract spec mandates polling the cancel marker every ~2 seconds during the OpenAI await (`codethumbnail.md:117`). Legacy only checks at start + before write (`thumbnail_engine.py:265`, `:302`). Cancellation works in practice because the legacy adds a 60-second urlopen timeout, but it's a contract violation worth surfacing.

**Design OS readiness:** Phase 6B/6C/6D infrastructure already covers most of the Thumbnail surface — `ModalPortal`, `Drawer`, `GlassCard`, `MetricBoard`, `AllowanceBar`, `StickyKade`, `EngineErrorBoundary`, `BakeErrorStrip`, `useEngineSession`, `useEngineSessionPersistence`. The `thumbnail` route is registered in `SimulatorRouter` as `ExtendedRouteId`, the `ThumbnailStudio.tsx` stub uses world `studio-deck` with default Kade `reading-brief` and placement `helper-right` (via routeRegistry → `studio` fallback; the `thumbnail` stub passes `route="studio"` today). Phase 6F overwrites the stub.

**Lego map:** 9 bricks REUSE the legacy contract direct (RPCs unchanged, types unchanged) · 6 PORT (legacy UI rewritten in Design OS surfaces) · 4 REBUILD (new components: ThumbnailVariantGallery, ThumbnailIdentityUpload, ThumbnailCostLedger, SafeAreaOverlay) · 2 DEFER (Hero marquee Beat 2; legacy v0.7.50 brand-palette tags).

**Stop / wait per the directive. Phase 6F is the build phase — this report is read-only.**

---

## 1 · Existing old-app thumbnail logic

### 1.1 UI surfaces (frontend · `desktop/src/`)

#### Primary modal
| File | Component | Role | Mounted |
|---|---|---|---|
| `desktop/src/components/ThumbnailStudio.tsx` | `ThumbnailStudio` (1,600 LOC) | Fixed `z-50` modal · two-tab UI (Cover Pack + AI Generate) · three nested sub-modals (prompt preview, image zoom, wizards) | ✅ v0.7.31+ |

Mounted from `desktop/src/App.tsx:2891` as a singleton modal. Controlled by `thumbnailStudio: { open, slug, projectName, clips }` state at App root (lines 2353–2367). Closes the Browse panel before opening (v0.7.79 contract).

#### Sub-surfaces (all inline functions inside `ThumbnailStudio.tsx`)
| Function | Lines | What it owns |
|---|---|---|
| `Header` | 549–609 | Tab switcher · ledger pill ($X.XX lifetime spend) · close button |
| `CoverPackView` | 644–710 | 4-col grid of per-clip frames · "Use as cover ↗" hover CTA |
| `AIGenerateView` | 1320–1551 | Split-pane: form (left) + gallery (right) · accent swatch picker · quality dropdown ($0.05/$0.07/$0.20) · Preview/Generate buttons |
| `BrandWizard` | 1141–1294 | Modal-over-modal · brand/identity/wardrobe fields · style-mood enum · advanced override |
| `IdentityWizard` | 1021–1138 | Face-crop upload (PNG/JPG only) · ≥3 required · drag-drop + file picker |
| `SetupGate` + `SetupRow` | 943–1018 | First-run checklist · Identity ✓ + Brand ✓ rows |
| `ThumbnailHero` + `HeroStep` | 754–875 | Beat 2 banner · 6-image YT-reference marquee · 3-step intro |
| `SoloUpsell` | 902–940 | Tier upsell pane for free users · "Upgrade in Settings →" |
| `NoProjectGate` | 713–752 | Empty state when no project slug |

#### Bundled hero references (Vite imports)
- `desktop/src/assets/yt-references/yt-{01..06}.png` (6 files · ~1.8–2.3 MB each) · loaded conditionally at runtime (lines 885–899). Bound to ThumbnailHero marquee.

### 1.2 Sidecar IPC wrappers (`desktop/src/lib/sidecar.ts`)

The `sidecar` object exports **13 thumbnail methods**. All shape-stable, all routed through `invoke('sidecar_call', { method, params })`.

| # | Method | Params | Returns | Timeout | Non-blocking? |
|---|---|---|---|---|---|
| 1 | `thumbnailPreviewPrompt` | `item, config?, prop?` | `{ prompt }` | — | No (fast template) |
| 2 | `thumbnailGetBrand` | — | `{ preset }` | — | No |
| 3 | `thumbnailSaveBrand` | `preset` | `{ preset, path }` | — | No |
| 4 | `thumbnailGetIdentity` | — | `{ files, count, dir }` | — | No |
| 5 | `thumbnailSaveIdentity` | `sources` | `{ files, count, dir }` | — | No (atomic copy) |
| 6 | `thumbnailList` | `slug` | `{ thumbnails, dir }` | — | No |
| 7 | `thumbnailUseAsCover` | `slug, path` | `{ slug, cover_path, choice_path }` | — | No (broadcasts `lc:library-refresh`) |
| 8 | `thumbnailGetCover` | `slug` | `{ slug, cover_path?, set_at? }` | — | No |
| 9 | `thumbnailGenerate` | `slug, item, config?, prop?` | `ThumbnailGenerateResult` | **180s** (cancel-on-timeout) | **NO** — blocking |
| 10 | `thumbnailCancel` | `slug` | `{ slug, marker_path, requested }` | — | Cancel-marker pattern |
| 11 | `thumbnailBatchStart` | `slug, items, config?` | `{ started, total, slug }` | — | **YES** (IG-010) |
| 12 | `thumbnailBatchCancel` | `slug` | `{ canceled, reason? }` | — | YES |
| 13 | `thumbnailLedger` | — | `{ rows, total_usd, count }` | — | No |

Single-image generate (#9) is intentionally **blocking** — it has no `start_*/cancel_*` pair. Cancellation is via marker file (#10). The batch pair (#11–12) is the only IG-010-locked thumbnail pair.

### 1.3 Sidecar Python (`desktop/python-sidecar/sidecar.py`)

Thirteen `method_thumbnail_*` dispatcher entries, lines 4069–4617. All registered in the `METHODS` table (lines 4731–4732 mark the batch pair as IG-010 v0.8.0). Each method delegates to either `thumbnail_engine.*` or local file I/O.

#### Backend persistence paths
| Path | Type | Purpose |
|---|---|---|
| `~/LiquidClips/brand_preset.json` | JSON · single writer | Brand whitelist (9 fields) |
| `~/LiquidClips/identity/` | Dir · atomic replace | Face crops (face_1.ext, face_2.ext, …) |
| `~/LiquidClips/thumbgen_ledger.jsonl` | JSONL · append-only | Lifetime cost ledger (1 row per gen) |
| `~/LiquidClips/.thumbgen_cancel.<slug>` | Marker file | Per-project cancel request (cleared on success/error) |
| `projects/<slug>/thumbnails/` | Dir | Generated PNGs (ms-timestamp filenames) |
| `projects/<slug>/cover_choice.json` | JSON · last-write-wins | User's chosen cover path + timestamp |

#### Iron Gates
- **IG-010** (`sidecar.py:4731–4758` v0.8.0 architecture lock) covers `thumbnail_batch_start`/`thumbnail_batch_cancel`.
- `IG-001` (import pipeline) and `IG-002` (RPC registry) apply transitively — every thumbnail RPC honours the typed return-shape contract.

### 1.4 Thumbnail engine (`desktop/python-sidecar/thumbnail_engine.py` · 324 LOC)

| Concern | Implementation | File:line |
|---|---|---|
| **Default model** | `gpt-image-2` | `:58` (DEFAULT_CONFIG) |
| **Fallback model** | `gpt-image-1` (404 / `model_not_found`) | `sidecar.py:4429` (catch + retry) |
| **API endpoint (with refs)** | `POST /v1/images/edits` (multipart) | `:280–284` |
| **API endpoint (no refs)** | `POST /v1/images/generations` (JSON) | `:287` |
| **API key resolution** | `llm.resolve_openai_key()` | `sidecar.py:4351` |
| **Identity strategy** | **Reference images** (multipart `image[]`) — NOT face description | `:138–139`, `:280–284` |
| **Output format** | PNG (base64-decoded → disk write) | `:313–315` |
| **Default dimensions** | `1536x1024` (configurable via `config["size"]`) | `:59` |
| **Cost per gen (USD)** | `low: 0.05`, `medium: 0.07`, `high: 0.20` | `:77` |
| **Prompt builder** | `build_prompt(config, item, prop)` — composes from identity + wardrobe + EMO rotation + PAT rotation + accent + metaphor + prop | `:120–167` |
| **EMO list** | 8 expression presets (rotated by `(order - 1) % 8`) | `:82–91` |
| **PAT list** | 5 stop-power treatments (rotated same way) | `:93–99` |
| **Cancellation** | Marker file check at start + before write only — **NOT** during await | `:265`, `:302` |
| **Cancellation poll cadence (contract)** | Every ~2s during await | `codethumbnail.md:117` — **NOT IMPLEMENTED** |
| **HTTP timeout** | `urlopen(req, timeout=60)` | `:208`, `:216` |
| **Empty-body error fix** | v0.7.31 P2-21 patched `_err_code()` | `:223–231` |
| **Error classes** | `BillingLimitError` (legacy name — contract calls it `BillingHardLimitError`), `CancelledError` | `:44` |
| **Ledger row schema** | `{ ts, slug, model, cost_usd, output_path, title }` | `sidecar.py:4456`, `:4568` |
| **Cost ledger UI hook** | `thumbnailLedger()` → `{ rows, total_usd, count }` | `sidecar.py:4617` |
| **Cancel-marker location** | `~/LiquidClips/.thumbgen_cancel.<slug>` | `sidecar.py:4307–4308` |
| **Cancel-marker clear timing** | Before each gen (`:4369`), after success (`:4439`), after Cancelled (`:4412`), after BillingLimit (`:4406`) | sidecar.py |

#### Brand preset shape (the 9 whitelisted fields)
```
brand           — character name              (str)
identity        — face + build descriptor     (str)
wardrobe        — clothing descriptor         (str)
model           — "gpt-image-2" | "gpt-image-1" (str)
size            — "1536x1024" etc             (str)
quality         — "low" | "medium" | "high"   (str)
style_mood      — extra (NOT used in build_prompt) (str)
props           — extra (NOT used; per-item)  (str)
font_directive  — extra (NOT used in build_prompt) (str)
```
Three of the nine fields are declared in the whitelist (`sidecar.py:4097–4100`) but **not consumed by `build_prompt`**. Phase 6F should either wire them or document them as forward-compat slots.

### 1.5 App state + event wiring
- App-root state: `thumbnailStudio: { open, slug, projectName, clips }` controls the modal.
- Hydration on open: parallel `thumbnailGetBrand` + `thumbnailGetIdentity` + `thumbnailLedger` + project-scoped `thumbnailGetCover` + `refreshGallery()` (`ThumbnailStudio.tsx:130–162`).
- Cover-change broadcast: `window.dispatchEvent(new CustomEvent("lc:library-refresh"))` (`App.tsx:2906`) — LibraryTab listens at `LibraryTab.tsx:101`.
- Generate elapsed counter: `useElapsedSeconds` hook drives "Generating… Xs" on button + PendingBar + PendingTile (`ThumbnailStudio.tsx:1558–1574`, v0.7.31 P1-11 fix).
- Esc handler chain (`:165–177`): zoom lightbox → wizard → preview lightbox → close modal.

### 1.6 Tier gating
- AI Generate tab requires `userTier !== "free"`.
- Free users see `SoloUpsell` → "Upgrade in Settings →" → fires `notifyPaywall("thumbnail_studio_ai", tier)`.
- Setup gate: `needsSetup = aiUnlocked && loaded && (identityCount < 3 || !brand?.brand)`.
- Cost ledger pill is only shown when `aiUnlocked`.

### 1.7 Error / status states
| State | Render | Trigger |
|---|---|---|
| `idle` | No strip · form enabled | Default |
| `pending` | Progress bar + Cancel + elapsed counter + PendingTile | Active `thumbnailGenerate` |
| `error` | Red strip with Retry (replays `lastGenerateItem`) + Dismiss | Any non-billing failure |
| `billing` | Amber strip with "Open billing →" external link | `code === "billing_hard_limit"` |
| `ledger_warning` | Soft warning shown alongside successful result | Gen succeeded but ledger write failed |

---

## 2 · Dropbox fallback comparison

Three artefacts on disk:

| File | Path | Role | Recommendation |
|---|---|---|---|
| **codethumbnail.md** | `~/Downloads/Uncle Daniel Dropbox/Uncle Daniel team folder/thumbnail skill/codethumbnail.md` | **Contract spec** — Python one-function `thumbgen.py` integration target | **Treat as the canonical contract** for Phase 6F sidecar wiring |
| **INSTALL-FOR-KIMI.md** | `~/Downloads/Uncle Daniel Dropbox/Uncle Daniel team folder/thumbnail skill/INSTALL-FOR-KIMI.md` | Node.js install guide for a turnkey CLI app + display server | **Reject in full** — violates Daniel's CLI/display/package rules. Reference only. |
| **thumbnail_engine.py** | `~/Desktop/thumbnail_engine.py` | Stale Python copy — missing v0.7.31 P2-21 empty-body fix + the 60s urlopen timeout guard | **Stale — discard.** Use the active legacy at `desktop/python-sidecar/thumbnail_engine.py` |

### 2.1 Dimension-by-dimension comparison

| Dimension | `codethumbnail.md` (contract) | `INSTALL-FOR-KIMI.md` (Node) | Active legacy `thumbnail_engine.py` | Desktop copy (stale) |
|---|---|---|---|---|
| **AI model** | **`gpt-image-1` (mandatory · "gpt-image-2 isn't real")** | `gpt-image-2` | `gpt-image-2` default · `gpt-image-1` fallback | `gpt-image-2` default |
| **Identity strategy** | Reference images via `image[]` multipart | Reference images via `image[]` multipart | Reference images via `image[]` multipart | Same |
| **Face description in prompt?** | **NEVER** (line 113) | "Identity comes from reference images, not words" (§1) | Identity descriptor (text) PLUS images | Same as legacy |
| **Prompt builder** | Compose identity + style + metaphor + accent + bold-text rule | Same composition strategy | EMO (8 expressions) + PAT (5 stop-powers) rotated by `order` | Same as legacy |
| **Brand preset shape** | TypedDict `BrandPreset` (5 fields: brand, style_mood, accent_palette, props, font_directive) | JSON `brand.config.json` (12 fields incl. apiKeyFile, referencesDir, displayPort) | 9-field DEFAULT_CONFIG (brand, identity, wardrobe, model, size, quality, references_dir, api_key, accents) | Same as legacy |
| **Cost (low/med/high USD)** | $0.03 / $0.07 / $0.20 ("rough" — document actuals) | $0.07 (medium only) | **$0.05 / $0.07 / $0.20** | Same as legacy |
| **API surface** | One function: `generate(identity_images, brand, request, api_key, output_path, cancel_marker)` returns `GenerateResult` TypedDict | CLI binary + display server | One function: `generate(item, output_path, *, config, cancel_marker, prop)` returns dict | Same as legacy |
| **Cancellation** | Cancel-marker file · **mandatory ~2s polling during OpenAI await** | Not described in install guide | Cancel-marker file · checks at start + before write **ONLY** | Same as legacy |
| **Exception names** | `BillingHardLimitError`, `CancelledError` | Not specified | `BillingLimitError`, `CancelledError` | Same |
| **HTTP timeout guard** | Not specified | Not specified | `urlopen(timeout=60)` (P2-21 fix) | **Missing** — stale |
| **Empty-body error handling** | Not specified | Not specified | `_err_code()` handles empty body gracefully (P2-21 fix) | **Missing** — stale |
| **CLI / display server / package mgmt** | **FORBIDDEN** (line 131, 135) | **Included in full** (bin/thumbgen.js + lib/display.js + npm link) | None | None |
| **Where it integrates** | `python-sidecar/adapters/thumbgen.py` (proposed location) | Standalone tool | `python-sidecar/thumbnail_engine.py` (already in place) | n/a |

### 2.2 Hard call-outs

**A. The model name conflict is the single most important contract violation.**
- The contract spec is explicit (`codethumbnail.md:14, 111-112, 252`): the public OpenAI image model is `gpt-image-1`. `gpt-image-2` is not a real public name.
- Yet the legacy `thumbnail_engine.py:58` defaults to `gpt-image-2` and the comment at `:71` says it "works on the owner's account (224 thumbnails shipped)."
- The legacy already has a fallback path: `sidecar.py:4429` catches `404` / `model_not_found` and retries with `gpt-image-1`. So in practice, accounts without the secret `gpt-image-2` access silently downshift.
- **Daniel's brief restates the rule: use `gpt-image-1`.**
- **Phase 6F action:** flip `DEFAULT_CONFIG["model"]` to `gpt-image-1` in the **new shell wiring** (Phase 6F doesn't touch sidecar runtime per the brief — but the Design OS prompt-preview UI and the brand preset default should both write `gpt-image-1` on save). The legacy stays as-is until a separate phase touches Python.

**B. Cancellation polling — minor contract violation.**
- Contract demands ~2s polling during OpenAI await (`codethumbnail.md:117`).
- Legacy only checks at start + before write (`:265`, `:302`).
- In practice, the 60s `urlopen(timeout=60)` cap means worst-case cancellation latency is 60 seconds.
- **Phase 6F action:** None on the runtime side (out of scope). UI side: make sure the Design OS Cancel button is visible the whole time the pending tile shows, and the cancel-marker write happens immediately (it already does).

**C. CLI / display server / package management — already excluded.**
- The Node version (`INSTALL-FOR-KIMI.md`) ships a complete `bin/thumbgen.js` CLI, an Express display server (`lib/display.js`), and an npm package layout.
- The contract spec explicitly forbids all three (`codethumbnail.md:131, 135`).
- Daniel's brief restates: "Do not bring in CLI/display server/package system."
- **Phase 6F action:** Read-only reference for the prompt templates and accent mapping if curious; ignore everything else.

**D. Desktop copy `~/Desktop/thumbnail_engine.py` is stale.**
- Missing v0.7.31 P2-21 empty-body error fix.
- Missing the `urlopen(timeout=60)` guard.
- **Recommendation:** Delete or archive. The active legacy in `desktop/python-sidecar/thumbnail_engine.py` is the source of truth.

### 2.3 Per-capability decision table

| Capability | Use legacy | Use Dropbox | Merge | Defer | Why |
|---|---|---|---|---|---|
| AI model name | | ✅ contract | | | Daniel + contract demand `gpt-image-1` |
| Reference-image identity | ✅ | ✅ | | | All three agree |
| EMO/PAT prompt rotation | ✅ | | | | Ship-proven; contract leaves it open |
| Brand preset whitelist | ✅ | | | | 9-field shape works; contract's 5-field is leaner but loses parity |
| Cost per quality tier | ✅ | | | | $0.05/$0.07/$0.20 is field-tested |
| API contract shape | ✅ | | | | `(item, output_path, …)` is already the sidecar contract |
| Cancellation polling cadence | ✅ | | | Defer | Out of Phase 6F scope (runtime change) |
| Exception names | ✅ | | | | `BillingLimitError` stays |
| HTTP timeout (60s) | ✅ | | | | Already in legacy — keep |
| Empty-body error fix (P2-21) | ✅ | | | | Already in legacy — keep |
| CLI / display server / package | | | | ✅ reject | Daniel's rule + contract rule |
| Per-image cost ledger | ✅ | | | | JSONL append-only is correct |
| Ledger total UI surface | ✅ | | | | Pill in legacy modal — Phase 6F port to MetricBoard row |
| Identity face-crop atomic replace | ✅ | | | | v0.7.31 P1-8 fix |

---

## 3 · Design OS plug-points

### 3.1 Route + world

- **Route id:** `thumbnail` (an `ExtendedRouteId` in `desktop-2/src/design-os/routing/SimulatorRouter.tsx:31`)
- **Stub file:** `desktop-2/src/design-os/routes/ThumbnailStudio.tsx` (currently a SimPage stub passing `route="studio"` because the registry only knows the canonical `RouteId` set)
- **routeRegistry entry needed:** Phase 6F should add `thumbnail` to `ROUTE_REGISTRY` with `world: "studio-deck"`, `defaultKade: "reading-brief"`, `kadePlacement: "helper-right"` — matching the existing studio.

### 3.2 Infrastructure already in place (REUSE direct)

| Need | Existing Design OS component | Mount pattern |
|---|---|---|
| Modal host (Brand wizard, Identity wizard, prompt preview, image zoom) | `<ModalPortal>` + `useModalPortal()` | Already mounted at `SimulatorRouter` (Phase 6B). Future modals render via `createPortal` into the host. |
| Side panel host (Brand presets, cost ledger detail) | `<Drawer>` | Already portal-rendered to `document.body` (Phase 6D fix). Caller manages `open` state. |
| Glass surface for variant grid / cost row / batch progress | `<GlassCard density="default \| quiet \| heavy">` | Wrap any new component. Hover-lift + bloom tint. |
| Numeric metric display (cost, count) | `<MetricBoard>` + `<CountdownBoard>` | DSEG7 digits with tone (fx/cy/amber/danger). |
| Progress bar (batch completion) | `<AllowanceBar state used total label />` | Direct reuse — `state="healthy"` for active, `"empty"` for done, `"low"` for warning. |
| Sticky Kade reaction | `useKadeFromSession("studio")` | Session pose → `bus.emit("nav:hover", { kade })` → StickyKade reacts. |
| Crash isolation per brick | `<EngineErrorBoundary route="studio" component="X">` | Wrap each brick. |
| AI failure banner | `<BakeErrorStrip>` | Listens for `engine:error` events. **Phase 6F extends its condition to `kind === "thumbnail" \|\| kind === "thumbnail-batch"`.** |
| Session state | `EngineSessionProvider` + `useEngineSession()` | Already used by TimelineStudio. Same provider wraps Thumbnail. |
| Cross-route handoff (slug + selected clip) | `useEngineSessionPersistence()` + `selectClipForStudio()` | Carries `selectedClipIdx`. Phase 6F can extend to `selectedVariantPath`. |
| Runtime honesty tag | `useRuntimeInfo().mode === "mock"` → render `<span class="lc-runtime-tag">Studio preview</span>` | Already used by Engine + Studio routes. |
| Cancel/Clear/Retry strip | `<EngineActions>` (Phase 6C-Lockdown) | Already gates on session phase. Reuse for thumbnail generation lifecycle. |
| Health/diagnostics panel | `<EngineHealthPanel>` | Reuse — runtime probes are shared. |
| Toast surface | `<ToastHost>` (subscribes to `bus.emit("toast", …)`) | Direct reuse. |
| File drop entry | `<DropOverlay>` → `bus.on("source:drop", …)` | Reuse for identity-image bulk drop. |

### 3.3 Bridge events (`desktop-2/src/design-os/bridge/events.ts`)

Already typed and ready:

```
EngineStage union includes "thumbnail" (line 25)
EngineCompletionKind includes "thumbnail-batch" (line 38)
engine:progress  { stage: "thumbnail", percent, slug?, idx?, note? }
engine:complete  { kind: "thumbnail-batch", slug?, idx?, url? }
engine:error     { kind: "thumbnail-batch" | "sidecar-died", error, human?, code? }
```

The tauri-adapter already maps the Tauri channel `sidecar:thumbnail_batch_progress` → `engine:progress { stage: "thumbnail", … }` and the matching complete/error pairs. Phase 6F doesn't need new event channels.

### 3.4 Kade pose mapping

The `STAGE_TO_KADE` table in `state/useEngineSession.ts` maps:
```
thumbnail:  "reading-brief"
```
**Phase 6F sticks with this.** A dedicated `generating-thumbnails` pose could come later, but the current Kade asset library doesn't have it. `reading-brief` reads the brief — appropriate for "AI is composing the prompt + variant" feel.

### 3.5 Assets already shipped

Brand-kit SVGs at `desktop-2/public/brand/icons/canvas/`:
- `safe-area-face.svg` (529 bytes)
- `safe-area-title.svg` (524 bytes)

These are the overlay assets the audit explicitly asks for. Phase 6F wraps them in a `SafeAreaOverlay` React component (absolute-positioned layer above the variant preview).

### 3.6 Gaps requiring new components in Phase 6F

| Component | Purpose | New file path |
|---|---|---|
| `ThumbnailVariantGallery` | Grid of generated variants · select / hover preview / "Use as cover" CTA | `design-os/studio/ThumbnailVariantGallery.{tsx,css}` |
| `ThumbnailIdentityUpload` | Drag-drop + file picker · live thumbnails of uploaded crops · ≥3 validation | `design-os/studio/ThumbnailIdentityUpload.{tsx,css}` |
| `ThumbnailBrandPresetPanel` | Brand/identity/wardrobe inputs · accent swatch picker · style-mood enum (optional advanced) · mounted inside `<Drawer>` | `design-os/studio/ThumbnailBrandPresetPanel.{tsx,css}` |
| `ThumbnailCostLedger` | Per-gen rows (date/model/cost) + lifetime total · mounted inside `<Drawer>` or sub-section | `design-os/studio/ThumbnailCostLedger.{tsx,css}` |
| `ThumbnailPromptPreview` | Lightbox over modal · live prompt string · re-roll button | `design-os/studio/ThumbnailPromptPreview.{tsx,css}` (uses `<ModalPortal>`) |
| `SafeAreaOverlay` | Layered SVG overlays (face + title) · toggle visibility | `design-os/studio/SafeAreaOverlay.{tsx,css}` |
| `ThumbnailEmptyState` | "Pick a clip in Engine first" + CTA | `design-os/studio/ThumbnailEmptyState.{tsx,css}` |
| `ThumbnailToolbar` | Brand wizard CTA · Identity wizard CTA · Cost ledger CTA · Cancel batch · runtime tag | `design-os/studio/ThumbnailToolbar.{tsx,css}` |

---

## 4 · Lego brick map

> One row per thumbnail feature. "Risk" weighs sidecar-runtime dependence + asset gaps + tier-gate complexity.

| # | Brick | Existing file | What it does | Dependencies | Move unchanged? | Needs wrapper? | Design OS mount slot | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | sidecar.thumbnail* IPC | `desktop/src/lib/sidecar.ts` | 13 RPC methods | Tauri `sidecar_call` (not in desktop-2 yet) | Yes (port file as-is to `desktop-2/src/design-os/engine/sidecar-stub.ts` once runtime lands) | Stub now · real later | imported directly by Phase 6F bricks | LOW |
| 2 | thumbnail_engine.py | `desktop/python-sidecar/thumbnail_engine.py` | OpenAI image-edit + prompt builder + cost | OpenAI key + ffmpeg/Python sidecar | n/a (runtime, not UI) | n/a | Stays in legacy until runtime-ship phase | LOW |
| 3 | Cover Pack grid | `ThumbnailStudio.tsx:644–710` | 4-col contact sheet of per-clip frames + "Use as cover" | `clip.thumbnails[]` data shape | Yes — props-driven | Light — wrap rows in `<GlassCard>` | `ThumbnailStudio.centerPanel` (tab #1) | LOW |
| 4 | AI Generate split-pane | `ThumbnailStudio.tsx:1320–1551` | Form left + gallery right + quality dropdown | `thumbnailGenerate`, `thumbnailCancel`, `thumbnailList` | No (visual language mismatch) | **Yes — significant** | `ThumbnailStudio.centerPanel` (tab #2) split into 2 components: `ThumbnailGenerateForm` + `ThumbnailVariantGallery` | **MED** |
| 5 | Brand Wizard | `ThumbnailStudio.tsx:1141–1294` | Brand/identity/wardrobe form modal-over-modal | `thumbnailSaveBrand`, `thumbnailGetBrand` | No (modal-in-modal is legacy chrome) | **Yes** | Portal into `<ModalPortal>` OR side-rail `<Drawer>`. Recommend Drawer (cleaner UX). | MED |
| 6 | Identity Wizard | `ThumbnailStudio.tsx:1021–1138` | Face-crop upload · drag-drop + file picker · ≥3 validation | `thumbnailSaveIdentity`, `thumbnailGetIdentity` | No | **Yes — significant** | Mount inside `<Drawer>` OR full-page take-over via `<ModalPortal>`. New component: `ThumbnailIdentityUpload` | **MED** |
| 7 | Setup Gate first-run | `ThumbnailStudio.tsx:943–1018` | 2-row checklist (Identity + Brand) | local state | Yes — extract function | Light — wrap in `<GlassCard density="default">` | `ThumbnailStudio.centerPanel` before tabs unlock | LOW |
| 8 | Hero banner (Beat 2) | `ThumbnailStudio.tsx:754–875` | 6-image YT-reference marquee + 3-step intro | 6 bundled PNGs (~13 MB total) | No — heavy assets + marquee animation | **Yes** | `ThumbnailStudio.centerPanel` (top), behind a "How it works" tab. **Recommend DEFER to Phase 7.** | HIGH (asset bloat + low first-build priority) |
| 9 | Solo Upsell pane | `ThumbnailStudio.tsx:902–940` | Tier-gate copy + "Upgrade in Settings →" | `notifyPaywall` helper | Yes (extract function) | No | `ThumbnailStudio.centerPanel` when `userTier === "free"` | LOW |
| 10 | No-Project Gate | `ThumbnailStudio.tsx:713–752` | Empty state when no slug | none | Yes (extract function) | Light — wrap in `<GlassCard>` | `ThumbnailStudio.centerPanel` when no clip selected | LOW |
| 11 | Header + ledger pill | `ThumbnailStudio.tsx:549–609` | Tab switcher + lifetime spend pill | `thumbnailLedger` | No (legacy chrome) | **Yes** | New `<ThumbnailToolbar>` + `MetricBoard` row inside the header | LOW |
| 12 | Prompt preview lightbox | inline modal | Shows composed prompt before spend | `thumbnailPreviewPrompt` | Yes (extract) | Light — render inside `<ModalPortal>` | `<ThumbnailPromptPreview>` | LOW |
| 13 | Image zoom lightbox | inline modal | Click variant → full-screen view + "Use as cover" CTA | local state | Yes (extract) | Light — render inside `<ModalPortal>` | child of `<ThumbnailVariantGallery>` | LOW |
| 14 | Cancel button on pending | inline | Cancel-marker write + close pending UI | `thumbnailCancel` | Yes | No | inside `<ThumbnailVariantGallery>` pending tile + `<EngineActions>` | LOW |
| 15 | Use-as-cover CTA | inline | Set cover + broadcast `lc:library-refresh` | `thumbnailUseAsCover` | Yes | No | inside variant card (gallery) | LOW |
| 16 | Cost ledger pill | inline in header | `$X.XX` lifetime spend | `thumbnailLedger` | Yes (extract) | Light — replace with `<MetricBoard value tone="fx">` | inside `<ThumbnailToolbar>` | LOW |
| 17 | Per-gen cost row detail | n/a (legacy doesn't render — only the total) | List of ledger rows | `thumbnailLedger().rows` | n/a — new | New | `<ThumbnailCostLedger>` mounted inside `<Drawer>` | LOW |
| 18 | Cancel-marker write | sidecar method | Drops marker file | `~/LiquidClips/.thumbgen_cancel.<slug>` | Yes | No | called from Cancel button | LOW |
| 19 | Batch progress event listener | `sidecar.ts:onThumbnailBatchProgress` | Tauri event stream subscriber | Tauri runtime | Yes (via tauri-adapter) | No | hooked at route root in `<ThumbnailStudio>` Provider | LOW |
| 20 | Batch complete listener | `sidecar.ts:onThumbnailBatchComplete` | Same | Same | Yes | No | Same | LOW |
| 21 | Batch error listener | `sidecar.ts:onThumbnailBatchError` | Same | Same | Yes | No | Same → drives `<BakeErrorStrip>` | LOW |
| 22 | Accent swatch picker (8 colors) | inline | Color chip row | static data | Yes (extract) | No | inside `<ThumbnailGenerateForm>` | LOW |
| 23 | Quality dropdown ($0.05/$0.07/$0.20) | inline | Cost selector | static map (DEFAULT_CONFIG line 77) | Yes (extract) | Light — use Design OS chip pattern | inside `<ThumbnailGenerateForm>` | LOW |
| 24 | Title input (≤30 char counter) | inline | Length validation | none | Yes (extract) | No | inside `<ThumbnailGenerateForm>` | LOW |
| 25 | Metaphor textarea | inline | Free-text input | none | Yes (extract) | No | inside `<ThumbnailGenerateForm>` | LOW |
| 26 | Elapsed counter on Generate button | `useElapsedSeconds` hook | "Generating… 23s" | local state + interval | Yes (port hook) | No | inside `<ThumbnailGenerateForm>` | LOW |
| 27 | Retry-on-error preserve | `lastGenerateItem` state | Replay last payload | local state | Yes | No | inside `<BakeErrorStrip>` Retry button | LOW |
| 28 | Ledger warning surface | `result.ledger_warning` | Soft warning alongside success | sidecar result | Yes | No | inside `<ToastHost>` with `kind="warning"` | LOW |
| 29 | Esc key handler chain | inline | zoom → wizard → preview → close | local state | Yes (already covered by `<Drawer>` + `<ModalPortal>` Esc handling) | No | dispatch already wired | LOW |
| 30 | `lc:library-refresh` broadcast | `App.tsx:2906` | Cross-surface refresh | `window.dispatchEvent` | Yes | No | After `thumbnailUseAsCover` success | LOW |
| 31 | Brand preset 9-field whitelist | `sidecar.py:4097–4100` | Persistence shape | Python sidecar | Yes (mirror in TS types) | No | `design-os/studio/thumbnailTypes.ts` (new) | LOW |
| 32 | EMO list (8 expressions) | `thumbnail_engine.py:82–91` | Prompt rotation | Python sidecar | n/a (runtime) | n/a | UI surfaces this implicitly via `order` field | LOW |
| 33 | PAT list (5 stop-power treatments) | `thumbnail_engine.py:93–99` | Prompt rotation | Same | n/a | n/a | Same | LOW |
| 34 | Cancellation 2s polling (contract gap) | n/a — not implemented | Per `codethumbnail.md:117` | Python sidecar | n/a | n/a | DEFER to runtime-ship phase | DEFER |
| 35 | Safe-area face overlay | `desktop-2/public/brand/icons/canvas/safe-area-face.svg` | Visual guide | static asset | Yes | Yes — new component | `<SafeAreaOverlay>` inside variant preview | LOW |
| 36 | Safe-area title overlay | `desktop-2/public/brand/icons/canvas/safe-area-title.svg` | Visual guide | static asset | Yes | Yes — new component | same | LOW |
| 37 | Hero 6 YT-reference PNGs | `desktop/src/assets/yt-references/*.png` | Marquee assets (~13 MB) | bundled assets | No — too heavy | n/a | DEFER (Phase 7+) | DEFER |
| 38 | Style-mood enum (cinematic/playful/luxury/editorial/brutalist) | Brand Wizard advanced | UI field | local state | Yes (extract) | No | inside `<ThumbnailBrandPresetPanel>` advanced section | LOW |
| 39 | Font directive override | Brand Wizard advanced | UI field | local state · NOT consumed by build_prompt yet | Yes (extract) | No | inside `<ThumbnailBrandPresetPanel>` advanced section · mark "experimental" | LOW |
| 40 | Refresh-gallery on failure | `ThumbnailStudio.tsx:116–124` | Catches orphan PNGs that arrive after timeout | `thumbnailList` | Yes | No | inside `<ThumbnailVariantGallery>` after `engine:error` | LOW |

### 4.1 Design OS components that already cover legacy needs

| DS component | File | Legacy equivalent | Reuse / Port / Rebuild |
|---|---|---|---|
| `GlassCard` | `design-os/components/GlassCard.tsx` | Modal card chrome (rounded-2xl + paper bg) | **REUSE** |
| `ModalPortal` | `design-os/components/ModalPortal.tsx` | Fixed z-50 modal layer | **REUSE** |
| `Drawer` | `design-os/components/Drawer.tsx` | Wizard modal-over-modal pattern | **REUSE** (replaces the modal-in-modal anti-pattern) |
| `MetricBoard` + `CountdownBoard` | `design-os/components/MetricBoard.tsx` | Ledger pill ($X.XX) + cost counters | **PORT** (legacy pill → DSEG MetricBoard row) |
| `AllowanceBar` | `design-os/components/AllowanceBar.tsx` | None (legacy has only an elapsed counter) | **NEW USE** — drive from batch `done/total` |
| `EngineErrorBoundary` | `design-os/components/EngineErrorBoundary.tsx` | None (legacy has no per-brick boundary) | **REUSE** (wrap each new component) |
| `BakeErrorStrip` | `design-os/engine/BakeErrorStrip.tsx` | Red error strip + Retry button | **REUSE** (extend condition to `kind === "thumbnail-batch"`) |
| `EngineActions` | `design-os/engine/EngineActions.tsx` | Cancel + retry pattern | **REUSE** (drives the cancel-marker write) |
| `EngineHealthPanel` | `design-os/engine/EngineHealthPanel.tsx` | None (legacy has no runtime probe) | **REUSE** (already shows sidecar_call + ffmpeg + yt-dlp + faster-whisper) |
| `ToastHost` | `design-os/effects/ToastHost.tsx` | `lc:toast` window CustomEvent | **REUSE** (legacy emits `lc:toast` — already listened) |
| `DropOverlay` | `design-os/effects/DropOverlay.tsx` | Legacy uses inline file picker | **REUSE** for bulk identity-image drop |
| `useEngineSession` + Provider | `design-os/state/useEngineSession.ts` | Local `status` state in ThumbnailStudio | **PORT** (session-driven status maps to phase) |
| `useEngineSessionPersistence` | `design-os/state/engineSessionPersistence.ts` | None (legacy has no resume) | **NEW USE** (carry `selectedClipIdx` from Engine + `selectedVariantPath` from Studio) |
| `useKadeFromSession` | `design-os/state/useKadeFromSession.ts` | None | **REUSE** |
| `useRuntimeInfo` | `design-os/engine/runtimeInfo.ts` | None | **REUSE** — drives the "Studio preview" tag in mock mode |

---

## 5 · Missing / broken items

### 5.1 Model name (HIGH PRIORITY)
- **What's wrong:** Legacy `thumbnail_engine.py:58` defaults to `gpt-image-2`. Contract spec + Daniel's brief both demand `gpt-image-1`.
- **Phase 6F action:** All new Design OS brand-preset writes and prompt previews must use `gpt-image-1`. The legacy runtime fallback already retries `gpt-image-1` on 404, so existing accounts continue to work.
- **Runtime fix:** Out of Phase 6F scope (Python edit).

### 5.2 CLI / display server / package management (HARD REJECT)
- **What it is:** `INSTALL-FOR-KIMI.md` ships a complete Node.js CLI with Express display server and npm packaging.
- **Phase 6F action:** Reference only. Do **NOT** port `bin/thumbgen.js`, `lib/display.js`, `package.json`, or any related infrastructure into Liquid Clips.

### 5.3 Cancellation polling cadence
- **What's missing:** Contract demands ~2s polling of the cancel marker during the OpenAI await. Legacy only checks at start + before write.
- **Real-world impact:** With `urlopen(timeout=60)`, worst-case cancel latency is 60 seconds.
- **Phase 6F action:** None on the runtime side (out of scope). UI side ensures Cancel is visible the whole time and the marker write is immediate.

### 5.4 Brand preset fields declared but not consumed
- **`style_mood`**, **`props`**, **`font_directive`** — declared in the `sidecar.py:4097–4100` whitelist but NOT used by `build_prompt`.
- **Phase 6F action:** Wire UI controls for them with an "experimental — does not affect generation yet" hint. Or omit from the Design OS UI entirely until the prompt builder is updated. **Recommend: surface in Brand Preset advanced section with the hint.**

### 5.5 No non-blocking pair for single-image generate
- **What's the issue:** Only batch has IG-010 start/cancel. Single-image `thumbnailGenerate` is blocking (180s timeout + cancel-marker).
- **Real-world impact:** A user mid-gen on a hot-reloaded route loses the elapsed counter on every hot reload.
- **Phase 6F action:** None — keep the blocking call; the session-persistence layer (Phase 6C-Lockdown) survives hot reloads with progress percent intact.

### 5.6 Bundled hero references are 13 MB of PNGs
- **What's the issue:** 6 reference PNGs at 1.8–2.3 MB each baked into the Vite bundle (`desktop/src/assets/yt-references/`).
- **Phase 6F action:** **DEFER** the Beat 2 marquee surface. When Phase 7+ revisits, generate equivalent assets via gpt-image-1 (Daniel's bespoke-craft rule) OR ship as lazy-loaded route-chunk.

### 5.7 Stale Dropbox copy at `~/Desktop/thumbnail_engine.py`
- **What's the issue:** Missing v0.7.31 P2-21 empty-body fix + `urlopen(timeout=60)` guard.
- **Phase 6F action:** Daniel may want to archive or delete it — outside Phase 6F scope. Flagged here for completeness.

### 5.8 Tier-gating signals (paywallNotify)
- Legacy fires `notifyPaywall("thumbnail_studio_ai", tier)` to the backend.
- Design OS has no `paywallNotify` helper yet.
- **Phase 6F action:** Stub `paywallNotify()` in a `design-os/state/paywall.ts` module that emits a bus toast for now. Real backend wire-up later.

---

## 6 · Phase 6F build order

> Easiest → hardest. One brick per step. Each step ends with tsc green + `__lcRunLeakTest()` clean. No step ships a real OpenAI call until the runtime phase.

### Phase 6F-A · Route scaffold (foundation)
1. **Add `thumbnail` to `ROUTE_REGISTRY`** (`design-os/routing/routeRegistry.ts`) with `world: "studio-deck"`, `defaultKade: "reading-brief"`, `kadePlacement: "helper-right"`. Update `SimulatorRouter` if needed. (~10 min · LOW risk)
2. **Mirror the brand preset shape into TypeScript types** at `design-os/studio/thumbnailTypes.ts`. Mirror the 9-field whitelist + `ThumbnailItem` + `ThumbnailGenerateResult` + `LedgerRow`. (~15 min · LOW)
3. **Extend the sidecar-stub** with the 13 thumbnail methods, each shape-compatible with legacy + mock-pipeline fallback that emits `engine:progress { stage: "thumbnail" }` for batch + `engine:complete { kind: "thumbnail-batch" }` for finish. (~30 min · LOW)
4. **Extend `BakeErrorStrip`** to also catch `kind === "thumbnail-batch"`. (~5 min · LOW)
5. **Stub `paywallNotify()`** in `design-os/state/paywall.ts` — emits a toast for now, real backend later. (~10 min · LOW)

### Phase 6F-B · Empty state + toolbar (visible scaffold)
6. **Build `ThumbnailEmptyState`** — "Pick a clip in Engine first" + "Open Clipping Engine" CTA (copies the EngineEmptyState pattern). (~20 min · LOW)
7. **Build `ThumbnailToolbar`** — runtime tag + Cancel-batch + Cost-ledger drawer toggle + Brand-preset drawer toggle + Identity-upload drawer toggle. (~30 min · LOW)
8. **Wire route shell** — overwrite the `ThumbnailStudio.tsx` SimPage stub with `EngineSessionProvider` + `useKadeFromSession("thumbnail")` + `<EngineErrorBoundary>` per brick. (~25 min · LOW)
9. **Wire Engine→Thumbnail handoff** — `ResultsGrid.onOpenClip` already routes to Studio (Phase 6D). Extend the persisted session to also carry `selectedVariantPath` (initially empty). (~15 min · LOW)

### Phase 6F-C · Cover Pack tab (read-only first surface)
10. **Build Cover Pack grid** — 4-col contact sheet wrapped in `<GlassCard>` rows · "Use as cover" hover CTA fires `sidecar.thumbnailUseAsCover` + `window.dispatchEvent('lc:library-refresh')`. (~40 min · LOW)
11. **Mount on route** as the default tab. (~10 min · LOW)

### Phase 6F-D · Brand preset + Identity wizards (Drawer-based)
12. **Build `ThumbnailBrandPresetPanel`** mounted in `<Drawer>` — 9-field form with advanced section. Save fires `sidecar.thumbnailSaveBrand` (stub for now). (~50 min · MED)
13. **Build `ThumbnailIdentityUpload`** mounted in `<Drawer>` — drag-drop + file picker + ≥3 validation + live thumbnail strip. Save fires `sidecar.thumbnailSaveIdentity` (stub). (~60 min · MED)
14. **Build Setup Gate** — 2-row checklist (Identity + Brand) shown before AI tab unlocks. (~25 min · LOW)

### Phase 6F-E · AI Generate tab (the heavy half)
15. **Build `ThumbnailGenerateForm`** — title input + counter + metaphor textarea + accent swatches + quality chips. (~45 min · LOW)
16. **Build prompt-preview lightbox** mounted in `<ModalPortal>` — calls `sidecar.thumbnailPreviewPrompt` (stub) + shows the composed prompt. (~25 min · LOW)
17. **Build `ThumbnailVariantGallery`** — grid of generated variants (mock data from fixture) + pending tile with elapsed counter + image-zoom lightbox via `<ModalPortal>` + "Use as cover" CTA. (~70 min · MED)
18. **Build `SafeAreaOverlay`** — toggle face/title SVG overlays over the active variant preview. (~30 min · LOW)
19. **Wire batch event listeners** — subscribe at route root to `engine:progress { stage: "thumbnail" }` + `engine:complete { kind: "thumbnail-batch" }` + `engine:error`. Drive `AllowanceBar` from `done/total`. (~30 min · LOW)
20. **Wire single-image generate** — Form's "Generate" button fires `sidecar.thumbnailGenerate` (stub) + shows pending tile + elapsed counter + Cancel button. (~30 min · LOW)

### Phase 6F-F · Cost ledger (Drawer)
21. **Build `ThumbnailCostLedger`** mounted in `<Drawer>` — lifetime total `MetricBoard` + per-row table (date · model · cost · title). Reads from `sidecar.thumbnailLedger`. (~40 min · LOW)

### Phase 6F-G · Polish + verification
22. **Tier-upsell pane** — show `SoloUpsell` content when `userTier === "free"`. Fires `paywallNotify` stub. (~20 min · LOW)
23. **No-Project gate** — guard the route when no slug. (~15 min · LOW)
24. **Wrap every new component in `<EngineErrorBoundary>`**. (~15 min · LOW)
25. **Per-route `__lcRunLeakTest()` clean** + tsc clean + 5 screenshots (empty / cover pack / generate form / variant gallery / cost ledger). (~30 min · LOW)

### DEFER to Phase 7+
- Hero Beat 2 marquee + 6 YT-reference PNGs (13 MB of asset bloat)
- Cancellation 2s polling (runtime change)
- gpt-image-1 default in `thumbnail_engine.py` (runtime change)
- Real `paywallNotify` backend wire-up
- Dedicated `generating-thumbnails` Kade pose

---

## 7 · Risk ledger

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legacy `gpt-image-2` model rename surfaces user confusion | LOW (only ~6 advanced users would notice) | Brand-preset default writes `gpt-image-1`; existing accounts auto-fallback via `sidecar.py:4429` |
| Identity-image upload UX regression | MED | Match the legacy ≥3 validation + atomic replace pattern in the new component |
| Cost ledger drift if `ledger_warning` ignored | LOW | Surface ledger warnings as `<ToastHost>` `kind="warning"` |
| Modal-in-modal anti-pattern resurrected | LOW | Use `<Drawer>` instead — already portal-rendered to body |
| Hero marquee blocks Phase 6F shipping | LOW | DEFER to Phase 7+ explicitly |
| Iron Gate IG-010 violation | LOW | Batch start/cancel keep the same RPC names · session-persistence + tauri-adapter routing already respects IG-010 |
| Beat-2 hero assets dropped without replacement | LOW | Phase 7+ generates new ones via gpt-image-1 per bespoke-craft rule |
| Style-mood / font-directive fields surface confusion | LOW | Mark as "experimental — does not affect generation yet" in the advanced section |

---

## 8 · Phase 6F readiness checklist

- [x] Route entry exists (`ThumbnailStudio.tsx` stub)
- [x] World + Kade default + placement plumbed (`studio-deck` / `reading-brief` / `helper-right` via stub)
- [x] `ModalPortal` + `Drawer` ready as React-portal-to-body primitives
- [x] `GlassCard` + `MetricBoard` + `AllowanceBar` primitives ready
- [x] `EngineErrorBoundary` ready for crash isolation
- [x] `BakeErrorStrip` ready (Phase 6F-A extends condition for `thumbnail-batch`)
- [x] `useEngineSession` + `EngineSessionProvider` already used by Engine + Studio
- [x] `useEngineSessionPersistence` carries `selectedClipIdx` from Engine
- [x] `useRuntimeInfo` + `EngineHealthPanel` ready
- [x] `ToastHost` + `DropOverlay` ready
- [x] `engine:progress / complete / error` channels include `thumbnail` + `thumbnail-batch`
- [x] tauri-adapter maps `sidecar:thumbnail_batch_*` channels onto the bus
- [x] Safe-area face/title SVGs shipped at `desktop-2/public/brand/icons/canvas/`
- [ ] `thumbnail` route added to `ROUTE_REGISTRY` (Phase 6F-A step 1)
- [ ] `thumbnailTypes.ts` types mirrored (Phase 6F-A step 2)
- [ ] sidecar-stub extended with 13 thumbnail methods (Phase 6F-A step 3)
- [ ] `BakeErrorStrip` condition extended (Phase 6F-A step 4)
- [ ] `paywallNotify` stub (Phase 6F-A step 5)
- [ ] 8 new components built (Phase 6F-B → 6F-F)

---

## 9 · What comes next

**Stop after this audit per the directive.**

Phase 6F is the build phase. Recommended first commit: **Phase 6F-A step 1 — add `thumbnail` to `ROUTE_REGISTRY`**. Tiny, reversible, foundational. From there each step lands one brick at a time, mirroring the Phase 6D Studio cadence.

No code changes will be made until Daniel says go.
