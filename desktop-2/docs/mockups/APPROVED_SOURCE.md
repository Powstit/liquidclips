# Approved mockup source (canonical)

This folder — `desktop-2/docs/mockups/approved/` — is the canonical
source for every **Section-pipeline** mockup. Any React route that
lives under `src/routes/**` or `src/sections/**` and paints a money
surface (wallet, cold-entry, outreach, cancellation, catalog) MUST
port from one of the HTML files here.

No file may be added under `approved/` without:

1. Explicit greenlight from Daniel (screenshot / walkthrough / voice
   note).
2. A matching founder video at `desktop-2/public/brand/founder/*.mp4`
   OR a matching walkthrough MP4 at
   `desktop-2/public/brand/walkthroughs/*.mp4`.
3. A matching entry in `desktop-2/public/brand/walkthroughs/README.md`
   linking the MP4 back to the surface + approved HTML.

Referenced by:

- `desktop-2/CLAUDE.md` § "The money-surface rule (LOCKED 2026-07-10)"
- Ship-lens Section-pipeline gate (fails on missing approved HTML).
- `docs/mockups/APPROVED_SOURCE.md` (this file — self-reference for
  agents grepping the source tree).

## Current inventory

| Approved HTML                                | React target                                                        | Founder / walkthrough video                                        |
|----------------------------------------------|---------------------------------------------------------------------|--------------------------------------------------------------------|
| `login-activation.html`                      | `src/routes/login-activation/` (or the equivalent Login surface)    | `public/brand/founder/founder-hook.mp4` · `02-login-and-activation.mp4` |
| `catalog-carousel.html`                      | `src/routes/catalog/` (or the Home cockpit catalog strip)           | `01-clipping-pick-a-video.mp4`                                     |
| `cold-email-preview-embed-card.html`         | `src/routes/cold-entry/`                                            | `07-cold-email-preview-card.mp4`                                   |
| `demo-video-placement.html`                  | `src/routes/learn/`                                                 | `01-clipping-pick-a-video.mp4`                                     |
| `in-app-browser.html`                        | `src/components/browser/` overlay                                   | `06-in-app-browser.mp4`                                            |
| `sync-mail-money-drop.html`                  | `src/sections/outreach/SyncMailMoneyDrop.tsx`                       | `03-money-moment-broadcast-and-get-paid.mp4`                       |
| `wallet-detail.html`                         | `src/routes/wallet-detail/WalletDetail.tsx`                         | `public/brand/founder/founder-wallet.mp4` · `04-earn-wallet-and-payouts.mp4` |
| `cancellation-intercept.html`                | `src/routes/cancellation-intercept/CancellationIntercept.tsx`       | `05-cancellation-save.mp4`                                         |

Design-OS-pipeline routes (Home cockpit, Workstation, Campaigns,
Analytics, Channels, Settings, Support, Submissions, Thumbnail Studio,
Login onboarding) do NOT belong here. Those are tool surfaces —
ship-lens runs the behavioral phase only against them.
