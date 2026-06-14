# Upgrade + Self-Onboarding Customer Journey UI

**Status:** parked spec — do not implement until SECTION A (Auth) and SECTION B (Projects Manager) pass their Iron Gates.

**Purpose:** define the conversion architecture so Liquid Clips stops being leaky and starts self-onboarding, self-converting, and self-scaling.

**Core principle:**

> Do not show payment walls before the user understands the value.

Payment should trigger after a behaviour trigger where the user has already invested effort or shown clear intent. The payment wall should feel like:

> `You are already doing the thing. Upgrade to finish it properly.`

Not:

> `Pay before you know why.`

---

## 1. Behaviour-triggered paywall rule

Gate after action, not before discovery.

### Allowed free

- Browse public Earn campaigns.
- Open campaign details.
- Understand payout / platform / rules.
- Import or preview value where technically possible.
- Create lightweight proof of value.
- See what Projects unlock.
- Understand affiliate upside.
- See free / watermarked output path.

### Trigger upgrade after

- User tries to export no-watermark.
- User hits free clip / output limit.
- User starts a premium / payout workflow.
- User tries to use full Projects Manager.
- User tries to organise serious campaign work.
- User tries to batch / export / publish.
- User tries to activate affiliate / payout tooling.
- User has generated / previewed an asset and wants to keep / use it properly.

### Existing proven pattern

Thumbnail creation already uses a behaviour trigger:

> `User creates thumbnail → user is invested → payment request appears`

Use this same architecture across the app.

---

## 2. Copy principle

Every paywall must answer:

1. What did I just do?
2. Why am I seeing this now?
3. What do I unlock?
4. What happens after I pay?

Example structure:

> `You’ve created your first campaign asset. Upgrade to export it clean, organise it inside Projects, and unlock paid campaign tools.`

Primary CTA:

> `Upgrade and continue`

Secondary:

> `Keep using free with watermark`

---

## 3. Journey definitions by surface

### 3.1 Earn

#### Free discovery states

- Public bounty marketplace grid loads without auth.
- Bounty cards show title, payout/RPM, platforms, status.
- Bounty Detail shows payout/RPM, platforms, rules/description, creator/context, spots remaining, Whop brief link.

#### Behaviour trigger

- User clicks `Start campaign` on a bounty.

#### Auth gate

- If signed out, start activation first (connect-desktop flow), then return to the bounty.

#### Payment trigger

- User needs full earning workspace, no-watermark exports, premium missions, or paid campaign tools.

#### Upgrade wall

- Headline: `Start earning from this campaign`
- Body: `You’ve picked a campaign. Upgrade to create your earning Project, export clean clips, and submit for payout.`
- Primary CTA: `Upgrade and start earning`
- Secondary: `Keep browsing free bounties`

#### Post-upgrade return path

- Return to the same bounty or the newly created Earn Project.
- Primary CTA: `Open Project` or `Create first clip`.

---

### 3.2 Projects

#### Free discovery states

- See Projects value screen / locked preview.
- Understand Projects as campaign / client workspaces.

#### Behaviour trigger

- User tries to use full Projects Manager.
- User tries to add / manage serious project files.
- User tries to create organised earning workspace outside the free allowance.

#### Payment trigger

- User attempts a Pro-only Projects action while on Free / Solo.

#### Upgrade wall

- Headline: `Organise your clips into campaigns`
- Body: `You’re ready to run campaign work like a pro. Upgrade to create Projects, attach clips to campaigns, and manage client or bounty workspaces.`
- Primary CTA: `Upgrade to Pro and continue`
- Secondary: `Stay on free workspace`

#### Post-upgrade return path

- Unlock Projects.
- Open the Project the user was trying to create or use.

---

### 3.3 Clips / Exports

#### Free discovery states

- Import source.
- Preview generated clip / thumbnail / moment where possible.
- Use watermarked allowance.

#### Behaviour trigger

- User tries no-watermark export.
- User tries batch export.
- User selects premium render / export options.
- User hits free export limit.

#### Payment trigger

- Export action requires paid tier.

#### Upgrade wall

- Headline: `Export your clip clean`
- Body: `You’ve made a clip worth sharing. Upgrade to remove the Liquid Clips watermark, export in full quality, and publish or save all your clips.`
- Primary CTA: `Upgrade and export`
- Secondary: `Export with watermark`

#### Post-upgrade return path

- Continue export immediately.
- Do not dump user on a generic dashboard.

---

### 3.4 Affiliate / Community

#### Free discovery states

- Understand 50% recurring affiliate offer.
- See Road to 1M / community upside.

#### Behaviour trigger

- User tries to activate affiliate dashboard.
- User tries payout setup.
- User tries premium referral tooling.

#### Payment / auth trigger

- Signed-out users activate first.
- Free users upgrade to unlock affiliate payout tooling.

#### Upgrade wall

- Headline: `Unlock your affiliate dashboard`
- Body: `You’re ready to share Liquid Clips and earn 50% recurring commissions. Upgrade to activate your referral link, track referrals, and set up payouts.`
- Primary CTA: `Upgrade and activate affiliate`
- Secondary: `Learn more`

#### Post-upgrade return path

- Land on affiliate setup or sharing page.

---

## 4. Post-upgrade return paths

| Surface | Pre-pay action | Return landing |
|---|---|---|
| Earn bounty detail | Clicked Start campaign | Same bounty detail or new Earn Project |
| Earn Project | Tried to export/submit | Same Project, export/submit enabled |
| Projects locked | Clicked New Project / Add file | Projects Manager with new Project open |
| Clip export | Clicked no-watermark export | Export dialog continues |
| Affiliate | Clicked activate affiliate | Affiliate setup / sharing page |

All checkout completions must fire `lc:checkout-complete` so the desktop refreshes tier and unlocks the originating surface.

---

## 5. Dead-end prevention

- Every locked screen must explain value, not just say "Upgrade".
- Every upgrade CTA must use `openUpgradeWhenSignedIn()` so signed-out users activate first.
- After payment, the app must return to the context that triggered payment.
- After activation, the app must refresh tier and re-evaluate the gate that triggered the upgrade.
- No upgrade wall may appear before any free discovery is possible.

---

## 6. D1 Iron Gate checklist

D1 is not complete until:

- [ ] Upgrade never appears before the user understands value.
- [ ] User is never blocked before discovery.
- [ ] Payment walls never appear randomly.
- [ ] Checkout returns to the right place.
- [ ] After paying, the user knows what to do next.
- [ ] Locked screens explain value, not just "Upgrade".
- [ ] Free users can experience enough value to care.
- [ ] Premium users never see locked / reactivate states.
- [ ] Every upgrade CTA opens a real checkout, not a dead end.
- [ ] Every behaviour trigger is documented per surface.

---

## 7. Implementation order

1. Implement after SECTION A (Auth / Account / Upgrade) passes.
2. Implement after SECTION B (Projects Manager) passes.
3. Implement after SECTION C (Earn Workflow) passes.
4. Then implement D1 walls as part of SECTION D (Earn + Projects UI Polish) or as a dedicated D1 pass.

No commit until the originating feature Iron Gates pass.
