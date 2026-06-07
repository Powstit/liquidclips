# UI Map — Hosted webview surfaces (v0.7.6)

Governed by `~/.claude/skills/user-outcome-lens/`. Companion to
`UI_MAP_workbench.md`. This file decides which surfaces become Tauri
child-webview embeds (push-to-Vercel-live) vs which stay native.

The goal Daniel stated as the test for this work:
> *"I want to add sponsored rewards in new places without rebooting."*

The answer to that goal is the SURFACE BOUNDARY, not a global pattern.
Content-heavy surfaces become webviews. Interaction-heavy surfaces stay
native. Everything in between is a judgement call run through the lens.

---

## SURFACE: Earn tab (becomes webview)

### OUTCOMES the user came here for

- **#5** *"I want to see what I can earn from clipping."*
- **#6** *"I want to start a bounty."*
- **#7** *"I want to know my submission status."*

### NAVIGATIONS in/out

- IN from primary nav (Earn icon rail).
- OUT to external browser for bounty pages (already opens via system browser).
- OUT to Workspace when "Start clipping for this bounty" picks up the bounty's source video.

### SIMPLICITY demands

- *"I want a clip-ready bounty in one click"* → "Start clipping" CTA.
- *"I want to see my latest submission status without leaving the surface"* → live poll.

### Elements (every one tagged)

| Element                                             | Tag                          |
|-----------------------------------------------------|------------------------------|
| Connection badge ("Whop linked / not linked")       | `(O #7 — proof of identity)` |
| SponsoredBannerCarousel (featured + sponsored)      | `(O #5)`                     |
| Bounty list (cards: title / brand / RPM / deadline) | `(O #5)(O #6)`               |
| "Start clipping" CTA on each bounty                 | `(S "start in one click")`   |
| Submission status pills (live polled)               | `(O #7)`                     |
| Manual submission entry                             | `(O #6 — fallback path)`     |
| Upgrade overlay on tier-gated rows                  | `(O #5 — see what's locked)` |

### Why this surface becomes a webview

- Every element above is **content** — text, images, status pills. None depend on native menus, native drag, or native keyboard shortcuts that span the desktop chrome.
- The surface refreshes data on a poll. That data already comes from `backend.campaignsList()` + `sidecar.whopListBounties()` — moving the fetch to a Next.js server component is a one-line port.
- The conversion delivers the user-stated outcome: deploying account-app to Vercel changes Earn live within 30 seconds, no rebuild.

### Cut list

- The native `EarnLayout` wrapper, `EarnSidebar`, `EarnTicker` — re-implemented inside the embed page using the same Tailwind tokens. The native versions are deleted in this sprint.
- Per-bounty native modals — replaced by `/embed/earn/bounty/[id]` sub-routes inside the webview.

### Conflicts

- *"Webview surface"* vs *"native scrollbars + keyboard"* — webview is a child of the main window; scroll + tab work natively inside the WebKit instance. Cmd-A in Workbench is unaffected because focus is in a different webview.
- *"Auth lives in keychain JWT"* vs *"webview needs to know who's signed in"* — resolved via Clerk satellite cookies on `account.liquidclips.app` (already wired). The embed page calls Clerk `auth()` server-side; no JWT-in-URL.

---

## SURFACE: Sponsored carousel — STAYS NATIVE (mounted in WorkstationRoom)

### Why it doesn't convert

- The cockpit carousel is a 4:1 banner strip inside the Workbench cockpit chrome. It's a SLICE of a surface, not a surface.
- Converting it would mean spawning a 280px-tall child webview floating inside the Workbench — a layering nightmare on top of the existing tile canvas.
- Its content already comes from `backend.campaignsList()`. Adding a campaign to backend = appears in the cockpit carousel live. **The user's outcome is already met for this slice without converting.**
- It's also mounted inside the new Earn webview surface above (where the conversion DOES happen). So the same component data hits a hosted version too.

### What this means

- New CAMPAIGN content → backend → live in both cockpit + earn embed simultaneously. Zero reboot.
- New CAMPAIGN PLACEMENTS inside the cockpit (e.g. a different banner position) → still needs rebuild. Trade-off acknowledged: the cockpit is interaction-heavy, so this is correct.
- New CAMPAIGN PLACEMENTS inside Earn surface → live (because the surface is a webview).

---

## SURFACE: Connect-channel popover — STAYS NATIVE

Already lens-mapped in `UI_MAP_workbench.md`. The popover spawns external OAuth in the system browser — that part is already a "hosted" page. The popover itself is a native React surface owned by AccountBindingChip and inherits the chrome-tile interaction model. Webview-ifying it would break the chip's hover/focus relationships with the tile.

---

## Auth bridge for the Earn embed

**Primary path — Clerk satellite cookies (preferred):**
- `account.liquidclips.app` is already a Clerk satellite domain.
- User signs in once via desktop auth panel; Clerk writes its session cookie to the satellite host.
- The `/embed/earn` page calls `auth()` server-side. Clerk reads the cookie. No JWT-in-URL.
- This is the same pattern `/dashboard` already uses today.

**Fallback path (only if Tauri child webview doesn't share cookies with main webview):**
- Desktop reads `LICENSE_JWT` from keychain via `licenseJwtRead()`.
- Webview, on first paint, posts `{ type: "lc:auth-request" }` to the parent via `window.parent.postMessage`.
- Parent (desktop React) responds with `{ type: "lc:auth-jwt", value: <jwt> }`.
- Webview stores in memory only; never persists.
- Backend `/embed/api/*` endpoints accept `Authorization: Bearer <jwt>` AND Clerk session — either works.

**Verification step in implementation:** before building the embed page, the build agent must verify which path works in the Tauri webview instance. If satellite cookies cross over, use path 1. If not, fall back to path 2.

---

## Implementation punch-list — v0.7.6

1. `account-app/src/app/embed/earn/page.tsx` — CREATE. Server component. Fetches campaigns + bounties + submission status server-side. Renders the four sections (badge / sponsored carousel / bounty list / manual entry) using Tailwind tokens that match desktop's index.css.
2. `account-app/src/app/embed/layout.tsx` — CREATE. Strips the Clerk header / nav from `/embed/*` so the embed pages render edge-to-edge.
3. `account-app/src/components/embed/SponsoredCarousel.tsx` — port the existing desktop `SponsoredBannerCarousel.tsx` 1:1, reading from the same `/campaigns` endpoint.
4. `account-app/src/components/embed/BountyList.tsx` — port `BountyCard` rendering. The "Start clipping" CTA posts a message back to the desktop parent.
5. `account-app/src/components/embed/AuthBridge.tsx` — client component on every embed page. Tries Clerk session first; falls back to post-message JWT request if Clerk session missing. Wraps the page in an `<EmbedAuthProvider>` that mirrors desktop's `useTier()` hook surface.
6. `desktop/src-tauri/src/earn_panel.rs` — CREATE. Mirrors `browse.rs` and `auth_panel.rs`. Spawns a child webview at the Earn tab's content frame, pointed at `https://account.liquidclips.app/embed/earn`. Position: under the primary nav; size: fills the content area. Singleton.
7. `desktop/src/lib/earn_panel.ts` — CREATE. TS bridge to the new Rust command (open / close / resize on focus / listen for message-bus posts from the webview).
8. `desktop/src/components/earn/EarnTab.tsx` — REPLACE the native render with `<EarnPanelMount />` — a one-line component that calls `openEarnPanel()` on mount and `closeEarnPanel()` on unmount. The native carousel / bounty list / connection badge code is deleted.
9. `desktop/src/components/earn/SponsoredBannerCarousel.tsx` — KEEP, but only the WorkstationRoom mount survives. Deduplicate the EarnTab mount (gone with #8).
10. `desktop/src-tauri/src/lib.rs` — register the new `open_earn_panel` / `close_earn_panel` Tauri commands.
11. `desktop/src/components/earn/EarnLayout.tsx`, `EarnSidebar.tsx`, `EarnTicker.tsx` — DELETE. The embed page owns its own layout. Verify nothing else imports them via grep first; cut if cleanly removable.
12. `desktop/src-tauri/tauri.conf.json` — extend `connectSrc` / `frameSrc` CSP to include the embed URL (already includes `account.liquidclips.app`; verify).
13. Backend: add `/embed/api/whop-bounties` proxy on `junior-backend/app/routes/` that the embed page calls server-side (or call existing `/whop/*` directly — verify Clerk session is enough). No new auth surface.
14. `docs/UI_MAP_workbench.md` — append a one-line "see also: `UI_MAP_embed_surfaces.md`" pointer.

---

## Lens guardrails for future "make this a webview" decisions

When a future surface is proposed for webview conversion, run it through:

| Question                                                          | Webview if YES         | Native if YES                   |
|-------------------------------------------------------------------|------------------------|---------------------------------|
| Is the surface mostly text + images + status reads?               | Yes                    |                                 |
| Does it need native drag + drop?                                  |                        | Yes                             |
| Does it need keyboard shortcuts that span the whole app?          |                        | Yes                             |
| Does it need to coordinate with the sidecar in real time?         |                        | Yes                             |
| Does its content change weekly / per campaign / per copy edit?    | Yes                    |                                 |
| Will it fit in a rectangular pane of the main window?             | Yes                    | (no constraint)                 |
| Does it need OS-native menus / context menus?                     |                        | Yes                             |

Earn passes the webview test on every row. Workbench fails the webview test on rows 2–4 + 6. The split is principled, not opportunistic.

---

## What this delivers

After v0.7.6:
- New sponsored campaigns: push to backend → live everywhere instantly.
- New Earn surface layouts / CTAs / sections / banner positions / bounty card variants: push to account-app → Vercel auto-deploys → live in 30 seconds. **No desktop rebuild. No reboot.**
- Workbench, captions, sidecar, Splash, intro: continue to ship via auto-updater (one-click for the user, no manual install).

That's the realistic ceiling for a native desktop app. The user's outcome is met for every surface where it can be met.
