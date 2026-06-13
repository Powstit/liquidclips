# Keychain Runtime Prompt Report

Date: 2026-06-13
Repo: `/Users/dipdip/code/jnr`
Baseline: `c8030c5 feat(earn): ship native Earn surface with sidecar session readiness`
Version: `0.7.63`

## Finding

v0.7.63 still has passive runtime paths that can read the macOS Keychain through the Python sidecar. The primary regression is not a direct JS/Tauri `licenseJwtRead()` call; it is an Earn mount/focus path that calls `sidecar.whopSessionStatus()`, which reads `LICENSE_JWT` through Python `keyring`.

Primary culprit:

- `desktop/src/components/earn/EarnTab.tsx:90` defines `probe()`.
- `desktop/src/components/earn/EarnTab.tsx:141` runs `probe()` on Earn mount.
- `desktop/src/components/earn/EarnTab.tsx:145-148` re-runs `probe()` on `focus`, `lc:tier-refresh`, and `junior:whop-auth`.
- `desktop/src/components/earn/EarnTab.tsx:130` calls `sidecar.whopSessionStatus()` when the in-memory JS cache is empty but `licenseJwtPresence()` says a JWT exists.
- `desktop/src/lib/sidecar.ts:999-1011` maps that to sidecar RPC `whop_session_status`.
- `desktop/python-sidecar/sidecar.py:3465-3491` implements `method_whop_session_status()`.
- `desktop/python-sidecar/sidecar.py:3480-3481` calls `get_secret("LICENSE_JWT")`.
- `desktop/python-sidecar/secrets_store.py:143-158` implements `get_secret()` as `keyring.get_password(_service_for(name), name)`.

That is enough to trigger the macOS prompt on Earn open and on focus when the signed binary identity is not already allowed by the keychain item's ACL.

## Trigger Path

Cold launch to Earn, or any passive event that mounts/re-probes Earn:

1. `EarnTab` mounts.
2. `useEffect()` calls `probe()`.
3. `probe()` checks `getCachedLicenseJwt()`.
4. If cache is empty, `probe()` calls `sidecar.licenseJwtPresence()`.
5. If the presence mirror says `LICENSE_JWT: true`, `probe()` calls `sidecar.whopSessionStatus()`.
6. `method_whop_session_status()` calls `get_secret("LICENSE_JWT")`.
7. `secrets_store.get_secret()` calls Python `keyring.get_password()`.
8. macOS Keychain prompts.

The same `probe()` is also registered on `window.focus`, `lc:tier-refresh`, and `junior:whop-auth`, so the prompt can repeat on passive app focus or refresh events.

## `whopSessionStatus()` Answer

Yes, `sidecar.whopSessionStatus()` reads keychain passively today.

Exact code:

- `desktop/python-sidecar/sidecar.py:3465` `method_whop_session_status()`
- `desktop/python-sidecar/sidecar.py:3480-3481` imports `get_secret` and evaluates `bool(get_secret("LICENSE_JWT"))`
- `desktop/python-sidecar/secrets_store.py:157` calls `keyring.get_password(...)`

It also calls `whop_client.token_source()` at `desktop/python-sidecar/sidecar.py:3484`. That function can read `JUNIOR_WHOP_TOKEN` from keychain:

- `desktop/python-sidecar/whop_client.py:120-148` `token_source()`
- `desktop/python-sidecar/whop_client.py:130-133` calls `get_secret("JUNIOR_WHOP_TOKEN")`

So `whopSessionStatus()` is unsafe for passive UI even if the `LICENSE_JWT` read is removed, unless `token_source()` is also made safe or avoided.

## `whopListBounties()` Answer

Yes, `whopListBounties()` reads keychain passively when mounted by UI code.

Runtime path:

- `desktop/src/components/earn/EarnTab.tsx:379-401` `BountySection.load()` runs when `auth.kind === "ready"`.
- `desktop/src/components/earn/EarnTab.tsx:383` calls `sidecar.whopListBounties(30)`.
- `desktop/src/lib/sidecar.ts:1026-1030` maps that to sidecar RPC `whop_list_bounties`.
- `desktop/python-sidecar/sidecar.py:3410-3433` `method_whop_list_bounties()` calls `whop_client.list_bounties()`.
- `desktop/python-sidecar/whop_client.py:206-209` `list_bounties()` calls `_backend_get()`.
- `desktop/python-sidecar/whop_client.py:173` `_backend_get()` calls `_license_jwt()`.
- `desktop/python-sidecar/whop_client.py:155-162` `_license_jwt()` calls `get_secret("LICENSE_JWT")`.
- `desktop/python-sidecar/secrets_store.py:157` calls Python `keyring.get_password(...)`.

`desktop/src/contracts/useBountySwipe.ts:57-80` has the same risk: `refresh()` calls `sidecar.whopListBounties(30)` and `desktop/src/contracts/useBountySwipe.ts:115-117` calls `refresh()` on hook mount. Its current mount component is `desktop/src/components/earn/BountySwipeMount.tsx:91-99`, which does not appear mounted by the current `EarnTab.tsx`, but it is still a passive caller if reintroduced.

## Other Passive Survivors

`desktop/src/components/Settings.tsx:1233-1253` has `WhoAmISection()`, which mounts under the default Settings category `account` (`desktop/src/components/Settings.tsx:121`, `desktop/src/components/Settings.tsx:738`). Its effect calls:

- `meStatus()`
- `sidecar.whopSessionStatus().catch(() => null)`

So opening Settings -> Account can also trigger the same Python keyring path passively.

Rust `desktop/src-tauri/src/earn_panel.rs:185-190` and `desktop/src-tauri/src/earn_panel.rs:309-313` only document the old hosted Earn embed auth bridge. The grep hits there are comments; they are not the current native Earn prompt source.

Known non-passive or explicit-action keychain touches:

- `desktop/src/lib/authStorage.ts:153-185` `readLicenseJwtForAuthAction()` calls `sidecar.licenseJwtRead()` and is intended for explicit auth actions only.
- `desktop/src/lib/activation.ts:160-166` writes `LICENSE_JWT` after the explicit connect-desktop deep-link callback.
- `desktop/src/lib/activation.ts:287` deletes `LICENSE_JWT` during explicit reset/sign-out.
- `desktop/src/components/FirstRun.tsx:70` writes `OPENAI_API_KEY` after user input.
- `desktop/src/components/Settings.tsx:301` writes edited secrets after user input.

Pipeline-stage keychain reads are not boot/Earn passive, but they are still Keychain-capable and should remain action-scoped:

- `desktop/python-sidecar/stages.py:949` reads `LICENSE_JWT` for cloud transcription fallback.
- `desktop/python-sidecar/stages.py:1665` reads `LICENSE_JWT` for watermark tier sync.
- `desktop/python-sidecar/llm.py:329` reads `LICENSE_JWT` for hosted LLM availability/calls.
- `desktop/python-sidecar/llm.py:583` reads `OPENAI_API_KEY`.
- `desktop/python-sidecar/sidecar.py:2245` reads reaction-provider API keys.

## Why Tests Passed

The IG-014 tests and pre-commit gate mostly detect direct static patterns, not semantic sidecar call chains.

What they catch:

- direct `licenseJwtRead(` outside approved files
- direct `sidecar.secretGet`
- `method_secret_get`
- `keyring.get_password.*LICENSE_JWT`
- direct `allowKeychainRead: true`

Why they missed this:

1. `desktop/src/components/earn/EarnTab.tsx` calls `sidecar.whopSessionStatus()`, not `licenseJwtRead()` or `secret_get`.
2. `desktop/src/components/earn/EarnTab.tsx` calls `sidecar.whopListBounties()`, not `licenseJwtRead()` or `secret_get`.
3. `desktop/python-sidecar/sidecar.py` and `desktop/python-sidecar/whop_client.py` are approved files in both:
   - `desktop/tests/no-passive-keychain.test.mjs:25-38`
   - `desktop/scripts/assert-no-passive-keychain.sh:27-29`
4. The test only checks five mount-sensitive surfaces at `desktop/tests/no-passive-keychain.test.mjs:132-155`; `EarnTab.tsx`, `Settings.tsx`, and `useBountySwipe.ts` are not included in that surface list.
5. The regex `keyring\.get_password.*LICENSE_JWT` does not match the real implementation because `keyring.get_password()` is called generically in `secrets_store.py:157`, while the key name is passed indirectly through `_service_for(name)`.

Net: the tests proved "no obvious JS direct keychain read survived," but they did not prove "no passive UI RPC reaches Python `get_secret()`."

## Source Of Prompt

This prompt is from Python sidecar `keyring`, not Tauri secret store.

The direct prompt-producing function is:

- `desktop/python-sidecar/secrets_store.py:157`

Current passive callers reach it through:

- `desktop/python-sidecar/sidecar.py:3481` via `whop_session_status`
- `desktop/python-sidecar/whop_client.py:160` via `whop_list_bounties`
- `desktop/python-sidecar/whop_client.py:132` via `token_source()` reading `JUNIOR_WHOP_TOKEN`

The legacy namespace migration appears not to be the active read path for `LICENSE_JWT`: `_service_for("LICENSE_JWT")` routes to `SERVICE_AUTH = "app.liquidclips.auth.v1"` at `desktop/python-sidecar/secrets_store.py:63-90`, and comments state legacy `app.liquidclips.desktop` JWTs are not auto-read. Legacy cleanup can still prompt during explicit `delete_secret("LICENSE_JWT")`, but that is sign-out/reset scoped, not the current passive Earn prompt.

## Proposed Fix

This needs a v0.7.64 fix because installed v0.7.63 has a shipped runtime prompt regression.

Product rule for v0.7.64:

- Passive UI may read only:
  - JS in-memory cache: `getCachedLicenseJwt()`
  - presence mirror: `licenseJwtPresence()` / `secretsStatus()`
  - a sidecar status JSON/cache that never calls `get_secret()`
- Passive UI must not call:
  - `sidecar.whopSessionStatus()` if it reads keychain
  - `sidecar.whopListBounties()` if it reads keychain
  - `whop_client.token_source()` if it can read `JUNIOR_WHOP_TOKEN`

Recommended code shape:

1. Remove `sidecar.whopSessionStatus()` from `EarnTab.probe()`.
2. On cold launch with `LICENSE_JWT` presence true and JS cache empty, render a "Continue session" / "Refresh session" state instead of trying to prove activation through sidecar keychain.
3. Only the user-clicked "Continue session" / "Refresh session" action may read keychain or run the connect-desktop flow.
4. Do not mount `BountySection.load()` unless the current process has a safe bearer token source:
   - JS cache was primed by explicit auth action, or
   - sidecar has an in-memory JWT cache populated by explicit auth action.
5. Refactor `whop_session_status` into a passive-safe method that returns only presence/cache state and never calls `get_secret()` or `token_source()`; e.g.:
   - `junior_activation_present`: from `list_known_secrets()`
   - `junior_session_ready`: from sidecar in-memory JWT cache only
   - `whop_desktop_oauth_present`: from presence mirror only
6. Refactor Whop bounty reads so passive loads use an explicit in-memory token cache, not keychain. If no token is cached, show the Whop/connect/continue-session state.
7. Add static coverage for semantic unsafe RPCs:
   - block `whopSessionStatus()` from mount/focus/passive files unless the sidecar method is proven passive-safe
   - block `whopListBounties()` from mount effects unless guarded by an in-memory auth-ready predicate
   - add `EarnTab.tsx`, `Settings.tsx`, and `contracts/useBountySwipe.ts` to mount-sensitive coverage
   - add a Python-sidecar test/check that `method_whop_session_status` and any passive status methods do not call `get_secret()`

## Acceptance Checklist

For v0.7.64:

- Cold launch with existing `LICENSE_JWT` presence does not trigger macOS Keychain prompt.
- Opening Earn does not trigger macOS Keychain prompt.
- Refocusing the app while Earn is open does not trigger macOS Keychain prompt.
- `lc:tier-refresh` and `junior:whop-auth` events do not trigger macOS Keychain prompt unless they are fired after an explicit auth action that already primed memory.
- Opening Settings -> Account does not trigger macOS Keychain prompt.
- Passive Whop status reads do not call `get_secret("LICENSE_JWT")`.
- Passive Whop status reads do not call `get_secret("JUNIOR_WHOP_TOKEN")`.
- Passive bounty list mounting does not call `get_secret("LICENSE_JWT")`.
- If the in-memory auth cache is empty but presence says a JWT exists, Earn shows a user-clicked "Continue session" or "Refresh session" CTA.
- Clicking "Continue session" / "Refresh session" is allowed to read keychain or route through `/connect-desktop`.
- Sponsored campaigns still render without auth.
- Whop/bounty area either renders data from a safe cached session or shows the correct connect/continue state.
- IG-014 invariant tests include Earn, Settings Account, and `useBountySwipe`.
- No tag, no release, no `latest.json`, no production deploy.
