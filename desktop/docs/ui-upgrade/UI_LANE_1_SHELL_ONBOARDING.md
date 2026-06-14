# UI Lane 1 — Shell + Onboarding

**Lane status:** `START NOW — visual-only, no editor collision`
**Owner:** Kimi A
**Read first:** `desktop/docs/UI_UPGRADE_MASTER_SCOPE.md` (sections 4, 5, 7, 8)
**Iron gates this lane crosses:** **IG-008** (RoomShell scroll), **IG-011** (Earn webview cascade), **IG-012** (brand-token parity), **IG-014** (no passive Keychain reads).
**Validation gates:** `npx tsc -b`, `npm run test:invariant`, `bash scripts/assert-no-passive-keychain.sh`, plus `bash scripts/brand-kit-drift-check.sh` if `src/index.css` is touched.

---

## 1. Scope

Lane 1 owns the **app shell** (left rail, room shells, cockpit wrapper, atmosphere CSS hooks), the **cold-launch flow** (Splash, FirstRun), and the **top-right HUD** (AvatarPanel, AvatarOrbit, NotificationBell mount decision). It defines the **button taxonomy and atmosphere CSS classes** that all other lanes consume.

Lane 1 ships **first** or in parallel with Lanes 3/4/5; the other lanes depend on the CSS contract Lane 1 lands.

---

## 2. Files owned by this lane

| File | Why |
|---|---|
| `desktop/src/App.tsx` | navigation routing root; atmosphere CSS class application per view |
| `desktop/src/index.css` | atmosphere `::before` hooks; button taxonomy classes; new shared state classes |
| `desktop/src/components/nav/SideNav.tsx` | left rail |
| `desktop/src/components/nav/SideNavItem.tsx` | rail item |
| `desktop/src/components/cockpit/RoomShell.tsx` | room scroll/atmosphere wrapper |
| `desktop/src/components/cockpit/WorkstationRoom.tsx` | workspace tile surface |
| `desktop/src/components/Cockpit.tsx` | room shell wrapper |
| `desktop/src/components/Splash.tsx` | intro splash + dismiss persistence (IG-003 locked; visual chrome only) |
| `desktop/src/components/FirstRun.tsx` | onboarding flow |
| `desktop/src/components/cockpit/AvatarPanel.tsx` | top-right HUD avatar drawer |
| `desktop/src/components/cockpit/AvatarOrbit.tsx` | top-right orbit |
| `desktop/src/components/NotificationBell.tsx` | mount decision (or formal removal) |
| `desktop/src/components/Greeting.tsx` (if exists) | greeting line on Workstation |

## 3. Files forbidden to this lane

- All editor-blocked files in master §7 (ClipCard, ClipPreview, ReactionControls, OverlaySourcePicker, ClipsBulkToolbar, InlineScheduler, masterClipActions, useGlobalBakeEvents, BottomCockpit).
- All `components/projects/*` (Lane 3).
- All `components/earn/*` (Lane 4).
- `components/Settings.tsx`, `UpgradeLockCard.tsx`, `PublishModal.tsx`, `PlatformIcon.tsx`, `CommunityTab.tsx`, `schedule/*`, `FailureCard.tsx`, `SidecarCrashOverlay.tsx` visual chrome (Lane 5).
- All `python-sidecar/*`, `lib/sidecar.ts`, `lib/activation.ts`, `lib/authStorage.ts`.

If Lane 1 needs a change inside another lane's territory, raise a "Cross-lane request" in this doc's §10 before implementing.

---

## 4. Target demo / brand references

| Surface | Reference | Strictness |
|---|---|---|
| Workstation Room tile grid | `desktop/docs/demo.html` workspace section | **CONTRACT** (IG-012) |
| Sidebar / global shell | `desktop/docs/demo-pages.html` rail section | **CONTRACT** (IG-012) |
| Atmosphere plates | `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md` (5 deck plates) | **CONTRACT** (CSS hook table) |
| Brand kit (tokens, type, motion) | `~/.claude/skills/liquid-clips-brand-kit/SKILL.md` + `desktop/src/index.css` `@theme` block | **CONTRACT** |
| Cockpit visual language | `desktop/docs/cockpit-handoffs-demo.html` | REFERENCE |
| Workstation legacy demo | `desktop/docs/cockpit-v2-demo.html` | REFERENCE (older) |

Lane 1's golden rule: **brand-token drift = ship blocker.** Any change to the 8 IG-012 hexes in `src/index.css` must mirror to all `docs/demo*.html` IG-012 sentinels in the same commit, or `brand-kit-drift-check.sh` refuses.

---

## 5. Page-by-page UI outcomes

### 5.1 First-launch / onboarding intro (Splash + FirstRun)

**Current state (per `Splash.tsx` 413 lines + audit):** Splash mounts intro video (IG-003 locked — do not change asset paths or fire-once-per-session logic); FirstRun renders the sign-in card.

**Cold-customer issues:**
- Splash fires once but the dismiss button copy / placement is generic.
- FirstRun shows two CTAs (Sign in / Sign in via browser); first-time users don't know which one to pick.
- After successful activation, the user lands on Workspace with no guided next step.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Splash dismiss | "Skip intro" with mono-uppercase eyebrow chip styling, fuchsia text, opacity 0.6, top-right of intro container |
| FirstRun card hierarchy | Eyebrow "Liquid Clips" + display H1 "Sign in to start clipping" + 1-sentence sub + ONE primary CTA "Continue with browser" + ONE secondary text-link "Sign in via the app" |
| FirstRun OpenAI key panel | Move to Settings → API keys; FirstRun should not prompt for OpenAI key on first run (per UI_POLISH §4.2 + audit P0) |
| Post-activation landing | Workstation Room shows the welcome greeting + 4 tiles + a one-time "Start here" pointer on the Create tile that auto-dismisses on first click |
| Welcome greeting copy | "Welcome back, {firstName}." (existing); add cold-customer variant "Welcome to Liquid Clips. Drop a video or paste a URL to get started." when `clips_total === 0` |

**Files likely to change:** `Splash.tsx` (visual chrome only — preserve IG-003 contract), `FirstRun.tsx`, `WorkstationRoom.tsx`, `Greeting.tsx` (if exists; otherwise inline in WorkstationRoom).

**Logic touch?** Cosmetic only. The `clips_total` check requires reading from existing sidecar state; no new RPC.

**Cold-customer next action:** "Drop a video or paste a URL" — always visible.

---

### 5.2 Sidebar / global shell (SideNav + SideNavItem + AvatarPanel + AvatarOrbit)

**Current state (per `SideNav.tsx` 159 lines + master vision §2.1):** 7-item left rail (Workspace, Library, Earn, Learn, Schedule, Community, Settings). Pixel-art badges. Collapsible.

**Cold-customer issues:**
- Rail badges are static — no indication that Workspace is processing, that Earn has new bounties, or that the inbox has unread notifications (NotificationBell is hidden behind `{false && ...}`).
- AvatarOrbit `notificationCount` is hardcoded to `0` so badge never appears.
- Collapsed rail offers no per-badge label hint.
- Keyboard `Cmd+1` through `Cmd+7` jumps are documented in 2027 vision but not implemented.

**Target UI outcomes (this lane, immediate ship):**

| Element | Outcome |
|---|---|
| Rail item active state | Existing fuchsia underline / outer glow — preserve |
| Rail item hover | Subtle scale-[1.02] over 120ms ease; show label in tooltip if rail is collapsed |
| Workspace badge micro-state | When `pipelineStagesFor(view)` reports any active run, badge shows a small 16px SVG progress ring around the icon |
| Library badge micro-state | When the AppData broadcast `lc:library-refresh` has fired since last visit (track via `localStorage.getItem("lc:library-last-visit")`), show a 6px fuchsia dot |
| Earn badge micro-state | When the personal layer has unseen bounties since last visit, show a 6px fuchsia dot |
| Settings badge micro-state | When OpenAI key is missing OR a channel is in `error` state, show an amber 6px dot |
| AvatarOrbit `notificationCount` | Wire to a real count: sum of (unread inbox messages) + (failed bakes since last open). If the helper doesn't exist, render the badge only when count > 0; do NOT hardcode 0 (per UI_POLISH §3.2) |
| NotificationBell | Decision: **remove** the `{false && <NotificationBell />}` and document that the inbox is opened from AvatarPanel's HUD button (per audit P1, UI_POLISH §3.1 Option B). Inbox icon stays in AvatarPanel header |
| Keyboard | NOT in this lane's scope. Defer to a future polish pass. |

**Atmosphere plate mounting:**
- Add `.deck-workspace`, `.deck-clips`, `.deck-earn`, `.deck-schedule`, `.deck-settings`, `.deck-community`, `.deck-learn` classes to the RoomShell wrapper based on `view.kind`.
- Add the `::before` CSS hooks per `BRAND_ATMOSPHERE_QUEUE.md` §1.
- If the plate assets are NOT yet on disk (`src/assets/atmospheres/*.png`), gate the `background-image` URL behind a `data-atmosphere-ready="true"` attribute set when the file exists; otherwise leave the deck without a plate (graceful absence).
- The asset-generation queue is a SEPARATE lane (not Lane 1's responsibility); Lane 1 only ships the CSS hooks.

**Files likely to change:** `SideNav.tsx`, `SideNavItem.tsx`, `AvatarOrbit.tsx`, `AvatarPanel.tsx`, `App.tsx` (remove `{false && ...}` wrap around NotificationBell + `notificationCount` wiring), `Cockpit.tsx` (room class injection), `RoomShell.tsx`, `index.css` (deck classes + atmosphere hooks).

**Logic touch?** Mostly visual; the AvatarOrbit count and Library/Earn dot wiring need a small read of existing state (inbox count + library-last-visit localStorage).

**Cold-customer next action:** Each sidebar item answers "click me to get to X" without prior knowledge.

---

### 5.3 Workstation Room (home / empty Workspace)

**Current state (`WorkstationRoom.tsx` 368 lines):** 4 tiles (Create, Import, Thumbnails, Script). HUD bracket corners. Greeting. Sponsored carousel below. Drag overlay.

**Cold-customer issues:**
- Greeting is friendly but doesn't tell a first-timer where to click.
- Sponsored banner carousel can be empty or loading; nothing distinguishes "Loading…" from "No campaigns".
- Drag overlay is brand-correct but only triggers on `dragHoverActive`; cold customer doesn't know dropping is an option until they try.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Welcome greeting | "Welcome back, {firstName}." (existing) OR cold-customer fallback "Welcome to Liquid Clips." when no prior projects |
| 4 tiles | Preserve existing structure; tiles use `library-card` HUD bracket pattern (IG-007 sibling). Tile labels: Create / Import / Thumbnails / Script (existing) |
| Cold-customer hint | Below the tiles, one-line mono-uppercase eyebrow: `or drop a video anywhere on this screen` — visible at all times, not just on drag-over |
| Sponsored carousel | If `publicSponsoredCampaigns.length === 0` after load, hide the carousel section entirely (don't show empty "Sponsored" header) |
| Sponsored carousel loading | Skeleton row of 3 dashed tiles using `animate-pulse` (Lane 5 will define the shared skeleton class; Lane 1 applies it here) |
| Drag overlay | Existing `<DropOverlay>` (or atmosphere plate `interaction-drop-target.png` when asset lands) — preserve |
| Greeting timing | Re-render on `lc:tier-refresh` so the post-sign-in greeting updates without a manual reload |

**Files likely to change:** `WorkstationRoom.tsx`.

**Logic touch?** Read-side only (existing state).

**Cold-customer next action:** "Click Create or drop a video here."

---

### 5.4 NotificationBell + Avatar HUD inbox decision

Per audit P1 and UI_POLISH §3.1, decide one of:

- **Option B (recommended):** Delete the dead `{false && <NotificationBell />}` from `App.tsx`. Delete `NotificationBell.tsx` if no other call site uses it. The inbox is opened from AvatarPanel's existing HUD button.
- **Option A (only if there's a reliable unread-count source):** Mount the bell in the header; bind to the count source.

Lane 1 should ship Option B in this pass — Option A is a separate post-shell lane.

**Files:** `App.tsx`, `NotificationBell.tsx` (delete or preserve), `AvatarPanel.tsx` (ensure inbox open button is visible).

---

### 5.5 Button taxonomy contract (defined here, applied everywhere)

Lane 1 lands **shared CSS classes** in `index.css` so all other lanes apply them without redefining. Proposed naming:

```css
/* Primary CTA — fuchsia pill */
.btn-primary { @apply inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-semibold text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-50 disabled:cursor-not-allowed; }

/* Secondary CTA — outlined pill */
.btn-secondary { @apply inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50; }

/* Ghost CTA */
.btn-ghost { @apply inline-flex items-center gap-1.5 rounded-full bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-text-secondary transition-colors hover:border-fuchsia hover:text-ink disabled:opacity-50; }

/* Destructive */
.btn-danger { @apply inline-flex items-center gap-1.5 rounded-full border border-transparent bg-transparent px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-50; }

/* Locked / Pro */
.btn-locked { @apply inline-flex items-center gap-1.5 rounded-full border border-fuchsia/50 bg-fuchsia-soft/30 px-4 py-2 font-sans text-[13px] font-semibold text-fuchsia-deep transition-colors hover:bg-fuchsia-soft/50; }
```

Other lanes adopt these classes incrementally; no lane is required to refactor every existing button in v0.7.77, but **all new buttons MUST use these classes**.

**IG-012 mirror:** the canonical demos `docs/demo.html` and `docs/demo-pages.html` already use the underlying classes Tailwind composes from these `@apply`s; the drift-check script reads tokens, not utility-class composition, so this addition is safe.

---

### 5.6 Empty / loading / error state contract (defined here, applied everywhere)

Lane 1 also ships these shared classes (Lane 5 will use them on individual states):

```css
/* Skeleton rectangle */
.skeleton { @apply animate-pulse rounded bg-paper-elev/60; }

/* Empty state container */
.empty-state { @apply rounded-2xl border border-dashed border-line bg-paper-elev/40 p-6; }

/* Inline error banner */
.error-banner { @apply flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-3 font-sans text-[13px] text-[var(--color-danger)]; }
```

---

## 6. Copy improvements

| Surface | Old copy | New copy |
|---|---|---|
| FirstRun primary CTA | "Sign in →" | "Continue with browser →" |
| FirstRun secondary | "Sign in via browser" | "Sign in via the app" |
| Workstation cold greeting | "Welcome back, …" only | "Welcome to Liquid Clips." when no prior projects |
| Workstation drop hint | (none visible) | "or drop a video anywhere on this screen" |
| Splash dismiss | "Skip" | "Skip intro" |

No `openAuthPanel("sign-in")` may be reintroduced. No "Continue session" — use "Refresh session" if such copy is needed downstream (Lane 4's territory).

---

## 7. Icons / accents

- Sidebar pixel-art badges: **preserve**. Do not replace with lucide.
- Rail micro-state dots: 6px fuchsia or amber circle, positioned bottom-right of badge.
- Workstation tiles: existing HUD bracket pattern (`library-card-corner-*`).
- Atmosphere plates: per `BRAND_ATMOSPHERE_QUEUE.md` table; CSS hooks landed even if assets missing.

---

## 8. Buttons / cards / tables specific to Lane 1

- Splash + FirstRun use `.btn-primary` + `.btn-secondary`.
- Workstation tiles are NOT buttons in the taxonomy — they're tiles. Preserve their HUD bracket chrome.
- AvatarOrbit + inbox button: existing chrome — preserve.
- NotificationBell: delete unless wired.

No tables in Lane 1.

---

## 9. Cold-customer hand-walk for this lane

Run against `/Applications/Liquid Clips.app` after Lane 1 ships:

- [ ] **Cold boot signed-out** → Splash plays once → Skip intro visible top-right of intro container → click skip → FirstRun appears.
- [ ] **FirstRun primary CTA reads** "Continue with browser →" → click → system browser opens → complete Clerk sign-in → deep-link returns → Workspace mounts with welcome greeting.
- [ ] **Sidebar** → 7 rail items visible. Each item label appears as tooltip when rail is collapsed.
- [ ] **Rail micro-states** → start a pipeline → Workspace badge shows progress ring; visit Library, return to Workspace → Library badge dot disappears.
- [ ] **AvatarOrbit** → if inbox is empty AND no failed bakes, no badge appears. If 1 unread, badge shows "1".
- [ ] **NotificationBell** → no dead bell visible anywhere; inbox accessible from AvatarPanel.
- [ ] **Workstation greeting** → reads "Welcome to Liquid Clips." on cold install; "Welcome back, …" once `clips_total > 0`.
- [ ] **Workstation drop hint** → mono-uppercase line below tiles reads "or drop a video anywhere on this screen" at all times.
- [ ] **Atmosphere plates** → if assets present, deck atmosphere visible at low opacity behind RoomShell content; if assets missing, deck loads cleanly without broken-image icons.
- [ ] **Button consistency** → primary CTAs across Splash + FirstRun + Workstation use `.btn-primary` class with consistent hover glow.
- [ ] **Brand-kit drift** → `bash scripts/brand-kit-drift-check.sh` passes.
- [ ] **No Keychain prompt** at any point in the walk.

---

## 10. Cross-lane requests

Lane 1 may need:

- **From Lane 5:** None expected; Lane 1 owns Splash/FirstRun chrome.
- **From Lane 4:** None expected.
- **From Lane 3:** None expected.

Lane 1 may receive requests from:

- **Lane 5:** Settings tab-open event listener in `App.tsx` (for routing missing-OpenAI-key path). Lane 5 specs the change; Lane 1 lands the listener.
- **Lane 5:** `lc:checkout-complete` listener in `App.tsx`. Lane 5 specs; Lane 1 lands.
- **Lane 5:** Mounting `<SidecarCrashOverlay />` is already done by sibling session at v0.7.70 — preserve.

If Lane 1 implements these on Lane 5's behalf, Lane 5's lane doc must reference the exact handler signature Lane 1 ships.

---

## 11. Validation commands

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
bash scripts/brand-kit-drift-check.sh   # if index.css touched
```

All four MUST stay green. No Tauri build or local-install without Daniel's explicit per-batch approval.

---

## 12. Iron-gate compliance

- **IG-003** (Cinematic intro): Splash visual chrome may change copy / dismiss styling; intro asset paths + dismiss persistence MUST NOT change.
- **IG-008** (RoomShell scrollability + BottomCockpit clearance): RoomShell `overflow-y-auto` + `items-[safe_center]` + `pb-48` clearance MUST stay. Lane 1's atmosphere additions are `::before` pseudo-elements behind content — no flex / overflow change.
- **IG-011** (Earn webview cascade): `<RoomShell roomKey="earn" align="stretch">` MUST stay. Lane 1's atmosphere class applies to the same RoomShell wrapper but does not change `align`.
- **IG-012** (Brand-token parity): every change to `src/index.css` IG-012 sentinel range must mirror to `docs/demo*.html` IG-012 sentinels. `brand-kit-drift-check.sh` enforces.
- **IG-014** (Auth-keychain invariant): Lane 1 introduces NO Keychain reads. `assert-no-passive-keychain.sh` + `test:invariant` must stay clean.

---

## 13. What's NOT in this lane

- Command palette (`Cmd+K`) — defer.
- Context strip (breadcrumb + ambient status bar) — defer.
- Multi-window support — defer.
- Onboarding tutorial overlay — defer.
- New atmosphere asset generation — separate asset lane (gpt-image-1 queue).
- Lane 2 / Lane 3 / Lane 4 / Lane 5 work — strictly out of scope.

---

## 14. Stop condition

Lane 1 ships when:
- All §5 page-by-page outcomes pass.
- §9 hand-walk is green per Daniel.
- §11 validation commands all clean.
- §12 iron-gate compliance verified.
- Cross-lane requests in §10 are resolved.

No commit, push, tag, release, or `latest.json` update without Daniel's explicit per-batch approval.

**End of Lane 1 sub-doc.**
