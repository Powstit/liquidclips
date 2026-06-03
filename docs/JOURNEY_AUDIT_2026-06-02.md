# Liquid Clips Live Customer Journey Audit - 2026-06-02

Scope: final live-stack pass over the launch-critical acquisition, account, download, affiliate, and pricing flows. This follows up `docs/CLAUDE_CUSTOMER_JOURNEY_REPORT_2026-06-01.md`.

Constraints: no production accounts were created, no real payment method was submitted, and no source code was changed. Authenticated Stripe checkout/dashboard return could not be fully completed without a test user and payment credentials.

## Executive Summary

The live stack is mostly reachable, but two launch blockers are visible before public release:

1. `/download` loads, but its DMG CTA points to `https://github.com/Powstit/Jnr-employee/releases/latest`, which currently returns GitHub `404` because no GitHub Release object exists yet.
2. Pricing copy is split: `liquidclips.app` still sells `Try / Solo / Growth / Autopilot` at `$0 / $29.99 / $99.99 / $199.99`, while the account app source of truth is `Free / Solo / Pro / Agency` at `$0 / $29.99 / $79.99 / $149`.

Affiliate entry also has a split behavior: `https://liquidclips.app/affiliates` works and the explicit Whop OAuth start URL works, but `https://partner.jnremployee.com` redirects back to the marketing affiliates page instead of loading a partner dashboard/sign-in surface.

## Live Checks

| Flow | URL checked | Result | Status |
|---|---|---:|---|
| Marketing home | `https://liquidclips.app` | `200` | Works |
| Account home | `https://account.jnremployee.com` | `200` | Works |
| Sign-up route | `https://account.jnremployee.com/sign-up` | `200`, Clerk live key present | Shell works; account creation not completed |
| Plan sign-up route | `https://account.jnremployee.com/sign-up?plan=solo` | `200`, Clerk signed-out headers | Shell works |
| Upgrade route | `https://account.jnremployee.com/upgrade` | `200` with Next redirect boundary to `/sign-in?redirect_url=/upgrade` | Expected for signed-out user |
| Dashboard route | `https://account.jnremployee.com/dashboard` | `200`, protected app shell | Authenticated dashboard not verified |
| Download page | `https://liquidclips.app/download` | `200` | Page works |
| Download DMG target | `https://github.com/Powstit/Jnr-employee/releases/latest` | `404` | Broken until release is published |
| Affiliates page | `https://liquidclips.app/affiliates` | `200` | Works |
| Partner root | `https://partner.jnremployee.com` | `307 -> https://jnremployee.com/affiliates -> 308 -> https://liquidclips.app/affiliates` | Does not load dashboard |
| Affiliate Whop start | `https://partner.jnremployee.com/auth/whop/start` | `307` to Whop OAuth, sets PKCE/state cookies | OAuth start works |
| Demo link | `https://app.jnremployee.com` | `200` | Works |

## Flow Findings

### 1. Sign-up via account.jnremployee.com

`/sign-up` returns `200` and the page includes Clerk production assets with the live Clerk publishable key for `account.jnremployee.com`. The signed-out plan links also route to the same Clerk catch-all sign-up page.

Verdict: sign-up shell is live. I did not create a real account, so webhook/user provisioning and post-signup redirect remain unverified.

### 2. `/upgrade` -> Stripe flow -> account return

Signed-out `/upgrade` returns a Next redirect boundary:

`NEXT_REDIRECT;replace;/sign-in?redirect_url=/upgrade;307`

That is correct for a protected upgrade page. I could not verify the Clerk/Stripe checkout handoff or return-to-account behavior without an authenticated test account.

Verdict: protected routing works. Stripe checkout and return remain unverified live.

### 3. `/download` -> DMG link

The new download page renders at `https://liquidclips.app/download` and its primary CTAs point at:

`https://github.com/Powstit/Jnr-employee/releases/latest`

That target currently returns GitHub `404` because `v0.4.53` has no published/draft GitHub Release object with assets yet.

Verdict: page works; installer link is broken until Claude's release pipeline creates the GitHub Release.

### 4. `/affiliates` -> partner.jnremployee.com

`https://liquidclips.app/affiliates` renders the affiliate program and the “Become an affiliate” URL works by starting Whop OAuth:

`partner.jnremployee.com/auth/whop/start -> api.whop.com/oauth/authorize -> whop.com/login`

However, the “Affiliate sign in” URL points to bare `https://partner.jnremployee.com`, and that root redirects back to the marketing affiliates page, not a partner dashboard.

Verdict: acquisition page and OAuth start work. Partner root/sign-in behavior is not a dashboard and may loop users back to marketing.

### 5. Pricing copy match

Live `liquidclips.app` pricing is still legacy:

- Try: `$0`
- Solo: `$29.99`
- Growth: `$99.99`
- Autopilot: `$199.99`

Current account-app pricing source is:

- Free: `$0`
- Solo: `$29.99`
- Pro: `$79.99`
- Agency: `$149`

The live download page already mentions `Pro` and `Agency`, so public pricing is internally inconsistent across marketing/download/account surfaces.

Verdict: pricing copy does not match and should be treated as a public-launch blocker.

## Recommendations For Claude

1. After the release pipeline publishes `v0.4.53`, re-check `https://github.com/Powstit/Jnr-employee/releases/latest` and then click through from `https://liquidclips.app/download`.
2. Decide whether `https://partner.jnremployee.com` should show a partner dashboard/sign-in screen or intentionally redirect to marketing. If intentional, change “Affiliate sign in” to the explicit Whop OAuth start URL or clearer copy.
3. Align live marketing pricing to the account app source of truth: `Free / Solo / Pro / Agency`.
4. Run an authenticated checkout smoke test with a test Clerk user: sign up, hit `/upgrade`, start Stripe checkout, cancel/return, and confirm the account page handles the return state cleanly.

## Commands Used

- `curl -L -s -o /private/tmp/lc_account_home.html -w "%{http_code} %{url_effective}\n" https://account.jnremployee.com`
- `curl -L -s -o /private/tmp/lc_account_signup.html -w "%{http_code} %{url_effective}\n" https://account.jnremployee.com/sign-up`
- `curl -L -s -o /private/tmp/lc_account_upgrade.html -w "%{http_code} %{url_effective}\n" https://account.jnremployee.com/upgrade`
- `curl -L -s -o /private/tmp/lc_download.html -w "%{http_code} %{url_effective}\n" https://liquidclips.app/download`
- `curl -I -L https://github.com/Powstit/Jnr-employee/releases/latest`
- `curl -L -s -o /private/tmp/lc_affiliates.html -w "%{http_code} %{url_effective}\n" https://liquidclips.app/affiliates`
- `curl -I -L https://partner.jnremployee.com`
- `curl -I -L https://partner.jnremployee.com/auth/whop/start`
- `curl -I -L https://app.jnremployee.com`
