# Draft · email to Whop dev support

**Send from:** danieldiyepriye@gmail.com (or whichever domain owns the Liquid Clips company `biz_0IMrpJRrTJID1u` on Whop)
**To:** dev@whop.com
**Cc:** support@whop.com (optional)
**Subject:** Elevated API access request · Liquid Clips (biz_0IMrpJRrTJID1u) · Content Rewards + Wallet reads

---

Hi Whop dev team,

I'm the founder of Liquid Clips (Whop company `biz_0IMrpJRrTJID1u`, product `prod_V8UzHw4fxCqaJ`). We're a video-clipping desktop app that integrates deeply with Whop — checkout, memberships, agent onboarding, affiliate payouts. Membership plans currently live: `plan_NMKvKj8SVVKsY` (Agency $99.99/mo, immediate charge) and `plan_SMaXhQLXpSOaH` ($1 Whop authorization / card-on-file trust wall).

We're about to open public cold-traffic and would like to request elevated API access for two capability blocks that our current account key doesn't authorize.

## 1 · Content Rewards / Bounties API

**What we need:** Read/write access to `v2/content-rewards`, `v2/bounties`, `v2/campaigns` (currently returning 401 "The API Key supplied does not have permission to access this route" · verified via curl 2026-07-07).

**Use case:** Our Agency-tier customers currently create clipping campaigns inside our app. We want to programmatically syndicate those campaigns to Whop's marketplace so any Whop clipper can find and claim them. Attribution back to the referring Liquid Clips agency via `metadata.liquid_clips_source_campaign_id`. Agency retains 50% MRR on referred clippers per our existing affiliate model.

**Fallback we're using today (works but suboptimal):** in-app webview handoff to `whop.com/dashboard/{company_id}/bounties/new` with prefill URL params. Agency completes on Whop's side, we listen to the `bounty_created` webhook and mirror to our `sponsored_campaigns` table. This ships, but native API access would remove the two-hop UX.

## 2 · Wallet + payments read (per-user scope)

**What we need:** Read access to `v2/wallet`, `v2/balance`, `v2/withdrawals`, `v2/payouts`, `v2/ledger` — same 401 today.

**Use case:** We're building a branded Wallet page inside our desktop app showing users their earnings history and connected wallet address. The "Withdraw" button routes back to Whop's own wallet page via our persistent-cookie in-app browser (users' Whop session survives from Gate 1), so Whop still owns the actual money movement — we just want to display the state honestly in our branded UI.

Read-only scope is sufficient. We don't want to trigger payouts ourselves; that stays on Whop.

**Fallback we're using today:** `v2/payments` + `v2/memberships` (both 200 with our key). Works but doesn't cover balance / pending withdrawals which are the numbers users most want to see on their dashboard.

## Auth pattern preferences

- Scoped key with read-only bounty + wallet permissions is our top ask
- We already run per-request `x-internal-secret` gating on our backend so key material never leaves our server
- Happy to migrate to a Partner API key if that's your preferred surface

## Additional context

- Whop affiliate code per user is populated via existing v2 API (`whop_affiliate_code` on users) and works fine · not part of this request
- Our Whop webhook consumer (`webhook.whop.membership_valid`, `payment.succeeded`, `payment_refunded`, etc.) is stable
- Public launch target within 30 days
- Happy to jump on a call if easier

Thanks in advance.

— Daniel Diyepriye
Founder, Liquid Clips
danieldiyepriye@gmail.com
Company ID: `biz_0IMrpJRrTJID1u`
