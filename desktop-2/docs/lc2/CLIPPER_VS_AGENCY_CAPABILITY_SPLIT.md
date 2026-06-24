# Clipper vs Agency Capability Split

**Status:** product/UX spec — no real tier wiring.  
**Date:** 2026-06-17  
**Target tree:** `/Users/dipdip/code/jnr/desktop-2`  

---

## 1. Core rule

A user must understand in 10 seconds:

```text
Clipper Mode = make clips, post clips, submit to Whop rewards.
Agency Mode = create campaigns, invite clippers, set campaign watermark, manage outputs.
```

---

## 2. Batch placement

```text
Batch 0 — Guard extension
Batch 1 — Senior UI foundation
Batch 1.5 — Mode system: Clipper vs Agency simulator state
Batch 2 — Home 4 cards with mode-aware inline/drawer interactions
Batch 3 — Sponsored reward banner carousel + LazyVideo
Batch 4 — Engine mode-aware watermark/review behaviour
Batch 5 — Browser overlay chrome only
```

---

## 3. Batch 1.5 — Mode system

Simulator-only mode state. No auth. No real tier check. No billing check.

**Files:**

```text
src/state/mode.ts
src/components/mode/ModeStrip.tsx
src/components/mode/ModeBadge.tsx
src/components/mode/CapabilityLock.tsx
```

**Mode values:**

```ts
type UserMode = "clipper" | "agency";
```

**Default:** `clipper`

**Persistence:** optionally `localStorage` key `lc:user-mode:v1`

---

## 4. Home mode strip

Home must show a mode strip above the four task cards:

```text
I am clipping for a campaign
I am creating a campaign
```

This changes visible guidance, not app access. Do not block the user.

---

## 5. Home card behaviour by mode

Keep the four cards always visible:

```text
Generate / Create Clips
Import
Thumbnails
Script
```

But the primary actions change.

### 5.1 Clipper mode

Home should prioritise:

```text
Join campaign
Generate clips
Open Engine
Submit to Whop
Connect channels
```

Generate card in Clipper mode must show:

```text
Join campaign
Paste YouTube URL
Generate clips
Generate 30 clips
Generate 100 clips
Open Engine
Submit to Whop
```

### 5.2 Agency mode

Home should prioritise:

```text
Create campaign
Set watermark
Invite clippers
Add source content
Open Engine
Reward setup on Whop
```

Generate card in Agency mode must show:

```text
Create campaign
Paste YouTube URL
Generate clips
Generate 30 clips
Generate 100 clips
Open Engine
Set campaign watermark
Invite clippers
```

---

## 6. Capability locks

Add honest lock/capability messaging.

### 6.1 Clipper cannot

```text
Create campaign
Set campaign reward rules
Set/remove campaign watermark
Invite/manage clippers
Approve/reject submissions
Manage agency billing
Create custom campaign banners
```

### 6.2 Agency cannot in v1

```text
Pay clippers natively
Track real views natively
Withdraw rewards inside Liquid Clips
Bypass Whop Content Rewards
Bypass Ayrshare for publishing
Store provider secrets in desktop
```

Use disabled buttons or lock badges where helpful. Do not hide everything. Teach the difference.

---

## 7. Campaign watermark rule

Campaign watermark is locked for clippers.

Every Clipper-facing campaign/engine surface must show:

```text
Campaign watermark locked
```

Do not create any UI that suggests clippers can remove the watermark.

Agency can set/preview watermark in simulator state, but no real export pipeline yet.

---

## 8. Campaigns section split

### 8.1 Agency view

Show:

```text
Agency Mode badge
Create campaign
Name campaign
Add source content
Set locked custom campaign watermark
Create/select campaign banner
Invite clippers
Open campaign community
Link Whop reward campaign
Set brief/rules
Allowed platforms
Review generated clips
Route to Engine
Route to Projects
Route to Schedule
Open Whop reward setup
Whop Checkout upgrade placeholder
Manage multiple campaigns
```

### 8.2 Clipper view

Show:

```text
You are viewing this as a clipper
Join campaign
View brief
Open Engine
Submit to Whop
Locked campaign watermark
Creator/community links
```

---

## 9. Clipper section

Clipper route must be clipper-first.

Show mission path:

```text
Join → Clip → Post → Submit → Earn
```

Show:

```text
Locked campaign watermark
Generate clips
Open Engine
Connect social channels
Publish via Ayrshare placeholder
Submit to Whop
Track on Whop
```

---

## 10. Earn section

Earn must be honest:

```text
Submit on Whop
Track on Whop
Withdraw on Whop
Native rewards are v2 deferred
```

No native payout numbers. No native view tracking. No “Liquid Clips pays you” copy.

---

## 11. Settings section

Settings can show simulator state:

```text
Current mode: Clipper / Agency
Agency access: locked/unlocked placeholder
Billing handled by Whop Checkout later
```

No real billing.

---

## 12. Whop surface split

```text
Agency upgrade / billing = Whop Checkout link-out
Clipper reward submission = Whop Content Rewards link-out
Reward tracking / withdrawal = Whop Content Rewards link-out
Community rooms = Whop link-out
```

---

## 13. Guard checks

Guard must confirm UI/docs include:

```text
Clipper Mode
Agency Mode
Campaign Owner
Create campaign
Set watermark
Invite clippers
Join campaign
Submit to Whop
Whop Checkout
Whop Content Rewards
Campaign watermark locked
Generate 100 clips
```

Guard must fail if UI/docs imply any of these exact phrases:

```text
- "Clippers can remove campaign watermark"
- "Liquid Clips pays clippers natively in v1"
- "Liquid Clips owns real view tracking in v1"
- "Agency tier is wired to real billing now"
```

---

## 14. Do not do

Do not build real tier wiring.  
Do not call Whop APIs.  
Do not call Ayrshare APIs.  
Do not add native payout tracking.  
Do not add native view tracking.  
Do not store provider secrets in desktop.  
Do not block simulator mode behind auth.
