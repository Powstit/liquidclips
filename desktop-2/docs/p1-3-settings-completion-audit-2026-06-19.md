# P1-3 · Settings Completion Audit
### Pre-build investigation · NO CODE

*Date · 2026-06-19 · Author · Claude · Audit-only deliverable*

The purpose: take Settings from "mostly present" (P1-2 + P1-2A baseline) to "beta complete." Inventory every Settings-relevant surface across desktop-2's current Settings · the legacy desktop Settings · and the FastAPI backend. Map what's real / mocked / disconnected / writes-backend / local-state-only · surface beta blockers · recommend a one-section-at-a-time build order.

No code. No new endpoints. Audit only.

---

## 0 · Headline

- **6 sections shipped in P1-2 + P1-2A** · Account · Connection status · Whop role · Storage & security · Beta diagnostics · Actions.
- **5 of Daniel's 11 expected areas are missing entirely**: Profile · Notifications · Connected accounts · Preferences · Desktop behavior. Two more (Support · full Billing surface) are partially present.
- **7 of 11 areas can ship with existing legacy + backend** · the wires are there, the UI isn't.
- **4 of 11 areas NEED new backend endpoints** before Settings UI can write to them: notification preferences (per-category email opt-in) · user preferences (theme/motion/audio/keyboard) · update channel selector · auto-start toggle storage.
- **Hard beta blockers identified**: Support contact UI (lack of a way to report bugs = lost beta signal) · Connected accounts visibility (clippers need to see payout-connected state) · Billing subscription-status line (users get confused about why a tier is gated).
- **Build order recommends 7 sub-units** (P1-3-a through P1-3-g) · ~3 days end-to-end · stop-and-report between each per the Phase 1 protocol.

---

## 1 · Current desktop-2 Settings inventory

`desktop-2/src/design-os/routes/Settings.tsx` ships 6 cards inside the `DesignOSAppShell` `cockpit-home` world (P1-2A):

| Section | Renders | Backend? | Writes? |
|---|---|---|---|
| **Account** | Activation state · email · tier (display) · "Door" (Email/Whop/saved-earlier) · degraded strip | reads from `useActivation()` snapshot · NO live `/me` mount fetch | none |
| **Connection status** | Channels / Schedule / Community → Live or Studio preview pills | reads `useChannels().source` · `useSchedule().source` · `useCommunity().isMockFallback` | none |
| **Whop role** | 3 paragraphs of v1 truth · "what Whop does vs what LC does" | none · static copy | none |
| **Storage & security** | License source (browser localStorage today · macOS Keychain after P1-1F) · clear-activation button | reads `getAuthSource()` + `hasJwt()` · writes via `clearJwt()` + `clearActivation()` | local state only |
| **Beta diagnostics** | Backend URL · Runtime (Tauri vs browser) · Storage source · JWT key name + Copy button | reads inline env + `getAuthSource()` + `LICENSE_JWT_STORAGE_KEY` const | none |
| **Actions** | Refresh account status (calls `/sync` · rotates JWT silently · toast result) · Open Whop dashboard ↗ | reads `getJwt()` for Bearer header · `/sync` GET · `setJwt(new_license_jwt)` rotation | **JWT rotation only** |

**Subtotal · 6 sections, ~500 LOC. Real-world feel via P1-2A world wrap. Token never displayed.**

---

## 2 · Gap matrix · the 11 areas Daniel wants

For each area: legacy state · backend state · current desktop-2 state · gap classification.

| # | Area | Legacy desktop | Backend | desktop-2 today | Gap |
|---|---|---|---|---|---|
| **1** | **Account** | Full AccountTab · `/me` read · sign-out via `performAtomicSignOutWipe` (keychain wipe) | `/me` returns identity + tier truth | Has activation-derived email / tier / door · no `/me` boot fetch · no proper sign-out (only "clear local activation") | **PARTIAL · polish** · add boot-time `/me` mount fetch · expose admin_override / affiliate_id rows |
| **2** | **License** | `authStorage.ts` IG-014 invariant · `resumeSessionFromKeychainIfPresent` cold boot · auto-rotate via `/sync` ≤5d | `/sync` rotates JWT · License table | P1-1B authStorage + P1-1D activation already match · "Storage & security" + Refresh action cover surface | **DONE for v1** · macOS Keychain bridge is P1-1F · explicitly deferred |
| **3** | **Tier** | Sync-driven tier · feature-flag dict for offline gate · upgrade CTA branched by `billing_provider` | `/sync` returns tier + features · `/me` returns raw vs effective | Tier pill renders from activation snapshot only · no features dict read · no upgrade CTA | **PARTIAL** · add features dict read · add upgrade CTA differentiated by billing_provider (open Whop manage vs Clerk billing portal) |
| **4** | **Billing** | AccountTab shows subscription_status · paid_until · billing_provider · CTA routes correctly | `/sync` returns subscription_status + paid_until + billing_provider · `/affiliate/me` mirrors | NOT SHIPPED | **MISSING · ship as new card** · "Subscription" row group · status pill (active/canceled/trial/past_due) · renewal date · `Manage on Whop ↗` or `Manage on Clerk ↗` |
| **5** | **Profile** | Avatar + email display only (read-only · no edit) · email change happens in Clerk hosted page | `/me` returns email · Clerk hosts edit · webhook syncs `User.email` | NOT SHIPPED | **MISSING · ship as new card** · avatar from `useAvatar()` legacy port · email read-only · "Edit profile on Clerk ↗" CTA |
| **6** | **Notifications** | Telemetry consent toggle ONLY (localStorage) · NO email notif prefs UI | `/notifications` GET/POST/PATCH for INBOX (read/dismiss) · **NO `/me/notification-preferences` endpoint** | NOT SHIPPED | **MISSING · backend gap** · Settings UI can ship as telemetry toggle + "Email frequency: All / Critical only / None" but the email-frequency choice has no backend persistence · would be localStorage only until a `/me/notif-prefs` PATCH lands |
| **7** | **Connected accounts** | NOT in legacy Settings (Ayrshare lives in Schedule panel · Stripe Connect in Affiliate dashboard) | `/social/connections` GET returns connected_platforms · `/stripe-connect/*` for onboarding · Whop link via `/onboarding/link-whop` | NOT SHIPPED | **MISSING · ship as new card** · the 3-row chip group (Ayrshare · Whop · Stripe Connect) with status pills + "Connect / Manage" CTAs |
| **8** | **Preferences** | NOT in legacy Settings (no theme/motion/audio/keyboard UI anywhere) | **NO `/me/preferences` endpoint** | NOT SHIPPED | **MISSING · backend gap** · theme/motion/audio/keyboard toggles can ship as localStorage-backed for v1; cross-device sync deferred to post-beta |
| **9** | **Desktop behavior** | Update check UI (checkForUpdate · applyUpdate · lastUpdateCheck log) · NO auto-start toggle · NO update channel selector | `/updates` serves signed manifest · no preference storage | NOT SHIPPED · the Refresh action does NOT include "check for updates" | **MISSING · partial backend gap** · update check button can call existing `/updates/latest.json` · auto-start needs `tauri-plugin-autostart` (not in `Cargo.toml`) · update channel selector needs nothing today (only "stable" exists) |
| **10** | **Diagnostics** | DiagnosticsSection with sidecar status probe (checkDeps · hardwareInfo · Python version · missing modules) · Copy diagnostics markdown · Boot-time errors | sidecar RPCs (`checkDeps`, `hardwareInfo`, `licenseJwtPresence`) | "Beta diagnostics" card has 4 rows + JWT key copy · no sidecar health probes · no log dump · no error history | **PARTIAL** · expand into full surface with sidecar status row, "Copy diagnostics markdown" button, last-boot-error display |
| **11** | **Support** | SupportEmailSection with `hello@liquidclips.app` copy-to-clipboard · Open mail app · Privacy + ToS links | NONE (no support ticket endpoint) | NOT SHIPPED | **MISSING · ship as new card** · purely static UI + 3 `openSmart()` CTAs · trivial · **HARD BETA BLOCKER · without this users have no way to report bugs** |

**Tally ·**

| Status | Count | Areas |
|---|---|---|
| ✅ DONE for v1 | 1 | License |
| ⚠️ PARTIAL | 3 | Account · Tier · Diagnostics |
| ❌ MISSING (backend ready) | 5 | Billing · Profile · Connected accounts · Desktop behavior · Support |
| ❌ MISSING (needs new backend) | 2 | Notifications (per-category prefs) · Preferences (theme/motion/audio) |

---

## 3 · What writes to backend vs local state · current map

| Surface | Read source | Write target |
|---|---|---|
| Account email/tier | `useActivation()` snapshot + `getJwt()` for /sync | none (read-only) |
| License JWT | `localStorage.lc.license.jwt.v1` via authStorage | `clearJwt()` writes local · `setJwt(new_license_jwt)` writes local via /sync rotation |
| Connection status pills | hook `.source` fields | none |
| Beta diagnostics | inline env + auth source | none |
| Refresh account button | `getJwt()` + `/sync` GET | local `setJwt()` if `new_license_jwt` returned |
| Open Whop dashboard | static URL | none |
| Clear local activation | `clearJwt()` + `clearActivation()` | local cache + module state |
| Copy JWT key | `LICENSE_JWT_STORAGE_KEY` const | clipboard (no token value) |

**Settings today writes to ZERO backend mutation endpoints.** Only one ambient read (`/sync` on Refresh) and one transparent rotation. This is honest for v1 · NO accidental overwrites of paid state · NO surprise mutations.

After P1-3 additions:
- Profile edit · WRITES to Clerk via redirect, NOT directly to backend
- Connected accounts (Ayrshare connect) · POST `/social/connect`
- Stripe Connect onboarding · GET `/stripe-connect/account-link` (redirect to Stripe hosted onboarding)
- Whop link · POST `/onboarding/link-whop`
- Telemetry consent · localStorage only (matches legacy pattern)
- Other preferences (theme/motion) · localStorage only until backend lands

**No new mutation surface is added that risks tier/payout drift.** All Settings writes touch only:
- LC's own user identity links (Ayrshare key, Whop link, Stripe Connect)
- Local-only preference toggles
- Re-fetches of authoritative backend state

Per `feedback_no_goldfish_memory` · all three integration writes (Clerk · Whop · Stripe · Ayrshare) are already wired+tested. P1-3 doesn't rebuild any of them; it just exposes them in Settings.

---

## 4 · Beta blockers identified

Three hard blockers that should be reordered to land first:

| # | Blocker | Why it's hard | Where it goes |
|---|---|---|---|
| **B1** | **Support contact** missing | A beta tester with a bug has no in-app channel to report it. Bug signal goes to wrong inbox or gets lost entirely. **Highest-leverage 30-min addition.** | P1-3-a (first sub-unit) |
| **B2** | **Connected accounts** missing | Clipper-side: a user with no Stripe Connect account thinks LC owes them money but can't see why payouts aren't flowing. Agency-side: cannot see if Ayrshare is connected before pasting a Whop URL in a campaign. | P1-3-b (second sub-unit) |
| **B3** | **Billing / subscription status** missing | A user on a 14-day trial gets surprised when features lock. A canceled-Whop subscriber doesn't see why agency mode is gone. Currently zero "why am I gated?" affordance. | P1-3-c (third sub-unit) |

Three softer blockers that should land before beta but can wait until B1-B3 ship:

| # | Blocker | Why |
|---|---|---|
| **B4** | **Profile** missing | Users want to verify "is the right account signed in?" before they trust the app with their work. Email-display alone is enough for v1. |
| **B5** | **Account boot-fetch of `/me`** | Current Settings can show stale tier/email until the user explicitly clicks Refresh. Adding a mount-fetch of `/me` closes the gap. |
| **B6** | **Diagnostics expansion** | Power users + support escalations need "Copy diagnostics markdown" so a bug report can attach version + runtime + sidecar state in one paste. |

The remaining areas (Preferences · Notifications email prefs · Desktop behavior auto-start/update-channel) are NICE-to-have but NOT beta blockers. They can defer or ship as localStorage-only stubs.

---

## 5 · Recommended build order

One section at a time per the Phase 1 protocol. Stop-and-report between each. NO scope creep · NO visual redesign · NO new design language.

### **P1-3-a · Support contact** (~0.5d · highest leverage)

**Goal:** beta testers can report a bug in one click.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · add one card "Support" before the existing Actions card
- `desktop-2/src/design-os/routes/Settings.css` · no new rules · reuse existing `lc-settings-card` styles

**Contents:**
- Row 1 · `hello@liquidclips.app` + Copy button (clipboard write)
- Row 2 · `Open mail client ↗` button (`openSmart("mailto:hello@liquidclips.app?subject=Beta · ")`)
- Row 3 · `Read docs ↗` button (`openSmart("https://liquidclips.app/docs")` if URL exists, else hidden)
- Row 4 · `Open Privacy ↗` + `Open Terms ↗`
- Kade-voice hint · "Kade · before you email, tap Copy diagnostics in the section below."

**Verification:**
- `npx tsc --noEmit`
- Manual click of each button opens the right surface
- Copy clipboard works (same pattern as JWT key copy)

### **P1-3-b · Connected accounts** (~0.75d)

**Goal:** user sees Ayrshare · Whop · Stripe Connect status with one CTA per row.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · new card "Connected accounts"
- Reuse `useChannels()` or wire `agencyWhop` / `social.listConnections()` sidecar surfaces

**Contents:**
- Row 1 · **Ayrshare (social publishing)** · status pill (Connected / Not connected) · CTA `Connect ↗` (opens account-app onboarding) or `Manage ↗`
- Row 2 · **Whop (community + reward)** · status pill from `whop_user_id` presence in `/me` · CTA `Open Whop ↗`
- Row 3 · **Stripe Connect (payouts)** · status pill from `/stripe-connect/me` (account_status: pending · onboarded · restricted) · CTA `Start payouts ↗` or `Manage payouts ↗`
- Kade-voice hint per the v1 truth: "Kade · these are the bridges. Payouts settle on Whop · Liquid Clips just shows the status."

### **P1-3-c · Billing & subscription** (~0.5d)

**Goal:** user sees subscription state + renewal date + manage CTA.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · new card "Subscription"
- Add a small `useMe()` hook (or extend `useActivation` to call `/me` on mount) for `subscription_status` + `paid_until` + `billing_provider`

**Contents:**
- Row 1 · Status pill: `Active / Trial / Canceled · grace period until <date> / Past due / Free`
- Row 2 · Renewal: `Renews on <date>` (or "No active subscription")
- Row 3 · Provider: `Billed via Whop` / `Billed via Clerk`
- CTA · `Manage subscription on Whop ↗` or `Manage subscription on Clerk ↗` (provider-conditional)

### **P1-3-d · Profile** (~0.25d)

**Goal:** user can verify which account is signed in.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · new card "Profile" between Account and Subscription

**Contents:**
- Avatar (initials chip from email if no avatar URL; defer image upload to post-beta)
- Display name (from `/me` if available · email-derived fallback)
- Email (read-only)
- CTA · `Edit profile on Clerk ↗` (opens account-app dashboard)

### **P1-3-e · Account polish + boot-fetch `/me`** (~0.5d)

**Goal:** Account section reflects backend truth from first paint.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · move existing Account section to read from new `useMe()` hook
- New `desktop-2/src/design-os/state/useMe.ts` · single GET `/me` fetch on mount + manual refresh

**Contents:**
- Hook mounts `/me` on first render when JWT present
- Boot-fetched email + tier override the activation snapshot
- Add admin_override row (when true) · "Admin override active"
- Add affiliate_id row (when present) · "Affiliate · `<id>`"
- Add `Sign out` button (full clear: `clearJwt()` + `clearActivation()` + reload)

### **P1-3-f · Diagnostics expansion** (~0.5d)

**Goal:** power users + support escalations can paste a complete state dump.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · expand Beta diagnostics card

**Contents:**
- Existing rows (Backend URL · Runtime · Storage source · JWT key) preserved
- New row · App version · `<package.json version>` + git SHA if available
- New row · Sidecar health (probe `__TAURI_INTERNALS__` presence; future P1-1F can extend)
- New row · Last boot timestamp · `<ISO>`
- New row · Last `/sync` result · `<ok / error · status>`
- New button · `Copy diagnostics markdown ↗` · constructs a markdown block of all rows + writes to clipboard

### **P1-3-g · Preferences + Desktop behavior (localStorage-only)** (~0.5d)

**Goal:** ship the toggles users expect, persist them locally until backend prefs endpoint lands.

**Files to touch:**
- `desktop-2/src/design-os/routes/Settings.tsx` · two new cards "Preferences" + "Desktop"
- New `desktop-2/src/lib/preferences.ts` · localStorage-backed key/value (theme · motion · audio · notification frequency · update channel)

**Contents (Preferences):**
- Theme · `Light / Dark / System` (drives CSS class on `<html>`)
- Motion · `Full / Reduced` (drives a `prefers-reduced-motion` class)
- Audio feedback · `On / Off` (drives a feature flag on `useEngineSession`)
- Notification frequency · `All / Critical only / None` (localStorage label only · backend write deferred)

**Contents (Desktop behavior):**
- Auto-start at login · OFF in v1 (no `tauri-plugin-autostart` in Cargo.toml yet · localStorage label only)
- Update channel · `Stable` (display only · single channel for beta)
- Check for updates · button calls `/updates/latest.json` (Tauri updater RPC) + toast result
- Download folder · `~/LiquidClips/` (read-only display · no edit UI in v1)

**Note:** Auto-start true wiring needs `tauri-plugin-autostart` added to `desktop-2/src-tauri/Cargo.toml`. Out of P1-3 strict scope. Toggle stays disabled with a "Lands with installer P1-4" tooltip.

### **P1-3-h · Audit + close** (~0.25d)

**Goal:** verify the new Settings hits Daniel's success criteria.

**Verification matrix:**
- A beta tester can understand who they are · ✓ Account + Profile + Subscription
- Their tier · ✓ Account tier pill + Subscription status
- Their license status · ✓ Storage & security + Diagnostics
- Connected services · ✓ Connected accounts
- Change preferences · ✓ Preferences card (localStorage)
- Recover from common issues · ✓ Support + Diagnostics

---

## 6 · Build sequence summary

| Sub-unit | Scope | Effort | Beta blocker? |
|---|---|---|---|
| P1-3-a | Support contact card | 0.5d | **YES** |
| P1-3-b | Connected accounts card | 0.75d | **YES** |
| P1-3-c | Billing & subscription card | 0.5d | **YES** |
| P1-3-d | Profile card | 0.25d | No (nice-to-have) |
| P1-3-e | `useMe()` hook + Account polish + Sign out | 0.5d | No |
| P1-3-f | Diagnostics expansion + Copy markdown | 0.5d | No |
| P1-3-g | Preferences + Desktop behavior (localStorage) | 0.5d | No |
| P1-3-h | Audit + close | 0.25d | n/a |
| | **Total** | **~3.75 days** | |

Phase 1 protocol: stop-and-report between each.

---

## 7 · What stays out of P1-3 (scope discipline)

Per Daniel's "No visual redesign · No new design language · No polish pass · Functional completion only":

- ❌ No new world wiring (Settings is on `cockpit-home` per P1-2A · unchanged)
- ❌ No new Kade choreography
- ❌ No loader animations (P2-1 visual debt)
- ❌ No FX particles on success/error
- ❌ No new card chrome (reuse `lc-settings-card` from P1-2)
- ❌ No native Keychain (P1-1F · deferred)
- ❌ No 401 self-heal (P1-1F · deferred)
- ❌ No new OAuth scopes (Whop bounty:create · explicitly locked)
- ❌ No billing CRUD UI (Settings shows status + manage link only · no in-app plan change)
- ❌ No avatar upload UI
- ❌ No display-name edit (Clerk hosts it)
- ❌ No new `/me/preferences` backend endpoint in P1-3 (preferences are localStorage-only until a separate backend phase)
- ❌ No `tauri-plugin-autostart` Rust dep change in P1-3 (auto-start toggle disabled with explanatory tooltip)

---

## 8 · Backend gaps that DON'T block P1-3 (will limit future polish)

| Gap | Impact | Resolution |
|---|---|---|
| `/me/preferences` endpoint missing | Theme/motion/audio prefs don't sync across devices | Acceptable for v1 (single-machine beta) · backend addition is its own small phase |
| `/me/notification-preferences` endpoint missing | Email-frequency choice is local-only | Acceptable for v1 · email throttle is still controlled by webhook handler |
| No support-ticket POST endpoint | Bug reports route via `mailto:` (legacy parity) | Acceptable for beta · post-beta upgrade to an in-app form |
| No `/me/display-name` PATCH | Display name change is Clerk-only | Acceptable · matches legacy |
| Update channel selector serves only "stable" | Single channel for beta · "beta" channel can land in P1-4 if Daniel wants | Acceptable |

None of these gaps block P1-3. Settings can ship complete with localStorage-only persistence on the affected toggles.

---

## 9 · Success-condition check

Daniel's success rule:

> A beta tester can understand who they are · their tier · their license status · their connected services · change preferences · recover from common issues · without needing support.

Predicted post-P1-3 state:

| Question | Settings card |
|---|---|
| Who am I? | Profile + Account |
| What tier am I on? | Account · Subscription |
| What's my license status? | Storage & security · Diagnostics |
| What services are connected? | Connected accounts |
| Can I change my preferences? | Preferences |
| How do I recover from a bug? | Support + Diagnostics (Copy markdown) |

**All 6 success conditions met without changing backend contracts.** Settings becomes self-serve for the beta audience.

---

## 10 · Honest gaps + risks

- **Preferences are local-only.** A user switching machines re-picks. Acceptable for v1.
- **No "delete my account" affordance.** Not in v1 scope · users would email support. Documented in Support card copy.
- **Sign out won't work in Tauri runtime until P1-1F native keychain.** Today `clearJwt()` clears `localStorage` only · Tauri-side has nothing to clear. Acceptable · localStorage is the only persistence.
- **Update channel selector** shows only "stable" because no `beta` channel exists yet. Out of v1 scope.
- **Connected accounts status for Stripe Connect** relies on the `/stripe-connect/me` endpoint returning current state · need to verify that endpoint returns what UI expects before P1-3-b ships.
- **Whop link status** depends on `whop_user_id` being non-null in `/me` · need backend confirmation that webhook landing reliably sets this on first Whop-bought membership.
- **Theme switching** with the existing CSS variable system: need to verify a runtime theme swap doesn't break framer-motion transitions or world-layer tints (deferred to live walk).

---

## 11 · TL;DR

- 5/11 Settings areas missing entirely · 2 partial · 1 done.
- **3 hard beta blockers** to ship FIRST: Support (P1-3-a) · Connected accounts (P1-3-b) · Billing (P1-3-c).
- **No new backend endpoints needed** for those 3 · all backend wires exist.
- **~3.75 days total** for full P1-3 across 8 sub-units · stop-and-report between each.
- Settings stays on the `cockpit-home` world · reuses existing card chrome · no new design language.
- Local-only preferences for v1 · cross-device sync deferred to a small post-beta backend phase.
- Auto-start toggle ships disabled with explanatory tooltip · true wiring is a P1-4 installer concern.

---

*Audit complete · no code · no endpoint changes · awaiting Daniel direction on P1-3-a start.*
