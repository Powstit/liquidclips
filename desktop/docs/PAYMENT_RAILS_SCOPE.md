# Payment Rails — Comprehensive Scope

## Executive Summary

Liquid Clips runs a **hybrid Whop + Clerk/Stripe** billing system. The desktop app never touches payment instruments directly. It embeds a webview for checkout and relies on a backend-authoritative license JWT stored in the OS keychain. Tier changes are detected via polling (`/sync` on window focus + auth-panel close), not webhooks.

**Current tiers:** Free → Solo ($29.99/mo) → Pro ($79.99/mo) → Agency ($149/mo)

**Free tier:** 100 clip exports, 3 visible clips in grid, watermarked exports, no publishing.

---

## Current Architecture

### 1. License JWT System (Authentication + Authorization)

**Flow:**
1. User clicks "Sign in" or "Upgrade" → desktop generates a one-time challenge nonce
2. Opens browser/webview to `account.jnremployee.com/connect-desktop?challenge=…`
3. User signs in via Clerk (or Whop OAuth)
4. Backend mints license JWT, deep-links back: `liquidclips://activate?token=<jwt>&challenge=…`
5. Desktop verifies challenge match, stores JWT in **OS keychain** via Python sidecar (`secret_set`)
6. Every authed request carries `Authorization: Bearer <jwt>`
7. On 401, JWT is deleted from keychain and app flips to signed-out state

**Files:**
- `src/lib/activation.ts` — deep-link activation bridge
- `src/lib/backend.ts:70-79` — `licenseJwt()` helper
- `src/lib/sidecar.ts:814` — `licenseJwtRead()` RPC
- `python-sidecar/secrets_store.py` — OS keychain read/write

### 2. Two Parallel Billing Rails

#### Rail A: Clerk / Stripe (Primary)
- Checkout: embedded Tauri webview (`auth_panel.rs`) hosting `account.jnremployee.com/upgrade`
- Stripe Checkout handled server-side by Clerk
- Post-payment: webview closes → Rust emits `auth-panel-closed` → desktop re-pulls `/sync`
- Management: `openAuthPanel("dashboard")` loads `account.jnremployee.com/dashboard`

#### Rail B: Whop (Secondary)
- Checkout: external browser to Whop hosted page
- Post-payment: user returns to app → window-focus `/sync` poll picks up new tier
- Management: `openExternal("https://whop.com/jnremployee")`
- Bounty integrations: `python-sidecar/whop_client.py`

**Files:**
- `src/components/auth/AuthPanel.tsx` — in-app upgrade webview
- `src-tauri/src/auth_panel.rs` — Rust webview + deep-link intercept
- `src/components/Settings.tsx:1183-1224` — subscription management buttons

### 3. Tier Gating Engine

**Client-side:** `src/lib/useTier.ts`
- Caches tier in `localStorage` (`lc:cached_tier`) to prevent "Free" flash on cold boot
- Re-polls `/sync` on mount, window focus, auth-panel close
- Admin email fallback: hardcoded founder emails get `agency` tier regardless of backend
- Capability matrix (`PUBLISH_MATRIX`): free=none, solo=publish_now_single, pro=schedule_one, agency=drip

**Backend-side:** `src/lib/backend.ts`
- `GET /sync` returns `tier`, `subscription_status`, `paid_until`, `billing_provider`, `remaining_exports`
- `GET /me` returns `effective_tier`, `admin_override`, `account_limit`
- `clipExported()` throws `QuotaExceededError` on 402 when 100 exports used
- `startVideoUsage()` decrements free-tier cap

---

## Gated Surfaces (Current State)

| Surface | Gate | CTA Action |
|---------|------|------------|
| Clip grid (only first 3 visible) | Free | `UpgradeLockCard` |
| Generate more clips | Free → Solo | `openAuthPanel("upgrade")` |
| 100-clip export quota | Free | `openAuthPanel("upgrade")` |
| Publish now | Free → Solo | `openAuthPanel("upgrade")` |
| Schedule one | Free → Pro | `openAuthPanel("upgrade")` |
| Multi-platform publish | Solo → Pro | Blocked in UI |
| Reaction layouts (bake) | Free → Solo | `openAuthPanel("upgrade")` |
| ClipCard "R" shortcut | Free → Solo | `openAuthPanel("upgrade")` |
| Overlay templates | Free → Solo | `openAuthPanel("upgrade")` |
| Bake retry | Free → Solo | `openAuthPanel("upgrade")` |
| **Thumbnail Studio AI Generate** | Agency only | "Upgrade in Settings →" |
| Earn campaigns | Growth/Pro | `onUpgrade()` |
| Affiliate earning | Solo+ | External upgrade URL |
| Watermark on exports | Free | `openAuthPanel("upgrade")` |
| Submission watermark check | Free | `openExternal(upgradeUrl)` |
| First-run OpenAI key | Free = required | Skip button for paid |

---

## What's Working ✅

1. **Tier gating** — Client-side matrix + backend 402 enforcement
2. **Free tier cap** — 100 clip exports, decremented via `/usage/clip-exported`
3. **License JWT / keychain** — Challenge-based activation, OS keychain storage
4. **Upgrade flow (Clerk/Stripe)** — Embedded webview checkout
5. **Whop billing** — OAuth + session token + bounty integrations
6. **Affiliate payouts** — Dual rail: Whop or Stripe Connect
7. **Window-focus tier refresh** — Catches post-checkout tier changes

---

## What's Missing / Broken ❌

### Critical

**1. Thumbnail Studio paywall triggers wrong tier**
- Current: `userTier === "agency"` required for AI Generate tab
- Required: Should trigger **Solo tier** checkout (per updated v0.8.0 spec)
- **Fix:** Change `ThumbnailStudio.tsx:79` from `agency` to `solo`, update upsell copy

**2. No webhook handling**
- Desktop relies entirely on polling (`/sync` on window focus)
- If user pays and doesn't return focus to the app, tier never updates
- **Fix:** Add deep-link callback from Stripe Checkout success (not just auth panel close)

**3. No offline billing grace period**
- If backend is down, paid users get demoted to Free tier
- `useTier.ts` falls back to `localStorage` cache, but capabilities are backend-enforced
- **Fix:** Cache `SyncStatus` with TTL (e.g., 24h) and serve stale data during backend outages

### High

**4. No dedicated Billing tab in Settings**
- Billing is buried inside Account category
- Users can't see invoice history, payment methods, or usage breakdown
- **Fix:** Add "Billing" category to Settings with: current plan, usage meter, invoice history, payment method

**5. No cancel subscription flow in-app**
- Users must navigate to external Whop page or Clerk dashboard
- **Fix:** Add "Cancel subscription" button in Settings → Billing with confirmation dialog

**6. Thumbnail generation costs not billed through backend**
- `thumbgen_ledger.jsonl` tracks local spend but backend doesn't know
- Users could theoretically refund subscription and keep using thumbnails
- **Fix:** Report thumbnail generation usage to backend `/usage/thumbnail-generated`

### Medium

**7. No team / seat management**
- Agency tier presumably supports multiple users, but no UI for inviting/removing
- **Fix:** Add "Team" section in Settings for agency users

**8. No usage-based metering for thumbnails**
- Thumbnails cost ~$0.07 each (OpenAI direct), but this is invisible to backend billing
- **Fix:** Backend should track thumbnail usage and enforce quotas

**9. UpgradeLockCard hardcodes "$29.99/month"**
- If prices change, this copy is stale
- **Fix:** Pull price from `TIER_COPY` or backend

### Low

**10. No Mac App Store IAP**
- App ships as Developer-ID DMG, so this is acceptable for now
- **Note:** If moving to App Store, entire billing rails must be rebuilt with StoreKit

---

## Recommended Improvements

### 1. Unified Billing Tab

Add a dedicated "Billing" tab to Settings:

```
┌─────────────────────────────────────────────┐
│  Settings                                    │
│  [Account] [Billing] [Keys] [About]          │
│                                              │
│  Current plan: Solo                          │
│  $29.99/month — Renews Jan 15, 2026          │
│                                              │
│  [Manage subscription →]                     │
│                                              │
│  ── Usage this month ──                      │
│  Clips exported: 47 / unlimited              │
│  Thumbnails generated: 12 ($0.84)            │
│  Social posts: 8                             │
│                                              │
│  ── Payment method ──                        │
│  Visa ·••• 4242                              │
│  [Update card →]                             │
│                                              │
│  ── Invoice history ──                       │
│  Dec 15, 2025 — $29.99  [Download PDF]       │
│  Nov 15, 2025 — $29.99  [Download PDF]       │
└─────────────────────────────────────────────┘
```

### 2. Thumbnail Studio Solo Tier Gate

Update `ThumbnailStudio.tsx`:
- AI Generate tab: unlock at **Solo** (not Agency)
- Batch save (365 thumbnails): requires active Solo subscription
- Preview 5 thumbnails: free with user's OpenAI key
- Paywall CTA: "Subscribe to Solo" (not "Upgrade to Agency")

### 3. Deep-Link Stripe Success

Add a Stripe Checkout success callback URL:
- `account.jnremployee.com/checkout/success?deep_link=liquidclips://tier-updated`
- Desktop receives deep link, immediately re-pulls `/sync`
- Eliminates reliance on window-focus polling

### 4. Usage Metering API

Create backend endpoints:
- `POST /usage/thumbnail-generated` — report thumbnail generation
- `POST /usage/social-post` — report social publish
- `GET /usage/summary` — return monthly usage breakdown

Desktop calls these after each billable action.

### 5. Offline Grace Period

In `useTier.ts`:
```ts
const CACHED_TIER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// If backend is down, serve stale cached tier instead of falling back to Free
const cached = localStorage.getItem(TIER_CACHE_KEY);
if (cached) {
  const { tier, ts } = JSON.parse(cached);
  if (Date.now() - ts < CACHED_TIER_TTL_MS) {
    return tier; // Serve stale data during outage
  }
}
```

---

## Iron Gates (Do Not Touch)

- **Do NOT store payment instruments** (cards, tokens) on the desktop
- **Do NOT implement custom checkout UI** — always delegate to Clerk/Stripe or Whop
- **Do NOT remove the license JWT keychain pattern** — it's the security boundary
- **Do NOT change the tier names** (`free`, `solo`, `pro`, `agency`) — backend depends on them
- **Do NOT remove the 100-free-clip starter pass** — it's the acquisition funnel
- **Do NOT change pricing in `TIER_COPY`** without backend coordination

---

## Implementation Priority

| Priority | Task | Effort | File(s) |
|----------|------|--------|---------|
| P0 | Fix Thumbnail Studio tier gate (agency → solo) | 30 min | `ThumbnailStudio.tsx` |
| P0 | Add offline grace period | 1 hour | `useTier.ts` |
| P1 | Add Billing tab to Settings | 4 hours | `Settings.tsx` + new components |
| P1 | Add cancel subscription button | 1 hour | `Settings.tsx` |
| P2 | Report thumbnail usage to backend | 2 hours | `sidecar.py` + `backend.ts` |
| P2 | Deep-link Stripe success | 2 hours | `activation.ts` + backend |
| P3 | Team management UI | 8 hours | New components + backend |
| P3 | Usage metering API | 4 hours | Backend endpoints |

---

## Key Files Reference

| Concern | File |
|---------|------|
| Tier hook + capability matrix | `src/lib/useTier.ts` |
| Backend client + `/sync` + `/me` | `src/lib/backend.ts` |
| License JWT read/write | `src/lib/sidecar.ts`, `python-sidecar/secrets_store.py` |
| In-app upgrade webview | `src/components/auth/AuthPanel.tsx` |
| Auth panel controller | `src/components/auth/useAuthPanel.ts` |
| Rust webview + deep-link | `src-tauri/src/auth_panel.rs` |
| Activation deep-link | `src/lib/activation.ts` |
| Settings subscription UI | `src/components/Settings.tsx` |
| Paywall card | `src/components/UpgradeLockCard.tsx` |
| Quota wall | `src/App.tsx` |
| Commerce redirect guard | `src-tauri/src/browse.rs` |
| Whop client | `python-sidecar/whop_client.py` |
