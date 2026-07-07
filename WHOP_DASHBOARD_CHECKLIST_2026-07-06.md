# Whop Dashboard · beta-blocking config click-list (2026-07-06)

**Estimate: 5-8 minutes total. All dashboard-only — my API key is App-scoped, not Company-Management, so I can't PATCH these from code.**

Login flow through Whop breaks or looks unbranded at every one of these. Fix in order — top-most block conversion the hardest.

---

## 1 · Founder plan branding fix (currently says "Junior")

**Where:** `whop.com/dashboard` → **Products** → **Liquid Clips** → plan `plan_NMKvKj8SVVKsY` → **Edit**

**Current** (scraped from live checkout page today):
> *"Junior is a desktop app that turns one long podcast, stream, or interview into 30+ ready-to-post clips…"*

**Change to:**
> *"Liquid Clips is a desktop app that turns one long podcast, stream, or interview into 30+ ready-to-post clips with captions, descriptions, thumbnails, and auto-publishing to YouTube, TikTok, and X.
>
> Pro tier unlocks embedded AI keys, unlimited clips, multi-account scheduling, drip mode, and AI thumbnails. Local processing, no watermark, ever.
>
> — FOR AFFILIATES —
>
> 50% commission on every subscription. Paid every month for as long as your referral stays subscribed. Refer 50 clippers, earn $1,225/month recurring. Refer 100, earn $2,450/month. Forever. Paid by Whop in 170+ countries via Stripe, PayPal, or crypto."*

**Save.**

---

## 2 · Redirect (success) URL

**Same plan editor** → **Advanced** → **Redirect URL after purchase**

**Set to:**
```
https://api.liquidclips.app/whop/checkout-success
```

**Why:** the backend endpoint mints the license JWT + 302s to `liquidclips://activate?token=…` which the deep-link handler catches. If unset, Whop returns the user to `whop.com/hub` — dead-end. **This is the single biggest checkout drop-off.**

---

## 3 · Founder plan visibility

**Same plan editor** → **Visibility**

**Set to:** `Visible`

**Why:** if hidden, only users who have the exact plan URL can check out. Any organic hits to `whop.com/liquidclips` see no Founder option.

**Verify:** visit `whop.com/liquidclips` in an incognito window → the Founder tile should appear.

---

## 4 · Company profile logo (LC lockup)

**Where:** `whop.com/dashboard` → **Company settings** → **Profile** → **Logo**

**Upload:** the primary Liquid Clips lockup. Ready to drag-drop at:
```
/Users/dipdip/code/jnr/account-app/public/brand/logo-primary.png
```
(1024×1024 PNG · fuchsia · already brand-locked)

**Why:** currently the checkout page shows the default Whop logo · every cold-lead lands on what looks like an unbranded generic-payment page. This is a trust bleed.

---

## 5 · Legacy plan grandfather check

**Verify** these three plan IDs still resolve to Founder tier so pre-July checkouts aren't stranded:

| Plan ID | Should redirect where |
|---|---|
| `plan_VWj1uoy2RcOsg` | Founder Access (hidden, grandfathered) |
| `plan_svbzoXoT4oj6b` | Founder Access (365-day-trial variant, grandfathered) |
| `plan_NMKvKj8SVVKsY` | Founder Access (canonical, from step 3 above) |

**Where to verify:** each plan's URL `whop.com/checkout/{plan_id}/` should load without a 404. Backend `FOUNDER_PLAN_IDS` already whitelists all three so any successful checkout maps to Founder — the risk is just checkout pages themselves being broken.

---

## 6 · QA test plan (already live · verify)

**Plan:** `plan_kx90QwXvszCI7` · $2/mo · hidden · for internal walk-throughs

**Verify:** `whop.com/checkout/plan_kx90QwXvszCI7/` loads (already confirmed live today).

**If missing** (unlikely — code references it): recreate as hidden `$2.00/mo` plan under the LC product. Update `WHOP_QA_TEST_PLAN_ID` in `desktop-2/src/lib/whopCheckout.ts:68` if you assign a new ID.

**Usage:** append `?qa=1` to any tauri-dev URL → the "I run an agency" CTA opens this $2 checkout instead of the $99.99 Founder plan. Use for your billing walk-through this week.

---

## Verification loop (do this last)

**Fresh incognito window:**

1. `whop.com/liquidclips` → Founder tile visible? ✅
2. Click Founder → checkout page loads with **Liquid Clips** logo (not Whop generic)? ✅
3. Description reads "Liquid Clips is a desktop app…" not "Junior is…"? ✅
4. Complete a $2 test checkout with the QA plan (`plan_kx90QwXvszCI7`) using a test card → after payment, browser redirects to `liquidclips://activate?token=…`? ✅
5. Desktop app receives the deep link → LoginScreen unmounts → app is signed in? ✅

If step 4 fails, the redirect URL from step 2 wasn't saved. If step 5 fails, the deep link scheme registration is broken on the desktop side (separate bug).

---

## What I'd do IF you give me a Company Management API key

If you generate a Company API Key at `whop.com/dashboard/developer/api-keys` and paste it into `~/.claude-credentials/whop-company.env` as `WHOP_COMPANY_API_KEY=<value>`, I can:

- Automate steps 1, 2, 3 with a bootstrap script
- Detect stale configs going forward
- Add a HQ dashboard tile that auto-verifies plan health

Not blocking · dashboard click-list is 5-8 min manual. Just an offer.

— Claude 1
