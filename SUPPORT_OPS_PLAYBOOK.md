# Liquid Clips — Support & Ops Playbook

Pre-launch blocker #5. Written for whoever is on support duty — assumes
no prior context beyond "I have admin access." Every mechanism named
here is real and already built; file paths point at the actual code so
you (or a future agent) can verify behavior instead of trusting this
doc blindly as things change.

## Where support requests come in

1. **#Message the Team** (Community → pinned top room) — a private
   1:1 line per user. Only that user and admins can see it.
   `junior-backend/app/routes/community.py` auto-creates one per user
   on first Community fetch; slug is `support-<user.id>`.
2. **#Bug Reports** (`bugs` slug) — public room, anyone can read it,
   but it's specifically where users are told to report bugs. Treat it
   as lower-priority/non-sensitive since other members can see replies.
3. Admin HQ (account-app `/admin/*`) for anything requiring a DB
   change — bans, tier overrides, refund set-offs.

There is no email/ticketing system in this codebase as of this
writing. If one gets added later, update this section.

## Scenario: "My account is locked, I can't do anything"

**What's actually happening:** either an admin ban (`User.banned_until`)
or an auto-lock from a failed payment (`User.payment_locked_at`).
Enforced in `junior-backend/app/deps.py` `current_user()` — every
license-JWT-authed request gets a 403 with a `reason` field:

```json
{"reason": "account_banned", "banned_until": "..."}
{"reason": "payment_locked", "locked_at": "..."}
```

**How to tell which one:** ask the user what error they saw, or check
the `users` row directly (Admin HQ or a DB query) — `banned_until` vs
`payment_locked_at`, whichever is non-null.

**payment_locked (the common case):** their card failed on the last
Whop billing attempt. This is 100% automatic — set the instant Whop
sends a `payment_failed` webhook
(`junior-backend/app/routes/webhooks_whop.py` `_handle_payment_failed`),
cleared the instant a charge succeeds (`_handle_payment_succeeded` /
`_handle_membership_valid`). **You should almost never need to touch
this by hand** — tell the user to update their card in Whop
(`https://whop.com/@me/settings/memberships`) and it clears itself on
the next successful charge. If it's been stuck for days with no retry
in sight, that's a real bug — escalate, don't hand-clear it without
understanding why Whop stopped retrying.

**banned_until (rare, deliberate):** an admin manually banned this
user via Admin HQ (`admin_mutations.py` → `POST /users/{id}/ban`). This
is a moderation call someone made on purpose. Don't clear it without
checking with whoever set it — there's no audit trail of *why* attached
to the row itself, so ask before assuming it was a mistake.

**To manually unlock (admin only, use sparingly):** clear the relevant
field via Admin HQ. There is deliberately no "unlock" button conflating
the two — banned_until and payment_locked_at are separate fields so
clearing one never accidentally clears the other.

## Scenario: "Some of my money is missing / on hold"

**Check the wallet's "Held" card first** (desktop app → Wallet — only
shows when non-zero). This is `withdraw.reserve_usd_cents` from
`GET /me/wallet/summary`, sourced directly from Whop's own sub-merchant
account balance (`whop_payments.retrieve_account()` — NOT something
Liquid Clips sets or controls).

**What to tell the user:** Whop holds a rolling reserve as a fraud/
chargeback safeguard — completely standard for payment processors, not
a Liquid Clips decision, not a penalty against them specifically.
Whop releases it on its own schedule. **We cannot manually release a
Whop reserve hold** — don't promise a timeline you don't control.

**Separately — "grace" and "cancelled" wallet states:** if the wallet
shows `payout_status: "grace"` or `"frozen"`, that's a *subscription*
issue (their Liquid Clips plan lapsed or was canceled), not a Whop
reserve hold. Copy for both is already in
`desktop-2/src/routes/wallet-detail/WalletDetail.tsx` (~line 468) —
read it before improvising an explanation, it's more precise than
anything paraphrased here.

**Affiliate payout frozen specifically:** check
`AffiliateAgreementSignature.status` — `"frozen"` means a
`payment.disputed` webhook fired for them (see `_apply_agreement_setoff`
in `webhooks_whop.py`). This nets a $50 admin fee against their pending
credit. This is chargeback-defense machinery, not arbitrary — don't
unfreeze without understanding the dispute is actually resolved.

## Scenario: "Why do I have to agree to Terms before I can pay?"

Pre-launch blocker #1. Every checkout surface now shows a click-wrap
gate before the payment embed loads. **The current document text is a
placeholder, not real legal copy** — see
`junior-backend/app/routes/me_terms.py` `TERMS_DOCUMENT_BODY`. If a
user has a substantive legal question about the terms, don't improvise
an answer — that document needs a lawyer's review before anyone treats
it as binding. Tell the user the final terms are coming and note their
question for whoever owns that review.

Acceptance is logged per-user in the `terms_acceptances` table (one row
per user per `document_version`) — if you need to confirm someone
actually accepted, that's where to look.

## Scenario: "I got scammed / someone asked me to pay outside the app"

**This should never legitimately happen.** Liquid Clips only ever
takes payment through the official Whop checkout embedded in this app
— never a DM, invoice link, or "send me the money and I'll add you"
arrangement from another user or someone claiming to be staff.

1. Get the other party's handle/user id and exactly what they asked
   for (payment method, amount, pretext).
2. Do NOT process any kind of manual refund yourself unless Liquid
   Clips actually received the money through Whop — if they paid a
   scammer directly, that money never touched our systems and we
   cannot reverse it. Be direct about that with the user; false hope
   is worse than a hard truth here.
3. If the scammer is a Liquid Clips user (not an outside impersonator),
   that's a ban — `banned_until` via Admin HQ, see the lock section
   above for what that field actually does.
4. Report the pattern even if it's a one-off — repeated reports of the
   same handle/wording matter for catching a real ring, not just one
   incident.

## Scenario: general chat moderation (Community rooms)

- Mute: `User.chat_muted_until` — chat-scoped, does NOT lock the rest
  of the app. Separate field from `banned_until` on purpose.
- Hide a message: sets `ChatMessage.hidden_at` — the content is
  replaced with `"[removed by moderator]"` server-side before it ever
  leaves the API (not a client-side CSS hide).
- `#Announcements` is admin-only to post; everyone can read it.
  `#Bug Reports` and the topic rooms are open to whoever the room's
  tier gate allows.

## What NOT to do

- Don't clear `banned_until` or `payment_locked_at` without checking
  which one it is first — they mean different things and clearing the
  wrong assumption erodes trust in the mechanism.
- Don't promise a Whop reserve hold will release by a specific date —
  we don't control Whop's schedule.
- Don't treat the placeholder Terms text as final/binding in a user
  conversation.
- Don't manually refund money that was never actually received through
  Whop (see scam scenario above).
