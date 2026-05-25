#!/usr/bin/env python3
"""Generate Junior brand art via gpt-image-1 (design-uplift scope §3).

Critical set: A1 app icon, A6 splash, A3 tier icons ×4, A10 pipeline icons ×4.
Staged to desktop/assets-gen/ for review BEFORE wiring into the app.

Usage:
  set -a; source ~/.claude-credentials/openai.env; set +a
  python-sidecar/.venv/bin/python scripts/gen_assets.py [--force] [name ...]
"""
from __future__ import annotations
import base64
import os
import sys
from pathlib import Path
from openai import OpenAI

OUT = Path(__file__).resolve().parent.parent / "assets-gen"
OUT.mkdir(exist_ok=True)

# House style prepended to every prompt (scope doc §3).
HOUSE = (
    "Minimal, premium, editorial. Brand palette ONLY: fuchsia #FF1A8C with deep "
    "#C70066 and glow #FF66B8, near-black ink #0A0A0F, warm paper #FAF7F2. No other "
    "colours. No text unless specified. No drop-shadow baked into transparent assets. "
    "Crisp vector-like edges, flat-with-subtle-depth, Apple-grade restraint. No emoji "
    "aesthetic, no clip-art, no gradients on small marks. "
)

TIER = (
    "A single minimal badge icon on transparent background representing a software "
    "subscription tier, flat with subtle dimensional light, fuchsia + ink + paper only, "
    "no text. Tier: {desc}. Geometric, restrained, instantly legible at 24px."
)
STEP = (
    "A minimal monochrome process-step glyph on transparent background, ink line-work "
    "with a single fuchsia accent dot, no text: {desc}. Consistent stroke weight, "
    "centered with even margins, legible at 20px."
)

# name -> (prompt, size, background)
ASSETS: dict[str, tuple[str, str, str]] = {
    "A1-app-icon": (
        "A macOS app icon: a rounded-square tile (squircle, ~22% corner radius) filled "
        "with a rich fuchsia #FF1A8C surface that has a single soft top-left light source "
        "and a very subtle deeper fuchsia #C70066 falloff toward the bottom-right — "
        "premium and dimensional but still minimal. Centered, a single bold near-black ink "
        "#0A0A0F forward-slash '/' mark, slightly italic, occupying ~55% of the height, with "
        "a barely-perceptible inner depth so it reads as carved, not painted. Full-bleed, no "
        "transparency, no text. Clean, Apple-grade, suitable at 16px and 1024px.",
        "1024x1024", "opaque",
    ),
    "A6-splash": (
        "A full-bleed launch screen backplate (no transparency): a soft fuchsia #FF1A8C to "
        "deep #C70066 to glow #FF66B8 diagonal gradient field with a faint radial light bloom "
        "top-right, very subtle, mostly dark-fuchsia and calm so light UI elements and a "
        "centered '/' mark can animate on top. Cinematic, restrained, no text, no objects.",
        "1536x1024", "opaque",
    ),
    "A3-tier-free": (TIER.format(desc="a clean open outline ring, mostly paper with a thin fuchsia edge"), "1024x1024", "transparent"),
    "A3-tier-solo": (TIER.format(desc="one solid fuchsia rounded bar"), "1024x1024", "transparent"),
    "A3-tier-growth": (TIER.format(desc="three ascending fuchsia bars"), "1024x1024", "transparent"),
    "A3-tier-autopilot": (TIER.format(desc="a fuchsia orbit/loop mark suggesting hands-off automation"), "1024x1024", "transparent"),
    "A10-step-transcribe": (STEP.format(desc="a soundwave resolving into text lines"), "1024x1024", "transparent"),
    "A10-step-cut": (STEP.format(desc="a clean scissor/cut mark on a timeline"), "1024x1024", "transparent"),
    "A10-step-reframe": (STEP.format(desc="a wide frame collapsing into a vertical 9:16 frame"), "1024x1024", "transparent"),
    "A10-step-thumbs": (STEP.format(desc="a small grid of frames"), "1024x1024", "transparent"),
}


def main() -> int:
    force = "--force" in sys.argv
    wanted = [a for a in sys.argv[1:] if not a.startswith("--")]
    names = wanted or list(ASSETS)
    client = OpenAI()
    for name in names:
        if name not in ASSETS:
            print(f"  skip unknown: {name}")
            continue
        out = OUT / f"{name}.png"
        if out.exists() and not force:
            print(f"  exists, skip: {out.name}  (use --force to regenerate)")
            continue
        prompt, size, bg = ASSETS[name]
        print(f"→ {name}  ({size}, {bg}) …")
        res = client.images.generate(
            model="gpt-image-1",
            prompt=HOUSE + prompt,
            size=size,
            quality="high",
            background=bg,
            output_format="png",
            n=1,
        )
        out.write_bytes(base64.b64decode(res.data[0].b64_json))
        print(f"  ✓ {out.relative_to(OUT.parent)}  ({out.stat().st_size // 1024} KB)")
    print("\nDone. Review in:", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
