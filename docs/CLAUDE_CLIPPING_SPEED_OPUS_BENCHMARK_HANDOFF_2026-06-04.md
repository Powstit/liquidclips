# Claude Handoff — Clipping Speed + Opus Benchmark Upgrade

Date: 2026-06-04

## Goal

Daniel is planning a marketing screencast that opens Opus Clip and Liquid Clips side by side with a timer. The product needs to win on **time to first usable clips**, not necessarily time to every polished export.

This upgrade has two parts:

1. **Fast Draft pipeline** — show usable clips faster.
2. **Branded clip scoring** — make Liquid Clips scoring more visible and competitive with Opus-style clip scores.

## Current Pipeline

Main stage order:

```text
ingest -> audio -> transcribe -> llm -> cut -> reframe -> thumbs
```

Defined in:

- `desktop/python-sidecar/sidecar.py` `STAGE_FUNCS`
- `desktop/python-sidecar/stages.py`

Important current optimizations already present:

- `stage_cut` uses stream copy (`-c copy`) and parallelizes cuts.
- `stage_reframe` defaults to vertical-only via `JUNIOR_REFRAME_RATIOS=vertical`.
- AI thumbnails are off by default unless `JUNIOR_THUMBS_AI=1`.
- API transcription path exists for OpenAI/Groq.
- `whisper_backend.py` has MLX support, but the main `stage_transcribe` path still directly instantiates `faster_whisper.WhisperModel`.

## Product Benchmark Strategy

Do not optimize for “all polish finished.” Optimize for:

```text
drop source -> first 3 playable scored clips visible
```

Then continue polishing in background or behind a “Polish all” action.

This gives the marketing timer a fair, commercial comparison: the user wants to see whether the app found good moments.

## Expected Speed Gain

Exact gain depends on source length, hardware, and whether the user has cloud transcription.

Practical estimates:

- **MLX transcription on Apple Silicon:** main transcribe stage can improve roughly **2x-5x** versus CPU faster-whisper on many M-series Macs.
- **Fast Draft reframe flags:** disabling silence removal + voice enhance + animated caption generation should reduce reframe work roughly **20%-45%** for the draft path.
- **Delay thumbnails:** saves a separate post-render stage before first display; often **5-20 seconds** depending on clip count.
- **Top-3-first rendering:** perceived speed can improve **2x-4x**, because the user sees clips after the first batch instead of waiting for all clips.
- **Cloud/Groq transcription for paid tiers:** can make transcription **10x+ real-time** on long sources when API path is available.

Conservative marketing expectation after this upgrade:

```text
Current: waits for full pipeline before results.
After: first usable clips should appear about 2x-3x faster on typical long videos.
Best case: 4x-6x faster perceived result on Apple Silicon/cloud transcription + top-3-first.
```

Do not promise a universal fixed number in UI.

## Part 1 — Fast Draft Pipeline

### New concept

Add a pipeline speed mode:

```text
Fast Draft
  - fastest time to playable clips
  - vertical only
  - basic/static captions or caption files
  - no silence removal
  - no voice enhance
  - thumbnails delayed
  - top 3 clips render first

Full Polish
  - animated captions
  - silence trim
  - voice enhance
  - thumbnails
  - optional extra ratios
```

Default for cold onboarding should be **Fast Draft**.

### Implementation scope

#### 1. Route main transcription through `whisper_backend.transcribe_auto`

File:

- `desktop/python-sidecar/stages.py`
- `desktop/python-sidecar/whisper_backend.py`

Today `stage_transcribe` directly uses:

```py
from faster_whisper import WhisperModel
model = WhisperModel(...)
segments, info = model.transcribe(...)
```

Change local fallback to use:

```py
from whisper_backend import transcribe_auto
segments_list, text_parts, info, engine = transcribe_auto(...)
```

Reason:

- `whisper_backend.py` already attempts MLX on Apple Silicon.
- Main clipping currently may not benefit from MLX.
- This is likely the largest single local speed win.

Acceptance:

- Transcript JSON/SRT still written.
- Progress still emits per segment.
- `via` reports `mlx` or `faster-whisper`.
- Fallback remains safe if MLX import/runtime fails.

#### 2. Add draft render flags

File:

- `desktop/python-sidecar/stages.py`

Support a mode env or project flag:

```text
JUNIOR_PIPELINE_MODE=fast_draft | full_polish
```

For `fast_draft`:

```text
JUNIOR_SILENCE_REMOVE=0
JUNIOR_VOICE_ENHANCE=0
JUNIOR_ANIMATED_CAPTIONS=0
JUNIOR_REFRAME_RATIOS=vertical
```

Do not rely only on external env. Ideally stage helpers read one central mode helper:

```py
def _pipeline_mode() -> str:
    return os.environ.get("JUNIOR_PIPELINE_MODE", "fast_draft")
```

Then inside reframe:

- silence removal default off when fast draft
- voice enhance default off when fast draft
- animated captions default off when fast draft
- ratios vertical only when fast draft

Full polish can preserve today’s quality defaults.

#### 3. Delay thumbnails from the blocking first result

Files:

- `desktop/python-sidecar/sidecar.py`
- `desktop/python-sidecar/stages.py`
- `desktop/src/App.tsx`

Current full path for clips likely runs through `thumbs` before results.

Change launch path:

```text
ingest -> audio -> transcribe -> llm -> cut -> reframe -> show results
```

Then either:

- run `thumbs` in background and update project, or
- expose “Generate thumbnails” / “Polish all” later.

Acceptance:

- ResultsGrid works with no thumbnails by using video preview/poster fallback.
- No UI crash if `clip.thumbnails` empty.

#### 4. Top 3 first

Harder but high impact.

Today `stage_reframe` renders every clip and only then returns.

Proposed fast path:

```text
Sort clips by virality descending.
Render top 3 first.
Persist project with those clips playable.
Show ResultsGrid.
Continue rendering remaining clips in background OR mark remaining cards as "rendering".
```

If full background stage is too large for this sprint, ship a simpler version:

```text
Limit fast draft initial clip count to top 3-5, with "Render more clips" button.
```

This is acceptable for the benchmark because the marketing timer measures first useful output.

Possible env:

```text
JUNIOR_FAST_DRAFT_LIMIT=3
```

Need care:

- Do not destroy LLM-selected clips permanently.
- Store pending clips or preserve all metadata in project JSON.
- ResultsGrid should be honest if only the top batch is rendered.

Recommended minimal version:

- LLM still selects all clips.
- In fast draft, render first `N` sorted by virality.
- Keep unrendered clips in `Project.clips` but with no `vertical_path`.
- Clip cards show “render” / “polish” state for unrendered cards.

## Part 2 — Branded Clip Scoring

Daniel wants Liquid Clips to stand beside Opus Clip and not look weaker. We already have scoring, but it is too quiet.

### Current scoring

Existing:

- `clip.virality` from LLM schema, shown as a small pill on `ClipCard`.
- `clip.theme`.
- `clip.title_variants`.
- YouTube `scored_titles` with `score` + `reason`.
- Reward projects show `BountyFitPill`.
- Thumbnail frame scores exist internally.

### Upgrade direction

Make the card show a clear branded score:

```text
LC SCORE 92
```

or:

```text
Viral Fit 92
```

Recommended label: **LC Score**.

Why:

- Ownable brand.
- Avoids promising actual virality.
- Works for normal clips and imported clips.

### Clip card design

File:

- `desktop/src/components/clips-feed/ClipCard.tsx`

Current score pill is small in header. Replace or enhance with:

```text
top-left overlay on video:
[LC 92]

below video:
Hook 88 · Retention 81 · Share 76
```

Keep it compact. Do not turn card into analytics dashboard.

Visual style:

- fuchsia score badge for 85+
- amber for 65-84
- muted for below 65
- count-up animation can remain
- mono uppercase label
- tooltip explaining “AI estimate, use as direction”

### Sub-scores

Add optional fields to `Clip`:

```ts
score_breakdown?: {
  hook: number;
  retention: number;
  clarity: number;
  shareability: number;
  payoff?: number;
};
score_reason?: string;
```

Python/LLM schema should emit:

```json
{
  "virality": 92,
  "score_breakdown": {
    "hook": 94,
    "retention": 87,
    "clarity": 91,
    "shareability": 83
  },
  "score_reason": "Opens with a specific money claim, resolves quickly, and has a strong comment CTA."
}
```

If schema migration is too large, derive a temporary UI-only breakdown:

```text
hook = virality +/- heuristic
retention = duration/structure heuristic
clarity = title/description length heuristic
shareability = theme + number/claim/question heuristic
```

But preferred is LLM-native because it can explain why.

### Imported clips

Imported finished clips do not have transcript/LLM score at import time.

For v1:

- show `LC Score —` or neutral `Imported`
- add CTA: “Score clip”
- scoring can run from transcript later

Do not fake high scores for imported clips.

## UI Copy

Use:

```text
LC Score
Hook
Retention
Clarity
Share
Why this clip
```

Example card tooltip:

```text
LC Score estimates hook strength, pacing, clarity, and shareability. It is guidance, not a guarantee.
```

Example reason:

```text
Strong first sentence, clear payoff, and a repeatable lesson people can save.
```

## Opus Benchmark Screen-Cast Notes

For the screencast, the winning Liquid Clips moment should be:

1. User drops/pastes source.
2. Progress UI says “Fast Draft”.
3. First 3 scored clips appear quickly.
4. Each card visibly shows `LC Score`.
5. User can immediately stack/split/remix/schedule.

The comparison should not wait for:

- all thumbnails
- all polish
- every ratio
- every clip fully enhanced

Positioning:

```text
Liquid Clips gets you to editable, schedulable clips fast.
Polish can run after you know which clips are worth it.
```

## Files Likely Touched

Backend/sidecar:

- `desktop/python-sidecar/stages.py`
- `desktop/python-sidecar/whisper_backend.py`
- `desktop/python-sidecar/sidecar.py`
- `desktop/python-sidecar/llm.py`
- `desktop/python-sidecar/project.py` if storing pending/unrendered state

Frontend:

- `desktop/src/lib/sidecar.ts`
- `desktop/src/components/clips-feed/ClipCard.tsx`
- `desktop/src/components/ClipPreview.tsx`
- `desktop/src/components/WorkingStage.tsx`
- `desktop/src/App.tsx`
- optional: `desktop/src/components/clips-feed/ClipsBulkToolbar.tsx`

## Acceptance Criteria

Speed:

- Main local transcription can use MLX on Apple Silicon.
- Fast Draft mode exists and is default for new clipping runs.
- Fast Draft skips or disables silence removal, voice enhance, animated captions, thumbnails-before-results, and non-vertical ratios.
- Results can display before thumbnails exist.
- First usable clips appear before Full Polish is complete.

Scoring:

- Clip cards show a prominent branded score, not just a tiny number.
- Score label is Liquid Clips branded (`LC Score` or `Viral Fit`).
- Clip preview shows score breakdown and reason.
- Existing `virality` remains backward-compatible.
- Imported clips do not receive fake scores.

Verification:

- `python3 -m py_compile desktop/python-sidecar/*.py` passes.
- `npx tsc -b --pretty false` in `desktop` passes.
- `npm run build` in `desktop` passes.
- Run at least one local sample clip job and record:
  - source duration
  - machine
  - old time to first results
  - new time to first results
  - new time to full polish if applicable

## Suggested Version Name

`v0.6.8 — fast draft clipping + LC Score`

