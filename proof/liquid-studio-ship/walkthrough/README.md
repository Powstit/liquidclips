# Walkthrough certification · Liquid Studio ship

**Status:** Implementation complete · certification pending live packaged-app walkthrough.

**Commit:** `2bd1dd5e`

**Installed .app carrying:**
- Sidecar SHA-256 `d6545a528fbf36cb3b7ccea241068c6016256bbb0bd8227b905dd5ff19b94310`
- Frontend rev with billing wiring (grep hit for `billingRefusalRouter`, `FreePreviewDisclosureCard`, `StudioUnlimitedKeyBanner`)
- Runtime resources · 7/7 resolved

## Artifacts to capture during Daniel's walkthrough

For each numbered path, populate the corresponding file in this directory.

### Path A · Free source ≤60 min

- [ ] `path-a/1-clerk-signin.png` — screenshot post-sign-in
- [ ] `path-a/2-source-video-path.txt` — absolute path to the video Daniel drops
- [ ] `path-a/2-source-sha256.txt` — `shasum -a 256` of that source
- [ ] `path-a/3-transcript.json` — copy of the sidecar's transcript.json
- [ ] `path-a/3-transcript-sha256.txt`
- [ ] `path-a/4-clip-count.txt` — clip count from `project.clips.length` (must be ≤ 10)
- [ ] `path-a/4-project.json` — sidecar Project record after settle
- [ ] `path-a/5-editor-screenshot.png` — clip open in existing editor
- [ ] `path-a/6-export.mp4` — exported clip
- [ ] `path-a/6-export-sha256.txt`
- [ ] `path-a/6-export-ffprobe.json` — ffprobe output (video codec, audio codec, duration)
- [ ] `path-a/6-first-frame.jpg` — decoded first frame
- [ ] `path-a/6-last-frame.jpg` — decoded final frame

### Path B · Free source >60 min

- [ ] `path-b/1-source-sha256.txt`
- [ ] `path-b/2-disclosure-screenshot.png` — Free preview disclosure card visible
- [ ] `path-b/3-ffmpeg-audio-command.txt` — contains `-t 3600`
- [ ] `path-b/4-transcript-last-timestamp.txt` — must be ≤ 3600
- [ ] `path-b/5-export.mp4` + sha + ffprobe

### Path C · Free entitlement used → paywall

- [ ] `path-c/1-refusal-log.txt` — backend 409 free_bundle_used
- [ ] `path-c/2-paywall-screenshot.png` — Studio $99 card visible with plan_dhssNse4FfPlI
- [ ] `path-c/3-plan-id-verification.txt`

### Path D · Studio $99.99

- [ ] `path-d/1-whop-checkout-screenshot.png` — plan_dhssNse4FfPlI in checkout
- [ ] `path-d/2-webhook-log.txt` — payment.succeeded fires
- [ ] `path-d/3-grant-row.json` — plan_allowance_grant DB row
- [ ] `path-d/4-source-sha256.txt` + reservation_id + settle IDs
- [ ] `path-d/5-cost-token-log.txt` — non-zero cost_usd_micros, input_tokens, output_tokens
- [ ] `path-d/6-export.mp4` + sha + ffprobe

### Path E · Studio allowance exhausted

- [ ] `path-e/1-reserve-402.log` — backend 402 allowance_exceeded
- [ ] `path-e/2-upgrade-card-screenshot.png` — Studio Unlimited option visible
- [ ] `path-e/3-existing-work-opens.png` — existing clip still opens

### Path F · Studio Unlimited BYOK

- [ ] `path-f/1-whop-checkout-plan_id.txt` — plan_Yyh9NoYq8v6b6
- [ ] `path-f/2-key-setup-screenshot.png` — OpenAI key card + banner visible
- [ ] `path-f/3-validation-result.txt` — validation success
- [ ] `path-f/4-provider-route-log.txt` — reserve response `provider_route=byok_openai_only`
- [ ] `path-f/5-no-hosted-call-proof.txt` — grep sidecar log for /proxy/llm calls (must be empty during Studio Unlimited run)
- [ ] `path-f/6-export.mp4` + sha + ffprobe
- [ ] `path-f/7-invalid-key-test.txt` — invalid-key attempt proves no hosted fallback

### Path G · Agency user regression

- [ ] `path-g/1-agency-mode-screenshot.png`
- [ ] `path-g/2-campaign-route-screenshot.png`
- [ ] `path-g/3-capability-snapshot.json`
- [ ] `path-g/4-export.mp4` — clipping still works under user's plan_tier

### Restart preserves state

- [ ] `restart/1-before-quit.png`
- [ ] `restart/2-after-relaunch.png`
- [ ] `restart/3-project-json-diff.txt` — must be empty

## Observation script

`observe.sh` in this directory tails the sidecar log and periodically snapshots critical Project state during a walkthrough. Daniel starts it before each path:

```
cd proof/liquid-studio-ship/walkthrough && bash observe.sh <path-id>
```

## Rules during walkthrough (per Daniel · 2026-07-17)

1. Observe only.
2. If something fails: record failing step, read both sides of the contract, apply smallest fix, rerun that exact proof.
3. Do NOT make speculative edits.
4. Do NOT push or deploy without explicit instruction.
