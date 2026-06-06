#!/usr/bin/env bash
# Liquid Clips brand mark generation via gpt-image-1
# Sequential to respect rate limits.

set -u

source ~/.claude-credentials/openai.env

OUT="/Users/dipdip/Desktop/jnr/liquidclips-marketing/public/brand"
ENDPOINT="https://api.openai.com/v1/images/generations"

# Brand palette to enforce in every prompt
PALETTE='Strict brand palette: fuchsia #ff1a8c, cyan #00e5ff, paper black #0b0b10, ink warm-white #f4f1ea. Inspiration: 1978 Space Invaders + Atari 2600 boxart + Ready Player One. 80s arcade-game-company aesthetic, neon, CRT scanlines, pixel Space Invader mascot.'

generate() {
  local name="$1"
  local size="$2"
  local prompt="$3"

  echo "→ generating $name ($size)..."

  local payload
  payload=$(jq -n \
    --arg model "gpt-image-1" \
    --arg prompt "$prompt $PALETTE" \
    --arg size "$size" \
    --arg quality "high" \
    --arg output_format "png" \
    '{model:$model, prompt:$prompt, size:$size, quality:$quality, output_format:$output_format, n:1}')

  local response
  response=$(curl -sS -X POST "$ENDPOINT" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local b64
  b64=$(echo "$response" | jq -r '.data[0].b64_json // empty')

  if [ -z "$b64" ]; then
    local err
    err=$(echo "$response" | jq -r '.error.message // "unknown error"')
    echo "✗ $name failed: $err"
    return 1
  fi

  echo "$b64" | base64 -d > "$OUT/$name"
  local bytes
  bytes=$(stat -f%z "$OUT/$name")
  echo "✓ $name ($bytes bytes)"
}

# 1
generate "logo-primary.png" "1024x1024" \
"Square brand mark for an 80s arcade-game-company called LIQUID/CLIPS. A small fuchsia pixel-art Space Invader (8x8 retro arcade alien, fuchsia body, cyan eye dots) sits on the left, beside a clean monospace wordmark 'LIQUID/CLIPS' (with the forward slash) rendered in crisp warm-white. Both elements sit on a deep neon-black rectangular plate with a thin fuchsia neon border, subtle horizontal CRT scanlines, and a soft fuchsia outer glow halo. Transparent dark background. Highly legible, no extra text, no artifacts, no other characters."

# 2
generate "logo-horizontal.png" "1536x1024" \
"Wide horizontal lockup of the LIQUID/CLIPS arcade brand. Small fuchsia pixel-art Space Invader on the far left, then generous letterspaced monospace wordmark 'LIQUID/CLIPS' in warm-white running across a long rectangular plate. Deep neon-black plate, thin fuchsia neon border, subtle CRT scanlines across the surface, fuchsia outer glow. Wide aspect, plate stretches edge to edge. Crisp, legible, no extra text."

# 3
generate "logo-stacked.png" "1024x1024" \
"Square stacked avatar layout for social profiles. A fuchsia pixel-art Space Invader (8x8 retro arcade alien) centered on top, with the monospace wordmark 'LIQUID/CLIPS' (with forward slash) directly beneath it in warm-white. Mounted on a deep neon-black square plate with a fuchsia rim glow, subtle CRT scanlines, and a soft outer halo. Mark stays inside central 70%. No extra text."

# 4
generate "logo-monogram.png" "1024x1024" \
"Just a single large fuchsia pixel-art Space Invader, 8x8 retro arcade alien silhouette, fuchsia body, cyan eye highlights, centered on a transparent deep neon-black background. Soft cyan glow halo surrounds the mark. No text anywhere. Crisp pixel edges. Mascot only, isolated, signature mark."

# 5
generate "logo-wordmark.png" "1536x1024" \
"Wide text-only logotype: the words 'LIQUID/CLIPS' (with forward slash) in a clean monospace typeface, warm-white color, centered horizontally on a deep neon-black background with a faint horizontal CRT scanline texture. No mascot, no icons, no other text. Pure wordmark, broadcast-clean."

# 6
generate "favicon-source-512.png" "1024x1024" \
"Hyper-crisp high-detail pixel-art Space Invader, 8x8 retro arcade alien sprite scaled large, sharp blocky pixel edges with zero anti-aliasing, fuchsia body with cyan eye highlights, centered on a transparent deep neon-black background with a very subtle outer fuchsia glow. No text. Designed as a high-resolution source for favicon downsampling. Mascot only."

# 7
generate "apple-touch-icon-180.png" "1024x1024" \
"App icon layout: a fuchsia pixel-art Space Invader centered inside a rounded-square dark plate with a subtle fuchsia radial gradient and thin neon border. Mark sits well within central 60% safe area for maskable icon cropping. Deep neon-black base, soft fuchsia inner glow, CRT scanlines very faint. No text. iOS-style touch icon."

# 8
generate "og-default.png" "1536x1024" \
"Open Graph social share card. A retro arcade cabinet centered in frame with the marquee header reading 'LIQUID CLIPS' in glowing neon, and a pixel-art fuchsia Space Invader perched on top of the cabinet. Tagline beneath the cabinet in small clean monospace warm-white text: 'DROP VIDEO. CLIP. POST. EARN.' Deep neon-black background, fuchsia and cyan rim lighting on the cabinet edges, prominent CRT scanlines, glossy retro-arcade-floor reflection beneath. Cinematic 80s arcade vibe."

# 9
generate "og-download.png" "1536x1024" \
"Open Graph card with boot-up terminal aesthetic. Deep neon-black background filled with green and cyan monospace terminal text lines, heavy CRT scanlines, with one line near center highlighted in bright fuchsia reading 'READY TO SUBMIT'. A small fuchsia pixel-art Space Invader sits in the bottom-right corner. Retro arcade computer-boot feeling, no other text."

# 10
generate "og-refer.png" "1536x1024" \
"Open Graph card. Two fuchsia pixel-art Space Invaders side by side, centered, beneath glowing neon text 'TAG TEAM CO-OP' in fuchsia and cyan. Player-2-press-start arcade aesthetic, deep neon-black background, CRT scanlines, retro arcade glow. Subtle small monospace warm-white subline 'PLAYER 2 - PRESS START' under the duo. No other text."

# 11
generate "og-help.png" "1536x1024" \
"Open Graph card. A single fuchsia pixel-art Space Invader centered, holding a tiny rolled-up arcade game manual scroll, with large glowing neon text behind reading 'CLIPPER ACADEMY' in fuchsia with cyan accents. Deep neon-black background, CRT scanlines, retro arcade tutor vibe. Mascot looks helpful. No other text."

# 12
generate "og-legal.png" "1536x1024" \
"Open Graph card with terminal aesthetic. Deep neon-black background, monospace heading 'OPS CONSOLE' in warm-white at top-center, faint columns of green and cyan terminal text below, prominent CRT scanlines across the whole frame. A small fuchsia pixel-art Space Invader sits quietly in the bottom-left corner. Serious, official, ops-room mood. No other text."

echo ""
echo "=== MANIFEST ==="
ls -la "$OUT"
