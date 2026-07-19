#!/usr/bin/env bash
# capture-export.sh · deterministic capture for an exported MP4
#
# Usage:
#   bash capture-export.sh <path-id> <mp4-path>
#
# Produces alongside the MP4 (into ./<path-id>/):
#   export.mp4                  · the MP4 itself
#   export-sha256.txt           · SHA-256 hash
#   export-size.txt             · byte count
#   export-ffprobe.json         · full ffprobe -show_format -show_streams JSON
#   export-video-codec.txt      · video codec name only
#   export-audio-codec.txt      · audio codec name (if any)
#   export-duration-seconds.txt · duration
#   export-first-frame.jpg      · first frame decoded from clip start
#   export-last-frame.jpg       · last frame decoded from clip end
#
# All Phase 3 required proofs for one exported MP4 in one shot.
set -Eeuo pipefail

PATH_ID="${1:?usage: capture-export.sh <path-id> <mp4-path>}"
SRC="${2:?usage: capture-export.sh <path-id> <mp4-path>}"

if [ ! -f "$SRC" ]; then
  echo "not a file: $SRC" >&2
  exit 2
fi

OUT="$(cd "$(dirname "$0")" && pwd)/$PATH_ID"
mkdir -p "$OUT"

FFMPEG="/Applications/Liquid Clips.app/Contents/Resources/_up_/_up_/python-sidecar/bin/ffmpeg"
FFPROBE="/Applications/Liquid Clips.app/Contents/Resources/_up_/_up_/python-sidecar/bin/ffprobe"
[ -x "$FFMPEG" ] || FFMPEG="$(command -v ffmpeg || true)"
[ -x "$FFPROBE" ] || FFPROBE="$(command -v ffprobe || true)"

if [ -z "$FFMPEG" ] || [ -z "$FFPROBE" ]; then
  echo "ffmpeg/ffprobe not found (tried .app bundle + PATH)" >&2
  exit 3
fi

# Copy MP4 into evidence dir with a stable name.
cp "$SRC" "$OUT/export.mp4"

# SHA-256.
shasum -a 256 "$OUT/export.mp4" > "$OUT/export-sha256.txt"
echo "  ✓ sha256"

# Size (bytes).
stat -f%z "$OUT/export.mp4" > "$OUT/export-size.txt"
echo "  ✓ size · $(cat "$OUT/export-size.txt") bytes"

# ffprobe full JSON.
"$FFPROBE" -v error -print_format json -show_format -show_streams \
  "$OUT/export.mp4" > "$OUT/export-ffprobe.json"

# Extract codecs + duration.
python3 - <<PY
import json, pathlib
p = pathlib.Path("$OUT")
data = json.loads((p / "export-ffprobe.json").read_text())
video_codec = None
audio_codec = None
for s in data.get("streams") or []:
    if s.get("codec_type") == "video" and video_codec is None:
        video_codec = s.get("codec_name")
    elif s.get("codec_type") == "audio" and audio_codec is None:
        audio_codec = s.get("codec_name")
duration = (data.get("format") or {}).get("duration")
(p / "export-video-codec.txt").write_text(f"{video_codec or 'none'}\n")
(p / "export-audio-codec.txt").write_text(f"{audio_codec or 'none'}\n")
(p / "export-duration-seconds.txt").write_text(f"{duration or '0'}\n")
print(f"  ✓ video={video_codec} audio={audio_codec} duration={duration}s")
PY

# First-frame + last-frame decode probes.
DURATION="$(cat "$OUT/export-duration-seconds.txt" | tr -d '\n')"
"$FFMPEG" -y -v error -ss 0 -i "$OUT/export.mp4" -frames:v 1 \
  -vf "scale=640:-2" "$OUT/export-first-frame.jpg" 2>&1
echo "  ✓ first frame decoded"

# Seek to duration-0.1 for last frame.
LAST_SEEK="$(python3 -c "print(max(0.0, float('$DURATION') - 0.1))")"
"$FFMPEG" -y -v error -ss "$LAST_SEEK" -i "$OUT/export.mp4" -frames:v 1 \
  -vf "scale=640:-2" "$OUT/export-last-frame.jpg" 2>&1
echo "  ✓ last frame decoded"

# Canonical-path check.
CANONICAL="$HOME/LiquidClips"
case "$SRC" in
  "$CANONICAL"/*|"$CANONICAL"/*/*)
    echo "canonical" > "$OUT/export-path-canonical.txt"
    echo "  ✓ export path lives under $CANONICAL"
    ;;
  *)
    echo "non-canonical: $SRC" > "$OUT/export-path-canonical.txt"
    echo "  ⚠ export path outside $CANONICAL — verify this is intentional"
    ;;
esac

echo ""
echo "=== capture complete: $OUT ==="
ls -la "$OUT/"
