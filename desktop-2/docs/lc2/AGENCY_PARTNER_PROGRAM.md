# Agency Partner Program

**Status:** product/UX spec — no real affiliate API, no real payout tracking, no real billing.  
**Date:** 2026-06-17  
**Target tree:** `/Users/dipdip/code/jnr/desktop-2`  

---

## 1. Core rule

The app must clearly explain what agencies unlock when they subscribe.

Agency unlock message:

```text
Create clipping campaigns.
Invite clippers.
Lock your campaign watermark.
Launch reward campaigns through Whop.
Share your affiliate link.
Earn 50% MRR from every paid clipper you refer.
```

---

## 2. Affiliate ownership decision

For v1:

- **Whop owns:** checkout, subscriptions, affiliate/referral tracking, and payouts.
- **Liquid Clips owns:** UX, copy, dashboard cards, copy-link button, and link-out.

Do not build native affiliate payout tracking.  
Do not build native commission payouts.  
Do not imply Liquid Clips pays affiliates directly in v1.

---

## 3. Generate 100 clips gate

`Generate 100 clips` must always appear in the UI so the user understands the capability exists.

The button is gated by simulator plan/trial state:

```text
free / trial users:
  - see the button
  - see the lock/upgrade label
  - clicking it shows an honest placeholder (no real purchase flow yet)

paid / agency users:
  - see the button unlocked
  - see it as a primary fast action
```

No real billing is wired.

---

## 4. Simulator state

Suggested files:

```text
src/state/plan.ts
src/components/plan/PlanBadge.tsx
src/components/plan/PlanGate.tsx
```

Plan values:

```ts
type PlanTier = "free" | "trial" | "agency";
```

Default:

```text
free
```

Persistence optional:

```text
lc:user-plan:v1
```

No auth. No real tier check. No billing check.

---

## 5. Home Generate card gate behaviour

The Generate card must show `Generate 100 clips` in all states.

### Free / trial state

```text
Generate 100 clips
Upgrade on Whop to unlock
```

Use a lock badge or disabled-style button with clear copy.

### Agency / paid state

```text
Generate 100 clips
```

No lock badge. Primary or secondary action styling.

---

## 6. Affiliate link UX

Add an affiliate link card/surface for Agency mode:

```text
Your affiliate link
https://liquidclips.com/?ref=SIM123
Copy link
Track on Whop
```

- Copy button copies the simulator URL to clipboard.
- Track on Whop opens Whop in a new tab.
- No real referral code generation.
- No real view/signup tracking.

---

## 7. Agency unlock card

Show an unlock card in Agency mode or on Campaigns:

```text
Agency Partner Program
Create campaigns · Invite clippers · Lock watermark · Launch Whop rewards · Share affiliate link · Earn 50% MRR
Upgrade on Whop →
```

For paid/agency simulator state, the CTA becomes:

```text
Agency tools unlocked
Create campaign
```

---

## 8. Do not do

Do not call the Whop API.  
Do not call an affiliate API.  
Do not add native payout tracking.  
Do not add native view tracking.  
Do not store provider secrets in desktop.  
Do not block simulator state behind auth.  
Do not imply Liquid Clips pays affiliates directly in v1.

---

## 9. Guard checks

Guard must confirm UI/docs include:

```text
Agency Partner Program
Create clipping campaigns
Invite clippers
Lock your campaign watermark
Launch reward campaigns through Whop
Share your affiliate link
Earn 50% MRR
Generate 100 clips
Upgrade on Whop
Track on Whop
```

Guard must fail if UI/docs imply:

```text
Liquid Clips pays affiliates directly in v1
Native affiliate payout tracking exists
Real commission numbers are wired
Agency tier is wired to real billing now
```
