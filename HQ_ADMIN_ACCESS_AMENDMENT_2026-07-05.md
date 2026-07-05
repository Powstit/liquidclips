# HQ · Admin access handoff · AMENDMENT (2026-07-05)

**Amends:** `HQ_ADMIN_ACCESS_HANDOFF_2026-07-05.md` (same folder)
**Reason:** I misread the SystemMap node text. Correcting one item before you build against a wrong spec.

---

## The correction — Peer Inbox is NOT something to build

In yesterday's handoff I wrote:

> *"Peer Inbox — genuinely unbuilt · landing page for incoming warm-peer replies + interaction dashboard. HQ's job to track cohort 0 engagement."*

**That's wrong.** I only read the two-line label + sub, not the full hint. Daniel caught it — kudos.

## What Peer Inbox actually is

From `SystemMapTab.tsx:230-240`, the full hint reads:

> *"Warm target's Gmail — receives peer recommendation with `?ref=<originator>`. Same nature as cold inbox: not probeable. Loop closes back to Preview Page — this is where K-factor > 1 lives."*

**Translation:** Peer Inbox is the **recipient's own Gmail inbox** — a real person's mailbox where the warm-peer email lands. It's a conceptual node on the flow chart representing "the email arrives here in someone else's Gmail." Nobody builds it. Same category as the Cold Inbox node (which is also grey because it's a lead's Gmail, not one of our surfaces).

## Why it renders grey on the SystemMap

Both Cold Inbox and Peer Inbox have no `probeUrl` — you can't health-probe an external Gmail. The SystemMap legend currently lumps two states together under grey:

- **Genuinely unbuilt** (F4 Deployer Surface — really needs building)
- **Conceptual · not probeable** (Cold Inbox, Peer Inbox — external Gmail we can't check)

That's a SystemMap legend fix, not a build request. If HQ (or CM lane) wants to clean this up, the change is:

1. Add a fourth `ProbeState` — e.g. `"external"` — with its own color (suggest fuchsia-tint) and legend label ("external · not probeable")
2. Set `probeState = "external"` for the two Gmail nodes at init time
3. Update `COLOURS` + `STATE_LABEL` maps at the bottom of `SystemMapTab.tsx` accordingly

Small change (~20 lines). Whoever picks it up should also update the top-of-file legend comment.

## Tracking is already end-to-end wired · nothing to build for that

You already know this but restating for the amendment record:

- **Instantly** tracks opens, clicks, replies per-recipient (their dashboard)
- **Backend `/r/{tracking_link_id}`** locks first-touch attribution at click (`redirect.py:1-100`)
- Full attribution chain — cold email → click → download → install → activate → paying — stamps at every stage
- Everything visible in `/admin/customer-signals` + `/admin/overview` via the API paths listed in the original handoff

## What still stands from yesterday's handoff

- Admin surface access paths (login + API) — still valid, still the ask
- SystemMap probeUrl fix for **F5 Contact Scan + F6 Broadcast Engine** — still valid, they actually shipped 2026-07-04 (commits `1ae0ad2` + `5a3bf05`), nodes need probe URLs
- **F4 Deployer Surface is the only genuinely unbuilt growth-engine node** — that's app-side (CM lane), scoped as sprint 2 after Cohort 0 lands
- Suggested Railway HQ dashboard layout still applies

## What HQ can drop from the todo list

- ❌ ~~Build Peer Inbox landing page~~ — not a thing to build
- ❌ ~~Peer Inbox as HQ deliverable~~ — nothing here

## What HQ can add to the todo list (only if you want)

- (optional) SystemMap `"external"` probeState fix so the two Gmail nodes render honestly instead of grey-as-unbuilt

Sorry for the noise. Corrected.

— CM lane
