# Liquid Clips — Competitive Upgrade Opportunities
## Research Report by Kimi (OpenClaw) — 2026-05-31

---

## Where You Stand vs. Competitors

| Feature | OpusClip | Submagic | CapCut | **Liquid Clips (Current)** | **Gap** |
|---|---|---|---|---|---|
| **Auto transcription** | ✅ Whisper | ✅ Whisper | ✅ Whisper | ✅ **faster-whisper** | ✅ Parity |
| **Animated captions** | ✅ Word-by-word highlight, colors, emoji, fonts | ✅ Same + bounce effects | ✅ Basic | ❌ **None** | 🔴 **Major gap** |
| **Auto-silence removal** | ✅ | ✅ | ✅ | ❌ **None** | 🔴 **Major gap** |
| **Auto B-roll** | ✅ AI stock footage | ✅ | ✅ | ❌ **None** | 🟡 **Medium gap** |
| **Beat-sync cuts** | ✅ | ✅ | ✅ | ❌ **None** | 🟡 **Medium gap** |
| **Face tracking** | ✅ Auto-follow face | ✅ | ✅ | ✅ **Static detection** | 🟡 **Minor gap** |
| **Sound effects** | ✅ Whoosh, pop, zap | ✅ | ✅ | ❌ **None** | 🟡 **Medium gap** |
| **Voice enhancement** | ✅ Noise removal | ✅ | ✅ | ❌ **None** | 🟡 **Medium gap** |
| **Background removal** | ✅ AI green screen | ✅ | ✅ | ❌ **None** | 🟡 **Medium gap** |
| **Multi-language** | ✅ Auto-translate | ✅ | ✅ | ❌ **None** | 🟡 **Medium gap** |
| **Social posting** | ✅ | ✅ | ✅ | ✅ **Ayrshare** | ✅ Parity |
| **Thumbnail** | ✅ AI generate | ✅ | ✅ | ✅ **Basic + AI** | ✅ Parity |

**The #1 differentiator you DON'T have:** **Animated captions**. This is what makes OpusClip and Submagic go viral. Everything else is a nice-to-have. This is the must-have.

---

## 🎯 Priority 1: Animated Captions (THE Killer Feature)

**What it is:** Instead of static subtitles, each word appears with a highlight animation as it's spoken. Colors, fonts, emojis, bounce effects, background boxes.

**Why it matters:** This is the #1 viral feature of every clip tool. Users instantly recognize it. It makes content feel "professional" without effort.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort to Integrate | Notes |
|---|---|---|---|---|---|
| **[burn](https://github.com/gwiazdorrr/burn)** | 500+ | Rust | Animated captions with word-by-word highlighting | **Medium** | Rust-based, needs FFI or subprocess call |
| **[subaligner](https://github.com/baxtree/subaligner)** | 1k+ | Python | Subtitle alignment + basic styling | **Low** | Python, easy to integrate into your sidecar |
| **[whisper-timestamped](https://github.com/linto-ai/whisper-timestamped)** | 2k+ | Python | Word-level timestamps from Whisper | **Low** | You already have word timestamps via faster-whisper |
| **[moviepy](https://github.com/Zulko/moviepy)** | 25k+ | Python | General video editing, can overlay styled text | **Medium** | Heavy dependency, but very capable |
| **[ffmpeg-drawtext](https://ffmpeg.org/ffmpeg-filters.html#drawtext-1)** | N/A | C/ffmpeg | FFmpeg native text overlay with animation | **Medium** | No new deps — just ffmpeg flags |
| **[ass/subtitle](https://github.com/mpv-player/mpv)** | N/A | Python | ASS subtitle format (advanced styling) | **Low** | Generate .ass files, ffmpeg burns them in |

**My Recommendation:** Use **ffmpeg + ASS subtitle format** or **burn (Rust)**. Both are zero-dependency or low-dependency. ASS gives you colors, fonts, positioning, and word-by-word Karaoke effects natively. ffmpeg can burn ASS into video with one command.

**Example:** `ffmpeg -i input.mp4 -vf "ass=subtitles.ass" output.mp4`

**ASS Karaoke effect:** `{\k100}word` — highlights word for 100 centiseconds. Perfect for word-by-word.

---

## 🎯 Priority 2: Auto Silence Removal (Dead Air Killer)

**What it is:** Automatically detect and remove silent/quiet sections from audio. Makes clips punchier.

**Why it matters:** Dead air kills retention. Every competitor does this automatically. You currently cut at transcript boundaries, which is good but not optimal.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort | Notes |
|---|---|---|---|---|---|
| **[ffmpeg silencedetect](https://ffmpeg.org/ffmpeg-filters.html#silencedetect)** | N/A | ffmpeg | Native silence detection | **Low** | Already have ffmpeg — just add filter |
| **[jumpcutter](https://github.com/carykh/jumpcutter)** | 8k+ | Python | Auto-remove silence, keep jump cuts | **Low** | Python, easy to integrate |
| **[auto-editor](https://github.com/WyattBlue/auto-editor)** | 6k+ | Python | Auto-edit video by removing silence + motionless sections | **Medium** | More powerful than needed, but works well |
| **[unsilence](https://github.com/bernardcooke53/unsilence)** | 1k+ | Python | Remove silence from audio/video | **Low** | Simple, focused |

**My Recommendation:** Use **ffmpeg silencedetect** filter. Zero new dependencies. One command:

```
ffmpeg -i input.mp3 -af silencedetect=noise=-50dB:d=0.5 -f null -
```

This outputs start/end timestamps of silent sections. You already have the transcript timestamps — just merge the silence data with your clip boundaries and skip silent sections.

---

## 🎯 Priority 3: Auto B-Roll (Contextual Footage Insertion)

**What it is:** When the speaker says "industrial revolution," insert stock footage of factories. Makes clips visually rich without extra filming.

**Why it matters:** Talking head videos are boring. B-roll is what makes documentaries watchable. OpusClip does this via AI search.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort | Notes |
|---|---|---|---|---|---|
| **[stockpile](https://github.com/sasoder/stockpile)** | 500+ | Python | AI-curated B-roll finder from YouTube | **Medium** | Uses Gemini API to search YouTube, scores clips |
| **[B-Roller](https://github.com/eshaan-mehta/B-Roller)** | 200+ | Python | DaVinci Resolve B-roll generator | **High** | Integrates with Resolve, not standalone |
| **[OpenMontage](https://github.com/calesthio/OpenMontage)** | 1k+ | Python | Agentic video production with B-roll | **High** | 12 pipelines, 500+ tools — overkill |

**My Recommendation:** **stockpile** is the closest fit. It:
1. Transcribes your clip (you already do this)
2. Extracts key topics (you already do this with LLM)
3. YouTube searches for relevant footage
4. AI scores each result for B-roll quality
5. Downloads scored clips

**You could integrate this:** After your clip selection step, extract the key topics from each clip's transcript, call a YouTube search API, download 2-3 short clips per topic, and offer them as "B-roll options" in the clip editor. The user drags them into the timeline.

**Alternative (simpler):** Skip B-roll for now. It's a v2 feature. Animated captions + silence removal are higher impact.

---

## 🎯 Priority 4: Beat Detection (Music Sync)

**What it is:** Detect beats in background music, cut clips exactly on the beat drop. Makes edits feel "professional."

**Why it matters:** This is what makes music videos and TikToks feel satisfying. The cut happens on the beat, not randomly.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort | Notes |
|---|---|---|---|---|---|
| **[librosa](https://github.com/librosa/librosa)** | 10k+ | Python | Beat tracking, onset detection, tempo analysis | **Medium** | Heavy (numpy, scipy), but the gold standard |
| **[beat-detection](https://github.com/emjjkk/beat-detection)** | 200+ | Python | Beat/onset detection with EDL export | **Low** | Wrapper around librosa, outputs timestamps |
| **[MusicVideoCutter](https://github.com/6Morpheus6/MusicVideoCutter)** | 100+ | Python | Beat-sync video cuts with Gradio UI | **Medium** | Full pipeline, but you can extract just the beat detection |
| **[BeatSync Engine](https://github.com/Merserk/BeatSync-Engine)** | 500+ | Python | Full AI music video generator | **High** | Overkill — includes Qwen3-VL scene matching |

**My Recommendation:** Use **librosa** directly for beat detection. It's one function:

```python
import librosa
y, sr = librosa.load("audio.mp3")
tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
beat_times = librosa.frames_to_time(beat_frames, sr=sr)
```

Then snap your clip boundaries to the nearest beat time. This is a **medium effort** feature — adds librosa to your Python sidecar (~50MB dependency), but the effect is high-impact.

**Alternative:** Skip for v1. Animated captions are higher priority.

---

## 🎯 Priority 5: Face Tracking (Better Than Static Detection)

**What it is:** Instead of detecting faces in one frame and cropping statically, track the face across frames and pan/zoom the crop to follow the speaker.

**Why it matters:** Your current face detection is static — it finds faces in frame 1 and crops to that position. If the speaker moves, they drift out of frame.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort | Notes |
|---|---|---|---|---|---|
| **[DeepFace](https://github.com/serengil/deepface)** | 12k+ | Python | Face detection + recognition + analysis | **Medium** | Heavy (TensorFlow), but very accurate |
| **[face_recognition](https://github.com/ageitgey/face_recognition)** | 55k+ | Python | Simple face detection + encoding | **Medium** | Uses dlib, needs compilation |
| **[OpenCV face tracking](https://docs.opencv.org/4.x/df/d6c/tutorial_js_face_detection_camera.html)** | N/A | C++/Python | Haar cascade + optical flow tracking | **Low** | You already have OpenCV via the face-detect binary |
| **[Mediapipe](https://github.com/google/mediapipe)** | 30k+ | C++/Python | Google's face mesh + tracking | **Medium** | Google-backed, very accurate, lightweight |

**My Recommendation:** Your current **junior-face-detect** Swift binary is already doing static detection. For tracking, **Mediapipe** is the best choice — it's lightweight, runs on CPU, and gives you face landmarks across frames. You'd use it to generate a "face track" (x,y coordinates over time) and then apply a smooth pan to the crop box.

**This is a v2 feature.** The static detection is fine for v1.

---

## 🎯 Priority 6: Sound Effects (Transition Audio)

**What it is:** Auto-add "whoosh" or "pop" sound effects on clip transitions. Makes cuts feel punchy.

**Why it matters:** Subtle audio cues make edits feel professional. Every TikTok/YouTube Shorts creator uses these.

**Options:** No good open-source library for this. You'd need a library of pre-recorded sound effects (whoosh, pop, zap, swoosh) and apply them at clip boundaries via ffmpeg.

**Effort:** Low — just bundle 5-10 .wav files and ffmpeg mix them in.

**This is a v2 feature.** Nice to have, not essential.

---

## 🎯 Priority 7: Voice Enhancement (Noise Removal)

**What it is:** Auto-remove background noise, hum, echo, and level audio. Makes clips sound like they were recorded in a studio.

**Why it matters:** Bad audio kills videos faster than bad video. If the source has fan noise, keyboard clicks, or room echo, the clip sounds amateur.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort | Notes |
|---|---|---|---|---|---|
| **[ffmpeg afftdn](https://ffmpeg.org/ffmpeg-filters.html#afftdn)** | N/A | ffmpeg | FFT-based noise reduction | **Low** | Native ffmpeg filter, zero deps |
| **[ffmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)** | N/A | ffmpeg | EBU R128 loudness normalization | **Low** | Standardizes audio levels |
| **[rnnoise](https://github.com/xiph/rnnoise)** | 4k+ | C | Neural noise suppression (Xiph/Mozilla) | **Medium** | Needs compilation or Python binding |
| **[noisereduce](https://github.com/timsainb/noisereduce)** | 2k+ | Python | Spectral gating noise reduction | **Low** | Pure Python, pip installable |

**My Recommendation:** Use **ffmpeg afftdn + loudnorm**. Two filters, zero new dependencies:

```bash
ffmpeg -i input.mp3 -af "afftdn=nf=-25, loudnorm=I=-16:TP=-1.5:LRA=11" output.mp3
```

- `afftdn` removes background noise
- `loudnorm` standardizes volume to broadcast standard

**This is a v1.5 feature.** Easy to add, high impact on perceived quality.

---

## 🎯 Priority 8: Background Removal / Replacement

**What it is:** Remove the background from a video (like Zoom virtual background) and replace it with a color, image, or blur. Makes clips look more polished.

**Why it matters:** Messy backgrounds look amateur. A clean background or blur makes the speaker pop.

### Open-Source Options

| Library | Stars | Language | What It Does | Effort | Notes |
|---|---|---|---|---|---|
| **[RMBG-2-Studio](https://github.com/Splendide-Imaginarius/RMBG-2-Studio)** | 200+ | Python | AI background removal | **Medium** | Uses ONNX models, runs on CPU |
| **[rembg](https://github.com/danielgatis/rembg)** | 15k+ | Python | Remove background from images | **High** | For images, not video. Video = frame-by-frame |
| **[Segment Anything (SAM)](https://github.com/facebookresearch/segment-anything)** | 50k+ | Python | Meta's image segmentation | **High** | Very accurate but heavy. Video = frame-by-frame |

**My Recommendation:** Skip for v1. This is **hard** for video (needs frame-by-frame segmentation). The payoff is medium. Focus on captions + silence removal first.

---

## 🎯 Priority 9: Multi-Language Translation

**What it is:** Auto-translate captions into other languages. One video → 10 languages.

**Why it matters:** Massive reach expansion. YouTube Shorts in Spanish/Portuguese get huge views.

**Options:** OpenAI GPT-4o already supports translation. You'd take the transcript text, call GPT-4o with `translate to Spanish`, and regenerate the captions. No new library needed.

**Effort:** Low — just add a language selector to the clip editor and a GPT-4o call.

**This is a v1.5 feature.** Easy add-on once captions work.

---

## 📊 Recommended Roadmap

### Phase 1: v0.5.0 (Next Release — 2-3 weeks)
**Theme: Animated Captions + Polish**

| Feature | Library | Effort | Impact |
|---|---|---|---|
| **Animated captions** (word-by-word highlight) | ffmpeg + ASS subtitles | **Medium** | 🔥 **Highest** |
| **Auto silence removal** | ffmpeg silencedetect | **Low** | 🔥 **High** |
| **Voice enhancement** (noise removal + normalization) | ffmpeg afftdn + loudnorm | **Low** | 🔥 **High** |
| **State race fix** (cancel/abort) | Already in progress | **Low** | 🔥 **Critical** |
| **Notarization** | Apple notary service | **Low** | 🔥 **Critical** |

**These 5 features make you competitive with OpusClip/Submagic at the core clip level.** The animated captions alone close the biggest gap.

---

### Phase 2: v0.6.0 (1-2 months)
**Theme: Smart Cuts + B-Roll**

| Feature | Library | Effort | Impact |
|---|---|---|---|
| **Beat-sync cuts** | librosa | **Medium** | 🟡 **Medium** |
| **Auto B-roll** | stockpile + YouTube API | **High** | 🟡 **Medium** |
| **Face tracking** | Mediapipe | **Medium** | 🟡 **Medium** |
| **Multi-language captions** | GPT-4o translate | **Low** | 🟡 **Medium** |

---

### Phase 3: v0.7.0+ (3+ months)
**Theme: Full Studio**

| Feature | Library | Effort | Impact |
|---|---|---|---|
| **Sound effects** | Pre-recorded .wav library | **Low** | 🟡 **Medium** |
| **Background removal** | SAM or RMBG-2 | **High** | 🟡 **Medium** |
| **AI voiceover** | ElevenLabs or OpenAI TTS | **Low** | 🟡 **Medium** |

---

## 🎯 The Bottom Line

**The one thing that makes you competitive:** **Animated captions (word-by-word highlight).**

Everything else is nice. Animated captions are **essential**. Without them, users will compare your app to CapCut or OpusClip and say "why doesn't it have the cool text?"

**The three features to ship next:**
1. **Animated captions** (ffmpeg + ASS) — closes the biggest gap
2. **Silence removal** (ffmpeg silencedetect) — makes clips punchier
3. **Voice enhancement** (ffmpeg afftdn + loudnorm) — makes audio sound professional

All three use **ffmpeg only** — no new heavy dependencies. Just filter chains you already have the infrastructure for.

**Want me to scope the animated captions implementation?** I can show you the exact ffmpeg + ASS pipeline, or find a more integrated approach.

---

*Report compiled by Kimi (OpenClaw) on 2026-05-31*
