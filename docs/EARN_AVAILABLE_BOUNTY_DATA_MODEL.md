# Earn Available-Bounty Data Model

Date: 2026-06-13
Status: Diagnosis — code not yet written.

## TL;DR

Whop does not require user auth for public bounty discovery. **Our backend
does** — for two policy reasons (abuse protection + Partner Engine filtering),
both of which can be relaxed via a new unauthenticated endpoint with its own
cache + rate limits. Adding that endpoint and routing the desktop's Available
tab to it (with the authenticated endpoint layered in only when a cached JWT
exists) is the permanent fix that matches the correct product model.

## Old working data path (pre-IG-014 era, around `73d1a2c~1`)

`desktop/src/components/earn/EarnTab.tsx` `bootstrap()`:

1. `sidecar.whopSessionStatus()` — reads `JUNIOR_WHOP_TOKEN` + `LICENSE_JWT`
   presence FROM KEYCHAIN. On a warm session with a granted ACL, silent.
   On a rebuilt binary, triggers macOS prompt loop.
2. If `junior_activated === true` → `sidecar.whopListBounties(25)` → backend
   `/whop/bounties` with the user's `LICENSE_JWT` from keychain.
3. Bounty grid renders.

**Why it "worked" for Daniel**: he had granted keychain ACL on a stable
binary, so the passive reads were silent. Cold launch on a freshly built /
freshly installed binary triggered the prompt loop — which is exactly what
IG-014 was created to fix.

So "the previous working state" was working _for a single ACL-granted machine
state_, not as a generalizable product. Shipping that to other users → the
keychain prompt loop bug.

## Current data path (v0.7.66)

`EarnTab.probe()` (`desktop/src/components/earn/EarnTab.tsx:108-127`):

1. `getCachedLicenseJwt()` — synchronous, in-memory only. `null` at cold
   launch because no auth action has run yet.
2. `sidecar.licenseJwtPresence()` — reads presence-file mirror (no keychain).
   Returns `{ present: true }` for previously-signed-in users.
3. Sets `auth.kind = "refresh-needed"` → renders the locked card.

`loadBounties()` (`EarnTab.tsx:175-198`) is gated on `auth.kind === "ready"`,
so it never runs at cold launch. Bounties never reach the UI.

The same code path applies on the backend
(`junior-backend/app/routes/whop.py:289-291`):

```python
@router.get("/bounties")
async def list_bounties(
    user: Annotated[User, Depends(current_user)],
    ...
```

`Depends(current_user)` rejects with 401 without a valid LICENSE_JWT
Bearer header. Two stated reasons (line 295-301):

> License-JWT-gated so a leaked desktop key can only browse what the
> App API Key can already see.
>
> Partner Engine: non-Partners see only Campaign A ($5 RPM). The $10
> RPM dedicated-channel Campaign B is filtered out by experience.id
> against WHOP_CAMPAIGN_B_ID.

## Does public bounty discovery require auth?

**Whop side**: No. Whop's `publicBounties` query needs the App API Key
(server-side secret), not a user OAuth token (see comment in
`junior-backend/app/routes/whop.py:3-12`).

**Our backend side**: Currently yes, but as a **policy choice**, not a
necessity:

| Backend reason for JWT gate | Can it be relaxed? | How |
|---|---|---|
| Abuse protection (rate-limit who hits Whop GraphQL) | Yes | Cache the public list aggressively (TTL ≥ 60s, single in-memory key shared across all anonymous callers); add IP-based rate limit on the public endpoint. |
| Partner Engine filtering (non-Partner sees only Campaign A) | Yes | Public endpoint returns Campaign A only — that's already the non-Partner view. Partners get the full list only via the authenticated endpoint. |
| User-visible logging (`log.info("...user=%s...")`) | Yes | Log anonymous-with-IP for the public endpoint. |

**Python sidecar side**: Currently refuses to call the backend without a
license_jwt (`sidecar.py:3422-3429`). Needs a new method that targets the
new public endpoint.

## Proposed data model

```
availableBountiesPublic   ← unauth backend feed (Campaign A only)
                              cached, IP rate-limited
availableBountiesPersonal ← authed backend feed (Partner-aware)
                              only fetched when cached JWT exists
displayedBounties         ← union(personal, public)
                              personal wins on id collision

start / submit / payout / tracker actions
                          ← gated on cached JWT
in-progress local projects
                          ← always (local FS only, no auth)
sponsored carousel        ← always (already unauth)
leaderboard               ← already has unauth preview fallback
reward clips              ← stays gated on cached JWT
affiliate hero            ← stays gated on cached JWT
```

EarnTab behaviour:

- Cold launch → public feed fetches immediately → cards render.
- Cached JWT present → personal feed also fetches and merges (Partner extras
  appear if the user is a Partner).
- Click a card → BountyDetail opens against the same data source it came from.
- Click Start → if no cached JWT → inline prompt: "Unlock to start this
  bounty" (small, scoped to the card action — not a full-page banner).
- Submit / payout / refresh-status — same gate, same scoped prompt.

The full-screen "session locked" card disappears from the Available tab.
It only appears on tabs that genuinely require auth (Submissions, Payouts,
Reward Clips, Affiliate).

## Files to change

### Backend (`junior-backend/`)

1. `app/routes/whop.py` — add new route:
   ```python
   @router.get("/bounties/public")
   async def list_public_bounties(first: int = 30): ...
   ```
   - No `Depends(current_user)`.
   - Cache key `bounties:public:{first}`, TTL 60s, shared across all callers.
   - Calls `_whop_gql(_LIST_BOUNTIES, {...})` then filters to non-Partner view
     (Campaign A only — same logic as `_filter_partner_only` with `partner=False`).
   - Add IP-based rate limit (e.g. `slowapi` or simple in-memory bucket).
   - Log `[whop_proxy] list_public_bounties ip=… count=…`.

2. `app/routes/whop.py` — add `/bounties/public/{id}` for unauth detail. Same
   Campaign A filter (non-Partner gets 404 on Campaign B). Reuses
   `_BOUNTY_DETAIL_TTL`.

### Python sidecar (`desktop/python-sidecar/`)

3. `whop_client.py` — add `async def list_public_bounties(first: int)`. Mirrors
   `list_bounties` but routes to `/whop/bounties/public` with no Authorization
   header.

4. `sidecar.py` — add `method_whop_list_public_bounties` + register in
   METHODS dict. Returns `{bounties, source, error?}`. No `license_jwt` param.

### Desktop TS bridge (`desktop/src/lib/`)

5. `sidecar.ts` — add wrapper:
   ```ts
   whopListPublicBounties: (first = 30) =>
     sidecarCall<{ bounties: WhopBounty[]; source: string; error?: string }>(
       "whop_list_public_bounties", { first },
     ),
   ```

6. `whopBounties.ts` — add `listPublicWhopBounties(first)` (no JWT needed) +
   a `mergeBountyLists(personal, public)` helper. Keep
   `listWhopBountiesWithCachedSession` as-is for the personal layer.

### EarnTab (`desktop/src/components/earn/EarnTab.tsx`)

7. Rewrite `loadBounties()` to fire `listPublicWhopBounties()` immediately on
   mount regardless of auth, then fire `listWhopBountiesWithCachedSession()`
   on top when `auth.kind === "ready"`. Merge results.

8. Remove the `auth.kind !== "ready"` full-card lockout from the Available
   tab. Replace with a slimmer "Connect once to see Partner-only campaigns"
   chip ABOVE the grid, only when `auth.kind === "refresh-needed"`.

9. Add the inline "Unlock to start this bounty" scoped action prompt on the
   Start button when no cached JWT.

10. Marker → `EARN SURFACE: universal native EarnTab v0.7.68` (or whatever
    version we land this under).

### Invariant tests

11. `tests/no-passive-keychain.test.mjs` — the new
    `whop_list_public_bounties` method is allowed in passive paths because
    it does not touch the JWT. Add to the explicit allow-list if the
    "passive UI surfaces never call keychain-capable Whop RPCs directly"
    test rejects it.

## Acceptance criteria

1. Fresh app launch → Earn opens.
2. No keychain prompt.
3. Sponsored campaigns show.
4. Available bounties (Campaign A) show immediately, no unlock required.
5. Bounty detail opens without unlock if data came from the public feed.
6. Clicking Start on a card without cached JWT shows an inline "Unlock to
   start this bounty" prompt, not a full-screen banner.
7. After explicit unlock, additional Partner bounties layer in seamlessly
   (no re-flash, no full reload).
8. Submissions / Payouts / Reward Clips / Affiliate sections keep their
   gated states.
9. In-progress local projects always render.
10. No `/sign-in?redirect_url=/dashboard`.
11. No hosted Earn webview.
12. No black screen.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Public endpoint gets hammered by bots or a leaked desktop key. | Medium | Aggressive cache (60s+, shared across callers). IP rate limit. Cap `first` at 25. |
| Whop GraphQL complexity ceiling exceeded on multi-tenant aggregate. | Low | Single shared cache key — at most one Whop call per 60s for all anonymous callers globally. |
| Partner Engine bypass — a non-Partner sees Campaign B because the public endpoint accidentally leaks it. | Medium | Same `_filter_partner_only(..., partner=False)` runs on the public path. Add a unit test. |
| Merge logic shows the same bounty twice (once from public, once from personal). | Low | Dedupe by `id`, personal wins. |
| New backend route ships without rate limiting and gets DDoS'd. | Low | Ship the rate limit in the same PR. Healthcheck the 429 path before release. |
| Existing desktop builds on v0.7.66 keep working — they don't know about the public endpoint. | Low | New endpoint is additive. Old desktops continue using `/whop/bounties` with their JWT. |

## Out of scope

- Refresh-token architecture (deferred — only useful if we ALSO want to keep
  the JWT flow but eliminate the unlock click, which is no longer required
  once public discovery exists).
- Caching personal bounty list per user (currently cache key includes
  `partner=` flag, not user id — that's fine, all Partners see the same list).
- Whop OAuth on the desktop (still reserved for future per-user submit
  actions; unchanged).

## Open product questions for Daniel

1. **Inline unlock prompt on Start button**: small chip ("Unlock to start"),
   modal, or just route to the existing flow with no extra UI? My pick:
   small chip below the Start button — least disruptive.
2. **Partner-only campaigns chip on Available**: do we want to advertise
   that Partner content exists ("Unlock for $10 RPM campaigns"), or stay
   silent until the user unlocks? My pick: silent. Less noise.
3. **Backend rate-limit strategy**: IP-only, or also a sliding window per
   `User-Agent`? My pick: IP-only with a 30 req/min ceiling. Tighten later
   if abuse is observed.
