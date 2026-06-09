"""3D Whop banners v2 — exact 1978 Space Invaders typeface, hero ship dives at camera.

Fifth pass. v1 (gen-whop-banners-3d.py) got the 3D extrusion + safe
zone right but the typeface drifted toward a generic blocky display
face and the action still hovered above the type instead of coming
at the viewer. Daniel's fix:

  - Use the EXACT typeface from the reference posters (framed retro
    arcade poster + 1978 Taito promo). Same chunky slab construction,
    same stepped letter geometry, same proportions — only the colours
    change (white face + fuchsia chromatic stack, not yellow + teal).
  - A single hero spaceship flying STRAIGHT AT THE CAMERA — nose
    pointed at the viewer, motion-blur trails receding into the
    canvas. Not above the type, not firing down at a row of aliens.

Mechanism: pass BOTH poster references alongside the locked invader
logo to gpt-image-1 /v1/images/edits (the endpoint accepts multiple
images via repeated image[] fields). The invader ref anchors the
alien sprite; the poster refs anchor the typeface construction.
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
POSTER_REFS = [
    OUT_DIR / "refs/space-invaders-poster-taito1978.png",
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
    "NO orange, NO other colours. NO emojis. NO people. NO drop "
    "shadows beneath text. Spell every word EXACTLY as written; do "
    "not abbreviate, swap, or invent letters."
)

INVADER_DNA_BLOCK = (
    "Image 1 (the small pink sprite) is the canonical Liquid Clips "
    "alien: 8-bit pixel-art space invader, pure fuchsia #FF1A8C, "
    "with two antennae on top, two square eyes, a wide blocky body, "
    "small arms / legs. Every alien in the scene must be a faithful "
    "8-bit PIXEL replica of this exact shape — blocky stepped pixels, "
    "not smooth vector, not 3D-rendered. Authentic Space Invaders "
    "(1978) sprite enlarged."
)

# Hero type anchored on the actual 1978 poster typeface via the reference images.
HERO_TYPE_BLOCK = (
    "HERO TYPE — the focal point: \n"
    "Set the words 'LIQUID' on the top line and 'CLIPS' on the bottom "
    "line, stacked, dead-centre of the canvas. Spell the letters "
    "EXACTLY: L-I-Q-U-I-D / C-L-I-P-S. No missing letters, no swapped "
    "letters. \n"
    "TYPEFACE — use the EXACT typeface construction shown in the "
    "reference poster images (the framed arcade poster and the 1978 "
    "Taito promo): the iconic 'SPACE INVADERS' letterforms. Match "
    "their proportions, stroke weight, slab construction, and the "
    "distinctive notched/stepped geometry on letters like S, C, P, "
    "D exactly. Same chunky display face. Only the COLOUR changes — "
    "render the front faces in solid white #FFFFFF and the extrusion "
    "stack in solid fuchsia #FF1A8C. Do NOT use yellow or teal as in "
    "the references; only white and fuchsia. \n"
    "3D treatment: letters face the camera HEAD-ON, ORTHOGRAPHIC "
    "FRONTAL — no perspective skew, no isometric tilt, no Z-rotation. "
    "Depth comes from a stack of 6 progressively offset chromatic "
    "shadow plates in solid fuchsia behind the white face, each "
    "shifted ~4 pixels down-and-left, forming a deep extruded "
    "stair-step rear wall. Identical to the 3D stacking seen in the "
    "poster references — just white + fuchsia instead of yellow + "
    "teal. \n"
    "SAFE ZONE — CRITICAL: 'LIQUID' and 'CLIPS' plus the full 6-plate "
    "extrusion behind them must sit fully inside the canvas with at "
    "least 8% padding on every side. Letters MUST NOT touch or clip "
    "any canvas edge. Scale down rather than crop. Both words 100% "
    "visible end-to-end."
)

# Single hero ship flying straight at the camera.
ACTION_BLOCK = (
    "ACTION — the hero ship flies STRAIGHT AT THE VIEWER: \n"
    "MIDGROUND: behind the hero type and behind the spaceship, rows "
    "of small 8-bit fuchsia pixel space invaders (faithful to the "
    "alien reference) arranged in a formation grid, partly obscured "
    "by the type and the ship, floating in the deep starfield. \n"
    "HERO SHIP: a single LARGE angular fuchsia V-shape arrowhead "
    "spaceship occupying ~22% of canvas width, positioned in front "
    "of the hero type, flying STRAIGHT AT THE CAMERA — nose pointed "
    "directly at the viewer, head-on POV target framing. The ship is "
    "approaching the lens, getting closer; long motion-blur trails "
    "and engine-glow plumes recede BEHIND it back into the canvas "
    "toward the vanishing point. Photoreal AAA-game-key-art rendering, "
    "neon fuchsia edge-glow, two glowing engine nacelles trailing. "
    "Do NOT show the ship from the side. Do NOT show it firing down. "
    "Do NOT show it hovering above the type. It is DIVING AT YOU. \n"
    "FOREGROUND: SMALLER duplicate pixel invaders (each unmistakably "
    "a miniature copy of the canonical alien, ~30% size) and pixel "
    "shards / fuchsia sparks bursting FORWARD out of the negative "
    "space inside and between the hero letters — popping toward the "
    "camera with motion-blur trails and depth-of-field bokeh. The "
    "duplication reads as the visual symbol of CLIPPING: one source "
    "becomes many. \n"
    "LIGHTING: fuchsia rim-light on every letter edge and on the "
    "ship's leading silhouette; white letter faces stay clean and "
    "bright; deep starfield corners. Thin fuchsia corner brackets at "
    "all four corners of the canvas."
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
        "name": "3d-v2-01-whop-business-cover",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'LIQUID CLIPS · "
            "WHOP'. \n"
            "SECONDARY TYPE: directly UNDER the 'CLIPS' line, set a "
            "single clean white modern sans line: 'Cut long videos "
            "into clips. Earn per view.' Centred, compact, fully "
            "inside the safe zone."
        ),
    },
    {
        "name": "3d-v2-02-whop-product-banner",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'LOCAL · MAC · "
            "WINDOWS · NO WATERMARK'. \n"
            "SECONDARY TYPE: directly UNDER the 'CLIPS' line, set a "
            "single clean white modern sans line: 'Local-first clip "
            "studio. Whop-secure billing.' Centred, compact, fully "
            "inside the safe zone."
        ),
    },
    {
        "name": "3d-v2-03-content-rewards-campaign-a",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'CAMPAIGN A · "
            "OPEN'. \n"
            "REWARD BADGE: top-right corner, a chunky 3D pixel-block "
            "badge using the SAME poster typeface and the SAME 6-plate "
            "fuchsia extrusion treatment as the hero type but smaller "
            "(~18% of canvas width), reading EXACTLY '$5 RPM' in white "
            "with fuchsia stack behind. Beneath the badge in tiny "
            "pixel font: 'PER 1,000 VIEWS'. Badge must sit fully "
            "inside the safe zone. \n"
            "SECONDARY TYPE: directly under the 'CLIPS' line, clean "
            "white modern sans line: 'Clip Liquid Clips. Post "
            "anywhere. Get paid.' Centred, fully inside safe zone."
        ),
    },
    {
        "name": "3d-v2-04-content-rewards-campaign-b",
        "extra": (
            "Variation for the PARTNER-GATED tier — heavier vignette "
            "around the canvas edges. Each pixel invader in the "
            "scene carries a small solid fuchsia PADLOCK pixel emblem "
            "inset on its body. \n"
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'CAMPAIGN B · "
            "PARTNER GATED'. \n"
            "REWARD BADGE: top-right corner, a chunky 3D pixel-block "
            "badge using the SAME poster typeface and the SAME 6-plate "
            "fuchsia extrusion treatment as the hero type but smaller "
            "(~18% of canvas width), reading EXACTLY '$10 RPM' in "
            "white with fuchsia stack behind. Beneath the badge in "
            "tiny pixel font: 'PER 1,000 VIEWS'. Badge must sit fully "
            "inside the safe zone. \n"
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
    print(f"[{banner['name']}] requesting (invader + 2 poster refs)…")
    t0 = time.time()
    refs = [INVADER_REF, *POSTER_REFS]
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
    for p in [INVADER_REF, *POSTER_REFS]:
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
