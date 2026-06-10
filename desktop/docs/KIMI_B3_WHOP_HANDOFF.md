# Kimi — B3 Whop OAuth Handoff (v0.7.32 ship-blocker)

**For Kimi.** Read this before touching anything. Every state line below was verified live on 2026-06-10. Don't re-litigate the parts marked ✅ — they already work.

Reference docs (load-bearing):
- `desktop/docs/SHIP_v0.7.32_BLOCKERS.md` — B3 is the blocker this closes.
- `desktop/docs/WHOP_TRUE_LOGIN_SCOPE.md` — original scope, env-var conventions.
- `desktop/docs/KIMI_P0_FIX_RAILS.md` — your house rules (no "I fixed it" without verification command output).

Iron Gates touched: **IG-004 (auth)**. `auth_whop.py` carries the sentinel. Do not edit beyond the scope below.

---

## ✅ Already wired — do not redo

| Component | State |
|---|---|
| `junior-backend/app/routes/auth_whop.py` | exists, fully coded, GET `/auth/whop/start` + `/auth/whop/callback` |
| `junior-backend/app/main.py:21` + `:246` | `auth_whop` imported + `include_router(auth_whop.router)` ✅ |
| Backend deployed | `https://api.jnremployee.com/auth/whop/start?challenge=X` returns HTTP 302 to Whop OAuth URL ✅ |
| Redirect URI | `https://api.liquidclips.app/auth/whop/callback` (set on Railway) ✅ |
| `account-app/src/app/connect-desktop/page.tsx` | "Continue with Whop" button rendered behind `WHOP_SIGNIN_ENABLED` flag ✅ |
| Vercel env (account-app, `prj_eIPnzibZFvuw6I9T4AHJAoA3GJRZ`) | `NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL`, plan IDs all set ✅ |
| Railway env (junior-backend) | `WHOP_OAUTH_CLIENT_ID = app_hLphExdFzjEQsM` ✅ · `WHOP_OAUTH_REDIRECT_URI = https://api.liquidclips.app/auth/whop/callback` ✅ |

---

## 🚨 OUTSTANDING — what's left

### B3-T1 · ✅ NO ACTION — Railway secret is correct (revised 2026-06-10)

**Reversed diagnosis.** Daniel confirmed via Whop dashboard screenshot 2026-06-10 that the Whop OAuth app for `app_hLphExdFzjEQsM` is in **`public` OAuth client mode**, and Whop labels the same `apik_BvoGD...0e0c9b142b` value as BOTH the API key AND the OAuth `client_secret` in the OAuth Apps screen. Whop's public-mode OAuth apps either accept the API key as the secret or ignore the field entirely — the original "wrong secret" diagnosis was based on the wrong assumption that OAuth secrets shouldn't share the `apik_` prefix.

**Verified state on Railway:** `WHOP_OAUTH_CLIENT_SECRET` matches the value Whop shows as the OAuth client_secret. ✅ No change required.

**Persisted to:** `~/.claude-credentials/whop.env` adds an explicit `WHOP_OAUTH_CLIENT_SECRET` line (same value as `WHOP_API_KEY` by design) so future agents don't re-diagnose this as a bug.

**Redirect URIs registered (verified 2026-06-10):**
- ✅ `https://api.liquidclips.app/auth/whop/callback` — REQUIRED, registered
- ✅ `https://partner.jnremployee.com/auth/whop/callback` — partner app
- ✅ `http://localhost:3000/auth/whop/callback`, `http://localhost:8765/auth/whop/callback` — dev
- ⚠️ `https://api.jnremployee.com/auth/whop/callback` — NOT registered, but the backend uses `api.liquidclips.app` per `WHOP_OAUTH_REDIRECT_URI`, so this is fine. Optional add for redundancy.

---

### B3-T2 · ✅ DONE 2026-06-10 — `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED` flipped to plain `true` on account-app production

**Was:** `sensitive` type on production (Next.js can't inline sensitive vars at build time, so the button was being dead-code-eliminated client-side).
**Now:** `plain` type, value `true`, target `production`. Vercel API confirms. account-app redeployed via `vercel --prod --yes --force`.

Note: CLI verification via `curl | grep "Continue with Whop"` returns 0 because the button is rendered post-hydration (gated on a useEffect setting `challenge` from URL). The real test is the smoke step below.

**Scope:**
1. On Vercel account-app project (`prj_eIPnzibZFvuw6I9T4AHJAoA3GJRZ`, team `team_3lDWj6sdPuELe9YfI0HmztSK`): delete the `production`-scope `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED` env entry.
2. Re-add as **plain** type, value `true`, target `production`.
3. Redeploy production: `cd ~/Desktop/jnr/account-app && vercel --prod --yes`.

**Why this matters:** `sensitive` env vars are encrypted with a runtime key. For a `NEXT_PUBLIC_` flag (which gets inlined into client JS), `sensitive` is wrong — Next.js can't inline a value it can't read at build time. The button will silently never render in prod.

**Exit criteria:** `curl https://account.liquidclips.app/connect-desktop?challenge=test123abc456` returned HTML contains `Continue with Whop` (run inside `<script>` blocks if needed, since it's a client-rendered button).

**Daniel's verification command:**
```bash
curl -s "https://account.liquidclips.app/connect-desktop?challenge=test123abc456" \
  | grep -ci "continue with whop"
# Must be ≥ 1.
```

---

### B3-T3 · End-to-end smoke test on staging

**Manual, in browser. Daniel runs.** Don't move past this without all 4 boxes ticked.

1. Open `https://account.liquidclips.app/connect-desktop?challenge=smoketest$(date +%s)` in a fresh incognito window.
2. Confirm both buttons appear: **Continue with Google** AND **Continue with Whop**.
3. Click **Continue with Whop** → expect Whop's OAuth consent screen for "Liquid Clips" app.
4. Authorize → expect either:
   - (a) `liquidclips://activate?token=<jwt>&challenge=<same challenge>` deep-link fires → desktop activates → tier resolves to your real Whop membership tier.
   - (b) `https://account.liquidclips.app/connect-desktop?whop_nomembership=1` empty state if your Whop account has no Liquid Clips membership.
5. Regression: click **Continue with Google** → Clerk flow still works → desktop activates (no Whop regression).

**If step 4 returns 500 or `whop_disabled=1`:** check Railway logs for the callback (`railway logs --since 5m | grep auth/whop/callback`). Most likely: B3-T1 secret is still wrong, or Whop OAuth app needs `read_memberships` scope added too (`auth_whop.py` requests `read_user` only — the membership lookup uses the App API Key server-side, so this should be OK, but verify in logs).

---

### B3-T4 · Mark B3 ✅ RESOLVED in the blocker doc

When T1 + T2 + T3 are all green, edit `desktop/docs/SHIP_v0.7.32_BLOCKERS.md`:
- Change B3 **State** from `🟡 PENDING` to `✅ RESOLVED 2026-06-10 — Whop OAuth live, smoke test passed.`
- Commit with message: `docs(ship): B3 Whop OAuth resolved`.

Then `desktop/docs/ROADMAP_LOCK.md` moves v0.7.32 closer to ship — only B2 visual walk + B4 manifest disposition remain.

---

## What's OUT of scope here

- B2 (visual walk) — Daniel runs that on the installed app after his next build.
- B4 (manifest disposition) — separate decision.
- The marketing site Sentry fix — already shipped this session (don't touch).
- Proton email — fully wired this session (don't touch).
- ClipPreview clamping fix — that was your last commit; verify on a real clip after v0.7.32 install.

---

**Single-line summary for the lazy:**
> Fix `WHOP_OAUTH_CLIENT_SECRET` on Railway (it's currently the API key, not the OAuth secret), make `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED=true` plain (not sensitive) on production, redeploy both, smoke test from incognito, mark B3 resolved.
