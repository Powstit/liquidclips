#!/usr/bin/env bash
# Renders the 30s intro as 5 chained 6s Seedance segments.
# Each segment uses the previous segment's last frame as its start_image
# so the visual chain stays seamless. After all 5 land we stitch with
# ffmpeg concat and report success.
set -euo pipefail

WIP="/Users/dipdip/Desktop/jnr/assets-wip/intro-30s"
cd "$WIP"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a chain.log; }

# Seg 1 start: locked Kade-in-OASIS 16:9 still (already uploaded).
START_ID="7dd9a825-3c9d-43e0-8b11-a4d0b69a53a3"

STYLE_LOCK="STYLE LOCK: photoreal 3D Kade as the CONSTANT — 16-year-old boy, chestnut-brown messy hair, charcoal hoodie, slate-blue technical vest with thin glowing fuchsia trim. All 2D content scenes use ONE consistent aesthetic: graphic-poster halftone, painterly, magenta-and-cyan duotone with deep contrast, Ben-Day dots, Heavy black ink lines defining shapes. NEVER comic-book vs Vogue inconsistency — always the same halftone-poster style."

COIN_RULE="COIN RULE: When Kade slashes, a small glowing fuchsia coin (geometric embossed pattern) spawns and IMMEDIATELY streaks toward his hand mid-stride — incidental 0.5s rhythmic beat, NOT a focal close-up. Kade keeps moving forward, coin gets absorbed into his palm with a brief flash, scene shatters within 1s."

render_seg() {
  local n="$1" duration="$2" prompt="$3"
  log "--- seg ${n}: render ${duration}s ---"
  local url
  url=$(higgsfield generate create seedance_2_0 \
    --prompt "$prompt" \
    --aspect_ratio 16:9 \
    --duration "$duration" \
    --resolution 720p \
    --mode std \
    --genre epic \
    --medias "[{\"role\":\"start_image\",\"data\":{\"id\":\"$START_ID\",\"type\":\"media_input\"}}]" \
    --wait --wait-timeout 10m 2>&1 | tail -1)
  log "seg ${n} url: $url"
  curl -fsS -o "seg${n}.mp4" "$url"
  log "seg ${n} downloaded ($(stat -f%z seg${n}.mp4) bytes)"
  # Extract last frame for next chain link
  ffmpeg -y -sseof -0.1 -i "seg${n}.mp4" -frames:v 1 -update 1 "seg${n}-end.png" 2>/dev/null
  START_ID=$(higgsfield upload create "seg${n}-end.png" 2>&1 | tail -1)
  log "seg ${n} end frame upload id: $START_ID"
}

# ── Seg 1: OASIS → Music portal slash ────────────────────────────────
render_seg 1 6 "Cinematic 6-second shot continuing from the start image of Kade in the OASIS chamber. 0-2s: Kade looks up at a glowing central holographic panel, expression confident, camera slowly pushes in. 2-4s: He raises his right hand toward the panel; the panel responds, blooming with hot magenta-fuchsia neon and expanding into a rectangular portal frame. 4-5s: Kade swings his right arm in a sharp diagonal SLASH across the portal; the portal shatters into glowing shards revealing through the rupture a STYLIZED 2D CONCERT SCENE — guitarist mid-riff under stage lights, painted in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink outlines, Ben-Day dots. 5-6s: Kade lunges forward into the music scene, body crossing the threshold. ${STYLE_LOCK} Anamorphic lens flares on the slash. Cinematic color grade. No text, no logos."

# ── Seg 2: Music slash → Fashion ─────────────────────────────────────
render_seg 2 6 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D CONCERT scene in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink lines, Ben-Day dots. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — runs forward through the 2D crowd silhouettes toward the stage, his 3D form sharp against the painterly 2D world. 2-3s: He leaps and SLASHES diagonally across the guitarist's instrument. 3-4s: ${COIN_RULE}. 4-5s: The 2D concert scene CRACKS like glass, fissures spreading, revealing a STYLIZED 2D FASHION RUNWAY behind — a model mid-stride in haute couture, SAME halftone-poster aesthetic, magenta-and-cyan duotone, heavy black ink, Ben-Day dots — no Vogue realism, identical visual treatment to the music scene. 5-6s: Concert shatters; Kade lunges into the fashion runway. ${STYLE_LOCK} Anamorphic lens flares on slash. Cinematic color grade."

# ── Seg 3: Fashion slash → Gaming ────────────────────────────────────
render_seg 3 6 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D FASHION RUNWAY scene in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink, Ben-Day dots. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — sprints down the side of the runway, his 3D form sharp against the painterly 2D models and audience. 2-3s: He leaps and SLASHES diagonally across a model mid-pose, the fashion pose-frame ripping apart. 3-4s: ${COIN_RULE}. 4-5s: The 2D fashion scene CRACKS like glass, revealing a STYLIZED 2D GAMING ARCADE behind — a pixelated boss sprite under a CRT scanline glow, SAME halftone-poster aesthetic, magenta-and-cyan duotone, heavy black ink — no 8-bit pixelation, the same painterly poster style applied to arcade subject matter. 5-6s: Fashion scene shatters; Kade lunges into the arcade. ${STYLE_LOCK} Cinematic color grade."

# ── Seg 4: Gaming slash → Comedy ─────────────────────────────────────
render_seg 4 6 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D GAMING ARCADE scene in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink, Ben-Day dots. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — runs through the arcade, neon glow on his face, his 3D form sharp against the painterly 2D arcade interior. 2-3s: He leaps and SLASHES diagonally across the boss-sprite figure on a giant screen, the sprite ripping apart. 3-4s: ${COIN_RULE}. 4-5s: The 2D arcade scene CRACKS, revealing a STYLIZED 2D COMEDY STAGE behind — a single spotlight on an empty mic stand, brick wall, SAME halftone-poster aesthetic, magenta-and-cyan duotone, heavy black ink — no realistic shading, identical visual treatment. 5-6s: Arcade shatters; Kade lunges toward the comedy stage. ${STYLE_LOCK} Cinematic color grade."

# ── Seg 5: Comedy slash → OASIS final with coins ─────────────────────
render_seg 5 6 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D COMEDY STAGE in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink, Ben-Day dots, spotlight on a mic stand. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — strides into the spotlight, his 3D form sharp against the 2D stage. 2-3s: He swings a final diagonal SLASH across the mic stand, releasing a burst of light. 3-4s: A glowing fuchsia coin streaks past him into his hand — same incidental beat — and at the same moment ALL the 2D world dissolves into shards of light and reassembles around him. 4-6s: Kade now stands back in the photoreal 3D OASIS CHAMBER (deep velvet-black void, translucent holographic glass panels suspended at varying depths, hot fuchsia + cyan neon, hexagonal grid floor, anamorphic lens flares), but now FIVE GLOWING FUCHSIA COINS slowly orbit around him at chest height, suspended in the air like an aura. Kade looks at camera with a faint half-smile, fully empowered. Camera holds wide. ${STYLE_LOCK} Cinematic color grade. No text, no logos."

# ── Stitch ───────────────────────────────────────────────────────────
log "--- stitching 5 segments ---"
{ for n in 1 2 3 4 5; do echo "file 'seg${n}.mp4'"; done } > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy intro-master-silent.mp4 2>&1 | tail -3 | tee -a chain.log

log "--- DONE ---"
log "Master file: ${WIP}/intro-master-silent.mp4"
log "Balance:"
higgsfield account status 2>&1 | grep credit | tee -a chain.log
log "FILES:"
ls -lh "${WIP}"/*.mp4 | tee -a chain.log
