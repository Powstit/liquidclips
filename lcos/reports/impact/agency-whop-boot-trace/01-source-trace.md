# 01 · Source trace · every gate that can redirect an authed user to LoginScreen

Base commit: `1e06972649c4626fdc7b2f4a0219fcbc15125817` on
`integration/cold-entry-mode-b`. Investigation branch:
`qa-harness/agency-whop-boot-trace`.

## Boot decision chain (read-only)

App.tsx boot tree (top → bottom):

```
HardUpdateGate
 └── Suspense
      └── IntroSplash (skipped in QA / qaGateEnabled() → true in Vite dev)
      └── WelcomeGate          <- can redirect to LoginScreen (WelcomeRoute)
           └── FunnelGate      <- redirects only when funnel session id present
                └── AuthGate    <- PASS-THROUGH · 2026-07-05 v2.2.24 · NEVER blocks
                     └── AppShell (data-testid="app-shell")
```

### Condition 1 · WelcomeGate mounts LoginScreen when `acked === false`

**File** · `desktop-2/src/App.tsx:476-559`.

`acked` initial state (line 477-484):
```ts
const [acked, setAcked] = useState<boolean>(() => {
  if (hasJwt()) return true;
  try { return window.localStorage.getItem("lc:welcome-acked") === "1"; }
  catch { return true; /* fail-open */ }
});
```

Redirect fires when BOTH:
* `hasJwt() === false` (no `lc.license.jwt.v1` in localStorage AND no
  in-memory cache), AND
* `localStorage["lc:welcome-acked"] !== "1"`.

Reactive flips to `acked === true` (lines 494-530):
* `activation:complete` bus event (JWT freshly stored via activation).
* `activation.status === "activated"` from `useActivation()`.
* `hasJwt()` re-read on either signal.

Reactive flip to `acked === false` (lines 539-556):
* `auth:signed-out` bus event, only when `!hasJwt() && !welcomeAcked`.

**Verdict**: WelcomeGate is the ONLY gate above AuthGate that can send an
authenticated user back to LoginScreen. It's satisfied when either
`hasJwt()` returns true OR the `lc:welcome-acked` localStorage flag is
"1".

### Condition 2 · FunnelGate mounts ClaimScreen when `sessionId` truthy

**File** · `desktop-2/src/App.tsx:446-462`.

`readSessionIdFromLaunch()` reads:
* `URLSearchParams` → `?session=` on window.location, OR
* `localStorage.getItem("lc.funnel.session.v1")` (via
  `funnelSession.ts`).

Harness does neither. `sessionId` stays `null`. FunnelGate always
returns `<>{children}</>` under harness conditions. Not a candidate for
the failure mode reported.

### Condition 3 · AuthGate is a pass-through

**File** · `desktop-2/src/App.tsx:561-617` (documented at line 561).

```
2026-07-05 · 2.2.24 · pass-through AuthGate.
Since the sign-in surface pivot, the gate never blocks the shell.
```

Line 616: `return <>{children}</>;` — unconditional.

Consumes `useAuth()` but only for downstream telemetry / re-render
coupling. Cannot redirect to LoginScreen under any input.

### Condition 4 · MembershipGate

**File** · `desktop-2/src/App.tsx:406`, mounts INSIDE `<AuthGate>`
alongside `<AppShell />`. Renders a paywall panel — does NOT prevent
`.lc-app` from mounting (paywall overlays on top). Not a candidate for
the "no `.lc-app`" failure mode.

## Data-testid mount points

* `[data-testid="app-shell"]` — `desktop-2/src/design-os/components/AppShell.tsx:226`
  (`div.lc-app`).
* `[data-testid="welcome-route-root"]` —
  `desktop-2/src/design-os/routes/WelcomeRoute.tsx:905`
  (`div.lc-login-root`).
* `"Sign in to Liquid Clips"` copy —
  `desktop-2/src/components/auth/SimpleLoginPanel.tsx:207`
  (rendered inside WelcomeRoute at
  `desktop-2/src/design-os/routes/WelcomeRoute.tsx:932`).

The failure signature reported by the task ("Sign in to Liquid Clips"
copy present, `.lc-app` never mounts) implies **WelcomeRoute** is
rendered, which requires `acked === false` in WelcomeGate.

## What the harness seeds (harness-side inspection)

**File** · `desktop-2/tests/e2e/_auth-harness.ts:290-322` (function
`seedAuthenticatedShell`).

Under `page.addInitScript`:
```ts
window.localStorage.setItem("lc.license.jwt.v1", CANONICAL_HARNESS_JWT);
window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
window.localStorage.setItem(
  "app.liquidclips.auth.v1.whop_authorized_at",
  whopAt,
);
window.localStorage.setItem("lc:welcome-acked", "1");
```

Both preconditions that flip WelcomeGate to `acked === true` are
present:
1. `lc.license.jwt.v1` populated → `hasJwt()` returns true (via the
   sync `getJwt()` path in `desktop-2/src/lib/authStorage.ts:60-70` +
   `hasJwt()` at line 168-170).
2. `lc:welcome-acked === "1"` populated (fail-open path also honours
   this).

The harness also installs `page.route(...)` mocks for `/me`, `/sync`,
`/me/money-rollup`, `/affiliate/me`, and a catch-all `/api/**`. These
prevent useMe from getting into a "hydration never lands" state that
some earlier consumers used to conflate with a mount failure.

## /me mock parity check

`_auth-harness.ts::buildMeBody()` (lines 108-141) produces a MeBody
that includes every field `adaptMe()` in
`desktop-2/src/design-os/state/useMe.ts:323-355` reads:
`backend_user_id`, `clerk_id`, `email`, `whop_user_id`,
`affiliate_id`, `raw_tier`, `effective_tier`, `admin_override`,
`billing_provider`, `subscription_status`, `paid_until`,
`platform_role`, `capabilities`, `tenant_contexts`, `operating_mode`,
`target_tenant_id`, `capability_schema_version`, `whop_company_id`,
`lc_id`, `handle`.

Every field maps to an `adaptMe` case that either accepts the type or
falls to `null`. No throw path is possible from the harness body.

## Conclusion of source trace

Every code condition that could redirect an authenticated user to
`WelcomeRoute` in the presence of a seeded JWT + welcome-acked flag is
satisfied. Nothing in the source expects `whop_connected` or `tier`
to gate `.lc-app` mount.

**Expected outcome under harness**: `.lc-app` mounts for every value
of `whop_connected` and every `tier`. Runtime instrumentation
(report 02) confirms this. No product bug is proven.
