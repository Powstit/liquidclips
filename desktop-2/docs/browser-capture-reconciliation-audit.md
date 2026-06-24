# Browser Capture & Reconciliation Audit
### Strategic Platform Capability · Pre-6N-E Lock

*Author scope · audit only · NO BUILD. 6N-E does not block on this work.*

---

## 0 · Lock & framing

Per the pre-6N-E product lock:

- **Whop = source of truth** for funding, escrow, payout, submission approval, reward accounting.
- **Liquid Clips = source of truth** for campaign creation, discovery, brief, asset links, scheduling, discussion, community, leaderboards, execution.
- **Browser Capture = reconciliation layer.** Bridges Whop and LC without deep Whop API access.

Browser Capture is a **read-only mirror with consent**. It never:

- writes to Whop
- bypasses Whop permissions
- captures cookies, tokens, or hidden API responses
- runs automated reward actions

It only reads what the **user is already looking at**, with explicit per-interaction consent.

---

## 1 · Legacy browser/webview capabilities (`desktop/`)

Liquid Clips legacy (`/Users/dipdip/code/jnr/desktop/`) already runs a fully working in-app Whop browser. Prior art we can lean on:

### 1.1 · Rust layer (`desktop/src-tauri/src/browse.rs`, 140 LOC)

Tauri 2 child webview pinned to the right pane of the main window. Verified primitives:

| Primitive | Implemented | Rust API |
|---|---|---|
| Create native child webview | ✅ | `WebviewBuilder::new(label, WebviewUrl::External(url))` + `main.add_child(builder, pos, size)` |
| Navigate the webview | ✅ | `wv.navigate(parsed_url)` |
| Pre-navigation filter (commerce-redirect) | ✅ | `WebviewBuilder::on_navigation(move \|nav_url\| -> bool { … })` returns `false` to block + spawn an OS-browser handoff |
| Run JS in the page | ✅ | `wv.eval("window.history.back()")` (no return value · fire-and-forget) |
| Reposition / resize | ✅ | `wv.set_position`, `wv.set_size` |
| Read current URL | ✅ | `wv.url()` (Tauri 2 returns the current navigated URL; verified in `on_navigation` callback signature) |
| Close | ✅ | `wv.close()` |

Tauri commands exposed: `open_browse_panel`, `close_browse_panel`, `is_browse_panel_open`, `browse_back`, `browse_forward`, `browse_reload`. Capabilities allow-list lives in `desktop/src-tauri/capabilities/default.json` (window label `browse_panel`).

### 1.2 · React layer

- `desktop/src/lib/browse.ts` · TS bridge + singleton open-state store. `loading` flag with 10s timeout. Subscribes to two Rust-emitted Tauri events:
  - `browse_panel:loaded` (Rust emission not yet shipped; timer-based fallback covers it)
  - `browse_panel:error` (Rust emission not yet shipped)
- `desktop/src/components/BrowseRewardsPanel.tsx` · 271-LOC chrome bar (Back / Forward / Reload / URL bar / Go / Close / quick links).
- `WHOP_REWARDS_URL = "https://whop.com/discover/content-rewards/"` and `WHOP_COMMUNITY_URL = "https://whop.com/liquidclips/"` are the two pinned entry points.

### 1.3 · Other webview surfaces in legacy

- `auth/AuthPanel.tsx` + Rust counterpart · centered modal child webview for Clerk sign-in.
- `src-tauri/src/social_link.rs` · separate `WebviewWindow` for Ayrshare OAuth (separate top-level window because OAuth providers block embedded webviews).

### 1.4 · Iron gates that touch webview work

- **IG-005** (workspace UI design) · cockpit layout invariants — webview reservation already lives in `App.tsx` line ~348 (Browse panel reserves 560px on the right).
- **IG-011** (webview room height cascade) · `RoomShell align="stretch"` for native-webview rooms — important when porting any of this to desktop-2.

### 1.5 · What legacy does NOT do today

- No URL/title broadcast back to React (the in-flight TODO).
- No DOM read-back.
- No screenshot capture.
- No reconciliation logic of any kind.

So the existing browse panel is **scaffolding ready to be extended** · not a finished capture layer.

---

## 2 · desktop-2 browser/open flow

### 2.1 · Current state

desktop-2 (`/Users/dipdip/code/jnr/desktop-2/`) has **no in-app browser yet**. External URLs route through:

```
bus.emit("browse:open", { url, mirror, title, source })
  → bridge/browseOpenSubscriber.ts   (auto-mounted)
    → lib/openSmart.ts
      → @tauri-apps/plugin-shell::open(url)   (Tauri runtime)
      → window.open(url, "_blank")            (browser preview fallback)
```

`browseOpenSubscriber.ts` is explicitly designed as a **plug-in point**: a future in-app browser overlay can either subscribe to `browse:open` before this module mounts, or call `setBrowseOpenDefault(false)` to take over. No refactor needed when capture lands.

### 2.2 · Where `browse:open` already fires

Hot paths (grep of `desktop-2/src`):

- `agency-creation/steps.tsx` · "Open Whop ↗" (Option B reward creation) + "Open Whop reward to copy rules ↗" (Step 2 mirror)
- `agency-creation/WhopRewardCard.tsx` · "Open Whop reward to copy rules ↗" in no-enrichment state
- `campaigns/CampaignPageShell.tsx` · external asset-link clicks
- `community/RoomDetailDrawer.tsx`, `CommunityBanner.tsx`, `FeaturedDiscussion.tsx` · Whop community mirror
- `earn/RewardClipDrawer.tsx` · Earn-tab reward opens
- `campaign-asset-links/CampaignAssetLinkRow.tsx` · brief asset clicks

Every one of these is already a candidate **capture entry point** — if a Whop URL routes through `browse:open` and the in-app browser is mounted, capture can read whatever the user lands on.

### 2.3 · desktop-2 Tauri config posture

`desktop-2/src-tauri/tauri.conf.json` is `0.8.0-shell` · placeholder shell. Single `main` window only. No child-webview capabilities declared. CSP is very tight (`connect-src 'self' ipc:` only).

**Implication**: porting the legacy `browse.rs` pattern to desktop-2 requires:
1. New Rust module (`desktop-2/src-tauri/src/browse.rs`).
2. Adding `browse_panel`, `social_link`, `auth_panel` window labels to capabilities.
3. Loosening `connect-src` to allow Whop domains (already done in legacy: `https://api.whop.com` is in legacy's CSP allow-list — extend to cover the page-load domains).
4. Wiring a `BrowserOverlay` React route that emits navigation events to consumers.

This is **scaffold work**, not green-field architecture. Effort: ~2 days port + 1 day capabilities + CSP audit.

---

## 3 · Tauri capability matrix · what can a webview safely expose?

Verified against Tauri 2 Webview API:

| Signal | How | Already proven? | Notes |
|---|---|---|---|
| **Current URL** | `wv.url()` from Rust; or `on_navigation` callback fires with `&tauri::Url` on every navigation | ✅ legacy `browse.rs` `on_navigation` filter | Trivial. Always safe. |
| **Page title** | `wv.eval("__lc_capture('title', document.title)")` + page-side bridge that emits a Tauri event back | ⚠️ pattern is standard, not yet wired in legacy | Title is "visible-by-definition" — safe to capture without further consent. |
| **Visible DOM** | Same pattern: `eval()` runs `JSON.stringify({ … document.querySelectorAll(...) })` and emits via Tauri event | ⚠️ not implemented anywhere yet | **Constraint: must run ONLY in same-origin context.** WKWebView/WebView2 sandbox `eval` to the page — so we read only what the page has rendered for the user. |
| **Selected text** | `window.getSelection().toString()` via `eval()` + emit | ⚠️ trivial JS, not yet wired | Cleanest consent signal — user literally highlighted it. Strongly recommended as the v1 capture surface. |
| **Screenshots** | `wv.take_snapshot()` — Tauri 2 exposes `webview.position` / `webview.size` but the snapshot API is **platform-specific**: WKWebView's `takeSnapshot(with:)` (macOS 10.13+) and WebView2's `CapturePreviewAsync`. Requires a thin Rust wrapper using `objc2` (mac) / `windows-rs` (win). | ❌ not in legacy or desktop-2 | Most invasive. Defer until v2 unless a specific reconciliation flow needs it. |
| **Cookies** | NOT exposed by Tauri webview API. Would require platform-specific WebKit/WebView2 hooks. | ❌ off-table per product lock | Hard rule: never. |
| **Network requests / API responses** | NOT exposed without URL-protocol swizzling — explicitly off-table. | ❌ off-table per product lock | Hard rule: never. |
| **localStorage** | Same-origin eval can read it, but tokens may live there. | ❌ off-table per product lock | Hard rule: never read localStorage of cross-origin pages. |

### 3.1 · The capture bridge pattern (recommended)

A single, audited Rust↔page bridge that all capture goes through:

```
                  User action (click "Capture" / select text)
                                  │
                                  ▼
        Rust calls wv.eval(initialization_script_capture_lib + call)
                                  │
                                  ▼
   Page-side: window.__lc_capture(kind, payload)
                                  │
                                  ▼
      __TAURI_INTERNALS__.invoke("lc_browse_capture", { kind, payload })
                                  │
                                  ▼
              Rust validates kind, writes to event bus
                                  │
                                  ▼
                 React subscribes via Tauri event listener
```

`kind` is one of a closed enum: `"title" | "selection" | "visible_text" | "reward_card" | "url" | "screenshot"`. Anything else gets dropped at the Rust validator. This is the **single audit point** the security review chases.

---

## 4 · Recommended BrowserOverlay architecture (desktop-2)

### 4.1 · Tauri side (~250 LOC)

New file: `desktop-2/src-tauri/src/browse.rs`. Mirrors the legacy 140-LOC `browse.rs` plus a capture command.

```
pub const PANEL_LABEL: &str = "browse_panel";

#[tauri::command] async fn open_browse_panel(url: String) -> Result<(), String>
#[tauri::command] async fn close_browse_panel() -> Result<(), String>
#[tauri::command] async fn is_browse_panel_open() -> bool
#[tauri::command] async fn browse_back() / forward / reload
#[tauri::command] async fn browse_capture(kind: CaptureKind) -> Result<CapturePayload, String>
#[tauri::command] async fn browse_consent_state() -> ConsentSnapshot
```

`browse_capture` accepts only the closed `CaptureKind` enum and calls `wv.eval(...)` with the matching script.

### 4.2 · React side · `BrowserOverlay` route

New route: `desktop-2/src/design-os/routes/BrowserOverlay.tsx` (and `BrowserOverlay.css`).

Layout (matches the existing workbench framing memory):

```
┌──────────────────────────────┬────────────────────────────────┐
│                              │  ┌────────────────────────────┐ │
│                              │  │  Chrome bar                │ │
│   Liquid Clips main UI       │  │  ← → ↻  https://whop.com/… │ │
│   (campaign / earn / etc)    │  │  [Capture] [Reconcile] [×] │ │
│                              │  ├────────────────────────────┤ │
│                              │  │                            │ │
│                              │  │   Native Tauri WKWebview   │ │
│                              │  │   (owned by Rust)          │ │
│                              │  │                            │ │
│                              │  │                            │ │
│                              │  └────────────────────────────┘ │
└──────────────────────────────┴────────────────────────────────┘
```

Right pane is the legacy `560px` panel pattern. Chrome bar above renders Capture / Reconcile buttons conditionally based on `url` heuristics (e.g. show "Reconcile this reward" only when URL matches `whop.com/c/*/bounties/*` or `…/links/*`).

### 4.3 · Event surfaces (new)

- `browse:url-changed` · payload `{ url, title }` · fires on every navigation
- `browse:reward-detected` · payload `{ rewardUrlOrId, snapshot }` · fires when on_navigation matched a known Whop reward URL pattern AND a capture was opt-in completed
- `browse:capture-completed` · payload `{ kind, data, sourceUrl, capturedAt }` · downstream consumers (Reconciliation engine) listen for these
- `browse:consent-changed` · payload `{ scope, granted }` · audit trail

These plug into the existing `bus.emit("browse:open", …)` graph cleanly. No refactor needed.

### 4.4 · Sizing the work

| Layer | LOC | Risk |
|---|---|---|
| Rust browse.rs (port) | ~140 | Low — direct copy from legacy |
| Rust capture bridge + Cmd enum | ~100 | Medium — security audit needed |
| desktop-2 capabilities allow-list | ~30 | Low |
| desktop-2 CSP relaxation for whop.com page-load | ~5 | Low |
| BrowserOverlay React route | ~250 | Low |
| Capture page-side library (initialization_script) | ~150 | Medium — DOM stability of Whop |
| Consent UI (toast + chrome-bar pill) | ~80 | Low |
| Total | **~750 LOC** | Medium overall |

Tractable in one focused sprint (~3–4 days).

---

## 5 · Safe data-capture boundaries (security contract)

### 5.1 · Hard rules (locked, never relax)

| Rule | Enforcement |
|---|---|
| No cookie access | Tauri API doesn't expose cookies. Don't bypass via platform-specific shim. |
| No token interception | No reading localStorage of cross-origin pages. Initialization script must scope to `document` and `getSelection()` only. |
| No hidden API interception | No `fetch` proxy, no URLProtocol swizzling. |
| No automated reward actions | No `eval("…click form button…")` ever. Capture is read-only. |
| Explicit user consent per kind | Each `CaptureKind` requires either (a) user click of "Capture", or (b) granted persistent scope via consent UI. |
| Visible content only | Initialization script reads `innerText` / `outerHTML` of pre-flagged container nodes — never document-wide dumps. |
| Closed enum of capture kinds | Rust validates `kind` against a `CaptureKind` enum and refuses unknown values. |
| No outbound traffic from page-side library | Initialization script only emits to Rust via `__TAURI_INTERNALS__.invoke`. No `fetch` calls. |

### 5.2 · Consent model

Three consent scopes, monotonically increasing:

| Scope | Persists | Triggers |
|---|---|---|
| **`per-click`** (default) | One capture per button click | "Capture from this page" button |
| **`per-session`** | Until panel closes | "Track this reward while open" toggle on chrome bar |
| **`per-reward`** (stored in app DB) | Until user revokes | "Auto-import updates for this reward" opt-in on a specific reward |

Consent state lives on a `BrowserConsent` row (`{ scope, url_pattern, granted_at, expires_at }`) in the desktop sidecar DB. All Rust capture commands check consent before executing.

### 5.3 · Auditable persistence

Every capture writes a `BrowserCaptureEvent` row: `{ kind, source_url, captured_at, payload_hash }`. Payload itself is stored only if the user explicitly imports it — observation events store only metadata. Users can view + delete history.

---

## 6 · ToS / compliance considerations

### 6.1 · Whop ToS posture (read carefully before v1.5 ships)

Whop's standard developer agreement restricts:
- Automated scraping without API key
- Circumventing access controls
- Redistributing reward data without consent

What it permits (by safe-harbor reading + industry precedent):
- A logged-in user viewing their own dashboard
- A user copy-pasting / importing what they're already looking at
- App API key reads of `publicBounty` (we already do this · §8 patch)

The compliance distinction is **agency of access**:

| Pattern | Posture |
|---|---|
| Automated headless poll of Whop URLs | ❌ ToS violation risk |
| User-initiated capture of a page they navigated to | ✅ Safe — courts have held this is "viewing what you already see" (hiQ v. LinkedIn, CFAA scope) |
| Per-session shadow observation with explicit consent | ✅ Safe under same reasoning, but worth a written ToS check before shipping |
| Cross-user redistribution of captured data | ❌ Risk — captures are user-private by default |

### 6.2 · Compliance guardrails to bake in

1. **Always logged-in-as-user.** Capture only runs in the user's own logged-in webview session. Never extract data the user wouldn't see manually.
2. **No redistribution without owner consent.** Captures are scoped to the user's own account. Agency-captured reward data can be shared with that agency's team, but not with third-party clippers without separate consent.
3. **Audit log on every capture.** User can view "what Liquid Clips has read from Whop on my behalf" at any time.
4. **One-button revoke.** Settings → Browser Capture → Clear all capture data + revoke all consents.
5. **Pre-launch Whop conversation.** Before v1.5 ships, send a written ToS-clarification note to Whop developer relations describing the capability and asking for explicit approval. This is the cheapest insurance.

### 6.3 · App Store posture

Apple App Store guideline 3.1.1 (in-app commerce) is already handled in legacy — `BLOCKED_PATH_FRAGMENTS` in `browse.rs` short-circuits `/checkout`, `/billing`, `/upgrade`, etc to the OS browser. Port that filter unchanged.

Privacy manifest: capture adds a new "data collected" entry to `PrivacyInfo.xcprivacy` · category "User Content · linked-to-user / used-for-app-functionality" — straightforward declaration.

---

## 7 · Suggested roadmap

### 7.1 · Browser Capture v1 · "Manual import"

**Goal:** Agency can paste a Whop reward URL, open it in the LC browser, click "Capture reward info", and have the visible reward fields prefill the Step 2 brief textarea.

**Scope:**
- Port `browse.rs` to desktop-2 (~140 LOC)
- BrowserOverlay React route + chrome bar (~300 LOC)
- One `CaptureKind`: `reward_card` (reads title, payout, pool, deadline, platform allowlist from visible DOM)
- `browse:capture-completed` event flows to Step 2 of the agency creation flow · prefills `description` textarea (still user-editable)
- `per-click` consent only

**Capability matrix:**
- ✅ URL
- ✅ Title
- ✅ Visible reward fields (selector-targeted DOM read)
- ❌ Screenshots
- ❌ Selection persistence

**Effort:** ~3 days. **Value:** Eliminates the manual mirror typing in the §8 patch's Step 2 for the happy path.

**Ship gate:** Whop developer-relations sign-off.

### 7.2 · Reconciliation v1.5 · "Show me what differs"

**Goal:** Agency campaign page surfaces a "Reconcile with Whop" button. Opening the matching Whop reward in LC's browser triggers a diff card: payout-copy, deadline, eligibility, status — each shown side-by-side LC vs Whop, with stale-flag highlighting.

**Scope (delta from v1):**
- `per-session` consent (chrome bar pill: "Tracking this reward")
- New `CaptureKind`: `reward_full_snapshot` (richer DOM dump within `visible-page-only` rule)
- New backend table: `whop_reward_reconciliation_event` · `{ campaign_slug, captured_at, diff_json }`
- New UI: ReconciliationDrawer component shows the diff
- Whop URL-pattern detector built into `on_navigation` — auto-suggests reconciliation when user lands on `whop.com/c/*/bounties/*` matching a known LC campaign
- Clipper-side variant: "You're viewing reward X · this matches LC campaign Y · open it in LC?"

**Capability matrix (additions):**
- ✅ Selected text (clipper highlights submission criteria → LC saves to brief)
- ✅ Visible-text DOM region capture (richer than v1)
- ❌ Screenshots
- ❌ Background polling (still requires user click or session-explicit consent)

**Effort:** ~5 days. **Value:** Trust-builder. Agencies see LC is honest about what Whop says. Clippers stop double-checking.

**Ship gate:** v1 stable for 60 days · written Whop ToS clearance.

### 7.3 · Deep Assist v2 · "Reconciliation as a campaign feature"

**Goal:** Campaign page promotes Reconciliation to a first-class panel. Background observation (per-reward consented) builds a longitudinal record. Submission-evidence and reward-status capture begins.

**Scope (delta from v1.5):**
- `per-reward` persistent consent
- New `CaptureKind` set: `submission_evidence` (clipper confirms "this is the post I submitted to Whop"), `payout_event` (user confirms "Whop paid me $X for this clip")
- Background URL-change observation while overlay is open · LC builds a shadow timeline of Whop activity
- **Screenshots** become available — `browse_capture_screenshot` Rust command using `objc2`/`windows-rs` thin shim
- Reconciliation dashboard: per-campaign match-rate vs Whop ledger, surfaced to agencies as a trust metric
- Approaches the "graduation criteria" framing — but native LC rewards do NOT ship in v2. This is still strictly reconciliation.

**Capability matrix (additions):**
- ✅ Screenshots (user-confirmed evidence capture)
- ✅ Background URL-change broadcast (within consented `per-reward` scope)
- ❌ Still no token / cookie / network interception
- ❌ Still no automated reward actions

**Effort:** ~10–12 days. **Value:** Closes the loop. Liquid Clips becomes the primary operational layer agencies + clippers actually use, with Whop reconciliation invisible-but-honest.

**Ship gate:** Native rewards work begins **after** the §8 graduation criteria (100+ campaigns, 10,000+ tracked submissions, 95%+ match rate, 90-day sustained). Deep Assist v2 ships before that and de-risks it.

### 7.4 · What does NOT belong on this roadmap

- Headless Whop polling without an active webview · ❌ never
- Cookie/token capture · ❌ never
- Cross-account redistribution of capture data · ❌ never
- Automated Whop actions (submitting a clip, marking a payout) · ❌ never
- A second LC-native reward engine · ❌ explicitly deferred per pre-6N-E lock

---

## 8 · Recommendations

1. **Treat v1 as scaffolding work**, not feature work. The legacy `browse.rs` is 140 LOC of audited Rust that has been in production. Porting it is low-risk; the high-leverage addition is the single audited capture bridge.
2. **Build the consent UI first**, before any capture lands. The trust posture is more important than the first imported field.
3. **Pre-launch ToS conversation with Whop.** Cheapest insurance — sending a one-page description before v1.5 ships avoids a six-figure legal review later.
4. **Hard-code the closed `CaptureKind` enum.** No string-typed capture commands. Every new kind requires a Rust change + a security review.
5. **Audit log surface from day one** · users can see + delete every capture LC has made on their behalf. Settings → Browser Capture → History + Revoke.
6. **Plug into `browse:open` graph that already exists** · zero refactor of the §8 patch. The existing `bus.emit("browse:open", …)` calls become natural entry points for capture-aware navigation.
7. **Sequencing**: 6N-E ships first as planned. Browser Capture v1 is a separate sprint that does not block agency campaign creation. The §8 URL-first flow already works without capture.

---

## 9 · TL;DR

- Legacy Liquid Clips already runs a working Whop side-browser. Porting it to desktop-2 unlocks Browser Capture.
- Tauri 2 webviews expose URL, title, page-script eval, and (with platform-specific shims) screenshots — sufficient for everything in v1/v1.5/v2.
- Cookies / tokens / hidden API responses are **off-table forever** — the strategic value is reconciliation, not impersonation.
- v1 = manual import. v1.5 = side-by-side diff. v2 = consented background observation + screenshots.
- 6N-E does not block on this. Build proceeds under the §8 URL-first patch.

---

*Audit complete · ready for build authorization on a separate turn.*
