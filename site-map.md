# Junior — Complete Site Map

**Domains in play:**
- `jnremployee.com` — marketing (the world-facing brand)
- `partner.jnremployee.com` — affiliate dashboard (logged-in)
- `app.jnremployee.com` — interactive product simulator
- `admin.jnremployee.com` — Daniel's MRR + affiliate admin (future)

**Three customer personas to design for:**

1. **Creator** — records podcasts/streams, wants to clip them. Lands cold. Needs to understand the product, trust it, install it.
2. **Whop clipper** — already in the Whop ecosystem, makes clips for content for affiliate revenue. Knows the game. Needs to see the angle and the tooling.
3. **Affiliate (general)** — marketer / podcaster / influencer with audience. Doesn't make clips themselves. Wants to recommend Junior for 50% lifetime.

Personas 2 and 3 overlap but ship from different doors. Personas 1 and 2 are revenue. Persona 3 is distribution.

---

## 1. Marketing layer · jnremployee.com

### Status legend
✅ Live · 🟡 Live but rough · 🔴 Missing (need to build)

### Pages

| Route | Persona | Purpose | Status |
|---|---|---|---|
| `/` | Creator | Brand landing — value prop, two-clicks story, moat, pricing, FAQ, download | ✅ Live |
| `/affiliate` | Whop clipper | Earnings-first pitch — "Your first $10,000 in Whop clips" + leaderboard + math | ✅ Live |
| `/affiliates` (or `/refer`) | General affiliate | Generic 50% lifetime program — not clipper-specific | 🔴 Missing |
| `/clippers` (or keep `/affiliate`) | Whop clipper | The current clippers page renamed for clarity | 🟡 Live as `/affiliate` — rename optional |
| `/download` | Creator/Clipper | Mac DMG + Windows installer, sys req, signing-trust badges | 🔴 Missing — currently `#download` anchor on main |
| `/pricing` | Creator | Full tier breakdown beyond the hero pricing cards | 🟡 Lives as anchor on `/` — works for now |
| `/compare` | Creator | vs Opus Clip / Reelify in detail | 🟡 Lives as section on `/` — works for now |
| `/founder` | Creator | Founder Lifetime offer (£500, 2,000 seats) — dedicated page for high-intent buyers | 🔴 Missing |
| `/changelog` | Creator (returning) | Version history — what's new in Junior | 🔴 Missing — v1.1 |
| `/privacy` | All | Privacy policy | 🔴 Missing — required for launch |
| `/terms` | All | Terms of service | 🔴 Missing — required for launch |
| `/refunds` | All | Refund policy (linked from Whop checkout) | 🔴 Missing — required for launch |
| `/security` | Trust-sensitive buyer | Why "your video never leaves your machine" is real | 🔴 Missing — defensive moat |
| `/support` | All | Support email + common issues | 🔴 Missing — currently `mailto:` from footer |
| `/blog/*` | Everyone | Long-form SEO + thought leadership | 🔴 Missing — v1.2+ |

### Navigation (binding for all marketing pages)

Standard top nav, left to right:

```
[logo: junior/employee]   How it works · Compare · Pricing · Demo · Affiliates · [Download CTA]
```

Footer (binding):

```
Privacy · Terms · Refunds · Security · Affiliates · Changelog · Support
© 2026 · Made for creators who'd rather record
```

---

## 2. App / Simulator layer · app.jnremployee.com

The interactive product simulator that doubles as a sales demo and a build spec.

| Surface | Purpose | Status |
|---|---|---|
| `/` — 12-screen flow | Walks user through the full app experience, with the real cut video on screen 1 + the 15-tile results grid | ✅ Live |

### The 12 screens (all interactive)

| # | Screen | What it shows |
|---|---|---|
| 01 | First run · welcome | Brand mark, value prop, **live preview video**, two CTAs |
| 02 | Activate · key paste | Anthropic key OR Whop license — auto-fills + validates |
| 03 | Workspace · empty | Drop zone + recent projects |
| 04 | Workspace · hovering | Drag-over state |
| 05 | Brief · context | Optional brief chips + free text |
| 06 | Working · stage 1 | Working state, animates through stages |
| 07 | Working · stage 4 | Later stage of processing |
| 08 | Results · clips grid | **15 real video tiles** of the user's video clipped |
| 09 | Clip preview · edit | Featured clip plays with sound, can restyle |
| 10 | Drip · setup | Schedule across 1/2/3/4 weeks, calendar updates live |
| 11 | Drip · confirmation | Queued. Junior posts while you sleep. |
| 12 | Settings · one page | Account, API keys, platforms, captions, output folder |

The simulator IS the live demo. Public access. Sales asset.

---

## 3. Affiliate program layer · partner.jnremployee.com

The logged-in affiliate dashboard plus its public counterpart pages.

### Existing affiliate surfaces

| Route | Purpose | Status |
|---|---|---|
| `partner.jnremployee.com/` | Logged-in dashboard — referral link, MRR, lifetime earned, currency toggle | ✅ Live |
| `/auth/whop/start` | Kicks off Whop OAuth | ✅ Live |
| `/auth/whop/callback` | Returns from Whop, creates session | ✅ Live |
| `/auth/logout` | Clears session | ✅ Live |

### Missing affiliate surfaces

| Route | Purpose | Status | Priority |
|---|---|---|---|
| `partner.jnremployee.com/payouts` | Full payout history with status per row, exportable CSV | 🔴 | High — affiliates trust what they can audit |
| `partner.jnremployee.com/assets` | Promotional kit — banners, logos, tweet templates, demo clips | 🔴 | High — drives activation |
| `partner.jnremployee.com/settings` | Notification prefs, payout method (links to Whop), currency default | 🔴 | Medium — Whop covers most of this |
| `partner.jnremployee.com/leaderboard` | Top 10 affiliates this month (opt-in public) | 🔴 | Medium — social proof |
| `partner.jnremployee.com/referrals` | Detailed list of every attributed customer (anonymised) + their tier + monthly contribution | 🔴 | High — replaces "trust me bro" with auditable trail |

### Public-facing affiliate pages (live on jnremployee.com)

These already exist but a non-clipper affiliate should also see a tailored version:

| Route | Persona | Status |
|---|---|---|
| `jnremployee.com/affiliate` | Whop clipper-specific (earnings, leaderboard, "free for clippers") | ✅ Live |
| `jnremployee.com/affiliates` *(plural — new)* | General affiliate program — rates, attribution, payouts, who it's for, FAQ | 🔴 Missing |
| `jnremployee.com/affiliate/terms` | Affiliate agreement (TOS) | 🔴 Missing |
| `jnremployee.com/affiliate/faq` | Affiliate-specific FAQ | 🔴 Missing — could live as section on `/affiliates` |

**Key UX note:** an affiliate visiting `partner.jnremployee.com` who's NOT signed in gets redirected to `jnremployee.com/affiliate`. This is correct for clippers. For non-clippers, the redirect target should be `/affiliates` (general). Conditional redirect based on referrer or query param.

---

## 4. Admin layer · admin.jnremployee.com (future)

Daniel's view across all products + affiliates.

| Surface | Purpose | Status |
|---|---|---|
| `admin.jnremployee.com/` | Total MRR, active customer count, top affiliates, recent sales feed | 🔴 v1.5 |
| `/affiliates` | Full list of affiliates, with override controls | 🔴 v1.5 |
| `/payouts` | All pending and completed payouts across all affiliates | 🔴 v1.5 |
| `/customers` | All paying customers, churn risk flags | 🔴 v1.5 |
| `/products` | When you add Catjack / DDB / Minko, multi-product switcher | 🔴 v1.5+ |

Defer until Junior has >100 paying customers. Whop's native dashboard covers everything until then.

---

## 5. The customer journeys, end-to-end

These are the load-bearing flows. Every page above either lives on one of these journeys or it shouldn't exist.

### Journey A — Cold creator → paying customer

```
Twitter/post → jnremployee.com → /pricing (anchor) → /compare (anchor) → /download
            ↓ optionally
            /security · /founder · /support · FAQ
            ↓ download
            installs Junior (Mac / Windows)
            ↓ first run inside app
            paste Anthropic key (Free) OR paste Whop license (Paid)
            ↓ uses app
            (returns)
            opens Junior → daily workflow
            ↓ ~20 clips later
            Founder Lifetime modal in-app
            → opens Whop checkout for £500 lifetime
```

**Funnel-critical:** the Demo nav link goes to `app.jnremployee.com` — lets a skeptic preview the entire product before installing.

### Journey B — Whop clipper → affiliate enrollment → first share

```
DMs / Whop community → jnremployee.com/affiliate
                      ↓
                      Hero: "$10,000 in Whop clips"
                      Reads the math + leaderboard
                      ↓
                      Click "Become an affiliate →"   (3 places on /affiliate)
                      ↓
                      api.whop.com/oauth/authorize    (Whop's hosted consent)
                      ↓
                      partner.jnremployee.com         (logged-in dashboard)
                      ↓
                      Sees their referral link IMMEDIATELY (the moat)
                      Clicks "Post on X" / "Download a clip" / "Email a friend"
                      ↓
                      Audience clicks the link → buys → 50% recurring kicks in
                      ↓
                      Returns to dashboard to check Active MRR
                      ↓
                      (eventually) goes to /payouts to verify they're being paid
```

**Funnel-critical:** the link is visible within 1 second of landing on the dashboard. Numbers are commentary.

### Journey C — General affiliate (marketer / podcaster) → enrollment

This is the journey that's CURRENTLY BROKEN — no path for someone who's not a clipper.

```
Twitter / podcast / DM → jnremployee.com/affiliates    🔴 MISSING
                        ↓
                        Generic program page: 50%, lifetime, paid via Whop, how attribution works
                        ↓
                        Same "Become an affiliate →" CTA → OAuth → partner dashboard
```

**Build priority:** create `/affiliates` (plural) as the general-affiliate landing. Re-use 70% of `/affiliate`'s structure, swap the clipper-specific copy for general-language copy. Wire it into the nav (footer "Affiliates" link should point here, not at `/affiliate`).

### Journey D — Existing affiliate returning to check stats

```
Bookmark → partner.jnremployee.com
        ↓
        Session valid? Yes → dashboard
        Session expired? Soft re-auth toast → /auth/whop/start → back to dashboard
```

### Journey E — Daniel checking the business

```
Bookmark → admin.jnremployee.com    🔴 v1.5
        ↓
        MRR · Active customers · Top affiliates · Pending payouts · Recent sales
```

Until v1.5, Daniel uses Whop's native dashboard. Acceptable.

---

## 6. Build priority for the missing pages

### Ship this week (blocks Junior launch)

1. `/privacy`, `/terms`, `/refunds` — required by Whop and required by law. Use templates, don't write from scratch. Get them live as static HTML in `jnremployee.com/legal/*` or root paths.
2. `/affiliates` (plural — general affiliate program) — closes Journey C. Without it, you only have a clipper-specific story and you're losing the 60% of potential affiliates who aren't Whop clippers.
3. `/security` — a single page that elaborates the "your video never leaves your machine" promise with the technical architecture diagram. Trust moat. One day of work, big conversion lift.

### Ship within 4 weeks (during build)

4. `/download` — when Mac/Windows DMG/MSI exist (Sprint 5), they need a real download page with checksums, signing badges, system requirements.
5. `/founder` — Founder Lifetime dedicated landing. Activates after 20-video trigger inside the app + as a direct link.
6. `partner.jnremployee.com/payouts` — the audit trail. Affiliates trust what they can verify.
7. `partner.jnremployee.com/assets` — promotional kit. Drives affiliate activation 5-10× vs link-only.
8. `partner.jnremployee.com/referrals` — detailed customer-level attribution. Trust + transparency.

### Ship in v1.2 / v1.5

9. `/changelog`
10. `/blog`
11. `partner.jnremployee.com/leaderboard`
12. `admin.jnremployee.com/*` (the whole admin layer)

---

## 7. Don't-lose-anything checklist (current live pages)

Confirming all current public surfaces are preserved:

- ✅ `jnremployee.com` — main landing
- ✅ `jnremployee.com/affiliate` — Whop clippers landing (keep as-is, optionally rename to `/clippers` later)
- ✅ `partner.jnremployee.com/` — affiliate dashboard
- ✅ `partner.jnremployee.com/auth/whop/start` — OAuth entry
- ✅ `partner.jnremployee.com/auth/whop/callback` — OAuth return
- ✅ `partner.jnremployee.com/auth/logout` — sign out
- ✅ `app.jnremployee.com/` — 12-screen simulator with real video

Nothing in this sitemap removes any of those. Everything new layers on top.

---

## 8. The one rule that keeps this coherent

**Every page must answer "what's the next action for this persona?" in under 3 seconds.**

- Creator on `/`? Next action = download.
- Clipper on `/affiliate`? Next action = become an affiliate.
- Affiliate on `partner.jnremployee.com`? Next action = copy your link, post on X.
- Skeptic anywhere? Next action = open the demo (`app.jnremployee.com`).

If a page makes the user think for more than 3 seconds, simplify it or kill it.

---

**End of sitemap.** ~1,400 words.
