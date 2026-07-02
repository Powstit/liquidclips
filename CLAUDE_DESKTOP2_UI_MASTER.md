# Liquid Clips Desktop 2 — UI/UX master implementation contract

> **Status:** UI IMPLEMENTATION READY FOR INTEGRATION · NOT RELEASED  
> **Repository:** `/Users/dipdip/code/jnr`  
> **Surface:** `/Users/dipdip/code/jnr/desktop-2`  
> **Isolated execution worktree:** `/Users/dipdip/code/jnr-codex-ui`  
> **Execution branch:** `codex/ui-end2end`  
> **Prepared:** 2026-07-02 (Europe/London)  
> **Owner:** Claude  
> **Current executor:** Codex (isolated from Claude's in-flight checkout)  
> **Authority:** This document governs UI/UX implementation.  
> **Higher authority:** `CLAUDE_DESKTOP2_RELEASE_MASTER.md` governs correctness,
> testing, release readiness, and deployment.

This document converts Daniel’s UI review notes and approved HTML mockups into
an exact implementation contract. It is not permission to deploy. It is not
permission to replace working application logic with mock data. The finished
application must both look like the approved direction and work end to end.

## Coordination checkpoint — Claude continue, 2026-07-02

Claude is **not release-finished**. The latest Claude checkpoint is
`partial-green`: its focused Workstation work passes, but its recorded full
suite is `46 passed / 18 failed / 0 skipped`. Do not claim completion or
deployment readiness from that checkpoint.

Codex does not need Claude to finish the UI implementation. Codex owns the UI
completion branch in `/Users/dipdip/code/jnr-codex-ui` until it supplies a
tested commit. Claude may continue release-master, backend, native-runtime, and
other non-overlapping release work in this checkout. Do not copy individual UI
files between worktrees or independently restyle the Codex-owned surfaces.

When Codex supplies the final UI handoff:

1. Integrate the complete commit, not selected source files.
2. Include every tracked brand asset in that commit, especially
   `desktop-2/public/brand/**`; do not omit the stage icons, Settings art,
   invader artwork, or branded QR asset.
3. Preserve the UI-master evidence and tests included by the commit.
4. Rerun all release-master gates after integration. The Codex handoff is not
   permission to deploy by itself.

### Ready-state handoff to Claude

The UI handoff is ready:

- Branch: `codex/ui-end2end`
- Implementation commit:
  `9bf37fd70a7f406684223683c53b80938f62fbd8`
- Frozen production Playwright result: `78 passed / 0 failed / 0 skipped`
  in `27.7m`, serial (`--workers=1`)
- Build: green
- Shell contracts: `119 passed / 0 failed`
- Brand drift and Agency paywall iron gates: green
- Rust `cargo check`: green with the previously classified unused
  `ManifestEnvelope` field warning only

Important integration constraint: the implementation commit includes the
uncommitted Claude working-tree snapshot that was copied when the isolated
worktree was created, plus Codex's UI work. Do not cherry-pick it blindly onto
an uncommitted checkout and do not copy selected files.

Claude must:

1. Commit the current `/Users/dipdip/code/jnr` work on its own branch first.
2. Inspect `git show --stat 9bf37fd` and then merge
   `codex/ui-end2end`, resolving overlaps in favour of Claude's later
   correctness fixes while preserving the UI contracts and tests.
3. Verify that the merge includes every path under
   `desktop-2/public/brand/icons/stages/`,
   `desktop-2/public/brand/settings/`, and
   `desktop-2/public/brand/invaders/invader-classic.png`.
4. Preserve `CLAUDE_DESKTOP2_UI_MASTER.md`, its evidence, and the new E2E
   suites.
5. Rerun the release-master gates from the merged state. UI green does not
   close packaged-native, real-account/Whop, physical-phone QR scan, or user
   visual-approval gates.

## 0. Required reading and authority order

Before editing:

1. Read `CLAUDE_DESKTOP2_RELEASE_MASTER.md`, including the mandatory in-flight
   correction checkpoint.
2. Read this entire UI master.
3. Inspect the current working-tree diff. Preserve all existing work.
4. Inspect every approved mockup listed below in a browser.
5. Inspect the real Desktop 2 component and state flow that each mockup will
   replace.

When documents disagree:

1. Functional correctness, truthful tests, accessibility, data integrity, and
   release gates in `CLAUDE_DESKTOP2_RELEASE_MASTER.md` win.
2. Explicit user-approved visual decisions in this UI master win over an
   agent’s later aesthetic preference.
3. Existing product behaviour must be preserved unless this document
   explicitly changes it.
4. A mockup is visual intent, not evidence that production behaviour exists.

Do not deploy, tag, promote a runtime, or claim release readiness while
implementing this document.

## 1. Source-of-truth mockups

These nine HTML states were reviewed during the design session:

```text
/tmp/lc-mockups/workstation-clipper.html
/tmp/lc-mockups/workstation-clipper-split.html
/tmp/lc-mockups/community-chat.html
/tmp/lc-mockups/chat-room.html
/tmp/lc-mockups/settings-clipper.html
/tmp/lc-mockups/settings-agency.html
/tmp/lc-mockups/earn-affiliate.html
/tmp/lc-mockups/chat-moderation.html
/tmp/lc-mockups/tokens.css
```

Observed SHA-256 hashes:

```text
workstation-clipper.html
6f1818f23a960c9551b228036fab11e458cdf7906568c15bde103a17cfc12225

workstation-clipper-split.html
0b4d445c5c24147f9ba091d9bc7c8752dad7e4e735beff06c15f2bebcb79f46e

community-chat.html
c3c03d85c3bfb16d09a1f857396e751a74b46a99bb878e73be691e0e0e1ae2cd

chat-room.html
f63e20753479591d1075cd4ffd64625f9af950cb1c347c504755c66c547b911a

settings-clipper.html
15decdd9aec6b20fac872615df29de667481c1e512797bc642f59b8a67b2eee9

settings-agency.html
257313d460ed43245e59a81d9a3c19aad9970c592d7223ba4f386bba53c75e08

earn-affiliate.html
e27f83cd7cc9d3cf10fdc2cbb399e8ecfc111cdaa08ea6710b031a01f2806449

chat-moderation.html
ac2933be1759fa04b8652e6cb70d25196d298c2729f62746e03d06f0f05f6606

tokens.css
7278ebc7623a2a3df3e23654b1f2c6ee8c9417adcf71104d465979f8d6538a98
```

### Preserve them before implementation

Before changing production UI:

1. Verify the hashes.
2. Copy the mockups and `tokens.css` into a tracked repository reference
   directory:

```text
desktop-2/docs/ui-master/mockups/
```

3. Add a short README stating that these are approved visual references, not
   production application code.
4. Render each at `1440×900` and preserve a reference PNG beside it.
5. Record any hash mismatch. Do not silently accept a different mockup.

Do not import the mockup HTML directly into production. Rebuild the approved
layout with existing React components, real stores, real routes, real events,
and existing design tokens.

## 2. Daniel’s locked design decisions

These are not suggestions:

- Less is more.
- Use whitespace to create seriousness and confidence.
- Do not fill empty space with decorative boxes.
- No generic “AI-looking” pink square grids.
- Use the existing Liquid Clips fuchsia/cyan/ink system consistently.
- Use Kade and the invader assets purposefully; do not scatter them as filler.
- Use real product states and real assets, not text inside fake rectangles.
- Typography must be consistent with the application.
- Clips are the hero of My Clips. Surrounding chrome must not suffocate them.
- Cards must never touch, merge visually, overlap, or have hidden bottoms.
- Split-screen output must be a true, rigid vertical or horizontal composition.
- The two split panes represent two independently controllable clips/videos.
- Community is an open Kade-led chat experience, not a decorative room grid.
- Users can see how many clippers are online and set themselves online/offline.
- Agency owners can have one private chat room per campaign.
- Settings must become a compact, navigable cockpit instead of a giant page.
- Affiliate tools belong naturally inside Earn and Settings.
- QR presentation uses the Liquid Clips invader asset.
- HTTP(S) account, billing, Whop, wallet, and affiliate journeys stay inside
  the application browser overlay whenever technically supported.
- The final application must remain enjoyable and obvious to a first-time
  clipper, not merely render without errors.

## 3. Global visual system

### 3.1 Typography

- Use the application’s existing Inter/Geist and Geist Mono stack.
- Do not introduce another font.
- Use Inter/Geist for readable interface copy and Geist Mono for labels,
  metadata, status, handles, scores, and technical readouts.
- Body copy must remain readable at the minimum supported window.
- Avoid text below `11px` except nonessential micro-labels; those must remain
  at least `9.5px` with adequate contrast.
- Do not use excessive letter spacing on sentences.
- Clamp only where an explicit expand affordance exists.
- Never allow per-character wrapping, `overflow-wrap: anywhere`, accidental
  vertical labels, or text collision.

### 3.2 Colour and hierarchy

- Fuchsia is the primary clipper/action accent.
- Cyan identifies agency/system-secondary states.
- Green means live/online/success only.
- Amber means warning/processing attention.
- Red means destructive/error only.
- Keep the canvas predominantly dark ink with restrained glow.
- One primary accent per component. Avoid simultaneous fuchsia, cyan, green,
  amber, and red unless each communicates a distinct state.
- Text contrast must satisfy WCAG AA for normal interface copy.

### 3.3 Spacing and cards

- Every card has a visible boundary at rest.
- Adjacent cards must have unambiguous negative space.
- Shadows cannot bleed so far that separate cards appear joined.
- Hover transforms must not collide with siblings.
- Use `isolation`, controlled z-index, and adequate grid gaps where needed.
- Card bottoms must remain visible before the next row begins.
- No absolute-positioned content may escape a card without an intentional
  portal/overlay.
- No content may depend on a fixed desktop height to remain visible.

### 3.4 Icons and assets

- Prefer existing SVG icons under `desktop-2/public/brand/`.
- Final UI controls must not use emoji where an existing brand/action icon
  exists.
- Keep icon stroke, optical weight, and bounding boxes consistent.
- Use these approved new Settings assets:

```text
public/brand/settings/devices.svg
public/brand/settings/notifs.svg
public/brand/settings/advanced.svg
public/brand/settings/roster.svg
public/brand/settings/qr-frame-bezel.png
```

- Use `public/brand/invaders/invader-classic.png` as the QR centre brand mark.
- Kade images must preserve face/head framing and must not be awkwardly cropped.
- Every informative image requires meaningful alternative text; decorative
  assets use empty alt text.

### 3.5 Motion

- Motion communicates state or focus; it is not constant decoration.
- Respect `prefers-reduced-motion`.
- Hover animation should normally finish within `120–220ms`.
- Loading animation must have a static fallback.
- No layout shift when a loader, thumbnail, GIF, score, or badge arrives.

### 3.6 Interaction and accessibility

- Every clickable card is keyboard reachable and exposes button/link semantics.
- Every icon-only control has an accessible name and tooltip.
- Focus rings remain visible against the dark canvas.
- Popovers, drawers, GIF sheets, and menus trap/restore focus correctly.
- Escape closes the topmost dismissible layer.
- Touch/click targets should be at least `36×36px` in the desktop shell.
- Do not remove the semantic route-title `<h1>`; it may be visually hidden when
  the approved layout does not need a visible duplicate heading.

## 4. Responsive contract

Every implemented state must be visually and behaviourally tested at:

```text
1040×680
1280×820
1440×900
```

Also inspect one high-density/wide desktop size used by the local machine.

At every target size:

- No unintended horizontal page scrollbar.
- One obvious scroll owner per region.
- No scroll trap.
- The final action and final card are reachable.
- Sticky/docked UI does not cover content.
- Text remains horizontal and readable.
- Drawers fit within the viewport.
- Popovers and menus remain on screen.
- Keyboard traversal reaches every primary action.
- Loading, empty, error, locked, offline, and populated states remain usable.

Do not use viewport media queries to solve a component-width problem. Use a
container on the component’s parent and query descendants. Never declare a
container on an element and attempt to query that same element.

## 5. Stage 1 — Workstation/My Clips

### 5.1 Product hierarchy

The clip grid is the primary product. Above-grid chrome must be compressed to
the minimum required to understand and control the project.

Approved wide layout:

- Sidebar remains `244px`.
- A single compact toolbar row approximately `32px` high:
  `[Active project title · LIVE indicator · 6/6 pill · chevron]`.
- “Run controls,” “Clear session,” and “Last source” live in an explicit
  collapsed disclosure, not a permanent tall strip.
- Remove the duplicate “CLIPS · SELECTED” band.
- Filters remain in one compact row where space permits:
  clip count, source, best-bits toggle, and Generate more.
- Keep a semantic visually-hidden Workstation `<h1>`.

### 5.2 Clip grid

Approved `1440×900` direction:

- Four columns when the available content width permits.
- Cards use `aspect-ratio: 4 / 5`.
- Row gap is `140px`.
- Column gap remains visibly separate; approved mockup used approximately
  `22px`.
- The bottom of row one must be fully visible before row two begins.
- Each card is isolated on all sides and never visually connected to another.
- At narrower widths reduce column count; never squeeze card copy or overlap.
- The grid/main panel owns vertical scrolling.
- Opening/closing the inspector preserves grid scroll position.

The `140px` row separation and `4:5` card ratio were explicitly approved after
multiple overlap corrections. Do not revert to `9:16` cards in the grid. The
exported clip may remain `9:16`; the library card is a usable preview tile.

### 5.3 Clip-card states

Each real card must support:

- Thumbnail available.
- Thumbnail pending with a stable nonblank fallback.
- Processing with the approved bug/Kade loader, stage, and progress.
- Completed.
- Selected.
- Hover/focus.
- Error with retry.
- Locked/paywalled action where applicable.

Required affordances:

- A visible play affordance appears on hover and keyboard focus.
- Score and status remain readable.
- Hover/focus does not shift neighbours.
- The whole card may open preview, but it must expose correct semantics.
- Do not decode/play six videos inside grid tiles. Use image/poster previews.

### 5.4 Preview, inspector, and editor

State model:

- `focusedClip`: selection.
- `inspectorOpen`: preview/details.
- `editorOpen`: Cockpit/editor dock.

Selecting a card opens preview intent, not every editing surface.
Only Edit, Schedule, or Export opens the relevant editor action.

Desktop:

- Results plus an approximately `300–340px` inspector when open.
- The preview layout responds to its actual container width.

Compact:

- Results remain full width.
- Inspector becomes a dismissible right drawer.
- Closing the drawer restores focus to the originating card.

Editor dock:

- Begins at the content boundary, not beneath the sidebar.
- Maximum expanded height around `40dvh`.
- Own internal scroll.
- Final clip can scroll fully above it.
- Current phase and actions remain reachable at all target sizes.

### 5.5 Rigid split-screen composition

Approved layouts include:

- Top/bottom: Pane A exactly top 50%, Pane B exactly bottom 50%.
- Side/side: Pane A exactly left 50%, Pane B exactly right 50%.
- Facecam: base clip fills the frame; secondary clip is a clearly bounded
  corner frame.

For top/bottom and side/side:

- Both media elements fill their pane (`width:100%; height:100%`).
- Use an intentional `2–2.5px` fuchsia divider.
- No floating mini-images, empty bands, partial fills, or natural-image sizing.
- Pane A and Pane B are independent source slots.
- Users can assign two separate clips/videos.
- Each pane has independent play, seek, and mute.
- Users can replace/swap one pane without replacing the other.
- Provide Swap A ↔ B.
- Provide optional synchronized playback.
- Labels clearly identify A and B without covering important content.
- The composed result exports as one new output file.
- Export must use the same crop, divider, timing, and audio choices previewed.

Required production tests:

- Two different source IDs remain distinct.
- Independent seek/mute state does not leak between panes.
- Swapping changes both preview and export mapping.
- Sync starts both panes deterministically.
- Export produces one playable file.
- Reopening the saved composition restores both sources and settings.

### 5.6 Workstation proof

Before Stage 1 can be called complete:

- Render running, completed, zero-result, error, and split-source states.
- Capture screenshots at all target sizes.
- Prove cards do not overlap using bounding-box assertions.
- Prove every row gap is positive and card rectangles do not intersect.
- Prove the card-bottom/next-row-top gap matches the approved direction.
- Prove the list scrolls to the final clip.
- Open a real clip, preview it, edit it, save it, and find it again in My Clips.
- Export a real two-source split and play the resulting file.

## 6. Stage 2 — universal in-app browser handoff

The partially implemented `src/lib/openInApp.ts` must be audited, not assumed
complete.

Rules:

- `http:` and `https:` open in the application’s BrowseOverlay.
- Whop login/checkout, account, billing, wallet, memberships, affiliate,
  campaign rewards, activation, and admin URLs use the same in-app path.
- `mailto:` and `tel:` may use the operating system.
- Filesystem paths may open Finder/native tools intentionally.
- An unavailable overlay may use one documented safe fallback.
- Redirects, OAuth completion, deep links, close, back, reload, and error
  recovery must work.
- Authentication cookies persist according to the approved security model.
- Never claim “the user never leaves the app” unless every supported call site
  and redirect path is tested.

Contract-test every call site and conduct one real Whop/account journey.

## 7. Stage 3 — Community as the Kade chat home

Approved structure:

- Compact Community route header and search.
- Presence strip with Kade avatar.
- “You’re online,” current identity, and live clipper count.
- Online/offline (or invisible) toggle.
- Weekly/community indicators and unread-room count.
- Left room rail.
- Active room conversation in the same route, not only a floating overlay.

Approved initial rooms:

- `#global`
- `#clippers-lounge`
- `#campaign-drops`
- `#fan-boost`
- gated `#agency-vip`

Room rows show:

- name
- active/online count
- unread count
- last-message preview
- locked/archive state where applicable

Kade:

- Appears as a real bot participant.
- Uses the Kade community avatar and a clear `[BOT]` badge.
- Can post pinned campaign/system messages.
- Does not impersonate a human.

Presence:

- Online count comes from real presence data, not a hard-coded `47`.
- Toggle state persists and is shared with Settings.
- Offline/invisible meaning is explained.
- Loading, stale, disconnected, and reconnecting states are visible.
- Presence updates do not cause layout jumps.

Agency private rooms:

- Agency owner may create one private room per campaign.
- Membership follows campaign invitation/permissions.
- Closed campaigns become read-only archives.
- Unauthorized users cannot enumerate or enter the room.
- Room creation, invite, archive, and access errors have visible recovery.

## 8. Stage 4 — robust chat and Giphy

### 8.1 Message stream

- Load newest messages first.
- Infinite history loads when the top sentinel becomes visible.
- Backend supports a real cursor such as `before_id`.
- Prepending older messages preserves the reader’s visual scroll position.
- Duplicate messages are suppressed.
- Sending states: pending, sent, failed, retrying.
- A 500-message fixture must remain smooth.

Long messages:

- Clamp to three lines in the compact stream.
- Provide an explicit `…more` / “Show less” control.
- Expansion is keyboard accessible.
- Do not fade old messages below readable contrast; recency hierarchy may be
  subtle but content remains accessible.

### 8.2 Giphy

- Composer has a GIF control.
- Open an in-app picker sheet with search.
- Load real results through the existing backend proxy, never a production API
  key embedded in frontend code.
- Default page size: 24.
- Preserve required “Powered by GIPHY” attribution.
- Use safe rating/filtering appropriate to the community.
- Lazy-load thumbnails and handle empty/error/offline states.
- Selecting a GIF inserts/sends the chosen media.
- GIF rendering is bounded and cannot make a message row enormous.
- Kade images in the mockup are fallback reference content, not fake Giphy
  production results.

### 8.3 Composer

- Text input, GIF control, Liquid Clips reaction/bug control, and send action.
- Enter sends; Shift+Enter creates a newline.
- Disable duplicate sends while a request is pending.
- Draft survives room switching where appropriate.
- Sending failure is visible and retryable.

### 8.4 Async feedback

Use the approved Liquid Clips bug/Kade loader for history/GIF requests, with:

- Accessible loading label.
- Static fallback.
- Reduced-motion support.
- No content shift.

## 9. Stage 5 — Settings cockpit

Replace the current very long page with a bounded identity strip, tab rail, and
scrolling active pane. Do not delete existing functionality during the visual
restructure.

### 9.1 Shared identity strip

- Avatar.
- Display name.
- `@handle`.
- Tier/mode.
- Presence status and toggle.
- Account connection state.

### 9.2 Common tabs

- Account
- Payouts
- Devices
- Notifications
- Support
- Advanced

### 9.3 Clipper tabs

- Streaks
- Referrals & QR

Referrals & QR pane:

- Real QR generated from the user’s actual affiliate URL.
- Approved HUD bezel.
- `invader-classic.png` centred without breaking QR scan reliability.
- Copy link.
- Download QR.
- Change affiliate tag/handle.
- State the handle-change policy and redirect behaviour.
- Show referral and payout metrics using real data.
- Explain the trial/upgrade and crypto payout timing clearly.

Test the QR with at least two real phone-camera scanners before release.

### 9.4 Agency tabs

- Whop Sync
- Roster
- Payout split
- Rules

Roster pane:

- Member identity/handle.
- Role/status.
- Campaign/private-room access.
- Payout status.
- Invite/add clipper.
- Pending and disabled states.
- Real permission enforcement.

The agency accent may use cyan, but typography and component language remain
part of the same application.

### 9.5 Preservation audit

Create an inventory of every existing Settings action before restructuring.
After implementation, prove each remains callable, including:

- activation/account refresh
- Whop connection and checkout
- billing/membership management
- wallet setup/reconnect
- connected accounts
- device/session management
- notifications
- support
- diagnostics/advanced actions
- admin-only controls

No action may disappear merely because it was absent from a mockup.

## 10. Stage 6 — Earn and affiliate polish

Affiliate tooling belongs inside Earn, using the same visual and behavioural
language as Settings.

Approved content:

- Earnings summary.
- Affiliate QR card.
- Copy link.
- Download QR.
- Consistent `@handle`.
- Referral conversion/payout metrics.
- Recent payouts.
- Active campaigns.
- Clear crypto payout copy.

Requirements:

- Do not create a visually unrelated “mini app” inside Earn.
- Reuse the same QR component and affiliate data source as Settings.
- Changing the handle updates both locations.
- QR/link values agree exactly.
- Use real payout/campaign data and honest empty states.
- Avoid implying fiat payout if the product remains crypto-only.
- All external/account journeys follow `openInApp`.

## 11. Stage 7 — admin moderation

Admin moderation is integrated into the Community chat visual language.

Approved desktop interaction:

- Right-click message context menu.
- Keyboard-accessible alternative menu button.
- Actions: Hide message, Warn user, Mute for 24 hours.
- Copy link to message remains available.

Behaviour:

- Backend authorization is authoritative.
- Non-admin receives `403`.
- Hidden content becomes `[removed by moderator]`; it is not merely hidden with
  CSS.
- Muted state persists and expiry is recorded.
- Warn/mute/hide requires confirmation for destructive or high-impact actions.
- Audit who acted, what action, target, room, and time.
- Optimistic UI rolls back on failure.
- Moderation controls never appear to ordinary users.

Test admin, agency owner, ordinary clipper, muted user, deleted message, and
offline/error states.

## 12. Implementation order and stop gates

Do not port all mockups in one uncontrolled rewrite.

### Gate A — repair baseline first

Complete every mandatory correction in
`CLAUDE_DESKTOP2_RELEASE_MASTER.md`, including:

- truthful shell exit codes
- Workstation semantic `<h1>`
- valid parent-based container queries
- hard-passing zero-candidate test
- complete defensive normalization
- missing hydration/resume/responsive tests

Stage 1 UI work cannot start until the targeted Workstation suite is green with
zero release-gate skips.

### Gate B — preserve references

- Copy and hash the approved mockups into the repository.
- Render reference PNGs.
- Record the visual contract.

### Gate C — implement one stage at a time

Order:

1. Stage 1 Workstation/My Clips.
2. Stage 2 in-app browser audit.
3. Stage 3 Community.
4. Stage 4 robust chat/Giphy.
5. Stage 5 Settings.
6. Stage 6 Earn/affiliate.
7. Stage 7 moderation.

For each stage:

1. Inventory existing production behaviour.
2. Identify exact production files.
3. Implement the smallest coherent slice.
4. Run type/build/unit/contract tests.
5. Render every required state.
6. Capture the responsive screenshot matrix.
7. Compare to the approved reference.
8. Conduct keyboard/accessibility checks.
9. Run relevant existing regression suites.
10. Update this document’s execution log.
11. Stop for user visual approval before beginning the next visual stage.

### Gate D — integrated visual review

After all stages pass individually:

- Run the entire application at every target size.
- Check route transitions and retained state.
- Check all drawers, popovers, browser overlay, chat sheet, GIF sheet, menus,
  dock, and tooltips for z-index collisions.
- Check clipper/agency and free/paid/admin personas.
- Check live data, empty data, slow data, errors, offline, and expired auth.
- Run full Playwright and invariant suites with truthful exit codes.

### Gate E — release master

Return to `CLAUDE_DESKTOP2_RELEASE_MASTER.md`. UI approval does not replace:

- real source-to-export E2E
- watermark and captions proof
- ship-lens `PASS`
- signing/notarization
- clean install
- runtime update/rollback
- clean committed worktree
- explicit user deployment approval

## 13. Visual evidence protocol

For each screen/state, preserve:

```text
desktop-2/docs/ui-master/evidence/<stage>/<viewport>/<state>.png
```

Minimum evidence matrix:

| Surface | Required states |
|---|---|
| Workstation | running, completed, empty, error, selected, inspector, editor |
| Split editor | top/bottom, side/side, facecam, two-source controls, export |
| Community | populated, empty, offline, locked room, private campaign room |
| Chat | loading history, long message, GIF picker, send failure |
| Settings clipper | each tab, QR, invalid handle, loading/error |
| Settings agency | each tab, roster, invite, permission failure |
| Earn | normal, no earnings, QR, payout pending/error |
| Moderation | menu, confirmation, hidden, warned, muted, forbidden |

Each evidence entry records:

- commit
- app version
- runtime version
- viewport
- persona/tier
- fixture or real-data source
- expected behaviour
- observed behaviour
- screenshot path
- test path/result

Do not use a regenerated snapshot matching itself as proof of user approval.
Retain before, after, and diff when changing an established baseline.

## 14. No-false-green rules

- No conditional `test.skip()` for a release-gate state.
- No `|| true` around verification.
- No status captured from `head`, `tail`, or `tee` without `pipefail`.
- No hard-coded “47 online,” earnings, clips, or scores in production.
- No test that only searches CSS source text when computed layout matters.
- No screenshot taken from a mockup and presented as production.
- No fixture-only claim presented as real E2E.
- No “working” claim when the click handler is a placeholder.
- No visual approval inferred from tests.
- No deployment while any execution-log row is `PENDING`, `PARTIAL`, or
  `FAILED`.

## 15. Execution log

Claude or Codex updates this table with exact evidence. `PARTIAL` means work
exists but the complete proof row is not yet green; it is never release-ready.

| Gate | Status | Evidence |
|---|---|---|
| Release-master correction checkpoint green | PARTIAL | Workstation correction suite passed `8/8` on isolated port; full release checkpoint still outstanding. |
| Mockups copied and hashes verified | COMPLETE | Approved files copied to `desktop-2/docs/ui-master/mockups/`; recorded hashes match. |
| Reference screenshots captured | COMPLETE | All eight approved HTML states captured beside source at `1440×900`; dimensions verified. |
| Stage 1 Workstation implemented | COMPLETE | Compact toolbar, collapsed run controls, four-column 4:5 grid, explicit editor opening, rigid split composer, and packaged sidecar mapping implemented. |
| Stage 1 responsive/keyboard/E2E proof | COMPLETE | Final production build passes Workstation `9/9` at `1040×680`, `1280×820`, and `1440×900`, including keyboard and zero-result gates. Reaction journey passes computed 50/50 geometry, swap, bake, clip-switch, and persistence. Evidence under `desktop-2/docs/ui-master/evidence/stage-1/`. |
| Stage 1 user visual approval | PENDING | |
| Stage 2 in-app browser audit | COMPLETE | HTTP(S) call-site sweep centralized; `_blank` and stray `window.open` guarded; frontend build, Rust `cargo check`, shell contracts `119/119`, and production Browse journey pass. |
| Stage 2 real account/Whop proof | PENDING | Requires packaged native runtime plus a real signed-in Whop/account journey; browser-preview fixtures are not accepted as proof. |
| Stage 2 user approval | PENDING | |
| Stage 3 Community implemented | COMPLETE | Kade-led embedded Community chat now uses the real `/chat/*` client, five-room rail, persistent local visibility preference, honest capability states, responsive internal scrolling, and a pinned reachable composer. |
| Stage 3 presence/private-room proof | PARTIAL | Production-build Community suite passes all three viewports plus pending-room, agency-gate, offline, and persistence journeys. Real server presence counts and campaign/private-room contracts do not yet exist and are shown as unavailable rather than fabricated. |
| Stage 3 user visual approval | PENDING | |
| Stage 4 chat/Giphy implemented | COMPLETE | Shared chat rows support long content, pinned labels, safe embedded media, in-app media opening, GIF/photo picker close/retry/setup states, draft-preserving send errors, and keyboard dismissal in both Community and the floating panel. |
| Stage 4 history/GIF/error proof | COMPLETE | Production-build Community/chat suite passes `9/9`: three responsive layouts, honest room/presence gates, explicit loading history, long-message/media rendering, GIF selection, provider failure, setup-required, offline history, embedded/floating send failure, and Escape dismissal. Evidence under `desktop-2/docs/ui-master/evidence/stage-4/`. |
| Stage 4 user visual approval | PENDING | |
| Stage 5 Settings implemented | PARTIAL | Bounded identity strip, shared presence, vertical common/mode tab rail, scrolling active pane, shared affiliate QR, and honest unsupported capability panes are implemented. Real agency roster/invite/split/rules remain blocked on absent backend contracts. |
| Stage 5 action-preservation/QR proof | PARTIAL | Production-build Settings cockpit suite passes `6/6` across `1040×680`, `1280×820`, and `1440×900`, covering all clipper tabs, real shared link/QR/download, invalid handle, bounded internal scrolling, agency gates, shared presence, and legacy action reachability. Existing Settings Avatar/System Migration regressions pass `5/5`. Two real phone-camera QR scans and native-only key/runtime actions remain release proof. |
| Stage 5 user visual approval | PENDING | |
| Stage 6 Earn/affiliate implemented | COMPLETE | Earn and Settings now reuse one affiliate component with the same handle, real referral URL, approved QR treatment, copy/download actions, real metrics, policy honesty, and Whop/USDC payout language. |
| Stage 6 data/link consistency proof | COMPLETE | Production-build Earn affiliate suite passes `3/3`: live reward/wallet/campaign/activity mapping, Settings↔Earn link equality, persisted handle rename, honest affiliate/wallet failures, and `1040×680` containment. Existing honest-zero Earn journey also passes. Evidence under `desktop-2/docs/ui-master/evidence/stage-6/`. |
| Stage 6 user visual approval | PENDING | |
| Stage 7 moderation implemented | PARTIAL | Keyboard/button and right-click message menus plus copy-link are implemented. Staff/mod/founder see the approved moderation action names only as disabled contract gates; ordinary users never receive them. Hide/warn/mute cannot be enabled because the backend has no such chat mutations. |
| Stage 7 authorization/audit proof | PARTIAL | Community/chat suite passes `11/11`, including ordinary-role exclusion, staff-role gating, copy-link clipboard proof, right-click opening, and Escape dismissal. Backend audit proves only pin/unpin and admin-wide role/ban exist; chat-specific hide/warn/timed-mute enforcement, removed-content serialization, rollback, and audit endpoints are absent. |
| Stage 7 user visual approval | PENDING | |
| Integrated responsive/z-index review | COMPLETE | Production suites pass at `1040×680`, `1280×820`, and `1440×900`; TopHud collisions, Settings containment/QR layout, Community scroll ownership, Workstation inspector/editor geometry, and keyboard/collapse paths are green in the final full run. |
| Accessibility review | COMPLETE | Keyboard journeys pass for the rebuilt Workstation and Community surfaces. The production-build button audit is green across all 11 customer surfaces with zero dead controls and zero console errors. It now observes pressed/selected/checked/expanded/busy states and reconciles live control state before each click. |
| Full automated regression suite | COMPLETE | Final frozen production-build run: `78 passed / 0 failed / 0 skipped` in `27.7m`, serial (`--workers=1`). This includes the 11-surface control audit, all three responsive Workstation/Community targets, Settings at `1040×680` and `1280×820`, full clipping, reaction, caption, trim, watermark, export, Browse, onboarding, backend tier enforcement, and brand consistency. |
| Release-master gates | PENDING | |

### 15.1 Live Codex execution ledger

Last updated: 2026-07-02, Europe/London.

Isolation guarantee:

- Claude continues in `/Users/dipdip/code/jnr`.
- Codex edits only `/Users/dipdip/code/jnr-codex-ui` on
  `codex/ui-end2end`.
- No Codex implementation edit has been made in Claude's working checkout.
- The final handoff will be a committed branch/commit with exact integration
  instructions; Claude must not copy ad-hoc files between worktrees.

Completed and verified:

- Preserved the approved HTML/CSS references under the tracked UI-master
  directory and verified their hashes.
- Removed the duplicate Workstation status band.
- Compressed project/session chrome into the compact title row.
- Moved run controls into a collapsed disclosure.
- Changed completed clip cards to `4:5`, four columns where width permits,
  with large unambiguous row separation and no card intersections.
- Added hard computed-layout assertions for column count, card ratio,
  intersection, and row gap.
- Made the zero-candidate release test deterministic and non-skipping.
- Fixed direct clip `Edit`, `Export`, and inspector tool entry so the newly
  mounted cockpit opens immediately on the intended module instead of missing
  an already-dispatched event.
- Verified the production-build reaction journey end to end: hydrate project,
  open editor, upload reaction, preview, bake, switch clips, and restore the
  persisted reaction.
- Replaced the generic persisted `split` value with deterministic migration to
  `side-by-side`.
- Added separate `side-by-side` and `top-bottom` reaction layouts, pane swap,
  and playback-sync controls.
- Added rigid preview composition and mapped the same choices to real sidecar
  export types.
- Corrected the sidecar change to the packaged canonical source at
  `python-sidecar/stages.py`; the legacy Desktop-1 copy is unchanged.
- Directly verified all four sidecar split filters at `1080×1920`.
- Production TypeScript/Vite build passes after the current changes.
- Audited HTTP(S) handoffs across billing, Inbox, Whop submission, Ayrshare,
  campaign rules, announcements, claim recovery, submissions, and scheduled
  posts; all now enter the shared in-app browser router.
- Added invariant guards rejecting new `_blank` bypasses and restricting
  `window.open` to the Browser overlay's documented system fallback.
- Changed browser-preview behaviour from a false loaded empty slot to an
  honest unavailable state.
- Added an explicit Rust browser-open outcome so commerce/system fallback
  cannot leave an empty overlay behind.
- Verified the production Browser journey, Rust bridge via `cargo check`, and
  shell contracts at `119/119`.
- Rebuilt Community as an embedded Kade-led chat home backed by the real
  `/chat/messages` and `/chat/message` client.
- Added five approved room names while keeping rooms without server contracts
  in explicit unavailable states with no invented messages, member totals, or
  unread counts.
- Added a locally persisted online/invisible preference without claiming it is
  server presence.
- Fixed the Community route's duplicate visible semantic heading and clamped
  its cockpit to the usable viewport so the message history scrolls internally
  and the composer remains reachable.
- Hardened shared chat rows for long text, pinned labels, safe media previews,
  broken-image fallbacks, and in-app media handoff.
- Hardened GIF/photo search with provider tabs, close, loading, no-results,
  missing-key, offline/server-error, and retry states.
- Preserved failed message drafts and exposed retry in both embedded Community
  and the floating chat panel.
- Production-build Community/chat suite passes `9/9`; responsive evidence is
  under `desktop-2/docs/ui-master/evidence/stage-3/` and GIF evidence under
  `desktop-2/docs/ui-master/evidence/stage-4/`.
- Added explicit delayed-history proof and a floating-panel regression covering
  failed-draft preservation and Escape dismissal.
- Rebuilt Settings as a bounded identity strip, vertical common/mode tab rail,
  and independently scrolling active pane.
- Preserved the legacy account, Whop, checkout, payout, connection, support,
  diagnostic, key-storage, runtime, and admin action surfaces in mapped tabs.
- Reused the exact affiliate component in Settings and Earn; its QR now uses
  the real referral URL, approved bezel, scan-safe excavated invader mark,
  high error correction, copy, and PNG download.
- Added honest capability panes instead of fake devices, notification
  preferences, streak counts, agency members, payout totals, or editable
  workspace rules.
- Production-build Settings suite passes `6/6` across all three target
  viewports; related Settings Avatar and System Migration regressions pass
  `5/5`.

Currently in flight:

- Final branch audit, local test-link cleanup, commit, and Claude handoff.
- The UI implementation itself and its complete frozen production regression
  are green (`78/78`). This is UI completion evidence, not deployment
  permission.
- The first fresh complete run finished `77/78`. Every product-specific
  journey passed except the combined full-clipping harness's final persistence
  assertion. Root cause was in the test: its `addInitScript` cleared
  `lc.clip.<slug>:*` on every navigation, including the navigation intended
  to prove persistence. Cleanup is now guarded to the first document only.
- The next complete run proved full-clipping green and finished `76/78`.
  Remaining failures were Community Refresh's too-brief observable feedback
  and a `1040×680` Settings height override that subtracted `44px` despite the
  stage beginning `116px` below the viewport top. Refresh now emits an honest
  completion confirmation; the wrong override is removed. The full Settings
  cockpit suite passes twice consecutively (`12/12`).
- Stage 7 remains partial by design until backend moderation contracts exist;
  the desktop exposes no fake destructive action.

Remaining implementation order:

1. Commit the isolated UI branch and hand it to Claude with exact integration
   instructions, including all tracked `desktop-2/public/brand/**` assets.
2. Obtain the explicitly external proofs still listed as pending: user visual
   approval, packaged native account/Whop journey, and two physical-phone QR
   scans.
3. Return to `CLAUDE_DESKTOP2_RELEASE_MASTER.md`; no deployment or
   release-ready claim is permitted from UI completion alone.

### 15.2 Settings preservation inventory

This inventory was captured before restructuring. `Mapped pane` is the new
location; it does not claim the action has passed its click proof yet.

| Existing action/state | Mapped pane |
|---|---|
| Activation status, email, tier, sign-in door | Account |
| Connect Whop OAuth | Account |
| Checkout / upgrade / manage membership | Account and Payouts |
| Refresh account and `/me` state | Account and Payouts |
| Clear local activation | Advanced |
| OpenAI key save, replace, remove | Advanced |
| Channel/service connection status | Devices and Agency Whop Sync |
| Open Channels route | Devices and Agency Whop Sync |
| Open Whop dashboard | Account, Devices, Payouts |
| Admin HQ, gated by real admin override | Payouts |
| Whop payout onboarding / portal | Payouts |
| Runtime version and check-now | Advanced |
| Copy JWT storage-key name | Advanced |
| Support email copy and mail client | Support |
| Docs, privacy, and terms | Support |
| Notification preferences | Notifications; honestly unavailable until a real preference contract exists |
| Device/session revocation | Devices; honestly unavailable until a real session contract exists |
| Clipper streak history | Streaks; honestly unavailable until a real history source exists |
| Affiliate handle, real URL, copy, QR copy/download, real metrics | Referrals & QR; shared with Earn |
| Agency seat sync, roster/invite, payout split, rules | Agency tabs; controls withheld until authorization and audit contracts exist |

## 16. Required handoff format

After each stage, report:

```text
UI STAGE:
Status: READY FOR VISUAL REVIEW | NOT READY
Commit/worktree:
Files changed:
Existing behaviours preserved:
New behaviours implemented:
Viewports tested:
Personas tested:
Automated tests:
Skipped tests:
Reference screenshots:
Production screenshots:
Known differences from approved mockup:
Open blockers:
Deployment performed: NO
```

If any field is unknown, the stage is `NOT READY`.
