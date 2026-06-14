# UI Lane 4 — Earn

**Lane status:** `START NOW — visual-only, no editor collision`
**Owner:** Kimi D
**Read first:** `desktop/docs/UI_UPGRADE_MASTER_SCOPE.md`, `docs/UI_PRESERVATION_INVENTORY.md` §1 (v0.7.70 Earn baseline), `docs/UI_POLISH_AND_LINK_FIX_PLAN.md` §6 (Earn polish items), `desktop/docs/EARN_CUSTOMER_JOURNEY.md` (canonical journey + hard desktop-auth rule).
**Validation gates:** `npx tsc -b`, `npm run test:invariant`, `bash scripts/assert-no-passive-keychain.sh`.

> **Earn shipped a full architectural rewrite at v0.7.70** (sibling session). Lane 4 is **polish only**.
> - DO NOT change the public-bounty data model.
> - DO NOT change the `useActivation()` → `activate({ via: "browser" })` flow.
> - DO NOT reintroduce `openAuthPanel("sign-in")`.
> - DO NOT use the deprecated `liquidclips.app/sign-in?redirect_url=/dashboard` URL.
> - DO NOT use the hosted Earn webview (orphaned per audit P1).

---

## 1. Scope

Earn at v0.7.70+ already delivers:
- Universal layout shell (`EarnLayout.tsx`).
- Top ticker strip (`EarnTickerStrip.tsx` — PAID / PENDING / VIEWS / CLIPS count-up).
- 8-step "How it works" popover (`EarnHowItWorks.tsx`).
- Right sidebar (`EarnSidebar.tsx` — Active brief / Your clips top 3 / Your campaigns top 5).
- Public-first data model: `publicData` + `personalData` merge with personal-wins-on-id.
- Inline "Unlock to start" gating per-bounty.
- 5-tab icon rail (`EarnIconRail.tsx` — Open / Doing / SUB / PAY / Top) + Invite popover.
- Sponsored carousel (`SponsoredBannerCarousel.tsx`).
- Bounty card + detail (`BountyCard.tsx`, `BountyDetail.tsx`).
- Manual bounty paste (`ManualBountyPrompt.tsx`).
- Payouts view (`PayoutsView.tsx`).
- Affiliate hero (`AffiliateHero.tsx`).
- Reward Clips panel (`RewardClipsPanel.tsx`).
- Submission portal (`SubmissionPortal.tsx`).
- Auth-ready listeners (`lc:desktop-auth-ready`, `lc:tier-refresh`, `focus`) for instant flip.

Lane 4 polishes:
- Visual chrome (atmosphere plate, button taxonomy adoption, table/list row styling).
- Copy fixes from `UI_POLISH_AND_LINK_FIX_PLAN.md` §6 (P2 items).
- The remaining "doesn't feel premium yet" surfaces (BountyCard hover, Reward Clips empty, Payouts signed-out CTA, Sponsored locked upgrade handler).
- Sidebar density + ticker tile polish.

---

## 2. Files owned by this lane

| File | Why |
|---|---|
| `desktop/src/components/earn/EarnTab.tsx` | Universal Earn shell — visual chrome polish only |
| `desktop/src/components/earn/EarnLayout.tsx` | 3-column workstation spine — polish |
| `desktop/src/components/earn/EarnTickerStrip.tsx` | top ticker — polish |
| `desktop/src/components/earn/EarnHowItWorks.tsx` | 8-step popover — copy polish |
| `desktop/src/components/earn/EarnSidebar.tsx` | right rail — density polish |
| `desktop/src/components/earn/EarnIconRail.tsx` | 5-tab sub-nav — polish |
| `desktop/src/components/earn/SponsoredBannerCarousel.tsx` | public sponsored carousel — locked-state upgrade handler (UI_POLISH §6.4) |
| `desktop/src/components/earn/BountyCard.tsx` | per-bounty card — chip rail polish |
| `desktop/src/components/earn/BountyDetail.tsx` | bounty detail — manual-bounty status fix (UI_POLISH §6.1) |
| `desktop/src/components/earn/AffiliateHero.tsx` | affiliate hero — billing URL + partner domain (already shipped v0.7.70; verify) |
| `desktop/src/components/earn/PayoutsView.tsx` | payouts — signed-out CTA (UI_POLISH §6.3) |
| `desktop/src/components/earn/RewardClipsPanel.tsx` | reward clips — signed-out CTA (UI_POLISH §6.3) |
| `desktop/src/components/earn/SubmissionPortal.tsx` | submission portal — auto-track (UI_POLISH §6.2) |
| `desktop/src/components/earn/ManualBountyPrompt.tsx` | manual bounty — locked-state copy |
| `desktop/src/components/earn/BountySection.tsx` (if exists) | section wrapper |
| `desktop/src/components/earn/BountySubmissionCapture.tsx` | submission capture form polish |
| `desktop/src/components/earn/SubmissionForm.tsx` | form chrome polish |
| `desktop/src/components/earn/EarnErrorBoundary.tsx` | docstring polish |

## 3. Files forbidden to this lane

- `EarnPanelMount.tsx` (hosted webview — orphaned per audit P1; **delete-or-archive lane**, not this one).
- All editor-blocked files (master §7).
- All `components/projects/*` (Lane 3).
- `App.tsx`, `index.css`, `SideNav.tsx`, `RoomShell.tsx`, `Splash.tsx`, `FirstRun.tsx` (Lane 1).
- `Settings.tsx`, `UpgradeLockCard.tsx`, `PublishModal.tsx`, `PlatformIcon.tsx`, `FailureCard.tsx`, `SidecarCrashOverlay.tsx`, `CommunityTab.tsx`, `schedule/*` (Lane 5).
- All `python-sidecar/*`, `lib/sidecar.ts`, `lib/activation.ts`, `lib/authStorage.ts`, `lib/whopBounties.ts`.
- `account-app/*`, `partner-app/*` — separate repos.

---

## 4. Target demo / brand references

| Surface | Reference | Strictness |
|---|---|---|
| Earn deck overall | `desktop/docs/demo-pages.html` Earn deck | **CONTRACT** (IG-012) |
| Ticker strip | `desktop/docs/demo-pages.html` Earn ticker section | **CONTRACT** |
| BountyCard | `desktop/docs/demo-pages.html` Earn bounty card | **CONTRACT** |
| Atmosphere plate | `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md` — Earn uses `.deck-earn` atmosphere | REFERENCE (CSS hook table) |

---

## 5. Page-by-page UI outcomes

### 5.1 EarnTab + EarnLayout (universal shell)

**Current state:** 3-column spine (top ticker / left rail / main / right sidebar collapsible below 1100px). Public-first data; personal layer hydrates on auth-ready.

**Cold-customer issues:**
- Universal shell works well. Minor polish: spacing rhythm in the main panel could match the brand-kit's vertical scale.
- When `publicData.status === "loading"`, the main panel shows skeletons — those should adopt Lane 1's `.skeleton` class.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Layout | Preserve 3-column spine. Atmosphere plate via `.deck-earn` once Lane 1 lands the CSS hook |
| Loading | Skeleton tiles use Lane 1's `.skeleton` class |
| Error banner | Use Lane 1's `.error-banner` class for retry banner |
| Sub-nav (EarnIconRail) | Preserve. 5 sub-tabs + Invite popover — visual polish (chip styling consistent) |
| Right sidebar | Preserve. Compact-density polish — Active brief / Top 3 clips / Top 5 campaigns. Each section uses mono-uppercase eyebrow + 1-line content rows |
| `onSignInClick` handler | Preserve `void activate({ via: "browser" })` — **DO NOT reintroduce `openAuthPanel("sign-in")`** |

**Files:** `EarnTab.tsx`, `EarnLayout.tsx`.

---

### 5.2 EarnTickerStrip (top tiles)

**Current state:** 60px top strip with PAID / PENDING / VIEWS / CLIPS count-up tiles + `?` popover.

**Cold-customer issues:**
- Tile labels are fine but the count-up animation is brief — first-timer may miss the numbers.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Tile chrome | Existing rounded-2xl border-line bg-paper-warm — preserve |
| Tile spacing | gap-2 currently; bump to gap-3 for breathing room |
| Tile label | mono-uppercase text-[10px] tracking-[0.32em] (existing) — preserve |
| Tile value | Large display number; preserve |
| Tile sub | Existing 1-line sub (e.g. "this month") — preserve |
| Help popover (`?` button) | Preserve `EarnHowItWorks` open — 8-step popover |
| Cold-customer copy | If user is signed-out, ticker tiles show `—` for value + "Sign in to track" sub-line |

**Files:** `EarnTickerStrip.tsx`.

---

### 5.3 EarnIconRail (5 sub-tabs)

**Current state:** Open / Doing / SUB / PAY / Top + Invite popover.

**Cold-customer issues:**
- "SUB" / "PAY" / "Top" are abbreviations — cold customer may not know what they mean. Tooltips help but aren't sticky.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Tab labels | Preserve abbreviations on the rail. Add `title="…"` tooltip: SUB → "Your submissions"; PAY → "Your payouts"; Top → "Leaderboard" |
| Active state | Existing fuchsia underline — preserve |
| Hover | Existing hover bg — preserve |
| Invite popover | Preserve. Polish: button taxonomy adoption inside popover (Invite link copy + Copy link `.btn-primary`) |

**Files:** `EarnIconRail.tsx`.

---

### 5.4 SponsoredBannerCarousel (public sponsored)

**Current state:** Mounted unconditionally; visible to all auth states. Locked tier-gated items currently fall through to `openExternal(c.whop_url)` (UI_POLISH §6.4 P2).

**Cold-customer issues:**
- Locked banner click lands on external Whop page with no upgrade hint. Cold customer doesn't know upgrading would unlock it.

**Target UI outcomes (UI_POLISH §6.4 fix):**

| Element | Outcome |
|---|---|
| Carousel chrome | Preserve scrollable row |
| Card chrome | Preserve sponsored card styling |
| Locked state | When `c.tier > userTier`, render card with `border-fuchsia/50 bg-fuchsia-soft/30` + Lock icon top-right + "Pro unlocks this" sub-copy |
| Locked card click | Pass `onUpgrade` from EarnTab: signed-out → `onSignInClick()` (which calls `activate({ via: "browser" })`); signed-in free → `openAuthPanel("upgrade")` |
| **DO NOT** | Fall through to `openExternal(c.whop_url)` for locked tier-gated items |

**Files:** `SponsoredBannerCarousel.tsx`, `EarnTab.tsx` (pass `onUpgrade` prop).

---

### 5.5 BountyCard (per-bounty card)

**Current state:** Inline gating via `startLabel` / `startTitle` props — "Unlock to start this bounty" when signed-out.

**Cold-customer issues:**
- Cards work; chip rail polish for consistency with Lane 2's ClipCard chips (EARN / RPM / spots-remaining / platforms).

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Card chrome | Preserve. Use `.library-card` base + HUD bracket sibling pattern (IG-007 sibling). |
| Chip rail | Standardize chips: RPM (fuchsia-soft when > 0) / Platform glyphs (mono) / Spots remaining (text-tertiary mono "N left") / Status (in progress / done / closed). |
| Locked state | Preserve `startLabel="Unlock to start"` (v0.7.70 baseline) |
| Start CTA | `.btn-primary` (Lane 1) when signed-in + active; `.btn-locked` when signed-out + active |
| Hover | Subtle scale + fuchsia outer ring (matches LibraryCard sibling) |

**Files:** `BountyCard.tsx`.

---

### 5.6 BountyDetail (drill-in)

**Current state:** Opens on card click. Manual bounty status currently shows "Closed" due to `spotsRemaining: 0` synthesis (UI_POLISH §6.1 P2).

**Target UI outcomes (UI_POLISH §6.1 fix):**

| Element | Outcome |
|---|---|
| Status label logic (`bountyStatusLabel`) | Add `bounty.bountyType === "manual"` branch → return "Live" or "Manual" before spots-remaining check |
| Detail chrome | Preserve. Bounty title + creator + description + spots + platforms |
| Start CTA | Preserve. `.btn-primary` |
| Open Whop brief | `.btn-secondary` |
| Submit clip | `.btn-secondary` |

**Files:** `BountyDetail.tsx`, possibly `App.tsx:1622` (manual bounty synthesis). Lane 4 spec the App.tsx change in §10; Lane 1 lands it.

---

### 5.7 AffiliateHero

**Current state (v0.7.70 preservation inventory §1):**
- `partner.jnremployee.com` → `partner.liquidclips.app` (shipped).
- billing URL → dashboard (shipped).
- "Activate Liquid Clips" copy still present (UI_POLISH §6 P2 — needs fix).

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Signed-out CTA copy | Change "Activate Liquid Clips" → "Sign in to Liquid Clips" |
| Fix payment | `account.liquidclips.app/billing` (404) → `account.liquidclips.app/dashboard` OR `whop.com/liquidclips` (whichever is canonical billing). Verify with Daniel before flipping; default to `/dashboard` |
| Open partner dashboard | Already flipped to `partner.liquidclips.app` (v0.7.70) — verify |
| See plans | Existing `account.liquidclips.app/upgrade` — preserve |
| Set up Stripe Connect | External Stripe URL — preserve |

**Files:** `AffiliateHero.tsx`.

---

### 5.8 PayoutsView (signed-out CTA — UI_POLISH §6.3)

**Current state:** Signed-out state shows static copy "Sign in to see your payout sources" with no CTA.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Signed-out state | Add a button: `.btn-primary` "Sign in to Liquid Clips →" calling existing `activate({ via: "browser" })` (already imported per regression sweep) |
| Body copy | "Connect your Whop account to see payouts and earnings." (clearer than "Sign in to see your payout sources") |

**Files:** `PayoutsView.tsx`.

---

### 5.9 RewardClipsPanel (signed-out CTA — UI_POLISH §6.3)

**Current state:** Signed-out state shows static copy "Sign in to see your reward clips" with no CTA.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Signed-out state | Add `.btn-primary` "Sign in to Liquid Clips →" calling existing `activate({ via: "browser" })` |
| Body copy | "Connect your Whop account to see clips you've submitted to brand campaigns." |

**Files:** `RewardClipsPanel.tsx`.

---

### 5.10 SubmissionPortal (auto-track — UI_POLISH §6.2)

**Current state:** Success state doesn't call `rememberSubmissionId(result.id)`.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| On success | After `setState({ kind: "success", submissionId: result.id })`, call `rememberSubmissionId(result.id)` (import from `./EarnTab` per UI_POLISH §6.2) |
| Success state UI | Existing — preserve. Optional: add "Track in SUB tab →" link that navigates to the SUB sub-tab |

**Files:** `SubmissionPortal.tsx`.

---

### 5.11 SubmissionForm + BountySubmissionCapture (form polish)

**Current state:** Form inputs use `bg-paper px-3 h-10` standard pattern.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Input chrome | Preserve. Add `focus:shadow-[var(--glow-sm)]` (matches Lane 1 brand-kit pattern) |
| Submit button | `.btn-primary` |
| Cancel | `.btn-secondary` |
| Error banner | Use Lane 1's `.error-banner` |

**Files:** `SubmissionForm.tsx`, `BountySubmissionCapture.tsx`.

---

### 5.12 ManualBountyPrompt (locked-state copy)

**Current state:** Locked state copy can be polished.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Locked state | "Paste a Whop brief link to start a manual bounty. Sign in to Liquid Clips to track earnings." |
| Inputs | Same chrome as SubmissionForm |
| CTA | `.btn-primary` |

**Files:** `ManualBountyPrompt.tsx`.

---

### 5.13 EarnHowItWorks (8-step popover)

**Current state:** Popover from ticker `?` button. 8 steps.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Popover chrome | Preserve. Calmer borders, `bg-paper-warm` |
| Steps | Verify copy matches the canonical journey doc `desktop/docs/EARN_CUSTOMER_JOURNEY.md`. Update any drift. |
| Close | X top-right with `title="Close (Esc)"` |

**Files:** `EarnHowItWorks.tsx`.

---

## 6. Copy improvements

| Surface | Old | New |
|---|---|---|
| EarnTab refresh-session banner | "Continue your session" / "Continue session →" | "Refresh your session…" / "Refresh session →" (UI_POLISH §6 P2) |
| AffiliateHero signed-out card | "Activate Liquid Clips" | "Sign in to Liquid Clips" (UI_POLISH P2) |
| PayoutsView signed-out | "Sign in to see your payout sources" | "Connect your Whop account to see payouts and earnings." + Sign in CTA |
| RewardClipsPanel signed-out | "Sign in to see your reward clips" | "Connect your Whop account to see clips you've submitted to brand campaigns." + Sign in CTA |
| BountyCard locked (signed-out) | "Unlock to start" (preserve) | preserve |
| ManualBountyPrompt locked | (varies) | "Paste a Whop brief link to start a manual bounty. Sign in to Liquid Clips to track earnings." |

---

## 7. Icons / accents

- Preserve existing lucide icons.
- Sponsored locked: `Lock` lucide icon.
- BountyCard chip rail: text only, no icons inside chips.
- Platform glyphs on BountyCard: via shared `PlatformIcon` (Lane 5 unifies).

---

## 8. Buttons / cards / tables specific to Lane 4

- All buttons use Lane 1's button taxonomy.
- BountyCard: `.library-card` HUD bracket sibling pattern.
- Payouts list rows + leaderboard rows + submission list rows: standardize to a single row pattern: `flex items-center justify-between gap-3 rounded-lg border border-line/40 bg-paper-elev/40 px-3 py-2 hover:border-fuchsia hover:bg-fuchsia-soft/20`.
- Hover row: fuchsia border + soft fill.
- Empty row: "No payouts yet." / "No submissions yet." / etc., with optional CTA.

---

## 9. Cold-customer hand-walk for this lane

Run after Lane 4 ships:

- [ ] **Cold boot signed-out** → SideNav Earn → public bounties grid renders.
- [ ] **Sponsored carousel** → cards display correctly with locked-state visual.
- [ ] **Click a locked sponsored card** → `onUpgrade` fires → signed-out users go through `activate({ via: "browser" })`, signed-in free users open Whop checkout via account-app.
- [ ] **System browser opens** at `liquidclips.app/connect-desktop?challenge=…` (NOT `/sign-in?redirect_url=…`).
- [ ] **Sign in completes** → deep-link `liquidclips://activate?token=…&challenge=…` returns → `primeLicenseJwtCache` runs → `lc:desktop-auth-ready` dispatches → Earn flips to ready.
- [ ] **Bounty card** → chip rail shows RPM / platforms / spots-remaining / status.
- [ ] **Manual bounty** → status reads "Live" or "Manual" (NOT "Closed").
- [ ] **Submit a clip** → success state shows; submission auto-tracked locally; SUB tab shows it.
- [ ] **PayoutsView signed-out** → primary CTA "Sign in to Liquid Clips →".
- [ ] **RewardClipsPanel signed-out** → primary CTA "Sign in to Liquid Clips →".
- [ ] **AffiliateHero signed-out** → "Sign in to Liquid Clips" copy (NOT "Activate Liquid Clips").
- [ ] **AffiliateHero Fix payment** → opens `account.liquidclips.app/dashboard` (NOT `/billing` which 404s).
- [ ] **EarnHowItWorks** → opens from ticker `?` button; 8 steps render.
- [ ] **EarnIconRail tooltips** → SUB / PAY / Top each have `title="Your submissions"` etc.
- [ ] **No `openAuthPanel("sign-in")` in any Earn surface** (grep verify).
- [ ] **Validation gates** all green.
- [ ] **No Keychain prompt** at any point.

---

## 10. Cross-lane requests

Lane 4 may need:

- **From Lane 1:** Button taxonomy classes; `App.tsx:1622` manual-bounty synthesis adjustment (Lane 1 lands per Lane 4's spec) per UI_POLISH §6.1.
- **From Lane 5:** PlatformIcon unification for BountyCard's platform glyphs.

Lane 4 may receive requests from:

- **Lane 3:** When a bounty is started → Project is created → Lane 3's ProjectDetail mounts with Earn context block. Lane 4 verifies that block continues to render correctly.

---

## 11. Validation commands

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
```

If `index.css` is touched (it shouldn't be — Lane 1 owns): run `brand-kit-drift-check.sh`.

---

## 12. Iron-gate compliance

- **IG-002** (Sidecar RPC contract): no new RPCs. Lane 4 uses existing `whopListPublicBounties`, etc.
- **IG-011** (Webview cascade): `<RoomShell roomKey="earn" align="stretch">` preserved. Lane 4 does not change RoomShell alignment.
- **IG-014** (Auth-keychain invariant): zero new Keychain reads. `useActivation()` flow preserved.

---

## 13. What's NOT in this lane

- Public-bounty data model changes — sibling shipped at v0.7.70; not in this lane.
- Hosted Earn webview (`EarnPanelMount.tsx`) cleanup — separate dead-code lane.
- Backend changes (junior-backend) — separate.
- Stripe Connect / payouts onboarding flow — out of scope.
- Earn analytics dashboard — defer.

---

## 14. Stop condition

Lane 4 ships when:
- All §5 page-by-page outcomes pass.
- §9 hand-walk is green per Daniel.
- §11 validation gates clean.
- §12 iron-gate compliance verified.
- No `openAuthPanel("sign-in")` reintroduced; no `liquidclips.app/sign-in?redirect_url=/dashboard` reintroduced.

No commit, push, tag, release, or `latest.json` update without Daniel's explicit per-batch approval.

**End of Lane 4 sub-doc.**
