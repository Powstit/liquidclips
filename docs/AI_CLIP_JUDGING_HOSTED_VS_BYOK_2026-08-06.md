# AI Clip-Judging — Hosted vs. BYOK

**Internal briefing · prepared for Daniel · 2026-08-06**

Prepared so this can be walked through directly. Covers: what "hosted AI" actually
means, exactly where the product stands today per tier, the one real risk in the
free-tier funnel, rough unit economics, how the AI billing actually works, and a
recommended path.

Verified against live code (`junior-backend/app/features.py`, `python-sidecar/llm.py`,
`app/routes/proxy_llm.py` + `proxy_anthropic.py`), not documentation — the docs on this
topic are stale.

---

## In one paragraph — what "hosted AI" means

To find the best moments in a video, the app has to ask an AI model to read the
transcript and pick clips. Someone has to pay for that AI call. **"Hosted"** means
Liquid Clips pays for it — the company's own OpenAI/Anthropic account handles it,
included in the subscription. **"BYOK" (bring your own key)** means the user creates
their own OpenAI or Anthropic account, generates their own key, pastes it into
Settings, and pays that AI provider directly and separately.

---

## Current state — what each tier actually gets today

| Tier | Needs their own API key? | Hosted AI quota | What actually happens |
|---|---|---|---|
| **Free** | 🔴 Required | none | Blank password field in Settings, no guidance on how to get a key. No key = clip-picking fails *after* they've already uploaded and waited through transcription. |
| **Solo** · $29.99/mo | 🔴 Required | none | Same as free — explicitly excluded from hosted AI in the tier matrix, not just "not built yet." |
| **Pro / Growth** · $99.99/mo | 🟢 Not needed | 2,000,000 tokens/mo | Automatically routed to hosted Claude, zero setup. Settings screen still tells them a key is "required," which is stale and wrong for this tier. |
| **Agency** (+ ladder) · $99.99/mo | 🟢 Not needed | 8,000,000 tokens/mo | Same as Pro — works automatically. Same stale Settings copy problem. |

---

## The gap — now vs. target

### ① Free-tier funnel risk — real, unresolved

- "100 free clips, no card" is the headline pitch everywhere in marketing/checkout copy
- But the first real action a free user takes can dead-end behind "paste your OpenAI API key"
- Most casual creators don't have one and won't know how to get one
- This is a drop-off point at the very first step of the funnel this whole tier exists to fill

### ② Stale Settings copy — cheap, safe fix

- Pro/Agency users are told a key is "required" and hosted compute "ships after the engine port"
- Both are wrong today — hosted AI already works for them, no key needed
- One-line copy fix, no logic change, no risk
- Worth doing regardless of what's decided on the free-tier question

---

## Money — if a client pays, how much do we make?

Real numbers where confirmed; AI cost is a **rough, illustrative estimate** — current
Anthropic/OpenAI per-token pricing isn't precise enough here to quote as fact. The real
number already exists in Admin HQ's "Clip Economics" panel, which tracks actual
observed spend, not a theoretical worst case — check that before trusting this table
for a real decision.

| Tier | Revenue/mo | AI cost, maxed quota | Est. margin |
|---|---|---|---|
| Solo | $29.99 | $0 (BYOK) | ~100%* |
| Pro / Growth | $99.99 | ≈ $5 – $10 | ≈ 90% |
| Agency | $99.99 | ≈ $20 – $35 | ≈ 65 – 80% |

\*Solo's "100% margin" is misleading, not literal — there's still payment processing
fees, infrastructure, and support cost; this table only isolates the AI line item
specifically since that's what's under discussion. The Agency range is wide because
it's the "if this one customer maxed out their entire 8M-token quota this month"
ceiling — most won't get near that, but a few power users doing it every month is the
real risk to watch, not the average.

---

## Mechanics — how the AI account is actually funded

There's **one** OpenAI account and **one** Anthropic account, both under Liquid Clips,
with the keys held on the backend server (Railway) — never on a customer's machine.
Every hosted request from every Pro/Agency user, across the whole company, draws from
that same shared account. The backend keeps each user honest with a per-account
monthly token quota (2M / 8M above) so nobody can silently blow through the bill on
their own — but the actual invoice from OpenAI/Anthropic lands as **one combined
bill** for everyone's usage that month, not itemized per customer.

**One thing that can't be answered from the code:** the actual billing arrangement on
those two accounts — prepaid credits, a card on file, spend caps set on
OpenAI/Anthropic's side. That's configuration on their dashboards, not visible in the
codebase. Worth confirming there's a spend alert or hard cap set there directly, as a
backstop under the app-level quota system.

---

## Recommendation

### Tonight, before launch
Fix the stale Settings copy for Pro/Agency (cheap, zero risk, stops actively confusing
paying customers). Do a real live test signed in as a paid account to confirm hosted
AI actually fires, not just that the code looks right. Do **not** attempt to give free
users hosted AI tonight — that's a real cost decision, not a bug fix, and shouldn't be
rushed.

### Soon after launch
Decide deliberately on the free-tier funnel gap. Two real options, not mutually
exclusive:

- **(a)** Give free users a small hosted-AI allowance — even 5–10 clips' worth —
  funded the same way Pro/Agency is, just capped tighter, so the "no card required"
  promise is actually true from clip #1.
- **(b)** Keep BYOK for free but make getting a key dramatically easier — a guided
  "get your key in under a minute" flow instead of a blank box.

Option (a) costs real money per free signup; option (b) costs product/design time.
Worth watching signup-to-first-export conversion for a few days post-launch before
committing — that number will tell you how big this problem actually is in practice.

---

## The decisions actually needed — for Daniel

1. **Free-tier AI access** — give free users a small hosted allowance, invest in
   making BYOK easier, or accept the drop-off and measure it first?
2. **Agency's quota ceiling** — is an ≈$20–35 AI-cost month against $99.99 revenue an
   acceptable worst case, or does the 8M-token cap need to come down?
3. **Billing backstop** — is there a hard spend cap set directly on the
   OpenAI/Anthropic account dashboards, independent of the app's own quota logic?
4. **Launch messaging** — "hosted AI included" is now true for Pro/Agency and can be
   used with confidence, once the Settings copy is fixed to match.
