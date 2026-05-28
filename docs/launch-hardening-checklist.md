# Junior — Launch Hardening Checklist (Codex 2,000-user audit)

Status as of 2026-05-25. P0 = must fix before wide launch.

## P0 status

| # | Item | State |
|---|------|-------|
| P0-1 | Remove stale JWT-paste copy | ✅ DONE (commit 6192034) — all 8 strings → "Sign in to Junior" |
| P0-2 | No-JWT export bypass | ✅ DONE (6192034) — `guardQuota` blocks unactivated users → Sign in before pipeline |
| P0-5 | Schema safety | ✅ DONE (6192034) — idempotent `ADD COLUMN IF NOT EXISTS` for all incremental prod columns |
| P0-3 | Postiz publish/schedule/drip | ✅ DONE (audited 2026-05-28). UI gated via `PUBLISHING_ENABLED=false` in flags.ts; ResultsGrid + UploadTab show "beta / coming soon" cards in prod. Backend `_fire_schedule` has early-return on `not postiz.is_live()`. `postiz.publish_now` exists and raises `NotImplementedError` (defensive — never reached). Marketing + account-app fully beta-labeled. |
| P0-4 | Hosted transcribe/AI | ✅ DONE (audited 2026-05-28). Backend `_HOSTED_AI_LIVE = bool(MODAL_TRANSCRIBE_URL or REPLICATE_API_TOKEN)` → false in prod, forces `hosted_transcribe = hosted_llm = false` for ALL tiers (overrides per-tier claims). Desktop `HOSTED_LLM_ENABLED=false`. Settings + FirstRun + marketing + account-app all copy "Hosted AI (no key needed) is in private beta". |
| P0-6 | Fresh-Mac first-run test | ⏳ needs a clean machine (script below) |

### Verified findings (the "prove it" results)
- **Publishing posts nothing in prod.** `POSTIZ_CLIENT_ID/SECRET` unset → `postiz.is_live()` false → stub returns fake `stub.example.com` URLs. `cron._fire_schedule` is a documented stub and never uploads media. `postiz.publish_now()` is *called* by cron + the publish route but **doesn't exist** in `postiz.py` → `AttributeError`. So "Publish now", "Schedule", and "Drip" are all non-functional.
- **Hosted transcribe/AI is stub in prod.** `MODAL_TRANSCRIBE_URL` unset → `transcribe.py` provider = `stub` (local whisper). Desktop falls back to local. `features.py` advertises Growth/Autopilot `hosted_transcribe`/`hosted_llm` as `built:true` — false. (Local processing works; the "hosted/cloud" claim doesn't.)

## P0-3 execution plan (beta-label + disable)
- **Desktop UI:** PublishModal, DripCalendar — replace publish/schedule/drip actions with a "Beta — coming soon" state; disable the buttons so nothing silently fails. ScheduleQueue → empty "scheduling is in beta" state.
- **Backend:** `features.py` — mark `publish_now`/`schedule_one`/`drip_scheduling` as not-yet-GA (beta); add a defensive `postiz.publish_now()` so any stray cron tick can't `AttributeError`.
- **Marketing (`marketing/index.html`) + account-app (PricingCards/PricingComparison):** beta-label schedule/drip claims.
- Verify desktop feature-gating actually reads these flags before flipping (predictive check).

## P0-4 execution plan (recopy to local)
- `features.py`: `hosted_transcribe`/`hosted_llm` → reflect reality (not built / local).
- Marketing + account-app + desktop tier copy: "hosted/cloud AI" → "fast on-device processing" (which is real). Keep the door open for hosted later.

## P0-6 — Fresh-Mac first-run competitor test (run on a clean machine)
Pre: a Mac you've never run Junior on, a NEW email (not danieldiyepriye@/mrddokubo@/crazycatjackkids@/thedoks2019@ — those force admin/autopilot), no `~/.claude-credentials`, no localhost backend.
1. Install the 0.4.21 DMG (or update from a prior version) — right-click → Open (ad-hoc signed).
2. App opens → click **Sign in** → browser opens `account.jnremployee.com/connect-desktop`.
3. Sign up with the fresh email → deep-link returns `junior://activate` → "Open Junior?" → Open.
4. Confirm signed-in **without restart**; Settings shows version 0.4.21.
5. Drop a video → clips generate (local transcribe + LLM with the free OpenAI-key path or activated tier).
6. Export → **export count decrements** (`remaining_exports` falls from 100).
7. Earn tab loads bounties (sidecar → prod backend).
8. Inbox + Queue load clean (no JWT-paste copy anywhere).
9. (If publish/schedule kept as Beta) confirm they're labeled Beta and don't silently fail.
10. Quit + reopen → still signed in (keychain).
11. Force a stale JWT (`security delete-generic-password -s video.junior.desktop -a JUNIOR_LICENSE_JWT`) → next authed call → 401 self-heal → "session ended" → Sign in re-runs the bridge.

## Hosted LLM (blocks no-key paid tiers)
- [ ] **Hosted LLM replacement path required before selling no-key Growth/Autopilot.** Today the desktop always resolves the OpenAI key locally (env→keychain→dev-file); there is no hosted-LLM proxy, so every tier needs their own key. Shipped 2026-05-26: paid-onboarding key prompt + pre-run key guard (`HOSTED_LLM_ENABLED=false` flag, `openai_key_status` sidecar check) + honest copy. Flip `HOSTED_LLM_ENABLED` true only when a tested hosted-LLM proxy is live.

## P1 — before launch campaign
- [ ] Notarized/public DMG (Apple Developer cert) OR clear "right-click → Open" beta install instructions.
- [ ] Real Whop purchase → real webhook → affiliate attribution end-to-end (non-admin email).
- [ ] Verify Resend (activation/claim emails), PostHog funnels, Admin HQ, Bugs tab with REAL events.
- [ ] Clean git/build noise (gitignore `tsconfig.tsbuildinfo`; confirm `assets-gen/` masters intent).
