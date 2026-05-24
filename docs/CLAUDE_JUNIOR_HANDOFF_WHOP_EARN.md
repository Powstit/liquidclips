# Junior 0.4.x Handoff: Earn, Whop Bounties, Activation, and Build Gate

## Current Goal

Make the Earn tab functional and honest for beta:

- A user signs into Junior with Clerk/Google/email.
- The desktop is activated with a Junior license JWT.
- The Earn tab can browse Whop Content Rewards through Junior Backend.
- Whop API secrets stay server-side.
- Whop OAuth is treated as an optional platform connection, not the account login and not the gate for public bounty browsing.

Do not rebuild the packaged app until the checks at the bottom pass.

## The Correct Mental Model

There are three different concepts. Keep them separate.

| Concept | Owner | Purpose | Where It Lives |
|---|---|---|---|
| Junior account | Clerk | User identity, billing account, license issuance | account-app + junior-backend |
| Junior desktop activation | Junior Backend | Proves this desktop belongs to a Junior user | `JUNIOR_LICENSE_JWT` in OS keychain |
| Whop bounty reads | Junior Backend | Read public Content Rewards / Bounties | backend uses server-side `WHOP_API_KEY` |
| Whop OAuth connection | Desktop / future backend | Future user-specific Whop actions | Settings → Connections, optional for now |

The Earn tab should not say or imply:

- "Sign into Whop to browse public bounties"
- "Whop OAuth is required for bounty list"
- "Desktop holds a Whop App API key"
- "Submission to Whop is automatic"

The Earn tab can say:

> Activate Junior to browse bounties. Whop tracks payouts. Junior helps you make, publish, and prepare submissions.

## Why This Refactor Is Needed

The previous desktop Whop OAuth path produced this Whop GraphQL error:

```text
You must provide a valid App API Key, or an app's user token
(generated automatically if your app is running in an iframe on whop.com)
```

That means the desktop user OAuth token is not valid for `publicBounties`.

Correct fix:

- Desktop calls Junior Backend using the Junior license JWT.
- Backend calls Whop GraphQL using server-side `WHOP_API_KEY`.
- Desktop never receives the Whop App API key.

## P0 Bug To Fix Before Rebuild

The backend proxy can be correct while the desktop still blocks users incorrectly.

Check `desktop/python-sidecar/sidecar.py`.

These methods must not require a local Whop token anymore:

- `method_whop_list_bounties`
- `method_whop_bounty`
- `method_whop_submission`

Bad pattern:

```py
if not whop_client.has_token():
    return {"bounties": [], "authenticated": False}
```

That is wrong now because `whop_client.list_bounties()` should authenticate to Junior Backend with `JUNIOR_LICENSE_JWT`, not to Whop with a local Whop token.

Expected behavior:

```py
def method_whop_list_bounties(params):
    import asyncio
    import whop_client
    first = int(params.get("first") or 30)
    bounties = asyncio.run(whop_client.list_bounties(first=first))
    return {"bounties": bounties, "authenticated": True}
```

Same idea for bounty detail and submission lookup.

If the Junior license JWT is missing, let `whop_client._backend_get()` raise a clear activation error. Do not translate that into "Connect Whop".

## Earn Tab Gate

Earn should be gated by Junior activation, not Whop OAuth.

Correct flow:

1. Earn loads.
2. Sidecar checks whether `JUNIOR_LICENSE_JWT` exists.
3. If missing: show `ActivateJuniorSplash`.
4. If present: call backend `/whop/bounties`.
5. If backend returns bounties: show available bounty list.
6. If backend returns `503` because `WHOP_API_KEY` is missing: show manual bounty paste fallback.
7. If backend returns `502` from Whop: show visible error + manual bounty paste fallback.

Whop OAuth should remain in:

```text
Settings → Connections → Whop
```

It is optional for now and should not block public bounty browsing.

## Backend Proxy Requirements

Backend route file:

```text
junior-backend/app/routes/whop.py
```

Expected endpoints:

```text
GET /whop/bounties
GET /whop/bounties/{id}
GET /whop/submissions/{id}
```

Requirements:

- Protected by `current_user`.
- Uses `WHOP_API_KEY` from backend config only.
- Never sends `WHOP_API_KEY` to desktop.
- Returns `503` if `WHOP_API_KEY` is missing.
- Returns `502` if Whop rejects or is unreachable.
- Uses short TTL cache for beta.

Note: `/whop/submissions/{id}` is acceptable for beta, but privacy-wise it can query any submission ID the user knows if Whop public API allows it. Keep this noted as a beta limitation.

## Admin / Autopilot Requirements

Daniel must not be locked out of his own app.

Source:

```text
junior-backend/app/features.py
```

Requirements:

- `JUNIOR_ADMIN_EMAILS` env var supported as comma-separated list.
- Fallback list may include Daniel’s known test emails for local/dev.
- Email matching must be case-insensitive and whitespace-trimmed.

Admin override must apply before issuing license JWTs.

Check:

```text
junior-backend/app/routes/desktop.py
junior-backend/app/routes/sync.py
```

Correct behavior:

- If admin email: effective tier is `autopilot`.
- If admin email: effective founder is `true`.
- `/desktop/connect` issues an autopilot/founder JWT.
- `/sync` rotates an autopilot/founder JWT.
- `/sync` response shows `subscription_status: "admin"`.

Do not only apply the override after JWT issuance.

## "Who Am I?" Debug Requirements

The user needs to know which account Junior thinks is active.

Backend:

```text
GET /me
```

Desktop Settings should show:

- email
- backend user id
- Clerk id
- Whop user id
- affiliate id
- raw DB tier
- effective tier
- admin override yes/no
- founder yes/no
- billing provider
- Whop backend key configured yes/no
- desktop Whop OAuth source if present

This is beta-critical. It removes confusion between:

- Clerk/Google login
- backend DB tier
- license JWT tier
- Whop connection state

## Manual Bounty Fallback

Keep this even if backend proxy works.

Use case:

- Whop API is down.
- `WHOP_API_KEY` is missing.
- Whop changes schema.
- A beta user has a bounty link and wants to test the product now.

Manual form should collect:

- bounty title
- creator/brand optional
- source URL
- brief/rules
- payout amount optional
- currency optional
- allowed platforms

Manual bounty should create a normal `BountyContext` so the rest of the pipeline does not branch.

## Copy Rules

Use honest copy.

Good:

```text
Activate Junior to browse bounties.
Whop tracks bounty payouts.
Junior helps you make, publish, and prepare submissions.
Paste bounty manually.
After you submit on Whop, paste the submission URL here so Junior can track status.
```

Avoid:

```text
Submit to Whop automatically.
Connected through Whop.
Sign in with Whop to use Junior.
Junior pays you.
```

Unless/until the private Whop submission mutation exists, Junior prepares submissions but does not submit them.

## Build Gate

Do not rebuild `.app` until these pass.

### Type / Build

```bash
cd /Users/dipdip/Desktop/jnr/desktop
npm run build
```

### Backend Route Smoke

Confirm routes are registered:

```bash
cd /Users/dipdip/Desktop/jnr/junior-backend
python - <<'PY'
from app.main import app
for r in app.routes:
    if "/whop" in getattr(r, "path", "") or getattr(r, "path", "") == "/me":
        print(r.path)
PY
```

Expected includes:

```text
/whop/bounties
/whop/bounties/{bounty_id}
/whop/submissions/{submission_id}
/me
```

### Desktop Sidecar Logic

Search must show no local Whop-token gate in bounty methods:

```bash
cd /Users/dipdip/Desktop/jnr
grep -n "has_token" desktop/python-sidecar/sidecar.py
```

It is okay for `whop_session_status` or Settings/Connections to use local Whop token status.

It is not okay for `method_whop_list_bounties`, `method_whop_bounty`, or `method_whop_submission` to require `has_token()`.

### Manual Functional Test In Dev

With `JUNIOR_LICENSE_JWT` present:

- Earn should try backend bounty proxy.
- It should not require Whop OAuth first.
- If backend lacks `WHOP_API_KEY`, Earn should show manual paste fallback.

With `JUNIOR_LICENSE_JWT` missing:

- Earn should show Activate Junior splash.
- It should not show Connect Whop as the primary blocker.

## Rebuild Rule

This fix touches bundled desktop files:

- React Earn tab
- Python sidecar
- possibly Tauri config/types

Therefore packaged `.app` testing requires a rebuild.

Do not install a new packaged build until the above checks pass.

## Next After This Patch

After this is confirmed:

1. Build 0.4.11 or next patch version.
2. Install packaged app.
3. Test:
   - Settings → Who Junior thinks you are.
   - Daniel account shows Autopilot/Admin/Founder.
   - Earn opens without Whop OAuth.
   - Bounties load through backend if `WHOP_API_KEY` is configured.
   - Manual bounty works if proxy fails.
   - Source ingest starts.
   - Results grid preserves bounty banner.
   - Submission capture accepts `sub_...`.

Only after that should we call Earn beta-functional.

---

## Claude Code Update — 2026-05-24 (packaged QA done)

Picking up the handoff. Build gate cleared **before** rebuilding, then built + installed `Junior.app` **0.4.11** and ran packaged QA against `localhost:8000` through the bundled sidecar + bundled ffmpeg + dev venv (the real packaged code path).

Committed on `main` (unpushed) as **`d7ad139` "fix: route Earn bounties through backend proxy"** (5 files; includes Codex's `error?` return-type cleanup + cast removal in `EarnTab.tsx`). Nothing local (DB / `.env` / `.junior-keys`) staged.

### Build gate — PASS
| Gate check | Result |
|---|---|
| `npm run build` (tsc -b + vite) | ✅ pass |
| Backend route smoke (`/whop/bounties`, `/whop/bounties/{id}`, `/whop/submissions/{id}`, `/me`) | ✅ all registered |
| No `has_token()` gate in `method_whop_list_bounties` / `_bounty` / `_submission` | ✅ removed (try/except around `whop_client` proxy calls; `has_token` still used by `whop_session_status`/Settings, which is allowed) |
| Dev functional: license present → backend proxy, no Whop OAuth; license missing → ActivateJuniorSplash | ✅ |

### "Next After This Patch" checklist — status
| Item | Status |
|---|---|
| Build 0.4.11 + install packaged app | ✅ done (`/Applications/Junior.app`) |
| Earn opens without Whop OAuth | ✅ gates on `junior_activated` (license JWT) |
| Bounties load through backend when `WHOP_API_KEY` configured | ✅ 3 live bounties + detail via proxy |
| Manual bounty works if proxy fails | ✅ trigger machine-verified (unreachable → `authenticated:false` + error); routing code-verified (`onStartManualBounty` → synthetic `BountyContext` → URL ingest). **GUI form not eyeballed.** |
| Source ingest starts | ✅ via full pipeline run (below) |
| Settings → "Who Junior thinks you are" | ⚠️ `/me` route exists; **Settings panel fields not eyeballed** |
| Daniel account shows Autopilot/Admin/Founder | ❌ **NOT verified** — see blocker below |
| Results grid preserves bounty banner | ⚠️ **not eyeballed (GUI)** |
| Submission capture accepts `sub_...` | ⚠️ **not tested** |

### Full pipeline (import → transcribe → clips → export)
12.6-min speech video → **3 × 1080×1920 h264+aac** clips in 164s, + SRT/VTT, thumbnails, transcript, 4 ratios each. Faithful packaged path.

### Bug I fixed beyond the spec (FYI Codex)
`junior-backend/app/routes/whop.py` queried `user { ... image }`, but Whop's `PublicProfileUser` has **no scalar `image`** → 502 `Field 'image' doesn't exist`. Fixed: query `profilePicture { sourceUrl }` and flatten back to `user.image` via new `_normalize_bounty()`, so the desktop `WhopBounty` contract is unchanged. (This was hit only once the proxy was actually reachable with a valid key.)

### Open blockers / not-yet-verified (please pick up or confirm)
1. **Admin/Autopilot override UNVERIFIED.** Local SQLite DB had **0 users** (reset). I seeded a dev user `clerk_id=user_devlocal`, tier **`growth`**, and minted a license JWT into the keychain to unblock QA — this **bypassed** the `JUNIOR_ADMIN_EMAILS` → autopilot/founder path. So `/desktop/connect` + `/sync` admin override and `subscription_status:"admin"` are **untested**. Needs a real Clerk-seeded Daniel user to verify.
2. **`/me` Settings panel** field rendering (email, ids, raw vs effective tier, admin override, founder, key-configured, oauth source) — route confirmed, UI not.
3. **Offline transcribe** (bundled whisper-tiny) not exercised — an OpenAI key was present so the hosted path ran. No-key run would confirm the local fallback.
4. Build's only non-zero exit = updater signing (`TAURI_SIGNING_PRIVATE_KEY` unset) — Sprint 9, not blocking the `.app`.

### Collision guard
I'm **not** touching Railway config or the offline-transcribe path until Daniel greenlights. If you (Codex) take the admin-override verification, the `/me` Settings panel, or the offline-transcribe run, flag it here and we won't step on each other. Currently running from my session: `Junior.app` (open) + backend on `:8000`.

