"""3D crawling bug — Made with Liquid Clips watermark character.

Per Daniel 2026-06-12 motion-graphics brief: replace the flat pixel-
invader bug with a 3D character that CRAWLS. Two variants generated in
parallel so Daniel can pick:

  A — 3D pixel-invader-evolution. Keeps the brand silhouette but
      rendered with depth, sub-surface fuchsia glow, mechanical legs
      that articulate as it crawls. Maximum brand continuity.
  B — 3D literal beetle. Liquid Clips fuchsia carapace, ink legs,
      paper-warm shadow. Reads as a real insect — pure "bug that
      crawls" interpretation.

Same prompt skeleton, swapped subject. Anchored to brand kit:
  fuchsia #FF1A8C · ink #F4F1EA · paper #0B0B10.

Outputs to ~/Desktop/jnr/desktop/src/assets/bug-3d/. Daniel picks,
SVG wrapper animates the chosen PNG crawling across a transparent
band. PNG → SVG with embedded image, CSS keyframes drive translateX +
subtle leg-bob.
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

import httpx

API_URL = "https://api.openai.com/v1/images/generations"
API_KEY = os.environ.get("OPENAI_API_KEY")
if not API_KEY:
    print("OPENAI_API_KEY missing — source ~/.claude-credentials/openai.env first", file=sys.stderr)
    sys.exit(1)

OUT_DIR = Path.home() / "Desktop/jnr/desktop/src/assets/bug-3d"
OUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL = "gpt-image-1"
SIZE = "1024x1024"
QUALITY = "high"

BRAND_BLOCK = (
    "Strict brand palette: hot fuchsia #FF1A8C as the dominant body color, "
    "ink-cream #F4F1EA highlights where light catches the carapace, "
    "deep paper-black #0B0B10 underbelly and shadow. NO other colors. "
    "Subject is a small character (not full frame) sitting on a completely "
    "transparent background — alpha channel pure. "
    "AAA-game character-design quality, studio render lighting, soft rim "
    "light, subtle subsurface scattering on the fuchsia carapace so it "
    "glows from within. 3D depth, dimensional shading, NOT flat illustration. "
    "Side three-quarter view so all six legs are visible and clearly posed "
    "mid-stride — left-front and right-mid lifted, others planted. The "
    "character reads as a cute premium tech mascot, never threatening."
)

VARIANTS: list[tuple[str, str]] = [
    (
        "invader-evolution",
        "A 3D-rendered evolution of the 1978 Space Invaders alien — instantly "
        "recognizable boxy invader silhouette (two antennae prongs up top, "
        "two short legs splaying down) but now with full dimensional depth, "
        "chamfered cube body segments stacked like premium polished vinyl "
        "figure, six articulated mechanical insect legs underneath the body "
        "in a mid-crawl pose. Glowing fuchsia bio-mechanical body with ink-"
        "cream highlights. Reads as Liquid Clips' invader mascot crawling on "
        "all six legs. " + BRAND_BLOCK
    ),
    (
        "fuchsia-beetle",
        "A cute 3D-rendered scarab beetle, premium vinyl-figure style. "
        "Glossy fuchsia carapace with iridescent ink-cream rim light. Six "
        "ink-black mechanical legs articulated in a mid-crawl pose — front-"
        "right and mid-left lifted, others planted. Single pair of small "
        "antennae. Cute round eyes (not menacing). Soft shadow underneath. "
        "Reads as Liquid Clips' brand bug crawling. " + BRAND_BLOCK
    ),
]


def generate(slug: str, prompt: str) -> Path:
    print(f"→ {slug}")
    with httpx.Client(timeout=180.0) as client:
        r = client.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "prompt": prompt,
                "size": SIZE,
                "quality": QUALITY,
                "n": 1,
                "background": "transparent",
            },
        )
        r.raise_for_status()
        data = r.json()
    b64 = data["data"][0]["b64_json"]
    out = OUT_DIR / f"{slug}.png"
    out.write_bytes(base64.b64decode(b64))
    print(f"  → {out}")
    return out


def main() -> None:
    for slug, prompt in VARIANTS:
        generate(slug, prompt)
    print("\ndone. Open ~/Desktop/jnr/desktop/src/assets/bug-3d/ to compare.")


if __name__ == "__main__":
    main()
