#!/usr/bin/env bash
# Chains segs 2-5 starting from seg1's last frame (fa5127e4-9d20-4fb1-9b49-3a1473bcf6be).
# All 2D scenes use the SAME aesthetic (graphic-poster halftone, magenta+cyan duotone).
# No humans in 2D scenes — Kade interacts with objects/light only. No "slash" verbs.
set -euo pipefail

WIP="/Users/dipdip/Desktop/jnr/assets-wip/intro-30s"
cd "$WIP"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a chain.log; }

START_ID="fa5127e4-9d20-4fb1-9b49-3a1473bcf6be"  # seg1 end frame

STYLE_LOCK="STYLE LOCK: photoreal 3D Kade — 16-year-old boy with messy chestnut-brown hair, charcoal hoodie under slate-blue technical vest with thin glowing fuchsia trim. ALL 2D scenes use ONE consistent aesthetic: graphic-poster halftone, painterly, magenta-and-cyan duotone, heavy black ink outlines, Ben-Day dots. NEVER realism in 2D scenes. NO PEOPLE in 2D scenes — only objects, instruments, environments, lights."

COIN_RULE="At the moment of the sweep, a small glowing fuchsia coin (geometric embossed pattern) spawns from the object and IMMEDIATELY streaks toward Kade's hand mid-stride — incidental 0.5s rhythmic beat. Kade keeps moving forward, coin absorbed into his palm with a brief flash."

render_seg() {
  local n="$1" prompt="$2"
  log "--- seg ${n}: render 6s 720p fast ---"
  local url
  url=$(higgsfield generate create seedance_2_0 \
    --prompt "$prompt" \
    --aspect_ratio 16:9 \
    --duration 6 \
    --resolution 720p \
    --mode fast \
    --genre epic \
    --medias "[{\"role\":\"start_image\",\"data\":{\"id\":\"$START_ID\",\"type\":\"media_input\"}}]" \
    --wait --wait-timeout 10m 2>&1 | tail -1)
  log "seg ${n} url: $url"
  curl -fsS -o "seg${n}.mp4" "$url"
  log "seg ${n} downloaded ($(stat -f%z seg${n}.mp4) bytes)"
  ffmpeg -y -sseof -0.1 -i "seg${n}.mp4" -frames:v 1 -update 1 "seg${n}-end.png" 2>/dev/null
  START_ID=$(higgsfield upload create "seg${n}-end.png" 2>&1 | tail -1)
  log "seg ${n} end frame upload id: $START_ID"
}

# ── Seg 2: Music stage → Fashion ──────────────────────────────────────
render_seg 2 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D STAGE ENVIRONMENT in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink outlines, Ben-Day dots, with floating microphone stand, suspended electric guitar, drum kit silhouette. NO PEOPLE. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — runs forward through the stage, his 3D form sharp against the painterly 2D environment. 2-3s: He sweeps his right hand in a sharp diagonal arc THROUGH the floating microphone stand, carving a line of glowing fuchsia light through the object. 3-4s: ${COIN_RULE}. 4-5s: The 2D stage CRACKS like glass, fissures spreading from the carved arc, revealing through the cracks a STYLIZED 2D FASHION RUNWAY — a long lit runway with a suspended dress on an invisible mannequin form, SAME halftone-poster aesthetic, magenta-and-cyan duotone, heavy black ink, Ben-Day dots. NO PEOPLE in the fashion scene either. 5-6s: The music stage shatters into shards of light; Kade lunges forward into the fashion runway. ${STYLE_LOCK} Anamorphic lens flares on each sweep. Cinematic color grade. No text, no logos."

# ── Seg 3: Fashion runway → Gaming arcade ─────────────────────────────
render_seg 3 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D FASHION RUNWAY in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink, Ben-Day dots, with a suspended haute couture dress on an invisible mannequin under runway lights. NO PEOPLE. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — sprints down the side of the runway, his 3D form sharp against the 2D environment. 2-3s: He sweeps his right hand in a sharp diagonal arc THROUGH the suspended dress, carving a line of glowing fuchsia light through the garment. 3-4s: ${COIN_RULE}. 4-5s: The 2D runway CRACKS, revealing through the cracks a STYLIZED 2D ARCADE INTERIOR — an empty arcade cabinet with a glowing screen showing an abstract geometric pattern, neon signs above, SAME halftone-poster aesthetic, magenta-and-cyan duotone, heavy black ink, Ben-Day dots. NO PEOPLE. 5-6s: The runway shatters into shards; Kade lunges forward into the arcade. ${STYLE_LOCK} Anamorphic lens flares. Cinematic color grade."

# ── Seg 4: Gaming arcade → Comedy stage ───────────────────────────────
render_seg 4 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D ARCADE INTERIOR in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink, Ben-Day dots, with an arcade cabinet, glowing screen showing abstract geometric shapes, neon signs. NO PEOPLE. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — runs through the arcade, neon glow on his face, 3D form sharp against the 2D environment. 2-3s: He sweeps his right hand in a sharp diagonal arc THROUGH the arcade cabinet's glowing screen, carving a line of glowing fuchsia light through the abstract pattern on screen. 3-4s: ${COIN_RULE}. 4-5s: The 2D arcade CRACKS, revealing through the cracks a STYLIZED 2D COMEDY STAGE — a single bright spotlight on an empty microphone stand on a wooden stage, brick wall backdrop, SAME halftone-poster aesthetic, magenta-and-cyan duotone, heavy black ink, Ben-Day dots. NO PEOPLE. 5-6s: The arcade shatters into shards; Kade lunges forward toward the comedy stage. ${STYLE_LOCK} Anamorphic lens flares. Cinematic color grade."

# ── Seg 5: Comedy stage → OASIS final with orbiting coins ─────────────
render_seg 5 "Cinematic 6-second shot continuing from the start image — a STYLIZED 2D COMEDY STAGE in graphic-poster halftone, magenta-and-cyan duotone, heavy black ink, Ben-Day dots, with a single bright spotlight on an empty microphone stand, brick wall backdrop. NO PEOPLE. 0-2s: Kade — photoreal 3D, charcoal hoodie + slate vest with fuchsia trim — strides into the spotlight, his 3D form sharp against the 2D stage. 2-3s: He sweeps his right hand in a final sharp diagonal arc THROUGH the floating microphone stand, releasing a burst of fuchsia light. 3-4s: A glowing fuchsia coin streaks past him into his hand — and at the same moment ALL the 2D world dissolves into shards of brilliant light. 4-6s: The shards reassemble around Kade revealing the photoreal 3D OASIS CHAMBER — deep velvet-black void with translucent holographic glass panels suspended at varying depths, hot fuchsia and cyan neon glow, hexagonal grid floor reflecting the light. FIVE GLOWING FUCHSIA COINS slowly orbit around Kade at chest height, suspended in the air like an aura. Kade looks at camera with a faint half-smile, fully empowered. Camera holds wide. ${STYLE_LOCK} Cinematic color grade. No text, no logos."

# ── Stitch with seg 1 ─────────────────────────────────────────────────
log "--- stitching all 5 segments ---"
{ for n in 1 2 3 4 5; do echo "file 'seg${n}.mp4'"; done } > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy intro-master-silent.mp4 2>&1 | tail -3 | tee -a chain.log

log "--- DONE ---"
log "Master file: ${WIP}/intro-master-silent.mp4"
log "Balance:"
higgsfield account status 2>&1 | grep credit | tee -a chain.log
log "Files:"
ls -lh seg*.mp4 intro-master-silent.mp4 | tee -a chain.log
