# v2.2.34 PROOF · PENDING · updates when CI completes

This is the pre-CI scaffold. Once CI run [28950299283](https://github.com/Powstit/liquidclips/actions/runs/28950299283) reports `completed:success`, values below get filled with real curl output.

## Sources

- Final commit SHA: `feb0d3f` (v2.2.34 hotfix bundle)
- Final tag: `desktop-2-v2.2.34`
- GitHub release: `https://github.com/Powstit/liquidclips/releases/tag/desktop-2-v2.2.34`
- Download page: `https://liquidclips.app/download` (auto-follows GitHub Latest · 10min revalidate)

## Direct dmg URLs (post-publish)

```
https://github.com/Powstit/liquidclips/releases/download/desktop-2-v2.2.34/Liquid.Clips_2.2.34_aarch64.dmg
https://github.com/Powstit/liquidclips/releases/download/desktop-2-v2.2.34/Liquid.Clips_2.2.34_x86_64.dmg
```

## Curl proofs (filled at CI completion)

| Check | Command | Expected | Actual |
|---|---|---|---|
| aarch64 dmg | `curl -sSI -L .../aarch64.dmg` | HTTP 200 | _pending CI_ |
| x86_64 dmg | `curl -sSI -L .../x86_64.dmg` | HTTP 200 | _pending CI_ |
| Backend healthcheck | `curl .../healthcheck` | 200 · `status:"ok"` | ✅ 200 · verified |
| Auto-updater aarch64 | `curl .../latest.json?target=darwin-aarch64&current_version=0.0.0` | `.version == "2.2.34"` | _pending CI_ |
| Auto-updater x86_64 | `curl .../latest.json?target=darwin-x86_64&current_version=0.0.0` | `.version == "2.2.34"` | _pending CI_ |
| Download page | `curl -L https://liquidclips.app/download` | 200 · links to 2.2.34 | _pending 10min revalidate after publish_ |

## Secret hygiene assertion

- `VITE_CLERK_PUBLISHABLE_KEY` present in GitHub repo secrets · CI assert step verifies shape · never echoed to logs
- `INTERNAL_API_SECRET` used server-to-server for the manifest POST · never echoed
- No JWTs, session tokens, or one-time codes appear anywhere in receipts or CI logs
- Signatures on the wire are the same `.sig` files GitHub publishes publicly · not secret material

## Known beta issues (honest list)

1. **v2.2.33 installs cannot auto-update to v2.2.34** — they crash before the Tauri updater phones home. Users on v2.2.33 must delete `/Applications/Liquid Clips.app` + reinstall from `liquidclips.app/download`.
2. **v2.2.34 onward auto-updates work** — first install that boots to shell will silently receive future versions on next launch.
3. **Community chat rooms** — 9 channels seeded on the backend but frontend chat UI wire status unverified in this window. Support fallback (email + Telegram) is visible on every error state so users have a real contact channel regardless.
4. **Telegram `@liquidclips_support` handle** — hardcoded in `BootErrorBoundary.tsx` and `KadeRepairScreen.tsx`. Daniel must create the actual Telegram channel/bot at that handle. Until then, links resolve to a "user not found" page. **Action item on Daniel.**
5. **SMS/phone Clerk login** — depends on Clerk dashboard config. If Daniel hasn't enabled phone identifier + SMS provider in the Clerk instance, phone entry will error with a friendly "This account can't sign in with an SMS code · try email" message (handled in `ClerkOtpPanel.tsx`). Email login always works as fallback.
6. **Whop webhook lag** — 5-45 second webhook processing delay after payment. MembershipGate polls `/me` for up to 45s after Whop iframe reports success. Users see "Confirming your payment…" panel during this window.

## Rollback plan

If v2.2.34 is worse than v2.2.33 (unlikely — v2.2.33 already crashes on Intel):

1. **Auto-updater**: on Railway, set `UPDATER_STATIC_MANIFEST` env var to the v2.2.33 manifest string. Env var wins over the file. Force restart.
2. **Marketing download page**: manually pin the direct dmg URLs to a specific previous tag by editing `liquidclips-marketing/src/lib/latest-release.ts` to override. Redeploy.
3. **Delete broken release**: `gh release delete desktop-2-v2.2.34 -R Powstit/liquidclips` will make `/releases/latest` fall back to the previous published version. Download page revalidates within 10 min.
4. **Do NOT delete user data.** Every rollback is display-layer only.

## Manual install proof

_Filled after Release Captain performs the walk on this Mac (Apple Silicon). Intel proof requires Jae or Ryan._

- [ ] Deleted old `Liquid Clips.app` from `/Applications`
- [ ] Downloaded fresh dmg from `https://liquidclips.app/download`
- [ ] Installed
- [ ] Launched
- [ ] No crash
- [ ] Clerk email input renders
- [ ] Email OTP delivered
- [ ] Verified code
- [ ] Reached app shell
- [ ] Support/community fallback visible

## Friend proof

_Send Jae or Ryan the message below once CI completes and dmgs are 200 reachable._

```
Download Liquid Clips here: https://liquidclips.app/download

Install it, open it, enter your email or phone, use the code we send,
and tell me whether you reach the app screen.
```
