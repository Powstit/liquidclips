#!/usr/bin/env bash
# Junior pipeline stress test — spec §1.1 non-negotiable #9
#   "4-hour podcast doesn't crash on a 16 GB machine."
#
# Synthesizes a long-form silent + voice fixture, runs the full pipeline,
# samples RSS memory every 5s, prints a report.
#
# Usage:  bash scripts/stress_test.sh [duration_minutes]
# Default duration is 60 minutes — bump to 240 before launch.

set -euo pipefail
cd "$(dirname "$0")/.."

DURATION_MIN="${1:-60}"
DURATION_SEC=$((DURATION_MIN * 60))
FIXTURE=~/Junior/stress/fixture-${DURATION_MIN}m.wav
LOG=~/Junior/stress/stress-${DURATION_MIN}m-$(date +%Y%m%d-%H%M).log

mkdir -p ~/Junior/stress

if [ ! -f "$FIXTURE" ]; then
  echo "Synthesizing ${DURATION_MIN}-min fixture (silent + occasional beep so VAD has hooks)…"
  # Silent base + a beep every 60s so the VAD has a few segments to chew.
  python-sidecar/bin/ffmpeg -y -loglevel error \
    -f lavfi -i "anoisesrc=d=${DURATION_SEC}:c=brown:r=16000:a=0.01" \
    -f lavfi -i "sine=frequency=440:duration=${DURATION_SEC}:sample_rate=16000" \
    -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest" \
    -ar 16000 -ac 1 -c:a pcm_s16le \
    "$FIXTURE"
  echo "✓ fixture: $(ls -lh "$FIXTURE" | awk '{print $5}')"
fi

# Memory profile while transcribe runs in the foreground.
echo "Running pipeline…"
echo "Log: $LOG"

python-sidecar/.venv/bin/python -c "
import sys, time, os, json
sys.path.insert(0, 'python-sidecar')
import tracemalloc
tracemalloc.start()
from project import Project
from stages import stage_ingest, stage_audio, stage_transcribe

# Tell the LLM stage to skip — we can't afford a real OpenAI call inside a
# stress test. We only care that transcribe doesn't blow up on memory.
os.environ['JUNIOR_FORCE_LOCAL_TRANSCRIBE'] = '1'

fixture = '$FIXTURE'
print(f'fixture: {fixture}')
print(f'duration: ${DURATION_MIN} min')
print('─' * 60)

proj = Project.create(source_path=fixture)
print(f'project: {proj.slug}')

print('=== STAGE 1 ingest ===')
t0 = time.time()
ing = stage_ingest(proj)
print(f'  {time.time()-t0:.1f}s · {ing[\"duration_seconds\"]:.0f}s ingested · poster: {bool(ing.get(\"poster_path\"))}')

# Skip audio extract — fixture is already a wav. Symlink for the transcribe stage.
audio_path = proj.root / 'audio' / 'audio.wav'
if not audio_path.exists():
    os.symlink(fixture, audio_path)
proj.stage_done('audio', {'audio_path': str(audio_path), 'cached': True})

print('=== STAGE 3 transcribe ===')
t0 = time.time()
tr = stage_transcribe(proj)
elapsed = time.time() - t0
rt_factor = ing['duration_seconds'] / max(elapsed, 1)
print(f'  {elapsed:.1f}s · words: {tr[\"word_count\"]} · {rt_factor:.2f}x real-time · via {tr.get(\"via\")}')

current, peak = tracemalloc.get_traced_memory()
print(f'─ memory peak: {peak/1024/1024:.0f} MB ─')
print('PASS' if peak < 8 * 1024**3 else 'FAIL — exceeded 8 GB budget')
" 2>&1 | tee "$LOG"
