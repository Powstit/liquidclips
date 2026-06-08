"""Space-Invaders-arcade × cinematic Whop banners.

The whole Liquid Clips brand is the pink pixel space invader. The earlier
banner passes (gen-whop-banners.py = cubes only, gen-whop-banners-kade.py =
Kade mascot) under-played the arcade DNA. This pass leans all the way in:

  - Fuchsia spaceship at the top of frame firing a thick laser straight down.
  - A row/grid of pink 8-bit pixel aliens (matching the locked Liquid Clips
    space-invader logo — assets-wip/brand-logo/liquidclips-spaceinvader-v1.png).
  - The lead alien is being SHOT — it explodes into a cluster of SMALLER
    copies of itself flying outward in 3D toward the camera. This is the
    "1 long video → many clips" symbolism: one source duplicates into many.
  - Particles, sparks, pixel debris, and floating "+$5" tokens streaming
    forward, popping out of the screen on the Z-axis (cinematic depth).
  - HUGE "$5 RPM" headline in BLOCKY 8-bit pixel font, white core with a
    fuchsia chromatic-aberration edge — Space Invaders / Atari era type.
  - Liquid Clips wordmark bottom-left in frosted-glass strip.

Endpoint: /v1/images/edits with the space-invader logo as reference so
gpt-image-1 keeps the alien design canonical (head, eyes, antennae,
pixel grid identical to the brand logo).
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

SIZE = "1536x1024"
MODEL = "gpt-image-1"
QUALITY = "high"

SHARED_ARCADE_BLOCK = (
    "Cinematic poster, 16:9, AAA-game-key-art quality. Style is Space "
    "Invaders ARCADE meets TRON LEGACY meets MARVEL poster — high "
    "production value, photoreal lighting, deep 3D depth, particles "
    "and pixel debris flying TOWARD the camera popping out of the "
    "screen. Backdrop is a DEEP STARFIELD: pure ink #0B0B10 black with "
    "tiny crisp white star points, a thin fuchsia volumetric nebula "
    "ribbon across the middle band, subtle film grain. Sole accent "
    "colour is one neon fuchsia #FF1A8C. Type is solid white. NO other "
    "colours. NO emojis. NO people. NO drop shadows on text. Spell every "
    "word EXACTLY as written; do not abbreviate or invent letters."
)

INVADER_DNA_BLOCK = (
    "The reference image shows the canonical Liquid Clips alien: an "
    "8-bit pixel-art space invader, pure fuchsia #FF1A8C, with two "
    "antennae on top, two square eyes, a wide blocky body, and small "
    "arms / legs. Every alien in the scene must be a faithful 8-bit "
    "PIXEL replica of this exact shape — blocky stepped pixels, NOT "
    "smooth vector, NOT 3D-rendered. They look like Space Invaders "
    "(1978) sprites enlarged."
)

ARCADE_ACTION_BLOCK = (
    "Composition: \n"
    "TOP CENTRE: a LARGE angular fuchsia spaceship occupying ~15% of "
    "canvas width — a sleek V-shape arrowhead vessel with neon edge-"
    "glow, two glowing fuchsia engine nacelles, a ventral gun barrel "
    "pointing straight down, photoreal AAA-game-key-art style. Make "
    "the ship MENACING and CLEARLY VISIBLE, not a glyph. It fires a "
    "THICK fuchsia laser beam straight down through the frame, with "
    "spark-flares at the muzzle. \n"
    "MIDDLE: a horizontal row of 6 pink 8-bit pixel space-invader "
    "aliens (faithful to the reference) hovering across the canvas. "
    "The CENTRE alien has just been hit by the laser — it is mid-"
    "SHATTER, breaking apart into EXACTLY 12 SMALLER PIXEL COPIES "
    "OF ITSELF (each visibly a faithful miniature space invader, "
    "clearly the same alien just shrunk to ~30% size). The 12 "
    "miniature aliens fan out in 12 directions in 3D — some flying "
    "TOWARD the camera with motion-blur trails behind them, some "
    "drifting up/down/sideways, leaving clear trajectory vectors. "
    "Each tiny invader is unmistakably a copy of the original — this "
    "is the visual SYMBOL of CLIPPING: one source video becomes many "
    "short clips. The duplication must be READABLE in a half-second "
    "glance. \n"
    "FOREGROUND: pixel debris, fuchsia sparks, small white pixel-font "
    "tokens reading '+$5' trailing several of the duplicated aliens, "
    "all rendered with depth-of-field bokeh and lens-flare ghosting — "
    "they pop OUT of the screen toward the viewer on the Z-axis. \n"
    "LIGHTING: the laser column lights the centre of the canvas; "
    "fuchsia rim-light bounces off every alien; corners stay deep "
    "starfield-dark. Thin fuchsia corner brackets at all four corners "
    "of the canvas."
)

WORDMARK_BLOCK = (
    "Bottom-left of the canvas: a small frosted-glass dark strip "
    "holding the Liquid Clips wordmark. Inside the strip: a small pink "
    "pixel-art space-invader glyph identical to the reference, then "
    "the words spelled exactly L-I-Q-U-I-D on the top line and "
    "C-L-I-P-S on the bottom line, separated by a fuchsia slash glyph. "
    "Tall narrow solid white sans-serif uppercase. The wordmark text "
    "must read EXACTLY 'LIQUID' and 'CLIPS' — no missing letters."
)


BANNERS = [
    {
        "name": "arcade-01-whop-business-cover",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "pixel-font label reading EXACTLY 'LIQUID CLIPS · WHOP' "
            "in tiny uppercase. \n"
            "HEADLINE: upper-right two-thirds of canvas, set the "
            "headline 'CLIP & EARN' in MASSIVE BLOCKY 8-BIT PIXEL "
            "font (authentic Space Invaders / Atari arcade typeface, "
            "sharp stepped pixel edges, NOT smooth rounded), white "
            "core with 4-pixel fuchsia chromatic-aberration outline. "
            "Each letter fills nearly a third of the canvas height. "
            "The ampersand '&' is the same pixel font, same weight, "
            "centred between CLIP and EARN. \n"
            "SUBHEAD: bottom-right corner, clean solid white modern "
            "sans (NOT pixel font), two stacked lines: 'Cut long "
            "videos into clips.' / 'Earn per view. Become a Partner.' "
            "Leave clear breathing room from the bottom-left wordmark."
        ),
    },
    {
        "name": "arcade-02-whop-product-banner",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "pixel-font label reading EXACTLY 'LOCAL · MAC · WINDOWS' "
            "and below it a second line 'NO WATERMARK' in tiny "
            "uppercase. \n"
            "HEADLINE: upper-right two-thirds of canvas, set 'CLIP & "
            "EARN' in MASSIVE BLOCKY 8-BIT PIXEL font (same Space "
            "Invaders typeface), white core with fuchsia chromatic-"
            "aberration edge. \n"
            "SUBHEAD: bottom-right corner, clean solid white modern "
            "sans, two stacked lines: 'Local-first clip studio.' / "
            "'Whop-secure billing.' Clear breathing room from the "
            "bottom-left wordmark."
        ),
    },
    {
        "name": "arcade-03-content-rewards-campaign-a",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "pixel-font label reading EXACTLY 'CAMPAIGN A · OPEN' in "
            "tiny uppercase. \n"
            "HEADLINE: upper-right two-thirds of canvas, set '$5 RPM' "
            "in MASSIVE BLOCKY 8-BIT PIXEL font (Space Invaders "
            "typeface), white core with 4-pixel fuchsia chromatic-"
            "aberration outline. Beneath in the same pixel font but "
            "smaller: 'PER 1,000 VIEWS'. \n"
            "SUBHEAD: bottom-right corner, clean solid white modern "
            "sans, two stacked lines: 'Clip Liquid Clips.' / 'Post "
            "anywhere. Get paid.' Clear breathing room from the "
            "bottom-left wordmark."
        ),
    },
    {
        "name": "arcade-04-content-rewards-campaign-b",
        "extra": (
            "Variation for the PREMIUM LOCKED tier — overall feel is "
            "heavier, more cinematic, with darker vignette around the "
            "canvas edges. The LEAD alien being shot has a SOLID "
            "FUCHSIA PADLOCK icon emblem inset on its pixel-art body "
            "(visible padlock pixels integrated into the alien's "
            "chest area). The 12 smaller duplicated invaders each "
            "still carry the small padlock badge on their bodies so "
            "the locked-tier symbolism is consistent. \n"
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "pixel-font label reading EXACTLY 'CAMPAIGN B · PARTNER "
            "GATED' in tiny uppercase. \n"
            "HEADLINE: upper-right two-thirds of canvas, set '$10 "
            "RPM' in MASSIVE BLOCKY 8-BIT PIXEL font (Space Invaders "
            "typeface), white core with 4-pixel fuchsia chromatic-"
            "aberration outline. Beneath in the same pixel font but "
            "smaller: 'PER 1,000 VIEWS'. \n"
            "SUBHEAD: bottom-right corner, clean solid white modern "
            "sans, two stacked lines: 'Dedicated channel only.' / "
            "'Partner-gated.' Clear breathing room from the bottom-"
            "left wordmark. \n"
            "Replace the '+$5' floating reward tokens with '+$10' "
            "tokens trailing the duplicated aliens — same pixel-font "
            "style."
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
        SHARED_ARCADE_BLOCK,
        INVADER_DNA_BLOCK,
        ARCADE_ACTION_BLOCK,
        WORDMARK_BLOCK,
        banner["extra"],
    ])
    print(f"[{banner['name']}] requesting (with invader reference)…")
    t0 = time.time()
    with INVADER_REF.open("rb") as f:
        files = {"image[]": (INVADER_REF.name, f, "image/png")}
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
    if not INVADER_REF.exists():
        print(f"ERROR: invader reference not found at {INVADER_REF}")
        sys.exit(1)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for b in BANNERS:
        if only and only not in b["name"]:
            continue
        generate(b)
        time.sleep(2)
    print(f"\nAll saved to {OUT_DIR}")
