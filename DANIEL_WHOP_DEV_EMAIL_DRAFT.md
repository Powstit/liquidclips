# Draft · email to Whop dev support

**Status (2026-08-14):** rewritten to match the current, narrower ask.
The original draft requested broad bounties/content-rewards read-write
plus wallet-read access. The wallet-read half is now **obsolete** — we
solved that ourselves this session by polling the existing
`listOverrides` affiliate endpoint instead of needing a new scope. What's
actually left blocking us is two specific, named permissions that aren't
self-service — confirmed absent from both the granted-permissions list
and the "add permissions" search in the app dashboard (checked directly,
not inferred from a 401).

**Send from:** danieldiyepriye@gmail.com (or whichever domain owns the Liquid Clips company `biz_0IMrpJRrTJID1u` on Whop)
**To:** dev@whop.com
**Cc:** support@whop.com (optional)
**Subject:** Permission request · Liquid Clips (biz_0IMrpJRrTJID1u) · `bounty:create` + `bounty:submission:create`

---

Hi Whop dev team,

I'm the founder of Liquid Clips (company `biz_0IMrpJRrTJID1u`, product `prod_V8UzHw4fxCqaJ`) — a video-clipping desktop app already integrated with Whop for checkout, memberships, and affiliate payouts (50% MRR revenue share, powered by your overrides API). Current live plans: `plan_NMKvKj8SVVKsY` (Agency, $99.99/mo) among others under the same product.

We'd like to request two specific permissions for our app that we've confirmed aren't available to enable ourselves from the dashboard's Permissions tab — neither appears in our current granted list nor in the "add permissions" search:

## 1 · `bounty:create`

**Use case:** today, a company running a clip bounty through Liquid Clips has to leave our app and create the bounty directly on whop.com. We want that action to happen without the hop — the company stays inside Liquid Clips, we call Whop's Create Bounty endpoint on their behalf, and the bounty still lives on Whop exactly as if they'd made it there (same escrow, same marketplace visibility, same everything — we're just moving where the "create" button lives, not changing how bounties work).

## 2 · `bounty:submission:create`

**Use case:** the mirror image on the clipper side. A clipper edits their clip in Liquid Clips today, then has to leave the app to submit it on Whop's own bounty page — we can show them the bounty and read their submission's status back (`bounty:basic:read` already covers that), but we can't file the submission itself. This scope would close that one remaining gap.

## Why we think this is a safe grant

- Both permissions would only ever act on bounties/submissions tied to **our own company's app credentials** — not a general-purpose write key, no access to any other company's bounties.
- We're not asking for anything beyond what a user could already do by hand on whop.com — this is purely about where the button lives, not new capability on Whop's side.
- We already run per-request `x-internal-secret` gating server-side so key material never leaves our backend, and our existing webhook consumer + affiliate integration has been stable in production.
- Happy to do this via a scoped/Partner API key, a review call, or whatever verification step you'd normally require for a write-scope grant — whichever is easiest on your end.

## Additional context

- Everything else (bounty discovery, submission status reads, affiliate payouts) already works against our current key — this request is narrowly the two scopes above, nothing else.
- Public launch is live; this closes the last hop in an otherwise fully in-app clipper↔company loop.

Thanks in advance — happy to jump on a call if that's faster than email back-and-forth.

— Daniel Diyepriye
Founder, Liquid Clips
danieldiyepriye@gmail.com
Company ID: `biz_0IMrpJRrTJID1u`
