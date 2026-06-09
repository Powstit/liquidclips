"""3D Whop banners v3 — exact chamfered typeface, ship smashes THROUGH the text.

Sixth pass. Daniel picked 3d-03 + 3d-04 (campaign A and B) from the v1
3D set as the strongest compositions. Two fixes only:

  1. Typeface: switch to the EXACT 1978 SPACE INVADERS wordmark
     letterform — octagonal chamfered corners (every external corner
     cut at 45°). Anchored on a tight typeface-zoom reference plus
     the framed arcade poster, so gpt-image-1 has the letter geometry
     in pixel form.
  2. Action: the hero ship SMASHES DIRECTLY THROUGH the hero type
     mid-flight, debris and pixel shards radiating from the collision
     point. Not flying past, not hovering over — colliding.

Everything else stays the same as 3d-03 / 3d-04: starfield backdrop,
fuchsia + white palette, pixel invader formation behind, secondary
type, wordmark, $5 / $10 RPM badges, padlock variation for campaign B.
Only 2 banners regenerated (the picked ones), saved as 3d-v3-*.
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx

API_URL = "https://api.openai.com/v1/images/edits"
API_KEY = os.environ["OPENAI_API_KEY"]
OUT_DIR = Path.home() / "Desktop/jnr/assets-wip/banners/whop-liquid-clips"
OUT_DIR.mkdir(parents=True, exist_ok=True)

INVADER_REF = Path.home() / "Desktop/jnr/assets-wip/brand-logo/liquidclips-spaceinvader-v1.png"
TYPEFACE_REFS = [
    OUT_DIR / "refs/space-invaders-typeface-zoom.png",
    OUT_DIR / "refs/space-invaders-poster-framed.png",
]

SIZE = "1536x1024"
MODEL = "gpt-image-1"
QUALITY = "high"


SHARED_BLOCK = (
    "Cinematic poster, 16:9, AAA-game-key-art quality, deep 3D depth, "
    "photoreal lighting. Backdrop is a DEEP STARFIELD: pure ink "
    "#0B0B10 black with crisp tiny white star points and a thin "
    "fuchsia volumetric nebula ribbon across the middle band. Sole "
    "accent colour is one neon fuchsia #FF1A8C. Type faces are SOLID "
    "WHITE with fuchsia chromatic-offset shadows. NO yellow, NO blue, "
    "NO teal, NO orange — only white, fuchsia, and starfield black. "
    "NO emojis. NO people. NO drop shadows beneath text. Spell every "
    "word EXACTLY as written; do not abbreviate, swap, or invent "
    "letters."
)

INVADER_DNA_BLOCK = (
    "Image 1 (the small pink sprite) is the canonical Liquid Clips "
    "alien: 8-bit pixel-art space invader, pure fuchsia #FF1A8C, "
    "with two antennae, two square eyes, blocky body, small arms. "
    "Every alien in the scene must be a faithful 8-bit PIXEL replica "
    "of this exact shape — blocky stepped pixels, not smooth vector. "
    "Authentic Space Invaders 1978 sprite enlarged."
)

HERO_TYPE_BLOCK = (
    "HERO TYPE — the focal point: \n"
    "Set the words 'LIQUID' on the top line and 'CLIPS' on the bottom "
    "line, stacked, dead-centre of the canvas. Spell EXACTLY: "
    "L-I-Q-U-I-D / C-L-I-P-S. No missing letters. \n"
    "TYPEFACE — MATCH the typeface in images 2 and 3 (the tight "
    "'SPACE INVADERS' zoom and the framed arcade poster) EXACTLY. "
    "Defining trait: OCTAGONAL CHAMFERED CORNERS — every external "
    "corner of every letter is cut at a 45-degree diagonal, so each "
    "letter reads as an OCTAGON rather than a rectangle. This "
    "chamfered geometry is visible on S, C, P, D, A, V, R, E in the "
    "reference. No curves anywhere: bowls in D, P, R, Q are built "
    "from straight diagonal cuts, not arcs. Letters have even slab "
    "stroke weight, very tight kerning so letters nearly touch, and "
    "tall rectangular proportions. NO generic block font. The "
    "octagonal chamfers are MANDATORY on every letter. \n"
    "3D treatment: letters face the camera HEAD-ON, ORTHOGRAPHIC "
    "FRONTAL — no perspective skew, no isometric tilt. Depth comes "
    "from a stack of 6 progressively offset chromatic shadow plates "
    "in solid fuchsia behind the white face, each shifted ~4 pixels "
    "down-and-left, forming a deep extruded stair-step rear wall — "
    "identical mechanic to the layered yellow/teal/violet stack in "
    "the reference poster, just rendered in white front + fuchsia "
    "stack. \n"
    "FRONT FACE: solid white #FFFFFF, no gradient. \n"
    "SAFE ZONE — CRITICAL: 'LIQUID' and 'CLIPS' plus the full 6-plate "
    "extrusion must sit fully inside the canvas with at least 8% "
    "padding on every side. Scale down rather than crop. Both words "
    "100% visible end-to-end."
)

ACTION_BLOCK = (
    "ACTION — the hero ship SMASHES DIRECTLY THROUGH the hero type: \n"
    "MIDGROUND: behind the hero type, rows of small 8-bit fuchsia "
    "pixel space invaders arranged in a formation grid, partly "
    "obscured by the type and the ship, floating in deep starfield. \n"
    "HERO SHIP: a single LARGE angular fuchsia V-shape arrowhead "
    "spaceship (~22% of canvas width) flying STRAIGHT AT THE CAMERA "
    "— nose pointed directly at the viewer, head-on POV target "
    "framing. The ship has just COLLIDED with the hero type and is "
    "punching forward THROUGH it — the ship's nose has burst out the "
    "front face of one of the letters (a counter-space or letter "
    "body — choose a centre letter like Q, U, I or L), and the ship "
    "is mid-emergence from the impact hole. The letter around the "
    "impact point shows a jagged shattered chamfered-edge break with "
    "pixel shards radiating outward. The ship is approaching the "
    "lens, getting closer; long motion-blur trails and engine-glow "
    "plumes recede BEHIND it back into the canvas. Photoreal AAA-"
    "game-key-art rendering, neon fuchsia edge-glow, two glowing "
    "engine nacelles trailing. Do NOT show the ship from the side. "
    "Do NOT show it firing down. Do NOT show it merely flying near "
    "the type. It has BROKEN THROUGH the letters and is bursting "
    "AT YOU. \n"
    "IMPACT DEBRIS: pixel shards, fuchsia sparks, and SMALLER "
    "duplicate pixel invaders (each unmistakably a miniature copy of "
    "the canonical alien, ~30% size) erupting FORWARD from the "
    "collision point — popping toward the camera with motion-blur "
    "trails and depth-of-field bokeh. The duplication reads as the "
    "visual symbol of CLIPPING: one source becomes many. \n"
    "LIGHTING: fuchsia rim-light on every letter edge and on the "
    "ship's leading silhouette; impact point glows hot fuchsia-white; "
    "white letter faces stay clean and bright; deep starfield "
    "corners. Thin fuchsia corner brackets at all four corners."
)

WORDMARK_BLOCK = (
    "Bottom-left of the canvas: a small frosted-glass dark strip "
    "holding the Liquid Clips wordmark in tiny tall narrow solid "
    "white sans-serif uppercase. Inside the strip: a small pink "
    "pixel-art space-invader glyph identical to the alien reference, "
    "then the words spelled EXACTLY 'LIQUID' and 'CLIPS' (separated "
    "by a fuchsia slash glyph). Small, subordinate to the hero type."
)


BANNERS = [
    {
        "name": "3d-v3-03-content-rewards-campaign-a",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'CAMPAIGN A · "
            "OPEN'. \n"
            "REWARD BADGE: top-right corner, a chunky 3D pixel-block "
            "badge using the SAME octagonal-chamfered typeface and "
            "SAME 6-plate fuchsia extrusion as the hero type but "
            "smaller (~18% of canvas width), reading EXACTLY '$5 RPM' "
            "in white with fuchsia stack behind. Beneath the badge in "
            "tiny pixel font: 'PER 1,000 VIEWS'. Badge fully inside "
            "safe zone. \n"
            "SECONDARY TYPE: directly under the 'CLIPS' line, clean "
            "white modern sans line: 'Clip Liquid Clips. Post "
            "anywhere. Get paid.' Centred, fully inside safe zone."
        ),
    },
    {
        "name": "3d-v3-04-content-rewards-campaign-b",
        "extra": (
            "Variation for the PARTNER-GATED tier — heavier vignette "
            "around the canvas edges. Each pixel invader (background "
            "formation, foreground duplicates) carries a small solid "
            "fuchsia PADLOCK pixel emblem inset on its body. \n"
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'CAMPAIGN B · "
            "PARTNER GATED'. \n"
            "REWARD BADGE: top-right corner, a chunky 3D pixel-block "
            "badge using the SAME octagonal-chamfered typeface and "
            "SAME 6-plate fuchsia extrusion as the hero type but "
            "smaller (~18% of canvas width), reading EXACTLY '$10 "
            "RPM' in white with fuchsia stack behind. Beneath the "
            "badge in tiny pixel font: 'PER 1,000 VIEWS'. Badge fully "
            "inside safe zone. \n"
            "SECONDARY TYPE: directly under the 'CLIPS' line, clean "
            "white modern sans line: 'Dedicated channel only. "
            "Partner-gated.' Centred, fully inside safe zone."
        ),
    },
]


def _resize_to_whop_1920x1080(src: Path) -> Path | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print(f"  ffmpeg not on PATH — skipping resize ({src.name} stays 1536x1024)")
        return None
    dst = src.with_name(src.stem + "-1920x1080.png")
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-i", str(src),
        "-vf", "crop=1536:864:0:80,scale=1920:1080:flags=lanczos",
        str(dst),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"  resized → {dst.name}")
        return dst
    except subprocess.CalledProcessError as e:
        print(f"  ffmpeg failed: {e.stderr.decode()[:300]}")
        return None


def generate(banner: dict) -> Path:
    prompt = "\n\n".join([
        SHARED_BLOCK,
        INVADER_DNA_BLOCK,
        HERO_TYPE_BLOCK,
        ACTION_BLOCK,
        WORDMARK_BLOCK,
        banner["extra"],
    ])
    print(f"[{banner['name']}] requesting (invader + typeface-zoom + framed-poster)…")
    t0 = time.time()
    refs = [INVADER_REF, *TYPEFACE_REFS]
    handles = [p.open("rb") for p in refs]
    try:
        files = [
            ("image[]", (p.name, h, "image/png"))
            for p, h in zip(refs, handles)
        ]
        data = {
            "model": MODEL,
            "prompt": prompt,
            "size": SIZE,
            "quality": QUALITY,
            "n": "1",
        }
        with httpx.Client(timeout=240.0) as client:
            r = client.post(
                API_URL,
                headers={"Authorization": f"Bearer {API_KEY}"},
                files=files,
                data=data,
            )
    finally:
        for h in handles:
            h.close()
    if r.status_code >= 400:
        print(f"[{banner['name']}] ERROR {r.status_code}: {r.text[:400]}")
        sys.exit(1)
    body = r.json()
    b64 = body["data"][0]["b64_json"]
    out = OUT_DIR / f"{banner['name']}.png"
    out.write_bytes(base64.b64decode(b64))
    print(f"[{banner['name']}] saved {out.name} ({out.stat().st_size//1024} KB, {time.time()-t0:.1f}s)")
    _resize_to_whop_1920x1080(out)
    return out


if __name__ == "__main__":
    for p in [INVADER_REF, *TYPEFACE_REFS]:
        if not p.exists():
            print(f"ERROR: reference not found at {p}")
            sys.exit(1)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for b in BANNERS:
        if only and only not in b["name"]:
            continue
        generate(b)
        time.sleep(2)
    print(f"\nAll saved to {OUT_DIR}")
