# Wallet Page · Scope · 2026-06-24

**Status:** SCOPE only. Build is tomorrow when Daniel says go.
**Replaces:** SponsoredRewardModule's "Withdraw $X" silent-success button.
**Lives at:** Cockpit · Earn tab · new `WalletPanel.tsx` sub-section.
**Beta badge:** in header — sets expectation that withdraw isn't live yet.

---

## The one thing this MUST do

Show a clipper exactly how much money is in their pipeline, broken down by stage. No lies. No "Paid!" green checks when nothing moved.

## Pipeline stages (the headline rows)

| Row | What it means | Source | Status today |
|---|---|---|---|
| **🕓 In Review** | Submissions awaiting campaign owner approval | `CampaignSubmission.status == "pending"` × `payout_amount_cents` | Real |
| **✅ Approved · Awaiting Payout** | Approved by campaign owner, not yet paid | `status == "approved"` × `payout_amount_cents` | Real |
| **💰 Paid** | Money that has actually moved to clipper's wallet | `status == "paid"` (per Whop webhook) OR `User.carrot_total_paid_usd_cents` | Real (0 until `CARROT_WHOP_LIVE=true`) |
| **❌ Rejected** | Submissions the campaign owner declined (with reason) | `status == "rejected"` × `payout_amount_cents` + `rejection_reason` | Real |

**Pipeline total** = In Review + Approved + Paid (rejected excluded from the "you have $X" hero number).

## Secondary stats (always-visible)

- Lifetime views (across all clips) → `/me/lifetime-views` (already built task #100)
- Total submissions (count)
- Total approval rate (approved ÷ (approved + rejected))
- Affiliate referral revenue if any → existing `/whop/me` proxy (already wired)

## Per-campaign breakdown table

One row per campaign the clipper has submitted to:

| Campaign | Views | Submissions | Approved | Earned $ | Status |
|---|---|---|---|---|---|
| Uncle Daniel S3E1 | 4,200 | 2 | 1 | $50.00 | 1 in review |
| Coca-Cola Spring | 12,800 | 5 | 4 | $200.00 | All approved |

Click row → drill-in modal with per-submission detail (clip thumb, status, payout, link).

## Where withdraw lives

- `CARROT_WHOP_LIVE=false` (default): NO withdraw button. Just a small line in the header: *"Withdrawals open once Liquid Clips finishes wallet integration with Whop. Your earnings are tracked and safe."*
- `CARROT_WHOP_LIVE=true`: "Withdraw $X" button appears under the Paid row when `Approved · Awaiting Payout > $10` (matches existing `MIN_WITHDRAWAL_USD`).

The toggle is a single env flag — same page, no migration when flipped.

## Data sources (all already exist · no new backend work needed)

| Need | Endpoint | Built? |
|---|---|---|
| Submissions per user | `GET /me/submissions` OR `/submissions?user_id=me` | Need to add OR use existing `agency_campaigns.py` shape inverted |
| Lifetime views | `GET /me/lifetime-views` | ✅ Task #100 |
| Campaign metadata (title, payout_per_view) | `GET /campaigns` | ✅ Existing |
| Affiliate revenue | `GET /whop/me` | ✅ Existing |
| Carrot lifetime paid | `User.carrot_total_paid_usd_cents` | ✅ Task #108 |

**Possible new endpoint:** `GET /me/wallet/summary` that returns the entire wallet page payload in one call (denormalised) — saves 4 round-trips. ~80 lines backend.

## File deltas (estimate)

| Path | Action | Est. lines |
|---|---|---|
| `desktop-2/src/design-os/earn/WalletPanel.tsx` | NEW | ~250 |
| `desktop-2/src/design-os/earn/WalletCampaignRow.tsx` | NEW | ~80 |
| `desktop-2/src/design-os/earn/WalletSubmissionDrillIn.tsx` | NEW | ~120 |
| `desktop-2/src/lib/wallet.ts` (typed client) | NEW | ~60 |
| `junior-backend/app/routes/me_wallet.py` (NEW unified endpoint) | NEW | ~140 |
| `junior-backend/app/main.py` (register router) | EDIT | ~3 |
| Cockpit Earn tab — slot WalletPanel | EDIT | ~10 |
| `SponsoredRewardModule.tsx` — remove "Withdraw" button (move to WalletPanel withdraw section) | EDIT | ~30 (deletions) |

**Total: ~700 lines · ~1.5h focused agent work.**

## Gates the build must pass

- `liquid-clips-brand-kit` skill — wallet page uses --lc-* tokens, brand typography, brand asset for the wallet hero (consider invader.png or a brand-issued "vault" sprite)
- `ship-lens` DESIGN + STATE + JOURNEY
- `causal-proof-gate` — every backend endpoint proven with curl + JWT + status matrix
- `snapshot-proof-lens` — before/after of cockpit Earn tab
- `user-journey-automation-gate` — Playwright spec: signed-in user lands on Earn → Wallet shows 4 stat cards + per-campaign table → drill-in opens modal
- typecheck both repos GREEN
- "$50 silent-success lie" must NOT be reproducible after build — verify by trying to click "withdraw" with CARROT_WHOP_LIVE=false → button does not exist

## Out of scope (deferred)

- Withdraw button wiring (lives behind env flag; activated when sub-merchant + master USDC funded)
- Whop sub-merchant onboarding UX (existing endpoint kept; clipper-facing flow is its own sprint)
- Withdrawal history filtering / export (v2)
- Per-platform attribution (TikTok views vs IG views breakdown — already in PostAnalytic but UI deferred)
- Pipeline forecast ("estimated approval in 3 days") — needs campaign-owner SLA data we don't track yet

## Resume command for morning

```bash
cd /Users/dipdip/code/jnr && claude --resume d11d2b24-4ee6-48c4-8d62-09daf0dac363
# Start with: "build wallet per docs/WALLET_PAGE_SCOPE.md, ship after"
```
