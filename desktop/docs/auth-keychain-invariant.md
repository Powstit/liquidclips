# Auth-Keychain Invariant (IG-014)

> **Canonical statement.** Liquid Clips must never read the macOS Keychain
> passively. Boot, tab mount, Earn, Schedule, Notifications, polling,
> focus, visibility, drawer open, quota checks, publishing, scheduling,
> and notification actions must use the cached JWT only. If the cache is
> empty, surface the reconnect UI. Only Sign in, Sign out, Reconnect, and
> Connect-desktop callback may touch auth storage.

This is a permanent repo invariant. The enforcement chain has four layers:

1. **`src/lib/authStorage.ts`** — central module. `getCachedLicenseJwt`,
   `licenseJwtPresence`, `requireCachedLicenseJwtOrThrow`,
   `primeLicenseJwtCache`, `invalidateLicenseJwtCache`,
   `readLicenseJwtForAuthAction`. Dev-mode runtime guard throws if a
   caller of `readLicenseJwtForAuthAction` did not declare
   `explicitAuthAction: true`.
2. **`scripts/assert-no-passive-keychain.sh`** — pre-commit gate. Blocks
   any commit that re-introduces a disallowed pattern outside the small
   approved-auth-files list.
3. **`tests/no-passive-keychain.test.mjs`** — `node --test` fixture. Static
   assertions over the source tree. Mirrors the pre-commit script
   verbatim; both must agree on the approved list.
4. **`IRON GATE IG-014`** sentinel in this file and in `authStorage.ts` /
   `secrets_store.py` / `assert-no-passive-keychain.sh`. The existing
   pre-commit hook (`iron-gate-precommit.sh`) refuses sentinel removal
   without an explicit override + an `Iron-gate-retire:` trailer.

## Why this exists

macOS Keychain access-control lists are keyed by the requesting binary's
codesign hash. Every release build produces a different sidecar
signature; the first time a rebuilt binary touches a Keychain item that
the previous binary's signature wrote, macOS shows a UI password prompt.

The pre-v0.7.58 desktop scattered direct `sidecar.licenseJwtRead()` calls
across boot, mount, polling, drawer-open, focus, visibilitychange, and
every user action that needed a JWT. Each of those triggered a separate
prompt — boot alone could stack ~10 of them — and users perceived the
app as broken / untrustworthy.

The invariant collapses every code path into one of two buckets:

* **Safe (every passive caller + every non-auth click).** Reads the
  in-memory cache via `getCachedLicenseJwt()` or throws
  `CachedJwtUnavailableError` via `requireCachedLicenseJwtOrThrow()`.
  Never touches the Keychain.
* **Allowed (the five explicit auth actions).** Calls
  `readLicenseJwtForAuthAction({ explicitAuthAction: true, callerLabel })`,
  which is the only path that hits `sidecar.licenseJwtRead`. A successful
  read primes the cache for the rest of the session.

The five allowed actions:

1. **Sign in** — `activation.ts.startActivation` opens the auth panel; the
   resulting deep-link `liquidclips://activate?token=…` lands in
   `handleDeepLink` which writes the JWT (via `sidecar.secretSet`) and
   primes the cache (via `primeLicenseJwtCache`).
2. **Sign out** — `Settings.performSignOut` → `performAtomicSignOutWipe` →
   `sidecar.secretDelete("LICENSE_JWT")` + `invalidateLicenseJwtCache`.
3. **Reconnect account** — same code path as Sign in.
4. **Connect-desktop callback** — same code path as Sign in.
5. **Explicit "Reset login session"** — `activation.resetLoginSession` →
   `sidecar.secretDelete("LICENSE_JWT")` + `invalidateLicenseJwtCache`.

## Approved auth files

These are the ONLY files allowed to contain `licenseJwtRead(` /
`allowKeychainRead: true` / `sidecar.secretGet` / `method_secret_get` /
`keyring.get_password.*LICENSE_JWT` patterns. Edit both
`scripts/assert-no-passive-keychain.sh` and
`tests/no-passive-keychain.test.mjs` if you add to this list.

* `src/lib/authStorage.ts`
* `src/lib/activation.ts`
* `src/lib/sidecar.ts`
* `python-sidecar/secrets_store.py`
* `python-sidecar/sidecar.py`
* `python-sidecar/whop_client.py`
* `scripts/assert-no-passive-keychain.sh`
* `tests/no-passive-keychain.test.mjs`
* `docs/auth-keychain-invariant.md`
* `docs/IRON_GATES.md`
* `CLAUDE.md`
* `src/components/NotificationBell.tsx` (comments only — see file head)

## Keychain SERVICE namespace split (v0.7.58)

`LICENSE_JWT` now lives under `app.liquidclips.auth.v1`. Every other
known secret (BYO API keys, onboarding flag) stays under
`app.liquidclips.desktop`. The dispatch happens in
`python-sidecar/secrets_store.py::_service_for`.

Legacy `LICENSE_JWT` items under `app.liquidclips.desktop` are never
read automatically. `delete_secret("LICENSE_JWT")` strips both the new
namespace AND the legacy slot, so the explicit sign-out / reset paths
clean up after themselves. Legacy items that the user never explicitly
signs out of remain orphaned in the user's Keychain — by design — until
the user signs out, resets, or reconnects.

## How to add a new surface

If you're adding a surface that needs a JWT:

* **Mount / lifecycle / drawer-open / poll-free refresh paths**: call
  `getCachedLicenseJwt()`. Empty → render a reconnect state using
  `RECONNECT_PROMPT_COPY`. Do NOT call `readLicenseJwtForAuthAction`.
* **Submit / action / row-click paths**: call
  `requireCachedLicenseJwtOrThrow()`. Catch `CachedJwtUnavailableError`
  and surface `err.message` (which IS `RECONNECT_PROMPT_COPY`) inline.
* **A new sixth-allowed auth action**: that requires a directive change.
  Discuss with the owner first; if green-lit, add the file to the
  approved list in both the pre-commit script and this doc, and use
  `readLicenseJwtForAuthAction({ explicitAuthAction: true,
  callerLabel: "auth.<flow>" })`.

## Verifying the invariant locally

```bash
# pre-commit gate (also runs automatically before any commit)
bash desktop/scripts/assert-no-passive-keychain.sh

# static-assertion test fixture
cd desktop && npm run test:invariant
```

Both must report green before any v0.7.58+ build is shipped.
