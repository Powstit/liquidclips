"""Whop app-store hero images for Liquid Clips (juniorlips app listing).

Two 16:9 hero images for the Whop app store listing carousel:
  1. CLIP — the action. Hero word "CLIP" in the chamfered v3 typeface.
  2. EARN — the payoff. Hero word "EARN" in the chamfered v3 typeface.

Reuses the v3 DNA (gen-whop-banners-3d-v3.py): octagonal chamfered slab
typeface from the 1978 Space Invaders poster, white face + 6-plate
fuchsia chromatic extrusion, deep starfield, pixel invader landmark,
spaceship smashing through the type, frosted-glass Liquid Clips
wordmark bottom-left.

Different from the Whop banners — no $5/$10 RPM reward badges, no
campaign-A/B chip in the top-left. Single-word hero, single value-prop
subhead, brand wordmark, that's it. App-store-listing clean.
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
OUT_DIR = Path.home() / "Desktop/jnr/assets-wip/banners/whop-app-store"
OUT_DIR.mkdir(parents=True, exist_ok=True)

INVADER_REF = Path.home() / "Desktop/jnr/assets-wip/brand-logo/liquidclips-spaceinvader-v1.png"
TYPEFACE_REFS = [
    Path.home() / "Desktop/jnr/assets-wip/banners/whop-liquid-clips/refs/space-invaders-typeface-zoom.png",
    Path.home() / "Desktop/jnr/assets-wip/banners/whop-liquid-clips/refs/space-invaders-poster-framed.png",
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

# Per-image: the hero word changes between banners.
def hero_type_block(word: str) -> str:
    return (
        "HERO TYPE — the focal point: \n"
        f"Set the single word '{word}' dead-centre of the canvas, occupying "
        f"roughly 55% of canvas width. Spell EXACTLY: {'-'.join(word)}. \n"
        "TYPEFACE — MATCH the typeface in images 2 and 3 (the tight "
        "'SPACE INVADERS' zoom and the framed arcade poster) EXACTLY. "
        "Defining trait: OCTAGONAL CHAMFERED CORNERS — every external "
        "corner of every letter is cut at a 45-degree diagonal, so each "
        "letter reads as an OCTAGON rather than a rectangle. No curves "
        "anywhere: bowls in P, R, D, B, C are built from straight "
        "diagonal cuts, not arcs. Even slab stroke weight, very tight "
        "kerning so letters nearly touch, tall rectangular proportions. \n"
        "3D treatment: letters face the camera HEAD-ON, ORTHOGRAPHIC "
        "FRONTAL — no perspective skew, no tilt. Depth comes from a "
        "stack of 6 progressively offset chromatic shadow plates in "
        "solid fuchsia behind the white face, each shifted ~4 pixels "
        "down-and-left, forming a deep extruded stair-step rear wall. \n"
        "FRONT FACE: solid white #FFFFFF, no gradient. \n"
        "SAFE ZONE — CRITICAL: the word plus its full 6-plate extrusion "
        "must sit fully inside the canvas with at least 10% padding on "
        "every side. Scale down rather than crop. 100% visible."
    )


# Single hero ship smashing through the hero word.
ACTION_BLOCK = (
    "ACTION — a single fuchsia V-shape arrowhead spaceship has SMASHED "
    "THROUGH the hero word and is flying STRAIGHT AT THE CAMERA. The "
    "ship's nose has burst out the front face of one of the centre "
    "letters; the letter around the impact shows a jagged shattered "
    "chamfered-edge break with pixel shards radiating outward. The "
    "ship is approaching the lens; long motion-blur trails and engine-"
    "glow plumes recede BEHIND it back into the canvas. \n"
    "BACKGROUND: rows of small 8-bit fuchsia pixel space invaders "
    "(faithful to the alien reference) in a formation grid behind "
    "the hero word, partly obscured by it, floating in deep starfield. \n"
    "FOREGROUND: SMALLER duplicate pixel invaders (each unmistakably "
    "a miniature copy of the canonical alien, ~30% size) and pixel "
    "shards / fuchsia sparks bursting FORWARD from the impact point — "
    "popping toward the camera with motion-blur trails and bokeh. The "
    "duplication reads as the visual symbol of CLIPPING: one source "
    "becomes many. \n"
    "LIGHTING: fuchsia rim-light on every letter edge and the ship's "
    "leading silhouette; impact point glows hot fuchsia-white; white "
    "letter faces stay clean and bright; deep starfield corners. Thin "
    "fuchsia corner brackets at all four corners of the canvas."
)


WORDMARK_BLOCK = (
    "Bottom-left of the canvas: a small frosted-glass dark strip "
    "holding the Liquid Clips wordmark in tiny tall narrow solid "
    "white sans-serif uppercase. Inside the strip: a small pink "
    "pixel-art space-invader glyph identical to the alien reference, "
    "then the words spelled EXACTLY 'LIQUID' and 'CLIPS' (separated "
    "by a fuchsia slash glyph). Small, subordinate to the hero word."
)


BANNERS = [
    {
        "name": "app-store-01-clip",
        "hero_word": "CLIP",
        "subhead": "Cut long videos into shorts.",
    },
    {
        "name": "app-store-02-earn",
        "hero_word": "EARN",
        "subhead": "Post anywhere. Get paid forever.",
    },
]


def _resize_to_1920x1080(src: Path) -> Path | None:
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
    subhead_block = (
        f"SUBHEAD: directly under the hero word, set a single clean white "
        f"modern sans line: '{banner['subhead']}'. Centred, compact, fully "
        f"inside the safe zone. Smaller weight than the hero word."
    )
    prompt = "\n\n".join([
        SHARED_BLOCK,
        INVADER_DNA_BLOCK,
        hero_type_block(banner["hero_word"]),
        ACTION_BLOCK,
        WORDMARK_BLOCK,
        subhead_block,
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
    _resize_to_1920x1080(out)
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
