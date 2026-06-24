# Claude — Two Pasted States Scope

**Status:** scope only — do not implement yet.
**Date:** 2026-06-17
**Working root:** `/Users/dipdip/code/jnr/desktop-2`
**Source pastes:** Pasted text #2 (UI/UX finish pass) + Pasted text #3 (Clipper vs Agency mode skin pass).
**Reference docs (read-only):**
- `docs/lc2/LC2_CURRENT_STATE_GAP_AUDIT.md`
- `docs/lc2/LC2_HOME_STUDIO_MERGE_SPEC.md`
- `docs/lc2/CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md`
- `docs/lc2/AGENCY_PARTNER_PROGRAM.md`
- `docs/lc2/PHASE_GATES.md`

---

## 1. Current stable state

Verified live this turn:

| Check | Result | Evidence |
|-------|--------|----------|
| `npm run build` | ✅ PASS | 1677 modules, 319.26 kB JS / 104.96 kB CSS, built in 8.96s |
| `npm run guard` | ✅ PASS | 307 passed, 0 failed |
| `npm run tauri dev` | ✅ launched | running in background (id `bhzqcb0he`) |
| Home has 4 big cards | ✅ | `src/sections/home/HomeSection.tsx` — Generate / Import / Thumbnails / Script |
| Clipper / Agency mode exists | ✅ | `src/state/mode.ts`, `src/components/mode/{ModeStrip,ModeBadge,CapabilityLock}.tsx` |
| Generate card pills exist | ✅ | "Generate clips" / "Generate 30 clips" / "Generate 100 clips" / "Open Engine" inline-expand |
| 100 clip gate exists | ✅ | `data-home-action="generate-100-clips"` rendered in Home |
| `EngineTimeline` mounted | ✅ | `src/sections/editor/EngineTimeline.tsx` rendered in `EditorSection.tsx` and `EngineEditorOverlay.tsx` |
| `EngineEditorOverlay` mounted | ✅ | `src/sections/editor/EngineEditorOverlay.tsx` rendered in `EditorSection.tsx` |
| Mode strip mounted above cards | ✅ | `<ModeStrip>` at top of `HomeSection.tsx` |
| Campaign watermark locked visible | ✅ | `<CapabilityLock label="Campaign watermark locked" />` |
| Submit to Whop / Invite clippers labels | ✅ | both rendered with `data-home-action` data attrs |
| Import/Thumbnail/Script drawers | ✅ | bottom-sheet drawers at `src/components/home/*Drawer.tsx` |
| Intro splash + Invaders | ✅ | guard confirms all assets + mount |

**Bottom line:** Batch 0 + 1.5 + 2 are landed and green. The two pasted states are asking for *polish + visual differentiation*, not new architecture.

---

## 2. What the pasted states are asking for

Every requested item extracted from Pasted #2 and #3, grouped.

### 2.1 Home UX

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Keep 4 cards (Generate / Import / Thumbnails / Script) | #2 §Home polish, #3 §Keep cards | ✅ |
| Bigger / clearer / more arcade / less cramped cards | #2 §Home polish | ⚠️ partial — cards exist, "arcade feel" pass not done |
| Large icon · short copy · obvious primary button | #2 §Home polish | ⚠️ partial — icons present, primary-CTA emphasis not loud enough |
| Inline expansion for Generate | #2 §Home polish | ✅ |
| Drawer pattern for Import / Thumbnails / Script | #2 §Import/window pattern | ✅ |
| Each work window has title · explanation · primary · secondary · close · Engine handoff | #2 §Import/window pattern | ⚠️ partial — need audit of all three drawers for handoff button parity |
| Splash logo bigger (without breaking intro timing) | #2 §Splash logo | ❌ not done |
| Empty-space rule — no large dead voids | #2 §Empty space rule | ⚠️ partial (Engine still has dead space) |

### 2.2 Mode skin (Clipper vs Agency)

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Mode toggle visually obvious | #3 §Current issue | ⚠️ partial — mode switch works but page barely changes |
| `lc-home--clipper` / `lc-home--agency` root class on Home | #3 §Suggested implementation | ❌ |
| Per-mode accent glow / border / background motif / badge colour | #3 §Suggested implementation | ❌ |
| Clipper mini path "Join → Clip → Post → Submit" | #3 §Clipper Mode design | ❌ |
| Agency mini path "Create → Invite → Review → Grow" | #3 §Agency Mode design | ❌ |
| Clipper copy "Join campaigns. Clip. Post. Submit." | #3 §Clipper Mode design | ❌ |
| Agency copy "Create campaigns. Invite clippers. Grow distribution." | #3 §Agency Mode design | ❌ |
| Clipper visual tone pink + cyan, mission badge | #3 §Clipper Mode design | ❌ |
| Agency visual tone pink + gold/white/command-purple, campaign command badge | #3 §Agency Mode design | ❌ |
| Mode-aware priority CTAs (Clipper: Join/Generate/Submit/Connect; Agency: Create/Set watermark/Invite/Share) | #3 §Both modes | ⚠️ partial — Generate card is mode-aware; surrounding strips are not |

### 2.3 Engine / workstation

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Larger selected clip preview | #2 §Engine polish | ❌ |
| Preview visually connected to timeline | #2 §Engine polish | ⚠️ partial |
| Right rail visible or intentionally collapsed with affordance | #2 §Engine polish | ⚠️ partial — exists at 280 px wide |
| Clip grid visible where appropriate | #2 §Engine polish | ✅ |
| Source / campaign chip visible | #2 §Engine polish | ✅ |
| Export / schedule / submit / publish CTAs visible | #2 §Engine polish | ✅ |
| Timeline anchored strongly at bottom | #2 §Engine polish | ⚠️ partial |
| Helpful empty state when no clip selected | #2 §Empty space rule | ❌ |
| No giant dead black voids | #2 + #3 §Engine empty-space note | ⚠️ partial |

### 2.4 Reward banners

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Reward banner carousel | #2 + #3 ("Do not start reward banners yet") | ❌ — explicitly deferred by both pastes |
| `LazyVideo` for `campaign.banner_url` | implicit in carousel | ❌ — deferred |

### 2.5 Browser / rewards overlay

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Browser overlay chrome | #2 + #3 ("Do not start browser overlay yet") | ❌ — explicitly deferred by both pastes |

### 2.6 Affiliate / partner messaging

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Agency Partner Program strip | #2 §Affiliate/partner messaging | ❌ |
| Copy: "Share your affiliate link" | #2 + #3 | ❌ — phrase not in repo |
| Copy: "Earn 50% MRR from every paid clipper you refer" | #2 + #3 | ❌ — phrase not in repo |
| Copy: "Payouts handled by Whop" | #2 §Affiliate | ❌ |
| Visible but not overwhelming in Agency mode | #2 §Affiliate | ❌ |

### 2.7 Fonts / game style

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Audit current font usage | #2 §Font pass | ❌ |
| Primary UI: Inter / Geist / Space Grotesk | #2 §Font pass | ❓ unverified |
| HUD/game labels: Silkscreen / Press Start 2P / pixel fallback | #2 §Font pass | ❌ |
| Apply HUD font to: nav labels · badges · section chips · mode pills · game overlay labels · timeline HUD · small status copy | #2 §Font pass | ❌ |
| Do not use pixel font for body text | #2 §Font pass | guard needed |
| Game/HUD font on mode badge / mini path / section chips / small labels / status pills | #3 §Font/arcade feel | ❌ |

### 2.8 Paywall / unlock messaging

| Item | Source paste | Already done? |
|------|--------------|---------------|
| `Generate 100 clips 🔒` visibly gated | #2 §100 clip gate | ⚠️ partial — button exists, lock affordance is plain |
| "Unlock with Agency" copy | #2 §100 clip gate | ❌ |
| "30-day free trial" copy | #2 §100 clip gate | ❌ |
| "Agency Growth / Agency Pro" tier names visible | #2 §100 clip gate | ❌ |
| No real billing wired | #2 + #3 | ✅ (none wired) |

### 2.9 Guards

| Item | Source paste | Already done? |
|------|--------------|---------------|
| Guard `Clipper Mode` / `Agency Mode` strings | #3 §Guard checks | ✅ |
| Guard `Join → Clip → Post → Submit` | #3 §Guard checks | ❌ |
| Guard `Create → Invite → Review → Grow` | #3 §Guard checks | ❌ |
| Guard `50% MRR` | #3 §Guard checks | ❌ |
| Guard `Campaign watermark locked` | #3 §Guard checks | ✅ |
| Guard `Submit to Whop` / `Invite clippers` / `Set watermark` / `Share your affiliate link` | #3 §Guard checks | ⚠️ partial (`Share your affiliate link` missing) |
| Forbidden — real Whop / Ayrshare API · native payout · native view tracking · clipper removes watermark | #3 §Guard fail-list | ✅ already enforced |

---

## 3. Conflicts / overlaps

| # | Conflict | Recommended decision |
|---|----------|----------------------|
| C1 | Pasted #2 calls drawers "work windows"; existing code calls them `*Drawer.tsx`. | **Keep `Drawer` filenames; expose "work window" only as in-UI title copy.** Renaming files breaks the guard and the merge spec. The user's phrase is descriptive, not a filename request. |
| C2 | Pasted #2 §Affiliate says "Earn 50% MRR from every paid clipper you refer" but `AGENCY_PARTNER_PROGRAM.md` §1 says "Earn 50% MRR from every paid clipper you refer." | **No conflict — identical.** Use this exact phrase. |
| C3 | Pasted #2 says "Apply this pattern consistently: Generate = inline panel **or** work drawer if needed". Merge spec §5.2 already chose inline expand for Generate. | **Keep inline expand.** Don't switch Generate to drawer — already shipped. |
| C4 | Pasted #2 §Engine asks for "preview connected visually to timeline" and pasted #3 says "do not risk breaking EngineTimeline or EngineEditorOverlay" + "CSS-only fix if easy". | **CSS-only fix in next polish batch; no JSX restructure of EngineTimeline / EngineEditorOverlay.** The gain isn't worth the risk against Iron Gate IG-005 (workspace UI). |
| C5 | Pasted #2 §Splash says "Increase splash logo if still small". Intro is iron-locked (IG-003). | **Logo size is a CSS scale in `IntroSplash.tsx`; allowed if `INTRO_DURATION_MS` and `LOADING_MIN_HOLD_MS` stay 28_500 / 5_000 (guard-enforced).** Verify with iron-gate-lens before editing. |
| C6 | Pasted #2 §Affiliate vs `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` §Earn: paste says show affiliate language; doors doc says no native payout numbers. | **Show copy + copy-link button + link-out only. No numbers. `Payouts handled by Whop`.** Already the AGENCY_PARTNER_PROGRAM.md decision. |
| C7 | Pasted #2 §Font says "Silkscreen / Press Start 2P / Pixel-style". Brand kit (Liquid Clips brand kit skill) defines HUD style; need to check whether Silkscreen is on the brand-kit allowlist. | **Default to brand-kit-approved HUD font; only adopt Silkscreen/Press Start 2P if brand kit explicitly allows. Otherwise propose alternative under same arcade-HUD intent.** Verify before adding any web-font import. |
| C8 | Pasted #3 says "Engine empty-space note … do not do full rewrite". Pasted #2 §Engine asks for a denser cockpit including larger preview + visible right rail + anchored timeline. | **The denser cockpit lives in Batch 4. Pasted #3 explicitly says CSS-only easy fixes are OK now; full structural pass deferred to Batch 4.** Do not bundle them. |
| C9 | Pasted #2 §Affiliate "Agency Growth / Agency Pro" tier names are NOT in any spec doc. | **Treat as new copy. Either ship them as Pasted #2 phrasing or replace with the existing `AGENCY_PARTNER_PROGRAM.md` "Agency Partner Program" language. Ask Daniel before adopting tier names that aren't in any source doc.** |

---

## 4. Batch assignment

Mapping every extracted item from §2 into the existing batch ladder.

### Batch 2 (final polish) — the next ship
Mode skin pass + missing copy/guards/affiliate strip. Pasted #3 is the centerpiece. CSS-only Engine empty-state polish piggy-backs.

- `lc-home--clipper` / `lc-home--agency` root class + scoped CSS variables
- Per-mode accent glow / border / background motif
- Clipper mini path `Join → Clip → Post → Submit`
- Agency mini path `Create → Invite → Review → Grow`
- Clipper headline copy: `Join campaigns. Clip. Post. Submit.`
- Agency headline copy: `Create campaigns. Invite clippers. Grow distribution.`
- Agency Partner Program strip with `Share your affiliate link` + `Earn 50% MRR` + `Payouts handled by Whop`
- Generate 100 clips lock UX: `Unlock with Agency`, `30-day free trial` (tier names pending Daniel's call on conflict C9)
- HUD font on mode badge / mini path / section chips / status pills (brand-kit-approved font; verify per C7)
- Drawer parity audit — confirm every drawer has title · explanation · primary · secondary · close · Engine handoff
- Splash logo scale-up (CSS-only, intro timing untouched — verify IG-003 via iron-gate-lens)
- Engine **CSS-only** empty-state polish (no JSX structural changes)
- Helpful empty state in Engine when no clip selected (CSS-only or single new component)
- Guard additions: `Join → Clip → Post → Submit`, `Create → Invite → Review → Grow`, `50% MRR`, `Share your affiliate link`, `Agency Partner Program`, `Unlock with Agency`, `Upgrade on Whop`, `Payouts handled by Whop`

### Batch 3 — reward banners + LazyVideo
- `SponsoredBannerCarousel` (offline-first, sample JSON)
- `LazyVideo` for `campaign.banner_url` mp4
- Align `fakeCampaigns.ts` schema with `sample-campaigns.json`
- Render carousel under Home cards (Hero card always first)
- Guard: reward banner presence

### Batch 4 — Engine / workstation density (structural)
- Reduce empty vertical gaps + oversized headers
- Larger selected clip preview, visually tied to timeline
- Right rail width down from 280 px; intentional collapse affordance
- Timeline anchored at bottom, visible without scrolling
- Source chip / campaign stamp / quota strip compact pass
- Engine empty state when no clip selected (full design pass)
- Engine keyboard shortcuts (`E`, space, Cmd-A)
- Guard: timeline-visible-without-scrolling marker

### Batch 5 — browser overlay chrome
- `BrowseRewardsOverlay.tsx` React chrome bar only
- Triggers from Home reward hero, Earn, Community
- `window.open` fallback; defer Rust `browse.rs`
- Commerce URL routing rule
- Guard: browser-overlay-exists-and-is-not-global

### Batch 6 — publish / share modals
- Connect accounts modal
- Publish via Ayrshare modal (simulator)
- Schedule modal (simulator)
- Submit to Whop modal (link-out only)

### Later / not now
- Tauri drag-drop real file events
- Real OS file picker
- Tauri Rust `browse.rs`
- Real Whop / Ayrshare / backend / FFmpeg / sidecar wiring
- Nav consolidation (future preferred nav)
- Avatar panel + notification sheet content
- Settings tabs: mode + agency-lock simulator display
- Campaigns / Clipper / Earn deep mode-aware content

---

## 5. What should happen next

**Recommendation: Batch 2 final mode-skin polish (Pasted #3) — single patch.**

Reasoning:

1. **Both pastes explicitly forbid Batch 3 and Batch 5 right now.** Pasted #2: "Do not start reward banner carousel yet. Do not start browser overlay yet." Pasted #3: same two prohibitions. So the next patch *must* be inside Batch 2.
2. **Pasted #3 is the narrower, higher-clarity scope.** It targets one user-visible failure ("the mode switch works, but visually the page barely changes") and proposes the exact technical lever (`lc-home--clipper` / `lc-home--agency` root class + scoped CSS). Pasted #2 is broader and more diffuse.
3. **Pasted #2 has heavy overlap with already-deferred batches.** Engine cockpit polish ≈ Batch 4. Splash logo ≈ low-risk one-line CSS. Font pass needs brand-kit verification (C7) before any web-font import.
4. **Mode skin is the cheapest unlock for "looks finished."** A single Home render pass swaps the visual personality of the entire surface without touching IronGate-locked engine code. It moves the most user-perceived quality per line of code touched.
5. **Pasted #3 includes its own guard checklist** (`Join → Clip → Post → Submit`, `Create → Invite → Review → Grow`, `50% MRR`, etc.), so the patch arrives with its own acceptance fence pre-defined.

**Patch shape (for the *next* turn, not this one):**

- One scoped CSS block keyed off `data-mode="clipper|agency"` on Home root
- Two micro-strips with mini paths and headlines
- One Agency Partner Program strip (visible only in Agency mode)
- Three text additions for the Generate 100 lock label
- One drawer-parity pass (audit + one-line title/handoff fixes only)
- Guard updates that match the new strings
- Optional: CSS-only Engine empty-state hint (low risk; skip if it requires JSX changes)
- Defer: font pass, splash logo, full Engine restructure, reward banners, browser overlay

---

## 6. Hard no list

Do not touch in any patch out of this scope:

- Real Whop API calls
- Real Ayrshare API calls
- Native payout tracking (no $ numbers, no commission math)
- Native view tracking (no views/impressions numbers)
- Rust `browse.rs` / Tauri webview integration
- Real billing / Stripe / Whop Checkout integration
- FFmpeg / sidecar processing
- Nav collapse / nav consolidation
- Old `App.tsx` from `/Users/dipdip/code/jnr/desktop` (Iron Gate prevents)
- `EngineTimeline.tsx` / `EngineEditorOverlay.tsx` JSX restructuring (Iron Gate IG-005)
- `IntroSplash.tsx` timing constants — `INTRO_DURATION_MS = 28_500`, `LOADING_MIN_HOLD_MS = 5_000` (guard-enforced)
- `INTRO_SEEN_KEY` / `hasSeenIntro` / `markIntroSeen` (Iron Gate IG-003)
- Any keychain reads on mount (guard-enforced)
- Adding `BrowsePanel` / `BrowserEdgeTab` / `openBrowsePanel` / global panel names (guard-forbidden)
- Adopting tier names ("Agency Growth", "Agency Pro") without Daniel's sign-off (conflict C9)
- Adopting non-brand-kit fonts without verifying brand-kit allowlist (conflict C7)
- Pushing to remote — local commits only until Daniel signs off (per memory `feedback_no_push_until_confirmed`)

---

## 7. Acceptance checklist

Daniel can run this visually after the next patch lands.

### Mode differentiation
- [ ] Can I tell Clipper Mode from Agency Mode in under 2 seconds on the same Home screen?
- [ ] Does the page background / accent / border colour shift when I switch modes?
- [ ] Do I see `Join → Clip → Post → Submit` in Clipper mode?
- [ ] Do I see `Create → Invite → Review → Grow` in Agency mode?
- [ ] Is the mode badge styled like a HUD label, not body text?

### Home — speed standard (60 sec / 100 clips)
- [ ] Can I see how to generate clips in one glance?
- [ ] Can I see how to import?
- [ ] Can I see how to make thumbnails?
- [ ] Can I see how to write scripts?
- [ ] Can I see what `Generate 100 clips` unlocks (with `Upgrade with Agency` lock copy)?
- [ ] Is the primary CTA on each card obvious (not buried)?

### Agency partnership
- [ ] Can I see `Share your affiliate link` in Agency mode?
- [ ] Can I see `Earn 50% MRR` copy in Agency mode?
- [ ] Can I see `Payouts handled by Whop` honest framing?
- [ ] Is the affiliate strip visible but not overwhelming?

### Engine
- [ ] When a clip is selected, does the preview feel connected to the timeline?
- [ ] If no clip is selected, is there a helpful empty state (not a dead black void)?
- [ ] Is the timeline still visible without scrolling?
- [ ] Do Export / Schedule / Submit to Whop / Publish via Ayrshare CTAs remain visible?

### Whop honesty
- [ ] Do I see where to submit to Whop?
- [ ] Do I see where to publish / schedule?
- [ ] Do I see zero fake native payout numbers, view counts, or commission math?
- [ ] Is `Campaign watermark locked` visible on every Clipper-facing surface?

### Polish
- [ ] No text squashed
- [ ] No click target smaller than the brand minimum
- [ ] Each drawer has title · explanation · primary action · secondary action · close · Engine handoff
- [ ] HUD font used only on labels/badges/chips, never on body paragraphs

---

## 8. Return values (for the next implementing turn)

When the next patch ships, the implementer must return:

1. Clipper visual changes (diff list)
2. Agency visual changes (diff list)
3. Screenshot — Home Clipper
4. Screenshot — Home Agency
5. Screenshot — Generate expanded Clipper
6. Screenshot — Generate expanded Agency
7. Files changed
8. Build result
9. Guard result (with the new guard checks added)
10. Remaining punch list before reward banners (Batch 3)

Snapshots must follow the `snapshot-proof-lens` skill — captured against the live running app, not the dev preview HTML mockups.
