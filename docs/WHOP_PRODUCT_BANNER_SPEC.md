# Whop Product Banner — Liquid Clips spec

> **Status**: drafted 2026-06-03. Asset ready, upload pending Daniel.
> **Scope**: v0.5.1 — Ready Player One redesign rollout to Whop product card.

## What this document is

A one-page handoff so Daniel can upload the right asset to the right place
without re-deciding dimensions or copy. No new generations required; the
banner reuses the locked Kade-in-OASIS hero still that ships everywhere else.

## Whop product card dimensions (current spec)

Whop's product card banner is rendered as a 16:9 hero image at the top of the
public product page (`whop.com/<product-slug>`) and in product cards inside
hubs. As of 2026-06, the documented constraints are:

| Field           | Value                                  |
|-----------------|----------------------------------------|
| Aspect ratio    | **16:9**                               |
| Recommended     | **1920 × 1080** (Full HD)              |
| Maximum         | up to 1920 × 1080; will be downscaled  |
| Minimum         | 1280 × 720                             |
| Format          | PNG or JPG (PNG preferred for sharp UI)|
| File size       | < 5 MB                                 |
| Safe area       | Keep critical content inside the centre 80% — Whop overlays a price chip + CTA over the lower-right on mobile |

If the actual upload form rejects the asset, fall back to the Whop docs at
<https://dev.whop.com/branding> or the in-dashboard tooltip — Whop occasionally
tightens upper bounds without changing the recommended size.

## Recommended asset

**Use `marketing/img/kade-oasis-hero.png`** (also at `desktop/src/assets/intro/closing-still.png`).

| Property        | Value                                  |
|-----------------|----------------------------------------|
| Source          | `marketing/img/kade-oasis-hero.png`    |
| Dimensions      | 2752 × 1536                            |
| Aspect          | 1.79:1 — effectively 16:9              |
| File size       | ~12 MB                                 |
| Crop required   | None — already framed for 16:9         |
| Compression     | Yes — re-export to PNG-24 or JPG (q=92) to drop under Whop's 5 MB ceiling |

### Why this still

It is the same bookend frame the desktop intro lands on (`closing-still.png`)
and the same poster the landing-page cinematic uses (`liquidclips.app`).
Customers who watched the intro recognise the OASIS chamber immediately;
customers who didn't get a sharp, cinematic first impression that aligns with
the rest of the brand.

### If Whop rejects file size

1. Open `kade-oasis-hero.png` in Preview.
2. Export as JPG at quality 92, resize to 1920 × 1080.
3. Save as `assets-wip/whop/whop-banner-1080p.jpg`.
4. Upload that file instead.

This keeps the master PNG untouched for other surfaces.

## Suggested headline copy

The banner is image-only — Whop draws the product name and price chips over
the top. So the *headline you set on the product itself* (product title +
tagline fields) is what pairs with the image. Use one of:

- **Primary** — "Liquid Clips — Slash long videos into ready-to-post clips."
- **Gamer hook** — "Your own avatar in the OASIS. Cut clips. Earn rewards."
- **Short variant for the card** — "The clip studio in the OASIS."

Tagline field (Whop renders this under the title on the product card):

> "Drop a long video. Slash it into clips. Submit to paid Whop Content Rewards — all from one cinematic desktop app."

## Where Daniel uploads it

1. Sign in at <https://whop.com/dashboard/>.
2. Open the **Liquid Clips** product (the company hub product, not a
   campaign reward).
   - Direct pattern: `https://whop.com/dashboard/biz/<biz-id>/products/<product-id>/`
3. Click **Settings → Branding** (or **Storefront** on some product types).
4. **Banner image** field → upload the asset above.
5. Save. Whop's CDN typically reflects the change within ~60 seconds; hard-refresh the public product page to confirm.

If the product also has a **logo** field, keep the existing fuchsia `/` logo
mark — do not overwrite with a hero crop.

## Do not regenerate

The v0.5.0 generation budget is spent. Do **not** queue a new Higgsfield or
Seedance run for the Whop banner unless this asset materially fails QA on the
live product page. Reuse first.

## Owner

Daniel (upload + QA). Claude (spec, copy drafts). Compression fallback owned by
whoever runs the upload — no automation required.
