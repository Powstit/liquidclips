# Junior — Affiliate User Journey

**For:** `partner.jnremployee.com` (logged-in affiliate dashboard)
**Audience:** creators who want to refer Junior and earn 50% lifetime recurring
**Build target:** Junior v1.0 (this sprint)

---

## The principle that drives every screen

**Get the link → share it → THEN numbers.**

Most affiliate dashboards show £0 / 0 clicks / 0 referrals on day one. Affiliates bounce because empty numbers feel like failure. Junior flips the order: the moment someone joins, the **link is the hero**. Numbers are secondary until there's something to show.

---

## The 6 states

Every affiliate is in exactly one of these. The page detects which and renders accordingly.

### State 0 — Not signed in (anonymous visitor)

**Entry:** lands on `partner.jnremployee.com` without a session.

**Screen:** redirect immediately to `jnremployee.com/affiliate` (marketing page). No need for a separate login wall — the marketing page has the "Become an affiliate →" button which kicks off OAuth.

### State 1 — Signing in (OAuth handshake)

**Entry:** clicks "Become an affiliate →" on the marketing page.

**Flow:**
1. Junior Backend redirects to `https://whop.com/oauth/authorize?client_id=app_hLphExdFzjEQsM&redirect_uri=...&scope=...&state=...`
2. Whop shows a consent screen: "Junior wants to: act as an affiliate of Junior, see your earnings, manage your payouts." User clicks Allow.
3. Whop redirects to `partner.jnremployee.com/auth/whop/callback?code=...&state=...`
4. Backend exchanges the code for an access token, identifies the user (`user_xxx`), creates a session cookie.

**Screen:** loading spinner with text "Connecting your Whop account…" (300ms–2s).

### State 2 — Just joined, no link yet (provisioning)

**Entry:** first time on the dashboard after a successful sign-in.

**What happens behind the scenes (one API call sequence, ~1s):**
1. Backend calls `client.affiliates.create({ company_id: biz_0IMrpJRrTJID1u, user_identifier: user_xxx })`
2. Whop returns the affiliate record, which includes (or implies) a unique referral URL and promo code.
3. If the promo code isn't auto-attached, Backend calls `client.promoCodes.create()` with the affiliate's ID.
4. Backend writes the affiliate's user_id, referral URL, and promo code to local Postgres for fast reads.

**Screen:** same loading spinner, message swaps to "Setting up your link…" — never blank.

### State 3 — Ready to share, zero activity (THE critical empty state)

**Entry:** provisioning done. Affiliate has a link. 0 clicks, 0 referrals, 0 earnings.

**This is the screen most affiliate programs ruin.** Junior's version:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Welcome, @username                                        │
│                                                             │
│   Your referral link is ready.                              │
│   Earn 50% of every payment, forever.                       │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  https://junior.video/?ref=@username                │  │
│   │                                          [📋 Copy]  │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   ─────── Start with one of these ───────                   │
│                                                             │
│   [🐦 Post on X]  [📺 Get a clip]  [📰 Email template]      │
│                                                             │
│   Three pre-made posts. One tap to share.                   │
│                                                             │
│ ───────────────────────────────────────────────────────────│
│                                                             │
│   When someone signs up, this fills in:                     │
│                                                             │
│      $0      0           $0                                 │
│      MRR     Referrals   Lifetime                           │
│                                                             │
│      ▢ Connect payout method to start receiving payments    │
│        [Set up payouts in Whop →]                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**What's deliberate:**
- The link is **above the fold**, large, copyable with one tap
- "Start with one of these" gives them an action before showing numbers
- The zero-state numbers are present but **subordinate** ("when someone signs up, this fills in")
- Payout setup reminder is a soft nudge (they don't need it to share a link — but they'll need it to get paid)

**Three share buttons explained:**
- **Post on X** — opens X compose with a pre-filled tweet: "Just found Junior — drops a 4-hour podcast in, gets 30 ready-to-post clips out, posts them across the next 2 weeks while you sleep. Free forever for clippers. https://junior.video/?ref=@username"
- **Get a clip** — downloads a 30-second demo video they can post directly (we make this once, reuse for all affiliates)
- **Email template** — opens a mailto with a 4-line message + their link

### State 4 — Some activity, no conversions yet

**Entry:** clicks > 0 but referrals = 0.

**Screen:** same as State 3 but the numbers tile starts showing real values:

```
   12 clicks     0 referrals     $0 MRR
```

Add one line: "Your link is being clicked. First conversion usually within 7 days of first share. Keep posting."

This is **encouragement, not anxiety**. A real human-tone line.

### State 5 — Active affiliate (1+ paying referrals)

**Entry:** at least one paid conversion.

**Screen:** the real dashboard.

**Top of page — three big numbers, the ones that actually matter:**

```
┌─────────────┐  ┌──────────────┐  ┌─────────────────┐
│   $147      │  │   $52        │  │   $312          │
│   ACTIVE    │  │   PENDING    │  │   LIFETIME      │
│   MRR       │  │   NEXT PAYOUT│  │   EARNED        │
└─────────────┘  └──────────────┘  └─────────────────┘

Currency: USD · [GBP] [EUR]
```

Currency selector top right — toggle between USD/GBP/EUR. Default USD (Whop's native). Conversion is approximate (we display a "rates approx" tooltip).

**Below — the working dashboard:**

- **Your referral link** (still here, always visible — they'll keep coming back to copy it)
- **Recent activity** — last 20 events: "New referral: anonymous · $49 Channel tier · 22 May" / "Renewal: anonymous · +$24.50 commission · 15 Jun" / "Churn: anonymous · -$24.50 MRR · 4 Jul"
- **Top sources** — which platform/post drove the most conversions (we get this from referral URL parameters like `?ref=@user&src=x`)
- **Payout history** — list of past payouts with date, amount, status
- **Promotional kit** — same share buttons as empty state, plus new assets we add weekly
- **Tax & payout setup** — link to Whop's KYC page if anything's missing

**Privacy note:** referred customers are shown as "anonymous" with their tier and timestamp. Affiliates don't need (or have a right to) the buyer's identity.

### State 6 — Disconnected / token expired

**Entry:** Whop token expired or revoked.

**Screen:** soft re-auth wall: "Re-connect your Whop account to keep seeing your stats. Your link and referrals are safe and unchanged. [Re-connect →]"

Numbers continue to accrue server-side even while disconnected — re-auth just restores read access for the dashboard.

---

## What gets built in v1.0 vs deferred

### Ship in v1.0
- States 0 → 5 fully functional
- Three share buttons (X, clip download, email template)
- Three numbers (active MRR / pending / lifetime)
- Recent activity feed
- Referral link + copy button
- Currency toggle USD ⇄ GBP ⇄ EUR
- Payout setup nudge linking to Whop's KYC flow
- Mobile-first (most affiliates check on phone)

### Defer to v1.1
- Top sources analytics (needs more data anyway)
- Auto-generated personal stat-card PNG ("I made $X with Junior this month — share to X")
- Weekly new promotional assets
- Sub-affiliate / second tier ("recruit other affiliates, earn 10% override") — only if data justifies
- Leaderboard / public proof
- In-dashboard notification preferences

### Never (or much later)
- Custom commission rate negotiation flow
- White-label dashboard for sub-agencies
- Multi-product affiliate program (one creator promoting Junior + Catjack + DDB)

---

## Routes that need to exist

```
GET   /                              → redirect to /dashboard if signed in, else /affiliate
GET   /auth/whop/start               → kicks off OAuth (sets state cookie, redirects to Whop)
GET   /auth/whop/callback            → handles ?code=&state=, creates session, redirects to /dashboard
POST  /auth/logout                   → clear session, redirect to /affiliate

GET   /dashboard                     → renders State 3–5 depending on data
GET   /api/me                        → returns { user, affiliate, link, stats, recent_activity }
GET   /api/me/payout-history         → paginated payouts
POST  /api/share/x                   → returns pre-filled tweet text (server-rendered so we can A/B it)
GET   /api/assets/demo-clip.mp4      → returns the demo video

POST  /api/whop/webhook              → receives Whop events (sale, renewal, churn, dispute)
```

All `/api/me*` calls require a valid session. Webhook is auth'd via Whop signature header.

---

## The single rule

If an affiliate visits the dashboard and **doesn't see their link within 1 second** — for any reason — we have a bug. The link is the product. Numbers are commentary.

---

**End of journey doc.** ~1,100 words.
