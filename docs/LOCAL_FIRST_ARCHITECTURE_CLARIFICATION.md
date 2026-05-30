# Architecture Clarification: Local-First Core + Thin Cloud Gateway

**Prepared by:** Kimi (2026-05-31)  
**Context:** Daniel questioning why backend needs Railway when the app is "local-first."

---

## 1. Three Questions, Answered Directly

### Q1: Does "Connect accounts in Settings" allow scheduling inside the app?

**YES.** The connection in Settings just proves "this user owns a TikTok account." Once connected, the **PublishModal** (already built) lets the user:
- **Publish now** → fires immediately
- **Schedule one** → picks date/time → backend queues it → cron fires at that time  
- **Drip** → picks 1/2/3/4-week spread → backend queues N posts → cron fires each

The connection is the *permission*. The scheduling is the *action*. Both work end-to-end with Ayrshare — you pass `scheduleDate` in the same API call as `post now`.

### Q2: "I thought the whole point is being local only — why push backend to Railway?"

**You're right. The heavy work IS 100% local.** Here's exactly what stays on the user's machine vs. what needs a cloud endpoint:

| What happens | Where | Why |
|-------------|-------|-----|
| **Drop video → transcribe → clip → export** | **Local only** | faster-whisper, ffmpeg, OpenAI API call from user's machine. Zero backend involvement. Video never leaves their disk. |
| **LLM clip selection** | **Local only** | OpenAI key in user's keychain. Call goes direct from their machine to OpenAI. |
| **License check (am I Solo/Growth/Autopilot?)** | **Cloud** | Can't be local — user would just edit a JSON file to unlock paid features. |
| **Whop purchase webhook** | **Cloud** | Whop needs a public HTTPS URL to POST to when someone buys. Your laptop isn't a public URL. |
| **Social API proxy (Ayrshare/Postiz)** | **Cloud** | Master API key must stay secret. Can't ship it in the app binary — users extract it in 10 minutes. |
| **Usage quota counting** | **Cloud** | Free tier = 3 videos. Needs a counter that persists across reinstalls. |
| **Inbox notifications** | **Cloud** | Push when affiliate payout lands, bounty accepted, etc. |
| **Scheduled post cron** | **Cloud** | If the user's laptop is closed at 9am when a scheduled post should fire, it won't fire locally. Needs a always-on cron. |

**The backend is a thin gateway (5% of the architecture).** It doesn't process video, audio, or AI. It just handles auth, billing webhooks, and API key secrecy. Everything that matters to the user — privacy, speed, offline capability — happens on their machine.

### Q3: "If we do cloud + local, I have to charge $29.99 for drip — already scoped?"

**YES, already scoped.** The tier matrix is already coded:

```python
# features.py (already in repo)
TIER_MATRIX: dict[str, TierDef] = {
    "free":   {"clips": 3,    "publish": False, "schedule": False, "drip": False,  "monthly": 0},
    "solo":   {"clips": 50,   "publish": True,  "schedule": False, "drip": False,  "monthly": 29},
    "growth": {"clips": 200,  "publish": True,  "schedule": True,  "drip": False,  "monthly": 49},
    "autopilot": {"clips": None, "publish": True, "schedule": True, "drip": True, "monthly": 99},
}
```

- **Solo ($29):** Publish now, 1 platform, 50 clips/mo  
- **Growth ($49):** Publish now + Schedule, multi-platform, 200 clips/mo  
- **Autopilot ($99):** Everything + Drip (auto-spaced posts across weeks), unlimited clips  

The backend just checks `user.tier == "autopilot"` before allowing a drip plan to be created. The money goes to you via Whop. You pay Ayrshare $99/mo for the app's master API access. Margin = your profit.

---

## 2. The Real Choice: What Kind of "Backend"?

You don't need Railway specifically. The backend just needs to be:
1. **Always online** (for webhooks + scheduled posts)
2. **Have a public HTTPS URL**
3. **Run a cron job every minute**

Options:

| Option | Cost | Complexity | Best For |
|--------|------|-----------|----------|
| **Railway** (proposed) | ~$5-20/mo | Low (Docker deploy) | Traditional FastAPI + Postgres + cron worker |
| **Vercel Serverless** | ~$0-20/mo | Medium (split cron to separate service) | If you want serverless functions for API + a separate cron trigger |
| **Cloudflare Workers** | ~$5/mo | Medium | Edge-deployed, lowest latency, but no native cron scheduling |
| **Render / Fly.io** | ~$5-15/mo | Low | Railway alternatives, same Docker pattern |
| **Self-hosted VPS** (DigitalOcean $6 droplet) | $6/mo | High (you manage the box) | Total control, but you're on-call |

**Recommendation:** Railway or Fly.io for the first 1000 users. Move to serverless when you hit scale.

---

## 3. What "Local-First" Actually Means for Users

This is your marketing pitch:

> "Your video never leaves your machine. Transcription, clipping, and export happen locally on your CPU — not in someone else's cloud. The only thing that touches our server is: (1) checking your license, (2) receiving purchase confirmations from Whop, and (3) posting to your social accounts when you click Publish."

That's a strong privacy story. The backend is invisible infrastructure, not a processing dependency.

---

## 4. The Path Forward (No Commitment Needed Today)

You can ship in this order without changing your mind about local-first:

**Phase 1 (this week):** Ship Mac app with local pipeline + Whop bounty submission. No backend needed for core clipping. Publish/Schedule/Drip are **disabled** (`PUBLISHING_ENABLED=false`). Users export clips and upload manually.

**Phase 2 (when Apple cert lands):** Ship signed Mac app, same local-first core. Still no backend dependency for clipping.

**Phase 3 (when you're ready):** Deploy thin backend to Railway. Enable Publish (Solo tier). Still local-first for everything that matters.

**Phase 4 (when Ayrshare is wired):** Enable Schedule (Growth) + Drip (Autopilot). Backend just queues dates. Clipping stays local forever.

---

## 5. Summary

| Concern | Reality |
|---------|---------|
| "Isn't this a cloud app now?" | **No.** 95% of the work is local. The backend is a 5% gateway for auth, billing, and social API secrecy. |
| "Do I have to charge for drip?" | **Already scoped.** Autopilot at $99/mo includes drip. Your margin after Ayrshare cost. |
| "Can I ship without the backend?" | **YES.** Core clipping works fully offline. Publish/Schedule/Drip are additive, not required. |
| "What if I never want a backend?" | **Possible but limiting.** Users bring their own Ayrshare API key, stored locally. No license enforcement (honor system). No webhooks (manual license sync). No scheduling (laptop must stay open). Not recommended for a paid product. |

**Bottom line:** The local-first value prop is intact. The backend is plumbing, not product. Ship the clipping engine now. Add the cloud gateway when you're ready to monetize social publishing.

**Co-Authored-By:** Kimi <noreply@kimi>
