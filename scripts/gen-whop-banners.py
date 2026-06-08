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
    "Backdrop is pure ink #0B0B10 with subtle volumetric haze. Sole accent "
    "colour is one neon fuchsia #FF1A8C used for glow, scan lines, edge-lit "
    "geometric cubes floating in space, and bracket framing in the four "
    "corners. Type is crisp white sans-serif. No other colours. No emojis. "
    "No people. No stock photography. No drop shadows. No skeumorphic UI. "
    "Composition is widescreen 16:9 cinematic. Negative space heavy at "
    "centre. Wordmark area kept clean. Photo-real lighting on the "
    "geometric props, not flat illustration. Subtle film-grain. Editorial, "
    "premium, expensive feel — Apple keynote meets Tron Legacy."
)

WORDMARK_BLOCK = (
    "Place the Liquid Clips wordmark prominently in the lower-left or "
    "centre: a small pink pixel-art space-invader glyph next to the words "
    "'LIQUID / CLIPS' stacked vertically on either side of a thin slash "
    "separator. Wordmark in fuchsia + white. Tall, narrow sans-serif "
    "letterforms."
)

BANNERS = [
    {
        "name": "01-whop-business-cover",
        "purpose": "Whop business storefront cover (whop.com/jnremployee)",
        "headline": "CLIP & EARN",
        "subhead": "Cut long videos into clips. Earn per view. Become a Partner.",
        "extra": (
            "Hero shot. Headline 'CLIP & EARN' set in oversized condensed "
            "sans-serif uppercase, centred upper-middle, slight fuchsia "
            "outer-glow on the ampersand. Beneath it: 'Cut long videos "
            "into clips. Earn per view. Become a Partner.' in smaller "
            "white sans. Three fuchsia-lit cubes floating behind the "
            "headline at staggered depths, motion-blurred at the edges. "
            "Corner brackets in fuchsia at all four corners of the canvas."
        ),
    },
    {
        "name": "02-whop-product-banner",
        "purpose": "Per-plan cover, reused across Solo / Pro / Agency / Founder",
        "headline": "CLIP & EARN",
        "subhead": "Local-first clip studio. Whop-secure billing.",
        "extra": (
            "Subtitle reads 'LOCAL · MAC · WINDOWS · NO WATERMARK' in "
            "small uppercase fuchsia at the very top. Headline 'CLIP & "
            "EARN' centred. Below: 'Local-first clip studio. Whop-secure "
            "billing.' in white sans. A single large fuchsia-edged cube "
            "rotated and lit from inside on the right side of the canvas, "
            "as if floating in deep space. Subtle horizontal scan lines "
            "across the lower third."
        ),
    },
    {
        "name": "03-content-rewards-campaign-a",
        "purpose": "Content Rewards Campaign A — $5 RPM, open to everyone",
        "headline": "$5 PER 1K VIEWS",
        "subhead": "Clip Liquid Clips. Post anywhere. Get paid.",
        "extra": (
            "Top-left small caps fuchsia chip reads 'CAMPAIGN A · OPEN'. "
            "Headline '$5 PER 1K VIEWS' centred in oversized condensed "
            "sans uppercase, the dollar sign drawn taller with a fuchsia "
            "glow. Subhead 'Clip Liquid Clips. Post anywhere. Get paid.' "
            "beneath. Three glowing fuchsia hexagonal arrows pointing "
            "right at the bottom edge, evoking the bounty flow. Scan "
            "lines diagonal across the upper right corner."
        ),
    },
    {
        "name": "04-content-rewards-campaign-b",
        "purpose": "Content Rewards Campaign B — $10 RPM, gated for Partners",
        "headline": "$10 PER 1K VIEWS",
        "subhead": "Dedicated Liquid Clips channel only. Partner-gated.",
        "extra": (
            "Top-left small caps fuchsia chip reads 'CAMPAIGN B · "
            "PARTNER GATED'. Headline '$10 PER 1K VIEWS' centred in "
            "oversized condensed sans uppercase, doubled glow halo "
            "around the '$10' to signal premium tier. Subhead "
            "'Dedicated Liquid Clips channel only. Partner-gated.' "
            "beneath. A solitary fuchsia padlock icon emblem sits low-"
            "right, half-dissolved in fuchsia particles. Heavier "
            "vignetting around the canvas edges than Campaign A — this "
            "is the locked-tier banner, premium feel."
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
