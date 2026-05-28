# Liquid Clips — App Store Connect metadata draft (0.4.34)

Draft for first submission, prepared 2026-05-28 during Apple Developer
enrollment processing. Fill in App Store Connect when membership activates.

---

## Primary identification

| Field | Value | Notes |
|---|---|---|
| **App name** | `Liquid Clips` | 30-char limit, well within |
| **Subtitle** | `Clip faster on your Mac` | 23/30 chars; primary candidate (descriptive, action-led, no JNR/Junior carry-over) |
| **Bundle ID** | `app.liquidclips.desktop` | Matches `tauri.conf.json` `identifier` |
| **SKU** | `liquid-clips-mac-001` | Internal — never shown to users |
| **Primary category** | `Productivity` | Per spec |
| **Secondary category** | `Video` | Fits the clipping workflow |
| **Age rating** | `4+` | No objectionable content; user-supplied video is processed locally |
| **Copyright** | `© 2026 Daniel Diyepriye` | Update name format if registered as a company |
| **Primary language** | `English (U.K.)` | Adjust if shipping U.S.-primary |

### Alternate subtitles (in priority order)
1. `Clip faster on your Mac` ← recommended
2. `AI editor on your Mac`
3. `AI clipping workspace`
4. `Browse, clip, and ship`
5. `Capture clips, stay in flow`

> Avoid: anything that mentions "Junior" or "JNR" — pulls the old brand into
> first impression. Avoid: anything about Whop / Content Rewards — that's a
> feature, not a positioning line, and ties our marketing copy to an external
> platform Apple reviewers don't recognise.

---

## URLs

| Field | URL | Status |
|---|---|---|
| Marketing URL | `https://liquidclips.app` | ✅ live |
| Support URL | `https://liquidclips.app/security` *or* dedicated `/support` | ✅ live (security page covers contact + trust) |
| Privacy Policy URL | `https://liquidclips.app/privacy` | ✅ live, rebranded |
| EULA | Use Apple's standard EULA *or* link to `https://liquidclips.app/terms` | ✅ terms live |

---

## Description (≤ 4000 chars)

> **Liquid Clips turns long-form recordings into ready-to-post short clips —
> right on your Mac.**
>
> Drop in a podcast, interview, livestream, or any long video. Liquid Clips
> transcribes it locally, picks the strongest moments, cuts them, reframes
> them vertically for shorts, generates thumbnails, and writes captions and
> metadata for every clip. Every file stays on your machine.
>
> **What you get**
> • Local transcription — your source video never leaves your Mac
> • AI moment-picking — bring your own OpenAI key (Free/Solo) or use hosted
>   AI (Growth/Autopilot, in beta)
> • Vertical reframe with face-aware crop, captions burned in
> • Multi-ratio export (9:16, 1:1, 4:5)
> • Thumbnails generated from the sharpest, face-aware frames
> • Titles, descriptions, hashtags, hooks — auto-drafted, editable
> • Plan a drip across days or weeks — Liquid Clips reminds you to post
> • Earn tab: browse Content Rewards from Whop, claim a brief, clip toward it
>
> **Built for solo creators**
> One person, one Mac, a long recording, and the AI editor that turns it into
> two weeks of shorts. No upload queues, no waiting in line, no watermark.
>
> **Privacy you can verify**
> Local processing by default. Your videos, your transcript, your decisions
> never leave your computer unless you choose to publish them. We never see
> the raw footage.
>
> **Plans**
> Free includes 100 clip exports. Solo (paid) removes the cap, adds platform
> publishing, drip scheduling, and unlimited project memory. Founder is a
> one-time payment that unlocks Autopilot-level features for life.
>
> Liquid Clips runs on macOS 11 (Big Sur) and later, on Intel and Apple
> Silicon Macs.

(Character count target: ~1900 chars — leaves room for tweaks.)

---

## Promotional text (≤ 170 chars, can change without re-submission)

> Local AI editor for your Mac. Drop a long video, get short clips, captions,
> thumbnails — all on your machine. New: clip toward live Content Rewards.

---

## Keywords (≤ 100 chars, comma-separated, no spaces after commas)

```
video,clip,short,reels,tiktok,youtube,podcast,transcribe,whisper,editor,creator,ai,shorts,whop
```

(95 chars — leaves room for one more.)

---

## Promotional images / screenshots

Required: 3-10 screenshots for macOS at one of:
- 2880 × 1800 (16:10, retina)
- 2560 × 1600 (16:10, retina)
- 1440 × 900 (16:10, non-retina)

Suggested screenshot set (5):
1. **Drop zone** — empty workspace + dropzone, wordmark visible.
2. **Working stage** — pipeline progress with transcribed audio + clip
   picker. Captures "the AI does the work" moment.
3. **Results grid** — generated clips with titles + thumbnails. The "look,
   ready to post" payoff frame.
4. **Earn tab** — Content Rewards bounty list, conveys earnings angle.
5. **Settings → privacy/local-first** — "your files stay on your machine"
   panel; underscores the privacy story for the reviewer.

---

## App Review information (private to reviewers)

| Field | Value |
|---|---|
| **First name** | Daniel |
| **Last name** | Diyepriye |
| **Email** | `danieldiyepriye@gmail.com` |
| **Phone** | (your number) |
| **Sign-in required** | Yes — provide demo account |
| **Demo account user** | (create a free-tier account on account.jnremployee.com, supply credentials) |
| **Demo account password** | (matching above) |
| **Notes for reviewer** | See block below |

### Reviewer notes (paste into the App Store Connect "Notes" field)

> Liquid Clips runs entirely on the user's Mac. To exercise the full pipeline
> you will need:
>
> 1. An OpenAI API key (used locally — the app reads it from the macOS
>    keychain or `OPENAI_API_KEY` env). We can provide a temporary review key
>    on request to the email above.
> 2. A sample video. Any short MP4 will work; we've supplied one at
>    https://liquidclips.app/review-sample.mp4 (~50 MB, 8 min).
>
> No Liquid Clips servers process the user's source video. The only network
> calls during normal use are to:
> - api.jnremployee.com (our backend — license verification + usage counters)
> - api.openai.com (only when the user has provided their own OpenAI key)
> - the user's chosen social platforms via official OAuth (YouTube, TikTok,
>   Instagram, X) when they explicitly publish a clip
>
> The Earn tab embeds links to Whop's public Content Rewards listing. Users
> follow those links externally; no in-app purchase of Whop content occurs.
>
> Sign-in uses a license JWT minted by our backend after the user authenticates
> via Clerk on account.jnremployee.com (this domain is intentional and stays
> in place — Clerk OAuth callbacks are registered there).

---

## Pricing & availability

| Field | Value |
|---|---|
| **Price tier** | Free (in-app purchase / external subscription) |
| **In-app purchases** | None on the Mac App Store — subscriptions billed via Whop and Clerk/Stripe outside the App Store |
| **Availability** | Worldwide (English-only at launch) |

> **App Store Guideline 3.1.1 caveat:** If submitting via Mac App Store, the
> subscription/paid plans must use Apple in-app purchase for the Mac App Store
> distribution. The current pricing flow (Clerk/Stripe + Whop) targets direct
> download from liquidclips.app, NOT the Mac App Store.
>
> **Recommended for 0.4.34: ship as a notarized direct download** (Developer
> ID signed + notarytool), distributed via the website. Skip Mac App Store
> submission until the pricing/IAP question is resolved.

---

## Notarization-only distribution (recommended first ship)

For 0.4.34, ship via **direct download with notarization** rather than the
Mac App Store. This avoids the App Store IAP requirement entirely and matches
the existing distribution pipeline (`ship.sh`).

What's needed in App Store Connect: **nothing**. Notarization happens via
`xcrun notarytool` against the standalone Apple ID. The App Store Connect
listing only matters when/if you submit to the Mac App Store later.

If you DO want a Mac App Store presence in addition to the direct download,
that's a 0.5.x feature — see the IAP caveat above.

---

## Open items requiring user action before submission

1. **Apple Developer Program membership active** — currently in 48-hour
   processing window.
2. **Developer ID Application certificate** issued and installed in keychain.
3. **`notarytool` keychain profile** stored (`xcrun notarytool
   store-credentials JUNIOR_NOTARIZE …`).
4. **`APPLE_SIGNING_IDENTITY` env var** in `~/.claude-credentials/junior-internal.env`.
5. **Screenshots** captured per the suggested set above (will need to be
   produced once the app is running with real content).
6. **Demo account** created with realistic state for the reviewer.
7. **Review sample video** uploaded to liquidclips.app/review-sample.mp4 (or
   alternative URL).
8. **OG card image** — `https://liquidclips.app/og-product.png` is referenced
   in marketing meta tags but the file does not exist yet (404). Generate or
   the social share preview will be blank.

---

## Browse Rewards reviewer notes (INCLUDE in 0.4.34 submission)

Add this to the App Review "Notes for the reviewer" block:

> **In-app browser side panel ("Browse Rewards" button in the Earn tab).**
> When the user clicks Browse Rewards, a 480px-wide WKWebView (macOS) /
> WebView2 (Windows) child webview pins to the right edge of the main
> window with a thin React-rendered chrome bar above it (back, forward,
> reload, close). The panel is provided as a workflow-continuity convenience
> — users browse Whop's public Content Rewards listings while keeping their
> clipping workspace visible. Default URL: https://whop.com/discover/content-rewards/.
>
> The panel does NOT facilitate purchase of digital goods inside the app.
> Any navigation whose path contains `/checkout`, `/pay`, `/billing`,
> `/upgrade`, `/subscribe`, `/purchase`, or `/cart` is intercepted at the
> Rust `on_navigation` callback, blocked from loading in-panel, and bounced
> to the user's system browser via `shell.open()`. No money changes hands
> inside the embedded webview. Liquid Clips's own paid plans are billed via
> Stripe (Clerk) and Whop, both flows happen OUTSIDE the app on
> account.jnremployee.com / whop.com — not inside the embedded browser.
>
> This is the same pattern Slack / Discord / Notion use for embedded link
> previews and content browsing — workflow continuity for the user, no
> in-app purchases.

## Future-version notes (do NOT include in 0.4.34 submission)

- **Mac App Store distribution** — defer until IAP integration replaces the
  current Whop / Stripe billing for App Store builds.
- **Browse Rewards bounty auto-fill** — when the panel detects a Whop reward
  URL the user clicked, pre-populate the rewardClips.create form with the
  reward ID. Deferred to 0.4.35.
