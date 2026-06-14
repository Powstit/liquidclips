# UI Lane 5 — Settings + Paywall + States (+ Schedule polish + Community empty + social icons)

**Lane status:** `START NOW — visual-only, no editor collision`
**Owner:** Kimi E
**Read first:** `desktop/docs/UI_UPGRADE_MASTER_SCOPE.md`, `docs/UI_POLISH_AND_LINK_FIX_PLAN.md` (all sections except §6 which Lane 4 owns), `docs/CUSTOMER_JOURNEY_UI_DEAD_END_AUDIT.md` §§ 2.5, 8.
**Validation gates:** `npx tsc -b`, `npm run test:invariant`, `bash scripts/assert-no-passive-keychain.sh`.

> **Lane 5 is the cross-cutting "everything-else" lane.** It owns Settings, Upgrade/paywall surfaces, all the global states (empty / loading / error), Schedule UI polish, Community empty hero, platform-icon unification, and a handful of P1/P2 polish items from the journey audit.

---

## 1. Scope

Lane 5 ships:
- **Settings.tsx redesign** (1923 lines today — reduce visual density, clarify tab outline, modernize button taxonomy).
- **UpgradeLockCard.tsx redesign** (59 lines today — premium paywall surface).
- **PublishModal.tsx visual polish** (Publish Deck-style chrome; disabled-reason tooltips already shipped v0.7.70).
- **FailureCard.tsx fallback** (UI_POLISH §4.3 — clipboard fallback when mailto fails).
- **SidecarCrashOverlay.tsx visual chrome** (mounted by Lane 1 / sibling session; chrome polish only).
- **CommunityTab.tsx empty hero** (audit §28 — "No rooms available" empty state).
- **Schedule polish** (`schedule/SchedulePage.tsx`, `schedule/ChannelsManager.tsx`, `schedule/AddChannelModal.tsx`, `schedule/ChannelRow.tsx`, `schedule/ChannelPicker.tsx`).
- **PlatformIcon unification** (UI_POLISH §1.2 — TikTok fallback in `upload/ClipReadyCard.tsx`).
- **NotificationBell decision** (already handled by Lane 1 if Option B chosen).
- **Settings tab-open event listener** (UI_POLISH §4.2 — proposed change to App.tsx; Lane 1 lands).
- **`lc:checkout-complete` listener** (UI_POLISH §1 + audit P1 — proposed change to App.tsx; Lane 1 lands).
- **Cross-cutting state classes** (empty / loading / error) — applied per surface using Lane 1's shared classes.

---

## 2. Files owned by this lane

| File | Why |
|---|---|
| `desktop/src/components/Settings.tsx` | Settings redesign |
| `desktop/src/components/UpgradeLockCard.tsx` | Paywall surface |
| `desktop/src/components/PublishModal.tsx` | Publish Deck-style chrome |
| `desktop/src/components/FailureCard.tsx` | Email fallback |
| `desktop/src/components/SidecarCrashOverlay.tsx` | Crash overlay chrome |
| `desktop/src/components/CommunityTab.tsx` | Community empty hero |
| `desktop/src/components/schedule/*` | Schedule UI polish (5+ files) |
| `desktop/src/components/PlatformIcon.tsx` | Platform glyph unification |
| `desktop/src/components/upload/ClipReadyCard.tsx` | TikTok glyph fallback (UI_POLISH §1.2) |
| `desktop/src/components/PoweredByWhop.tsx` | Whop badge click + cursor (UI_POLISH §1.5) |
| `desktop/src/components/upload/DirectPublishQueue.tsx` | docstring + copy polish |
| `desktop/src/components/workbench/AccountBindingChip.tsx` | "Schedule → Loadout" copy (v0.7.70 baseline preserved; verify) |
| Any other empty / loading / error surface across the app (cross-cutting) | apply Lane 1's shared classes |

## 3. Files forbidden to this lane

- All editor-blocked files (master §7).
- All `components/projects/*` (Lane 3).
- All `components/earn/*` (Lane 4).
- `App.tsx`, `index.css`, `SideNav.tsx`, `RoomShell.tsx`, `Splash.tsx`, `FirstRun.tsx`, `WorkstationRoom.tsx`, `AvatarPanel.tsx`, `AvatarOrbit.tsx`, `Cockpit.tsx`, `NotificationBell.tsx` (Lane 1).
- `python-sidecar/*`, `lib/sidecar.ts`, `lib/activation.ts`, `lib/authStorage.ts`.
- `account-app/*`, `partner-app/*` — separate repos.

---

## 4. Target demo / brand references

| Surface | Reference | Strictness |
|---|---|---|
| Settings deck | `desktop/docs/demo-pages.html` Settings section | **CONTRACT** (IG-012) |
| Paywall / Upgrade | `desktop/docs/demo-pages.html` paywall section | **CONTRACT** (IG-012) |
| PublishModal | `desktop/docs/demo-pages.html` publish section | **CONTRACT** |
| Schedule deck | `desktop/docs/demo-pages.html` Schedule section | **CONTRACT** |
| Community deck | `desktop/docs/demo-pages.html` Community section | **CONTRACT** |
| Atmosphere plates | `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md` (Settings = `.deck-settings`, Schedule = `.deck-schedule`) | REFERENCE |
| State plates (empty/error/offline/cmd-k) | `BRAND_ATMOSPHERE_QUEUE.md` §2 | REFERENCE |
| Made-with-Liquid-Clips | `desktop/docs/made-with-liquid-clips-demo.html` | REFERENCE |

---

## 5. Page-by-page UI outcomes

### 5.1 Settings.tsx redesign

**Current state (1923 lines):** Dense settings UI with tabs (Account / Subscription / API keys / Channels-deprecated / Privacy / About / Sign out / etc.). Per audit + UI_POLISH:
- Settings → Connections tab removed; channels live in Schedule → Loadout. Stale copy fixed in places, lingering in others.
- API-keys mount calls `sidecar.secretsStatus()` + `openaiKeyStatus()` on mount (audit P1 — risk of macOS Keychain prompt on Settings open).
- Re-activate CTA already shipped via `activate()` (v0.7.70).

**Cold-customer issues:**
- 1923 lines = too dense; tabs compete for attention.
- API-keys section unmarked as Pro-only vs free-fallback.
- Sign-out button buried; no partial-wipe warning.
- "Manage subscription" + "Upgrade to Solo" routes for signed-in users; signed-out user clicking Upgrade strands per audit P1.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Top-level tab outline | Refactor tab structure to: **Account** / **API keys** / **Privacy** / **About**. Drop deprecated tabs |
| Tab header | Eyebrow + H2 + 1-line sub-copy per tab. Visible at all times so user always knows where they are |
| Account tab | Subscription + Plan + Manage / Upgrade / Sign out. Sign-out button uses `.btn-danger` ghost style |
| API keys tab | Each provider row (OpenAI / Anthropic / GIPHY / Pexels / Pixabay) shows: provider name + green/amber/grey dot + Add key / Edit / Remove |
| API keys mount | **CRITICAL**: defer `sidecar.secretsStatus()` + `openaiKeyStatus()` until tab is actually opened (Lane 5 specs the change; audit P1 deferred-fix). Lane 1 lands the change. Currently called on Settings mount — moving to tab-open prevents passive Keychain prompts on Settings drawer open |
| Privacy tab | Existing copy + links to privacy/terms. `.btn-ghost` for links |
| About tab | Version / build / "Made with Liquid Clips" badge / support email (FailureCard pattern) |
| Sign-out partial-wipe warning | When sign-out is best-effort and keychain delete fails, show a microcopy: "Some items couldn't be cleared from your Keychain. Open Keychain Access to remove them manually." |
| Re-activate | `activate({ via: "browser" })` (v0.7.70 baseline) — preserve |
| Upgrade CTA gating | When signed-out, "Upgrade to Solo" instead routes to `activate({ via: "browser" })` first, then opens Whop checkout on return (audit P1) |
| All buttons | Use Lane 1 button taxonomy |
| Atmosphere plate | `.deck-settings` once Lane 1's CSS hook lands |

**Files:** `Settings.tsx`.

---

### 5.2 UpgradeLockCard.tsx redesign (59 lines today — paywall surface)

**Current state:** Tiny 59-line component used as a paywall placeholder. Per CUSTOMER_JOURNEY audit P1, this is the visible upgrade gate across multiple surfaces.

**Cold-customer issues:**
- Card reads "developer placeholder" not "premium SaaS upgrade".

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Card chrome | `bg-paper-warm border border-fuchsia/40 rounded-2xl p-5 shadow-[var(--glow-md)]` + subtle gradient backdrop |
| Eyebrow | mono-uppercase "Pro unlocks this" |
| H2 | Surface-specific (e.g. "Unlock Projects.", "Unlock Reaction Studio.", "Unlock Hosted AI.") — accept a prop |
| Body | 1-line value prop (accept a prop, with sensible default) |
| Bullet list | 3-bullet feature list (accept prop array) |
| Primary CTA | `.btn-primary` "Upgrade →" — wires to `openUpgradeWhenSignedIn()` for signed-in OR `onSignInClick()` (i.e., `activate({ via: "browser" })`) for signed-out |
| Secondary CTA | `.btn-ghost` "See plans" — opens marketing pricing page (`account.liquidclips.app/upgrade`) |
| Tertiary text-link | "Already paid? Refresh session" → calls `activate({ via: "browser" })` |
| Atmosphere plate | Optional `state-empty-hero.png` at low opacity behind |

**Files:** `UpgradeLockCard.tsx`.

---

### 5.3 PublishModal.tsx (Publish Deck-style chrome)

**Current state (801 lines):** Functional. v0.7.70 added `disabled-reason tooltips. UI_POLISH §4.1 done.

**Cold-customer issues:**
- Modal chrome reads "developer form" — needs platform tile visual hierarchy.
- Channel picker dense.
- Schedule toggle / sequence inputs cramped.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Modal vs side panel | Keep as centered modal for now (true side panel is 2027 vision). Wider: `max-w-[720px]` |
| Header | Eyebrow "Publish" + H2 "Publish to N channels" + close X |
| Platform grid | Visual grid of platform tiles (YouTube / TikTok / Instagram / X / LinkedIn / Facebook). Each tile: PlatformIcon (unified per §5.10) + name + connection status dot (green / amber / red) + last post time (if available) |
| Selected tile | `border-fuchsia bg-fuchsia-soft/30` |
| Channel picker | Compact list per platform |
| Title / Description / Tags | Existing inputs; Lane 1 typography + focus glow |
| Schedule toggle | `.btn-ghost` toggle: Now / Schedule |
| Schedule timing | Inline datepicker + timepicker if Schedule toggled |
| Thumbnail preview | Preserve. Side panel showing the rendered video poster |
| Disabled-reason tooltip | Preserve v0.7.70 disabled-reason logic |
| Publish primary CTA | `.btn-primary` "Publish to N channels" or "Schedule N posts" |
| Cancel | `.btn-secondary` |

**Files:** `PublishModal.tsx`.

---

### 5.4 FailureCard.tsx (email fallback — UI_POLISH §4.3)

**Current state:** "Email support" calls `openExternal(mailto:…)` with `.catch(() => undefined)` — silent fail if no mail client.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Email support button | Replace silent-fail with clipboard fallback: on failure, copy `SUPPORT_EMAIL + prefilled subject/body` to clipboard + inline microcopy "Couldn't open your mail app. Support email copied to clipboard." |
| Add second button | "Copy support email" — always copies, regardless of mail client |
| Body chrome | Use Lane 1's `.error-banner` for the danger header; rest of card uses `.empty-state` style |

**Files:** `FailureCard.tsx`.

---

### 5.5 SidecarCrashOverlay.tsx (chrome polish)

**Current state:** Mounted at root by App.tsx (v0.7.70). Full-screen panic overlay when sidecar dies.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Background | Atmosphere `state-offline.png` plate at 0.6 opacity over `bg-paper` |
| Title | "We lost connection to the engine." |
| Body | "Liquid Clips couldn't talk to its background helper. This usually fixes itself in a few seconds. If it doesn't, restart the app." |
| Primary CTA | `.btn-primary` "Retry" — restart sidecar via existing handler |
| Secondary | `.btn-secondary` "Restart Liquid Clips" — quits + relaunches |
| Tertiary text-link | "Email support" → FailureCard's improved handler |

**Files:** `SidecarCrashOverlay.tsx`.

---

### 5.6 CommunityTab.tsx (empty hero + chat URL — audit §28)

**Current state:** Hub URL correct; per-room flow OK; **no overall empty hero when zero rooms**. Chat URL comment/code mismatch already fixed (v0.7.70).

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Empty hero (when 0 rooms) | New `.empty-state` block: "No rooms available right now." + sub "The Liquid Clips community lives on Whop. Open Whop to join the conversation." + `.btn-primary` "Open Whop community →" calling `openBrowsePanel(WHOP_COMMUNITY_URL)` |
| Existing per-room flow | Preserve. Polish row chrome to match cross-app standard (`flex items-center justify-between gap-3 rounded-lg border …`) |
| `whopChatUrl(channelId)` | Already fixed; preserve |
| Atmosphere plate | `.deck-community` once Lane 1 lands the hook |

**Files:** `CommunityTab.tsx`.

---

### 5.7 Schedule polish (SchedulePage + ChannelsManager + AddChannelModal + ChannelRow + ChannelPicker)

**Current state:** Most mature journey per audit §24. No live polling on ScheduleQueue (correct).

**Cold-customer issues:**
- "Add your first channel" empty state exists but copy could be sharper.
- Channel row chrome inconsistent with bounty row + payout row.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| SchedulePage header | Eyebrow "Schedule" + H1 "Plan your next post." (or similar) + tab strip (Loadout / Queue / Analytics-if-exists) |
| Loadout empty state | "Add your first channel." + sub "Connect a YouTube, TikTok, Instagram, or other social account to start scheduling posts." + `.btn-primary` "Add channel →" |
| ChannelRow | Standardize row chrome (matches bounty/submission/payout row from Lane 4). Status chip: linked = fuchsia-soft / pending = amber / unlinked = neutral / error = danger |
| AddChannelModal | Modal chrome standardized. Buttons use Lane 1 taxonomy. |
| ScheduleQueue empty | "Nothing scheduled yet." + sub "Schedule a post from any clip's Publish menu." + `.btn-secondary` "Open Publish" |
| Manual refresh | Existing button — preserve; use `.btn-ghost` |
| Atmosphere plate | `.deck-schedule` once Lane 1 lands the hook |

**Files:** `schedule/SchedulePage.tsx`, `schedule/ChannelsManager.tsx`, `schedule/AddChannelModal.tsx`, `schedule/ChannelRow.tsx`, `schedule/ChannelPicker.tsx`, `schedule/ScheduleQueue.tsx`.

---

### 5.8 PlatformIcon unification (UI_POLISH §1.2)

**Current state:** Three different platform-glyph sources:
- `desktop/src/components/PlatformIcon.tsx` — canonical mono SVG.
- `desktop/src/components/PlatformBadge.tsx` / `PlatformGlyph` — brand glyph.
- `desktop/src/components/upload/ClipReadyCard.tsx:43` — text fallback "T" for TikTok.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| `ClipReadyCard.tsx` TikTok branch | Import `PlatformIcon` (or inline the canonical TikTok SVG path from `PlatformIcon.tsx:15-19`) so TikTok renders a brand glyph instead of text "T" |
| All other platforms in `ClipReadyCard.tsx` | Preserve (already uses lucide `Instagram` / `Youtube`) |
| Cross-app default | When a surface needs a platform glyph, use `PlatformIcon` (canonical mono SVG). If a brand-colored glyph is needed (limited to certain marketing surfaces), use `PlatformBadge` / `PlatformGlyph` |
| No new icons | Use only what already exists in the repo |

**Files:** `PlatformIcon.tsx`, `upload/ClipReadyCard.tsx`.

---

### 5.9 PoweredByWhop badge click + cursor (UI_POLISH §1.5)

**Current state:** No click handler on PoweredByWhop badge.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Option A (recommended) | Add optional `onClick` prop default `() => openSmart("https://whop.com/liquidclips/")`. Wrap span in a `<button>` when clickable so keyboard users can activate. Small hit target (badge-only). |
| Option B (alternative) | Leave non-clickable with an explicit code comment `// Powered-by attribution, intentionally non-interactive` + `cursor: default` styling |

Lane 5 recommends Option A.

**Files:** `PoweredByWhop.tsx`.

---

### 5.10 NotificationBell mount (Lane 1's domain, but visual chrome here)

If Lane 1 ships Option B (remove dead bell), Lane 5 has nothing to do.
If Lane 1 ships Option A (mount the bell), Lane 5 owns the badge visual chrome.

Coordinate with Lane 1 before either ships.

---

### 5.11 Settings tab-open + lc:checkout-complete event listeners (App.tsx — Lane 1 lands)

Lane 5 specs two App-level changes; Lane 1 lands them in App.tsx:

**`lc:settings-open-tab` listener (UI_POLISH §4.2):**
```ts
// in App.tsx, near the existing settings-open-channels handler
function onSettingsTabOpen(e: Event) {
  const tab = (e as CustomEvent).detail?.tab;
  if (typeof tab !== "string") return;
  setView({ kind: "settings" });
  // Pass initialTab to Settings component
  setSettingsInitialTab(tab);
}
window.addEventListener("lc:settings-open-tab", onSettingsTabOpen);
```

Then in `guardQuota()` at App.tsx:923-954, when `!available` for OpenAI key:
```ts
window.dispatchEvent(new CustomEvent("lc:settings-open-tab", { detail: { tab: "api-keys" } }));
```

Lane 5 spec for Settings: accept `initialTab` prop; render the corresponding tab on mount.

**`lc:checkout-complete` listener (UI_POLISH §1 + audit P1):**
```ts
// in App.tsx, similar handler
function onCheckoutComplete() {
  // Trigger tier refresh
  window.dispatchEvent(new CustomEvent("lc:tier-refresh"));
}
window.addEventListener("lc:checkout-complete", onCheckoutComplete);
```

This makes the "desktop will sync instantly" promise on the checkout success page actually work.

**Files (Lane 1 lands):** `App.tsx`, `Settings.tsx` (Lane 5 owns Settings' initialTab prop).

---

### 5.12 Schedule → Loadout copy migration (final pass)

**Current state (per v0.7.70 preservation inventory):** Most strings updated to "Schedule → Loadout" / "Schedule → Channels". Some stale references may remain.

**Target UI outcomes:**

| File | Verification |
|---|---|
| Any `Settings → Connections` text outside docs/comments | Replace with `Schedule → Loadout` |
| Clickable hint text | Wherever "Schedule → Loadout" appears in user-facing copy, make it clickable to `setView({ kind: "schedule" })` (where feasible) |

**Files:** any file in §2 plus `workbench/AccountBindingChip.tsx`, `clips-feed/InlineScheduler.tsx` (coordinate with Lane 2), `upload/DirectPublishQueue.tsx`, `lib/backend.ts` (error strings — read-only sanity check).

---

## 6. Copy improvements

| Surface | Old | New |
|---|---|---|
| Settings tab labels | (varies) | Account / API keys / Privacy / About — drop deprecated |
| Sign-out partial-wipe | (silent) | "Some items couldn't be cleared from your Keychain. Open Keychain Access to remove them manually." |
| UpgradeLockCard eyebrow | (varies) | "Pro unlocks this" |
| UpgradeLockCard H2 | (placeholder) | Per-surface (prop) — e.g. "Unlock Projects." |
| UpgradeLockCard tertiary | (none) | "Already paid? Refresh session" |
| FailureCard email fallback | (silent fail) | "Couldn't open your mail app. Support email copied to clipboard." |
| SidecarCrashOverlay title | (existing) | "We lost connection to the engine." |
| SidecarCrashOverlay body | (existing) | "Liquid Clips couldn't talk to its background helper. This usually fixes itself in a few seconds. If it doesn't, restart the app." |
| CommunityTab empty hero | (none) | "No rooms available right now." + Whop community CTA |
| SchedulePage empty | (varies) | "Add your first channel." |
| ScheduleQueue empty | (varies) | "Nothing scheduled yet." |
| Settings → Connections (anywhere user-visible) | "Settings → Connections" | "Schedule → Loadout" |

---

## 7. Icons / accents

- Lock icon (lucide `Lock`) on UpgradeLockCard.
- `MailIcon`, `Copy` (lucide) on FailureCard.
- Atmosphere plates apply via Lane 1's CSS hooks.
- Platform glyphs unified per §5.8.

---

## 8. Buttons / cards / tables specific to Lane 5

- All Lane 5 buttons use Lane 1's button taxonomy.
- Settings rows: `flex items-center justify-between gap-3 rounded-lg border border-line/40 bg-paper-elev/40 px-3 py-2.5 hover:border-fuchsia hover:bg-fuchsia-soft/20`.
- Settings tab content: `.empty-state` for empty / `.skeleton` for loading / `.error-banner` for error (Lane 1's classes).
- Lists / tables in Schedule: same row pattern across ChannelRow / queue rows / leaderboard rows / payout rows.

---

## 9. Cold-customer hand-walk for this lane

Run after Lane 5 ships:

- [ ] **Open Settings** → 4 tabs visible (Account / API keys / Privacy / About) with eyebrow + H2 + 1-line sub on each.
- [ ] **No Keychain prompt** on Settings open (API-keys mount no longer enumerates secrets).
- [ ] **Click API keys tab** → only then does the secret presence/status fetch run; provider rows render correctly.
- [ ] **Sign-out** → confirm best-effort wipe + partial-wipe warning if needed.
- [ ] **Upgrade CTA on Settings** → signed-out goes through `activate({ via: "browser" })` first.
- [ ] **Click any locked surface's upgrade CTA** → UpgradeLockCard renders premium chrome with eyebrow + H2 + sub + 3 CTAs.
- [ ] **Publish flow** → open PublishModal → wider modal with platform tile grid + status dots + selected state styling.
- [ ] **PublishModal disabled-reason** → tooltip shows on hover.
- [ ] **FailureCard** → kill sidecar → crash overlay renders calmly (not a stack of red banners).
- [ ] **FailureCard email button** → if no mail client, falls back to clipboard with inline microcopy.
- [ ] **SidecarCrashOverlay** → atmosphere plate visible if asset present; Retry primary CTA works.
- [ ] **CommunityTab on first launch** → if zero rooms, empty hero renders with "Open Whop community" CTA.
- [ ] **Schedule tab** → empty Loadout shows "Add your first channel" with primary CTA.
- [ ] **ScheduleQueue empty** → "Nothing scheduled yet" with secondary CTA.
- [ ] **ClipReadyCard TikTok glyph** → brand glyph, not text "T".
- [ ] **PoweredByWhop badge** → clickable to Whop community (Option A).
- [ ] **No "Settings → Connections" text** anywhere reachable in UI.
- [ ] **`lc:checkout-complete` event** → after Whop checkout completes in browser, desktop tier refreshes automatically.
- [ ] **Validation gates** all green.
- [ ] **No Keychain prompt** at any point.

---

## 10. Cross-lane requests

Lane 5 may need:

- **From Lane 1:** Button taxonomy + state classes (`.empty-state`, `.skeleton`, `.error-banner`); App.tsx `lc:settings-open-tab` listener; App.tsx `lc:checkout-complete` listener; Settings `initialTab` prop wiring (Lane 1 lands the App.tsx side, Lane 5 owns Settings.tsx side).
- **From Lane 2:** PlatformIcon emission consistency across ClipCard's platform chips.

Lane 5 may receive requests from:

- **Lane 3:** UpgradeLockCard signatures (ProjectsLockedScreen could use the new card — verify if better to keep current bespoke locked screen or migrate).
- **Lane 4:** UpgradeLockCard signatures for Earn-locked surfaces.

---

## 11. Validation commands

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
```

The `assert-no-passive-keychain.sh` test is **critical** for Lane 5: the deferral of `sidecar.secretsStatus()` + `openaiKeyStatus()` to tab-open MUST keep the invariant clean.

---

## 12. Iron-gate compliance

- **IG-002** (Sidecar RPC contract): no new RPCs.
- **IG-008** (RoomShell scrollability): all Lane 5 surfaces mount inside `<RoomShell>` — preserve `overflow-y-auto` + `pb-48` clearance.
- **IG-012** (Brand-token parity): no `index.css` change in Lane 5.
- **IG-014** (Auth-keychain invariant): Settings tab-open deferral is the load-bearing fix. `assert-no-passive-keychain.sh` MUST stay clean.

---

## 13. What's NOT in this lane

- Settings 2027 vision (categorized search across settings, Cmd+K, etc.) — defer.
- Paywall A/B test variants — defer.
- Multi-platform copy variants in PublishModal — defer (2027 vision).
- Thumbnail A/B in PublishModal — defer.
- Analytics dashboard — defer.
- Backend deploys (Railway, Vercel) — separate.

---

## 14. Stop condition

Lane 5 ships when:
- All §5 page-by-page outcomes pass.
- §9 hand-walk is green per Daniel.
- §11 validation gates clean (especially `assert-no-passive-keychain.sh` — Settings deferral is the load-bearing change).
- §12 iron-gate compliance verified.
- No `Settings → Connections` user-visible text remains.
- No `openAuthPanel("sign-in")` reintroduced.
- No `account.liquidclips.app/billing` 404 reintroduced.

No commit, push, tag, release, or `latest.json` update without Daniel's explicit per-batch approval.

**End of Lane 5 sub-doc.**
