"""3D forward-facing pop-out Whop banners — Space Invaders poster homage.

Fourth pass. The references Daniel sent (framed retro Space Invaders
arcade poster + the 1978 Taito promo) share one piece of visual DNA:

  - MASSIVE chunky 3D EXTRUDED block letters as the hero element.
  - Letters face the camera HEAD-ON (orthographic frontal, no perspective
    skew, no isometric tilt).
  - Letters sit fully inside the frame with generous margin — type
    never clips the canvas edge.
  - The 3D pop comes from a STACK of layered chromatic-offset shadow
    plates behind a clean white face: 4-6 steps of fuchsia drift,
    suggesting deep extrusion straight back into the canvas.
  - 8-bit pixel invader formation behind/around the type.
  - Invaders + spaceships SHATTER THROUGH the letterforms — pixel
    debris, sparks, and tiny duplicate invaders explode FORWARD out of
    the negative space between letters, popping toward the camera.

Previous arcade pass (gen-whop-banners-arcade.py) put a single
spaceship at TOP-CENTRE firing DOWN at a horizontal row of aliens. The
hero type sat to the right of that action — small, cropped, and the
letters mangled on render. This pass inverts the hierarchy:

  - HERO TYPE is dead-centre, huge, fully framed, the focal point.
  - The action HAPPENS THROUGH the type, not above it.
  - The brand name 'LIQUID CLIPS' is the hero word on every banner
    (matching the 'SPACE INVADERS' position in both references). Plan
    differentiation ($5 RPM / $10 RPM / Whop / Partner-gated) goes into
    smaller secondary type, chips, and visual treatment.

Endpoint: /v1/images/edits with the locked space-invader logo as
identity anchor so every alien renders as canonical brand.
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


SHARED_BLOCK = (
    "Cinematic poster, 16:9, AAA-game-key-art quality, deep 3D depth, "
    "photoreal lighting, particles and pixel debris popping FORWARD "
    "out of the screen toward the camera on the Z-axis. Backdrop is a "
    "DEEP STARFIELD: pure ink #0B0B10 black with crisp tiny white star "
    "points and a thin fuchsia volumetric nebula ribbon across the "
    "middle band. Sole accent colour is one neon fuchsia #FF1A8C. "
    "Type faces are SOLID WHITE with fuchsia chromatic-offset shadows. "
    "NO other colours. NO emojis. NO people. NO drop shadows beneath "
    "text. Spell every word EXACTLY as written; do not abbreviate, "
    "swap, or invent letters."
)

INVADER_DNA_BLOCK = (
    "The reference image shows the canonical Liquid Clips alien: an "
    "8-bit pixel-art space invader, pure fuchsia #FF1A8C, with two "
    "antennae on top, two square eyes, a wide blocky body, and small "
    "arms / legs. Every alien in the scene must be a faithful 8-bit "
    "PIXEL replica of this exact shape — blocky stepped pixels, not "
    "smooth vector, not 3D-rendered. They look like authentic Space "
    "Invaders (1978) sprites enlarged."
)

# Forward-facing 3D extruded type — the hero element on every banner.
HERO_TYPE_3D_BLOCK = (
    "HERO TYPE — the absolute focal point of the composition: \n"
    "Set the words 'LIQUID' on the top line and 'CLIPS' on the bottom "
    "line, stacked, dead-centre of the canvas. Spell the letters "
    "EXACTLY: L-I-Q-U-I-D / C-L-I-P-S. No missing letters, no swapped "
    "letters. \n"
    "Typeface: chunky blocky uppercase display, inspired by the "
    "original Space Invaders 1978 arcade poster headline — fat slab "
    "construction with sharp 90-degree corners, even stroke weight, "
    "uniform letter heights. Authentic Atari / arcade era display "
    "type, NOT a generic sans, NOT script. \n"
    "3D treatment: letters face the camera HEAD-ON, ORTHOGRAPHIC "
    "FRONTAL — no perspective skew, no isometric tilt, no Z-rotation, "
    "no vanishing point. The letters look like they are pressed flat "
    "against the picture plane facing the viewer. The 3D depth comes "
    "ENTIRELY from a stack of layered chromatic-offset shadow plates "
    "BEHIND the white front face: 6 progressively offset duplicates "
    "of each letter in solid fuchsia #FF1A8C, each shifted ~4 pixels "
    "down-and-left from the one in front, forming a deep extruded "
    "stair-step rear wall behind the white letter face. The result "
    "reads as a flat-fronted block letter with a chunky 3D extrusion "
    "stretching back into the canvas. \n"
    "Front face: pure solid white #FFFFFF, no gradient, no inner "
    "shadow. \n"
    "SAFE ZONE — CRITICAL: the entire 'LIQUID CLIPS' block including "
    "all 6 extrusion plates behind it must sit fully inside the "
    "canvas with at least 8% padding on every side. Letters MUST NOT "
    "touch or clip any canvas edge. If the type would clip, scale it "
    "down — never crop. Both words must be 100% visible end-to-end."
)

ACTION_BLOCK = (
    "ACTION — invaders explode THROUGH the hero type: \n"
    "BACKGROUND: rows of small 8-bit fuchsia pixel space invaders "
    "(faithful to the reference) arranged in a formation grid, partly "
    "obscured behind the hero type, floating in the deep starfield. \n"
    "MIDGROUND: angular fuchsia V-shape arrowhead spaceships diving "
    "INTO the type from behind, breaking forward through the negative "
    "space between letters and through the counter-spaces inside "
    "letters like O, U, P. Their motion trails arc toward the camera. \n"
    "FOREGROUND: pixel shards, fuchsia sparks, and SMALLER duplicate "
    "pixel invaders (each unmistakably a faithful miniature copy of "
    "the canonical alien from the reference, ~30% size) exploding "
    "FORWARD out of the negative space between and inside the letter "
    "shapes — bursting toward the camera with motion-blur trails and "
    "depth-of-field bokeh. The duplication reads as the visual symbol "
    "of CLIPPING: one source becomes many. \n"
    "Key rule: the action passes THROUGH the type — invaders crash "
    "forward out from BEHIND and BETWEEN the letters. Do NOT place "
    "the entire fight above the type, do NOT place a single big "
    "spaceship hovering over the headline. The type is the stage; "
    "the explosion punches through it. \n"
    "LIGHTING: fuchsia rim-light on every letter edge from the "
    "explosion behind; the white letter faces stay clean and bright; "
    "deep starfield corners. Thin fuchsia corner brackets at all four "
    "corners of the canvas."
)

WORDMARK_BLOCK = (
    "Bottom-left of the canvas: a small frosted-glass dark strip "
    "holding the Liquid Clips wordmark in tiny tall narrow solid "
    "white sans-serif uppercase. Inside the strip: a small pink "
    "pixel-art space-invader glyph identical to the reference, then "
    "the words spelled EXACTLY 'LIQUID' and 'CLIPS' (separated by a "
    "fuchsia slash glyph). This is a secondary lockup — small, "
    "subordinate to the hero type."
)


BANNERS = [
    {
        "name": "3d-01-whop-business-cover",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'LIQUID CLIPS · "
            "WHOP'. \n"
            "SECONDARY TYPE: directly UNDER the 'CLIPS' line of the "
            "hero type, set a single clean white modern sans line: "
            "'Cut long videos into clips. Earn per view.' Centred, "
            "compact, fully inside the safe zone."
        ),
    },
    {
        "name": "3d-02-whop-product-banner",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'LOCAL · MAC · "
            "WINDOWS · NO WATERMARK'. \n"
            "SECONDARY TYPE: directly UNDER the 'CLIPS' line of the "
            "hero type, set a single clean white modern sans line: "
            "'Local-first clip studio. Whop-secure billing.' Centred, "
            "compact, fully inside the safe zone."
        ),
    },
    {
        "name": "3d-03-content-rewards-campaign-a",
        "extra": (
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'CAMPAIGN A · "
            "OPEN'. \n"
            "REWARD BADGE: top-right corner, a chunky 3D pixel-block "
            "badge (same extrusion treatment as the hero type but "
            "smaller — ~18% of canvas width) reading EXACTLY '$5 RPM' "
            "in white with fuchsia chromatic stack behind. Beneath "
            "the badge in tiny pixel font: 'PER 1,000 VIEWS'. The "
            "badge must sit fully inside the safe zone — no clipping. \n"
            "SECONDARY TYPE: directly under the 'CLIPS' line of the "
            "hero type, set a clean white modern sans line: 'Clip "
            "Liquid Clips. Post anywhere. Get paid.' Centred, "
            "compact, fully inside the safe zone."
        ),
    },
    {
        "name": "3d-04-content-rewards-campaign-b",
        "extra": (
            "Variation for the PARTNER-GATED tier — heavier vignette "
            "around the canvas edges. Each pixel invader in the "
            "scene (background formation, midground ships, foreground "
            "shards) carries a small solid fuchsia PADLOCK pixel "
            "emblem inset on its body so the locked-tier symbolism is "
            "consistent. \n"
            "TOP-LEFT corner: small fuchsia frosted-glass chip with "
            "tiny pixel-font label reading EXACTLY 'CAMPAIGN B · "
            "PARTNER GATED'. \n"
            "REWARD BADGE: top-right corner, a chunky 3D pixel-block "
            "badge (same extrusion treatment as the hero type but "
            "smaller — ~18% of canvas width) reading EXACTLY '$10 "
            "RPM' in white with fuchsia chromatic stack behind. "
            "Beneath the badge in tiny pixel font: 'PER 1,000 VIEWS'. "
            "The badge must sit fully inside the safe zone. \n"
            "SECONDARY TYPE: directly under the 'CLIPS' line of the "
            "hero type, set a clean white modern sans line: "
            "'Dedicated channel only. Partner-gated.' Centred, "
            "compact, fully inside the safe zone."
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
        HERO_TYPE_3D_BLOCK,
        ACTION_BLOCK,
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
