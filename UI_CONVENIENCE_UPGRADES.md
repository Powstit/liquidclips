# Liquid Clips — UI & Convenience Upgrades
## Quick Wins by Kimi (OpenClaw) — 2026-05-31

---

## 🔥 Quick Wins (1-2 Days Each)

### 1. **Drag-to-Resize Clip Duration** (like TikTok trim)
**What:** In the clip editor, let the user drag the edges of a clip segment to trim it shorter or longer, instead of just accepting the AI-selected boundaries.
**Why:** Users always want to tweak the exact cut points. Right now they have to regenerate the whole clip if the AI's boundary is slightly off.
**Effort:** Medium — add drag handles on the timeline, update the cut boundaries in `project.json`.

### 2. **Undo/Redo Stack**
**What:** Full undo/redo for: clip generation, edits, deletions, reordering, thumbnail changes.
**Why:** Users accidentally delete clips or change thumbnails and panic. Undo is the #1 requested feature in every creative app.
**Effort:** Medium — keep a `history[]` array of `project.json` snapshots in React state.
**Existing code:** The `project.json` is already a serializable state — perfect for undo snapshots.

### 3. **Keyboard Shortcuts**
**What:** Space = play/pause, J = previous clip, K = play, L = next clip, C = copy clip, V = paste, Delete = remove, Cmd+Z = undo, Cmd+Shift+Z = redo, Cmd+S = save, Cmd+Enter = publish.
**Why:** Power users (and you) will never use the app without shortcuts. Every editor has them.
**Effort:** Low — add `useKeyboardShortcuts` hook, map to existing state functions.

### 4. **Preview Before Export**
**What:** A "Preview" button that plays the full assembled clip with captions, b-roll, and music before exporting. Don't make the user export to see the final result.
**Why:** Exporting is slow (video encode). Users want to preview in 2 seconds, not export for 30 seconds and then find a mistake.
**Effort:** Medium — stitch the clips into a temp preview using ffmpeg `concat` + overlay captions.

### 5. **Batch Export / Queue**
**What:** Select multiple clips, click "Export All", and the app processes them in a queue with a progress bar. Don't force one-by-one.
**Why:** A single transcript might generate 5-10 clips. Exporting each individually is tedious.
**Effort:** Medium — add a queue array, process sequentially with progress tracking.

### 6. **Template Presets for Captions**
**What:** Pre-built caption styles: "TikTok Bold" (yellow text, black outline), "YouTube Clean" (white text, subtle shadow), "Neon Glow" (purple glow), "Minimalist" (small, top-left). User picks one, applies to all clips.
**Why:** Configuring caption colors/fonts for every clip is annoying. Most users want "make it look like TikTok" in one click.
**Effort:** Low — JSON config presets, apply to ASS subtitle generation.

### 7. **Dark/Light Mode Toggle**
**What:** The app is dark-only right now. Add a light mode toggle for daytime editing.
**Why:** Some users prefer light mode. Also makes the app look more "professional" and polished.
**Effort:** Low — CSS variables + `data-theme` attribute. Tailwind has built-in dark mode support.

### 8. **Sidebar Project Navigation**
**What:** Instead of closing the app to switch projects, show a sidebar with recent projects. Click to switch without losing state.
**Why:** Users work on multiple videos in a session. Right now they have to close and reopen the app to switch.
**Effort:** Medium — scan `~/LiquidClips/projects/` for `project.json` files, show list, load on click.

---

## 🎯 Medium Effort (1 Week)

### 9. **Clip Timeline / Storyboard View**
**What:** A horizontal timeline showing all clips in order, with their duration and thumbnails. Drag clips to reorder. Zoom in/out for precision trimming.
**Why:** The current grid view is good for browsing, but terrible for understanding the flow of the final video. A timeline is the standard in every video editor.
**Effort:** Medium — React component with drag-and-drop, sync to `project.json` order.
**Existing:** You already have `clip_order` in `project.json`.

### 10. **Live Preview with Scrubbing**
**What:** In the clip preview, let the user drag a scrubber bar to jump to any timestamp in the video. Show a frame thumbnail at the scrubber position.
**Why:** The current preview is play/pause only. Users want to scrub to a specific frame to check the face crop or caption timing.
**Effort:** Medium — use ffmpeg to extract keyframe thumbnails, add `<input type="range">` scrubber.

### 11. **Auto-Save + Recovery**
**What:** Every 30 seconds, auto-save `project.json`. If the app crashes or the sidecar hangs, show a "Restore session?" dialog on next launch with the last auto-saved state.
**Why:** Users lose work when the app crashes (which happens with the VAD hang). Auto-save is a safety net.
**Effort:** Low — `setInterval` + write `project.json` to a `.autosave` file. Check on app startup.

### 12. **Clip Favorites / Archive**
**What:** Instead of deleting clips you don't want right now, mark them as "archive" or "favorite". Archive clips are hidden from the main grid but can be restored. Favorites are pinned to the top.
**Why:** Users aren't sure if they'll need a clip later. Deleting feels permanent and stressful. Archive is safer.
**Effort:** Low — add `status: "active" | "archived" | "favorite"` to `project.json` clips, filter in the UI.

### 13. **Export Format Presets**
**What:** One-click export: "TikTok 9:16" (H.264, 30fps, 1080x1920), "Instagram Reels 1:1" (H.264, 30fps, 1080x1080), "YouTube Shorts 9:16" (H.264, 60fps, 1080x1920), "Twitter/X" (H.264, 30fps, 720x1280), "High Quality" (ProRes 422, no re-encode).
**Why:** Users don't know ffmpeg parameters. They want "make it for TikTok" in one click.
**Effort:** Low — JSON presets mapping to ffmpeg flags. You already have ratio selection, just add format presets.

### 14. **Recent Files / Quick Open**
**What:** On the "empty" screen, show the last 5 projects with thumbnails and one-click open. Don't make the user browse the file system.
**Why:** The empty screen right now is just a drop zone. It should be a dashboard.
**Effort:** Low — scan `~/LiquidClips/projects/`, sort by mtime, show cards.

### 15. **Audio Waveform Visualizer**
**What:** In the clip preview, show a waveform of the audio underneath the video. Makes it easy to see where words start/end and where to trim.
**Why:** Audio waveforms are standard in every editor. They make trimming intuitive.
**Effort:** Medium — use ffmpeg `showwavespic` or a React library like `wavesurfer.js` to generate waveform data.

---

## 💡 Pro Features (The "Mind-Blowing" Layer)

### 16. **AI Voiceover Replacement**
**What:** Let the user select a clip, click "Replace voice with AI", and generate an AI voiceover (ElevenLabs, OpenAI) that matches the transcript's sentiment but sounds polished and professional.
**Why:** Bad audio quality is the #1 reason clips fail. AI voiceover fixes it instantly.
**Effort:** High — needs ElevenLabs/OpenAI API integration, audio sync, lip sync (optional).
**Existing:** You already have OpenAI API integration. Add ElevenLabs API key and a TTS call.

### 17. **One-Click "Viral Style"**
**What:** A single button that applies: animated captions + silence removal + beat-sync cuts + zoom transitions + sound effects. "Make this clip go viral" in one click.
**Why:** Users don't want to configure 5 settings. They want "just make it good."
**Effort:** Medium — composite the individual features into one pipeline.

### 18. **Competitor Clip Analysis**
**What:** Paste a URL of a viral TikTok/YouTube Short. The app analyzes it: caption style, cut frequency, music genre, b-roll usage, hook structure. Then offers to "match this style" for your next clip.
**Why:** Users want to replicate what works. This is manual research right now.
**Effort:** High — needs yt-dlp download, frame extraction, LLM analysis, style matching.

### 19. **Hook/CTA Templates**
**What:** Pre-built video intros: "Wait for it..." (3s suspense), "POV:" (point-of-view style), "This changed everything" (dramatic hook), "Before you scroll" (attention grabber). User picks one, AI generates the hook text + timing.
**Why:** The first 3 seconds determine whether someone watches. Most users have no idea how to write a hook.
**Effort:** Medium — LLM prompt templates for hook generation, add intro clip to the pipeline.

### 20. **A/B Test Variants**
**What:** Generate 3 versions of the same clip with different: hooks, captions styles, thumbnail frames, music beds. Then publish all 3 and track which gets the best engagement via the backend.
**Why:** YouTube/TikTok algorithm favors testing multiple variants. Manual creation is too slow.
**Effort:** High — needs backend analytics, multiple clip generation, batch publish.

---

## 📊 Recommended UI Roadmap

### Phase 1: v0.5.0 (Polish + Core UX)

| Feature | Effort | Impact | Why Now |
|---|---|---|---|
| **Undo/Redo** | Medium | 🔥 Critical | Safety net for AI mistakes |
| **Keyboard shortcuts** | Low | 🔥 High | Power user essential |
| **Auto-save** | Low | 🔥 High | Prevent data loss from hangs |
| **Export format presets** | Low | 🔥 High | One-click platform export |
| **Recent files dashboard** | Low | 🔥 Medium | Better empty screen |
| **Dark/light mode** | Low | 🟡 Medium | Professional polish |

### Phase 2: v0.6.0 (Editor Power)

| Feature | Effort | Impact | Why Then |
|---|---|---|---|
| **Drag-to-trim clips** | Medium | 🔥 High | Users always tweak boundaries |
| **Timeline/storyboard view** | Medium | 🔥 High | Standard video editor UX |
| **Audio waveform** | Medium | 🔥 Medium | Visual trimming |
| **Scrubbing preview** | Medium | 🔥 Medium | Frame-level precision |
| **Clip favorites/archive** | Low | 🟡 Medium | Better clip management |
| **Batch export queue** | Medium | 🟡 Medium | Multi-clip efficiency |

### Phase 3: v0.7.0+ (AI Magic)

| Feature | Effort | Impact | Why Later |
|---|---|---|---|
| **One-click viral style** | Medium | 🔥 Highest | "Just make it good" |
| **AI voiceover** | High | 🔥 High | Bad audio fix |
| **Hook/CTA templates** | Medium | 🔥 High | First 3 seconds |
| **Competitor analysis** | High | 🟡 Medium | Research automation |
| **A/B test variants** | High | 🟡 Medium | Algorithm optimization |

---

## 🎯 The Bottom Line

**The 3 UI features that make the app feel "professional":**
1. **Undo/Redo** — every app has it, yours doesn't. This is the #1 "why does this feel janky?" issue.
2. **Keyboard shortcuts** — makes power users love the app.
3. **Auto-save** — prevents the "I lost 30 minutes of work" panic from sidecar hangs.

**The 1 feature that makes the app feel "magical":**
- **One-click "Viral Style"** — hit one button, get: animated captions + silence removal + voice enhancement + zoom transitions. This is the "wow" moment that differentiates you from CapCut (which makes users do it manually).

**My recommendation:** Ship the 3 Phase 1 features + animated captions (from the other report) in v0.5.0. That's 6 features that close every UX gap. The app will feel polished, professional, and competitive.

**Want me to implement any of these?** I can start with the low-effort ones (keyboard shortcuts, auto-save, dark mode) right now while Claude works on the transcription fixes.

---

*Report by Kimi (OpenClaw) — 2026-05-31*
