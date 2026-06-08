"""Generate the four Liquid Clips Whop banners via gpt-image-1.

Outputs land in assets-wip/banners/whop-liquid-clips/. Daniel uploads them
manually via Whop dashboard (the company branding API is not exposed at
our tier).

Brand kit (locked):
  - Ink backdrop #0B0B10 (cinematic dark)
  - One fuchsia accent #FF1A8C (glow, brackets, HUD lines)
  - White type
  - HUD / cyberpunk geometry — fuchsia-lit cubes, scan lines, bracket frames
  - Liquid Clips wordmark: pink pixel space-invader glyph + LIQUID / CLIPS
    in clean tall sans, stacked vertically on the slash separator
  - No other accents. No emojis. No extra colours.

Strapline: CLIP & EARN.
"""

import base64
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx

API_URL = "https://api.openai.com/v1/images/generations"
API_KEY = os.environ["OPENAI_API_KEY"]
OUT_DIR = Path.home() / "Desktop/jnr/assets-wip/banners/whop-liquid-clips"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# All four banners use 1536x1024 (closest gpt-image-1 supports to Whop's
# 16:9 1920x1080). We upscale / pad to 1920x1080 with ffmpeg after.
SIZE = "1536x1024"
MODEL = "gpt-image-1"
QUALITY = "high"

SHARED_BRAND_BLOCK = (
    "Brand: Liquid Clips. Aesthetic is cinematic dark, HUD-cyberpunk. "
    "Backdrop is pure ink #0B0B10. Subtle volumetric haze only at the "
    "FAR edges of the canvas — the centre is clean and dark. Sole "
    "accent colour is one neon fuchsia #FF1A8C used for edge-lit "
    "wireframe geometric cubes floating in space and thin bracket marks "
    "at the canvas corners. NO glow effects on type or text. NO halo, NO "
    "bloom on lettering. Headline type is CRISP solid white sans-serif "
    "with hard edges, sitting on a frosted-glass dark-grey strip "
    "(rgb 16/16/22 at 80% opacity) so the white is fully legible against "
    "the dark backdrop. Bloom and glow live ONLY on the fuchsia cubes and "
    "scan lines, NEVER on the typography. No other colours. No emojis. "
    "No people. No stock photography. No drop shadows. No skeumorphic UI. "
    "No watermarks. Composition is widescreen 16:9 cinematic. Photo-real "
    "lighting on the geometric props, not flat illustration. Subtle "
    "film-grain. Editorial, premium, expensive feel — Apple keynote "
    "meets Tron Legacy. Spell every word EXACTLY as written; do not "
    "alter, abbreviate, or invent letters."
)

WORDMARK_BLOCK = (
    "Place the Liquid Clips wordmark in the lower-left corner inside a "
    "clean dark area free of cubes and haze: first a small pink pixel-art "
    "space-invader glyph (~50px), then to its right the words spelled "
    "exactly L-I-Q-U-I-D on the top line and C-L-I-P-S on the bottom "
    "line, stacked, separated by a thin fuchsia slash glyph between the "
    "lines. Both words rendered in tall narrow solid white sans-serif "
    "letters, uppercase, with NO glow and NO bloom on the letters. The "
    "wordmark text must read EXACTLY 'LIQUID' and 'CLIPS' — no missing "
    "or extra letters."
)

BANNERS = [
    {
        "name": "01-whop-business-cover",
        "purpose": "Whop business storefront cover (whop.com/jnremployee)",
        "headline": "CLIP & EARN",
        "subhead": "Cut long videos into clips. Earn per view. Become a Partner.",
        "extra": (
            "Compositional layout: a horizontal frosted-glass dark strip "
            "(60% canvas width, vertically centred) holds all type. INSIDE "
            "that strip and only inside it: the headline 'CLIP & EARN' in "
            "oversized condensed solid white sans-serif uppercase letters "
            "with hard crisp edges (NO glow on the letters); directly "
            "underneath in smaller solid white sans the line "
            "'Cut long videos into clips. Earn per view. Become a Partner.' "
            "OUTSIDE the strip, scattered behind it in the dark backdrop: "
            "three fuchsia wireframe cubes floating at staggered depths "
            "with fuchsia edge-glow ON THE CUBES ONLY. Thin fuchsia "
            "bracket marks at all four corners. The ampersand '&' between "
            "CLIP and EARN is solid white, same weight as the other "
            "letters, NO halo. Every letter spelled exactly as written."
        ),
    },
    {
        "name": "02-whop-product-banner",
        "purpose": "Per-plan cover, reused across Solo / Pro / Agency / Founder",
        "headline": "CLIP & EARN",
        "subhead": "Local-first clip studio. Whop-secure billing.",
        "extra": (
            "Compositional layout: left half of canvas holds a vertical "
            "frosted-glass dark strip with all type. Right half holds a "
            "single large fuchsia wireframe cube rotated 30 degrees and "
            "lit from inside, floating in deep space, fuchsia glow ON THE "
            "CUBE ONLY. INSIDE the left strip: a small uppercase fuchsia "
            "subtitle at the top reading exactly 'LOCAL · MAC · WINDOWS · "
            "NO WATERMARK' (spell L-O-C-A-L, do not invent letters). "
            "Below that, the headline 'CLIP & EARN' in oversized "
            "condensed solid white sans uppercase, crisp edges, no glow. "
            "Below the headline, smaller solid white sans: 'Local-first "
            "clip studio. Whop-secure billing.' Subtle horizontal scan "
            "lines across the lower third of the canvas."
        ),
    },
    {
        "name": "03-content-rewards-campaign-a",
        "purpose": "Content Rewards Campaign A — $5 RPM, open to everyone",
        "headline": "$5 PER 1K VIEWS",
        "subhead": "Clip Liquid Clips. Post anywhere. Get paid.",
        "extra": (
            "Compositional layout: vertical frosted-glass dark strip on "
            "the left half holds all type. Right half holds the geometry. "
            "INSIDE the left strip, top: small uppercase fuchsia chip "
            "reading exactly 'CAMPAIGN A · OPEN'. Beneath: headline '$5 "
            "PER 1K VIEWS' in oversized condensed solid white sans "
            "uppercase, crisp hard edges, NO glow on any digit or letter. "
            "Beneath: solid white sans subhead 'Clip Liquid Clips. Post "
            "anywhere. Get paid.' OUTSIDE the strip on the right half: "
            "three fuchsia wireframe cubes at staggered depths with "
            "fuchsia edge-glow ON THE CUBES ONLY. Three small solid "
            "fuchsia chevron arrows pointing right at the bottom-right "
            "corner, suggesting flow. Diagonal scan lines in the upper "
            "right behind the cubes."
        ),
    },
    {
        "name": "04-content-rewards-campaign-b",
        "purpose": "Content Rewards Campaign B — $10 RPM, gated for Partners",
        "headline": "$10 PER 1K VIEWS",
        "subhead": "Dedicated Liquid Clips channel only. Partner-gated.",
        "extra": (
            "Compositional layout: vertical frosted-glass dark strip on "
            "the left half holds all type. Right half holds the geometry. "
            "INSIDE the left strip, top: small uppercase fuchsia chip "
            "reading exactly 'CAMPAIGN B · PARTNER GATED' (spell "
            "P-A-R-T-N-E-R G-A-T-E-D exactly). Beneath: headline '$10 PER "
            "1K VIEWS' in oversized condensed solid white sans uppercase, "
            "crisp hard edges, NO glow on any digit or letter. Beneath: "
            "solid white sans subhead 'Dedicated Liquid Clips channel "
            "only. Partner-gated.' OUTSIDE the strip on the right half: "
            "a single fuchsia wireframe cube with a solid fuchsia "
            "padlock icon emblem inset on its front face, lit from "
            "within. Heavier dark vignette around the canvas edges than "
            "Campaign A — premium locked-tier feel. No particles or "
            "dissolving effects on the icon."
        ),
    },
]


def _resize_to_whop_1920x1080(src: Path) -> Path | None:
    """gpt-image-1 returns 1536x1024 (3:2). Whop covers want 1920x1080 (16:9).
    Center-crop to 1536x864 then upscale to 1920x1080 with lanczos. Returns
    the resized path (sibling file with -1920x1080 suffix) or None when
    ffmpeg is not on PATH."""
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
    prompt = "\n\n".join([SHARED_BRAND_BLOCK, WORDMARK_BLOCK, banner["extra"]])
    print(f"[{banner['name']}] requesting…")
    t0 = time.time()
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
            },
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
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for b in BANNERS:
        if only and only not in b["name"]:
            continue
        generate(b)
        time.sleep(2)  # gentle pacing
    print(f"\nAll saved to {OUT_DIR}")
