# Junior — Hybrid Transcribe (the moat-doubling play)

**Status:** scope doc. Sign-off required before implementation.
**Owns:** how Junior turns audio into transcripts — what runs where, what moves over the wire, what privacy claim we get to make.
**Why now:** the local-only ceiling on Intel CPU is ~2.6× real-time. Pure cloud (what competitors do) requires uploading full video. The hybrid model dodges both walls and gives us a clean privacy story competitors cannot copy.

---

## 1 · Goals

The bar Junior must clear:

1. A Free-tier user with no internet can transcribe a 60-min podcast and never see a network request. Today's behaviour, preserved.
2. A Channel-tier user with internet finishes the whole pipeline (drop → 15 clips on disk) on a 60-min input in **under 60 seconds wall-clock** on any machine.
3. The video file never leaves the user's machine, ever. Paid or free. This is the line.
4. The audio that does leave (paid tiers only) is in-flight only — never persisted on Junior Backend, never logged with PII, deleted from the transcribe provider on response.
5. The user can switch off cloud transcribe with one toggle and fall back to local. Sovereignty over their data.
6. Cost to us per Channel user per month is ≤ £4 even if they process 30 hours of content (their tier price is £49 — we keep 90%+ margin).
7. Marketing line: **"Your video never moves. Even on the fast plan."** Reelify can claim local; OpusClip can claim cloud; only Junior can claim both, by splitting the layer.

---

## 2 · The split

```
INGEST → AUDIO → TRANSCRIBE → LLM → CUT → REFRAME → THUMBS
                    ↑
                    └─ this is the ONLY stage that has a cloud variant
```

Every other stage stays 100% local — the moat doesn't move. Only transcribe gets a hosted alternative for paid tiers.

### 2.1 Free tier (Try)
- `stage_transcribe` uses faster-whisper tiny int8 locally. Today's behaviour. ~2.6× real-time on Intel CPU.
- Works offline. Works in airplane mode. Works without an account.

### 2.2 Solo (BYOK)
- Same as Free. The "bring your own key" tier is about LLM, not transcribe.
- Local transcribe. No cloud path. Solo users opted into local-only when they chose BYOK.

### 2.3 Channel / Autopilot / Founder
- `stage_transcribe` uses the **hosted transcribe** path by default.
- A settings toggle lets them flip back to local at any moment (privacy hedge, offline tolerance, or just preference).
- Cloud path is opt-out, not opt-in — the speed is the upsell, no point hiding it.

---

## 3 · The audio-only upload (the differentiator)

Every other cloud clipper uploads the full video. We upload **audio only, after local extraction**:

```
[Desktop]                              [Junior Backend transcribe-proxy]
  Stage 2 produces audio.wav   ───▶    receives opus stream
  (mono 16 kHz, ~960 kbps)              ↓ pipes straight through ↓
                                       [GPU provider — Modal / Replicate / Deepgram]
  ◀───  transcript JSON  ◀───────────  returns Whisper output
  writes transcript.json
  Stage 3 done
```

### 3.1 Bandwidth math (60-min input)

- Source video: ~500 MB (1080p mp4)
- Extracted mono 16 kHz wav: ~115 MB
- **Opus-encoded for transit: ~10 MB** (12 kbps voice-optimized)
- Transcript back: ~50 KB JSON

10 MB up on Channel vs ~500 MB up on every competitor. **That alone is a 50× speedup over the wire for users on imperfect connections** — the latency dominator for cloud clipping today.

### 3.2 Why opus and not just the wav

- 10× smaller than mono 16 kHz wav
- Voice-optimized codec — transcribe quality identical (Whisper trained on similar quality)
- ffmpeg can stream-encode while audio extraction runs (no second pass)

### 3.3 What the backend keeps

- **Nothing.** Junior Backend is a pure pipe. It receives the opus chunks over a long-lived HTTP/2 stream, forwards them to the GPU provider, streams the transcript chunks back. In-memory only. Never written to disk. Never logged with the user_id-to-audio association.
- We DO log: `user_id`, `duration_seconds`, `cost_charged`, `started_at`. Standard usage telemetry. Never the audio, never the transcript.

---

## 3.5 · URL-direct mode (the third innovation, added 2026-05-21)

When the source is a **public URL** (YouTube, Twitch VOD, podcast RSS, any URL yt-dlp recognises), nothing on the user's machine is private. The video is already public on the source platform. This unlocks an even faster path on paid tiers:

```
DRAG-DROP FILE (user's own content):
  audio-only stream — see §3 above

URL PASTE (public content):
  desktop posts URL to /transcribe-stream/from-url
  backend asks the GPU worker to do yt-dlp + transcribe in one shot
  desktop separately downloads the file LOCALLY (for stages 5-7 cut + reframe)
  whichever finishes first, doesn't matter — both pipelines converge at stage 4 (LLM)
```

### 3.5.1 Wall-clock impact (60-min YouTube URL)

| Mode | Time to results |
|---|---|
| Free local (today) | ~30 min |
| Channel+ audio-only hybrid (§3) | ~5-10 min |
| **Channel+ URL-direct hybrid** | **~3-5 min — cloud transcribes during local download** |

The cloud transcribe ~always finishes before the local yt-dlp download on consumer broadband. Total wall time is dominated by the local download + the local cut/reframe — both of which we can't speed up further without bundling ffmpeg-static + a faster CPU.

### 3.5.2 Privacy story strengthens, doesn't weaken

The "your video never leaves your machine" claim is **about the user's private files**. A YouTube URL points to public content the user does not own and never had locally. Sending the URL to our cloud worker — which fetches from YouTube the same way the user's machine would — is no privacy event at all. We can frame this on the privacy page:

> **Smart cloud:** Junior knows when the source is already public. For YouTube and similar URLs on paid tiers, your machine doesn't even download a copy of the video to extract audio — our cloud worker fetches it directly. Faster for you, less bandwidth, identical privacy.

Reelify and OpusClip cannot say either of these things — Reelify because they have no cloud, OpusClip because they make every job upload from the user's machine regardless of source.

### 3.5.3 What the desktop still does for URL paste

For Channel+ on URL input:
1. POST `/transcribe-stream/from-url?url=<youtube>&user_id=<sub>` — backend kicks off the cloud yt-dlp + transcribe.
2. Locally: spawn `yt-dlp` as today to download the original file (needed for stages 5-7).
3. As soon as the cloud transcript returns, write to `transcript.json` and start stage 4 (LLM) — even if local download is still running.
4. Stage 5 (cut) waits on the local file. Stages 6-7 run as today.

The user sees the working screen rip through ingest / audio / transcribe / LLM in seconds, then a longer pause on cut while the rest of the local file finishes downloading. The pause is honest — they know they're waiting on bytes — and the bottleneck is no longer Junior, it's their ISP.

---

## 4 · Speculative streaming (the second innovation)

Today, the pipeline stages stack. Stage 2 must finish before Stage 3 starts. Local transcribe doesn't benefit from speculative work because it's bottlenecked by the same CPU as everything else.

With cloud transcribe, **the GPU is sitting idle while stage 2 runs locally**. Wasted parallelism.

```
TODAY (local, stacked):
audio extract: ▓▓▓▓
transcribe:        ▓▓▓▓▓▓▓▓▓▓▓▓
TOTAL:         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

CHANNEL+ (hybrid, overlapped):
audio extract: ▓▓▓▓
opus encode:    ▓▓▓ (parallel to wav, sharing the same ffmpeg input)
upload chunks:    ▓▓▓
GPU transcribe:      ▓▓▓
transcript back:        ▓
TOTAL:          ▓▓▓▓▓▓▓
```

The chunked pipeline means stage 2 and stage 3 overlap in wall time. Net: a 60-min input that takes 26 min on Free finishes in 30-45 seconds on Channel — almost all of which is just the audio extraction itself.

### 4.1 How we chunk

- ffmpeg writes the wav in real-time as it extracts. We tail it.
- A second ffmpeg process reads the tail and encodes opus to stdout in 10-second chunks.
- Each chunk POSTs to `/transcribe-stream/chunk` with a `chunk_index` + `is_last` flag.
- The backend forwards each chunk to the GPU provider with the same chunk metadata.
- The GPU provider returns transcript segments as they're ready. We stream them back as SSE.
- Desktop accumulates segments into `transcript.json`. Done when the last chunk's segments arrive.

### 4.2 What if the user goes offline mid-pipeline

- Half the audio is uploaded, half on disk. We have partial transcript chunks.
- Desktop detects the disconnect, falls back to local transcribe for the remaining chunks, splices the partial cloud transcript with the local-finished tail.
- User sees a one-line message: "Switched to local transcribe — connection dropped at 47%."

---

## 5 · GPU provider choice

Three reasonable options, with costs estimated for a 60-min audio job:

| Provider | Cold-start | Cost / 60 min | Pros | Cons |
|---|---|---|---|---|
| **Modal Labs** | ~2 s with keep-warm | ~£0.06 | Pin the container, fast cold | Per-second billing means warm-pool tuning |
| **Replicate (Whisper)** | ~5-10 s | ~£0.04 | Simplest API | Cold-start on every job |
| **Deepgram Nova-2** | none (real-time) | ~£0.45 | True real-time, best-in-class accuracy | 7.5× more expensive than open-source on GPU |
| **OpenAI Whisper API** | none | ~£0.30 | Easy, no infra | Cost; cap is 25 MB per file (we'd need to chunk anyway) |

**Pick: Modal**, with the open-source `large-v3` Whisper model warm-pooled. Reasoning:
- We're streaming chunks anyway, so cold-start is a one-time cost per job not per chunk
- Open-source model + Modal GPU = ~£0.06 per 60 min. At Channel £49/mo with 50% gross margin for Junior, this lets a user do ~400 hours/mo before we lose money. They won't.
- Modal lets us pin our own warm pool — turn it off when traffic is low, scale up when it's not
- If Modal cold-starts hurt the experience we cache 1-2 warm instances during business hours

### 5.1 Failover

- Modal endpoint times out or returns 5xx → backend fails over to **Replicate Whisper** (next-cheapest)
- Replicate also fails → desktop falls back to local transcribe
- All three fail in a single job → user sees an error AND we get paged. Three independent providers down at once is incident-level.

---

## 6 · Cost model — per Channel user / month

Assumption: a Channel user processes 20 hours of content per month (heavy creator).

- Transcribe: 20 hr × £0.06 = £1.20
- LLM (already in pricing): ~£8
- Backend infra share: ~£0.10
- Postiz storage share: ~£0.40

Channel tier nets: £49 - £24.50 affiliate - £3 Whop - £1.20 transcribe - £8 LLM - £0.50 infra = **£11.80/user/mo**. Up from our spec's £9.10 because cloud transcribe is cheaper than I budgeted there (no GPU was previously priced in). So this is **margin-positive**, not just margin-neutral.

---

## 7 · Tier policy (binding)

Locked-in answers so we don't re-debate at code time:

- **Free / Solo: always local.** No cloud option exposed. Reduces support burden + reinforces the privacy story.
- **Channel / Autopilot / Founder: cloud-by-default with a Settings toggle to switch to local.** Explicit, never silent.
- **First-time onboarding for paid tiers:** one-line opt-in screen on tier upgrade — "Use cloud transcribe for ~50× faster processing? Only audio leaves your machine, never video, never persisted." Default yes.
- **Offline behaviour for paid tiers:** auto-fallback to local with a one-line notification ("Switched to local transcribe — you're offline.")
- **Per-project override:** a small "use local for this one" link on the working screen, for the rare paranoid case.
- **No cloud transcribe path for source files containing the strings `nda`, `confidential`, `private`, etc. in the filename.** Conservative default. Paranoid users can rename. *(Open question — flag in §10.)*

---

## 8 · Data flow + privacy

The audit-defensible version:

```
Audio leaves:    yes (Channel+) or no (Free / Solo)
Video leaves:    never. Any tier. Any provider. Period.
Audio persists:  no — in-memory only on Junior Backend AND on Modal
Transcript persists: no on backend; on desktop (~/Junior/projects/.../transcript.json)
LLM call:        the transcript is sent to OpenAI/Anthropic. Same as today.
```

Privacy page section we can publish:

> **Your video never moves.** On every Junior tier — Free, Solo, Channel, Autopilot, Founder — your source video file stays on your machine. Forever.
>
> **On paid tiers, your audio is processed in our hosted transcribe service.** Audio is streamed in opus-encoded chunks to a GPU running an open-source Whisper model. The chunks are held in memory only. Nothing is written to disk on our servers. Nothing is logged with identifying information. After the transcript is returned, the audio is gone — there's no archive, no backup, no copy.
>
> **You can switch off cloud transcribe with one toggle.** Settings → Transcribe → Local only. Junior falls back to faster-whisper on your machine. Slower, but identical privacy story to Free tier.

That paragraph is the differentiator. Reelify can't write it (they have no cloud). OpusClip can't write it (they upload video). Only Junior can.

---

## 9 · Implementation order (5 sub-sprints)

When code time arrives, build in this sequence. None of this is on the critical path to v1.0 — it's a v1.1 feature that ships after the local pipeline is rock-solid.

1. **Backend `/transcribe-stream` proxy.** FastAPI route + httpx streaming + Modal/Replicate client. ~6 hr. Pure pipe, no DB writes for the audio itself.
2. **Modal deployment** — Whisper large-v3 in a Modal function with warm-pool config + secret for the Modal API token in Railway env. ~3 hr.
3. **Backend `/transcribe-stream/from-url`** — variant that lets the Modal worker yt-dlp + transcribe in one step, returns transcript. Used when source is a public URL. ~2 hr (most work is yt-dlp inside the Modal container).
4. **Desktop streaming client.** Two paths in the sidecar — `stage_transcribe_cloud_audio` (drag-drop) and `stage_transcribe_cloud_url` (URL paste). Falls back to local on any error. ~6 hr.
5. **Settings UI + tier gating + onboarding nudge.** Toggle, copy, privacy page update. ~3 hr.

Total ~20 hr — call it 3 dev days. Pin to Sprint 5.5 (after Postiz wiring, before public launch).

---

## 10 · Open questions to settle before code

- **The keyword-blacklist filename heuristic** in §7 — useful safety rail or just creepy false positives? I lean: ship it OFF by default, expose it in Settings → Privacy as a "Don't cloud-process files with sensitive names" opt-in.
- **Tier-specific Whisper model.** Channel/Autopilot/Founder all use `large-v3`? Or Founder gets a future "exclusive" upgrade path? I lean: same model for everyone paid. Founder differentiation comes from the price, not the bytes.
- **Real-time partial transcripts in the UI** — show transcript text appearing in the working-state screen as chunks come back, like a live caption? Visually dazzling but adds UI complexity. v1 ships without; v1.1 candidate.

---

## 11 · Out of scope (deferred forever or until specific milestones)

- Punctuation / capitalization passes — Whisper's output is already adequate; downstream caption burn handles styling.
- Speaker diarization — the spec already calls "active speaker detection" via face tracking. Audio-side diarization is a v2 ask.
- Live transcription (real-time during recording) — Junior is post-production; live is a different product.
- Custom vocabulary / brand-name pinning — Whisper supports it via prompts; defer to v1.2 when there's user demand.

---

**Sign-off:** Daniel reads §1–§7 and approves. Anything to flip — edit here first. Otherwise this is what hybrid transcribe builds against.
