"""Generate the four Liquid Clips Whop banners via gpt-image-1, this time
anchored on the Kade hero-character reference so facial identity stays
consistent with the marketing site, intro cinematic, and 50-MRR community
banner.

Endpoint: /v1/images/edits (multipart) with kade-oasis-16x9-startframe.png
as the identity-anchor reference. gpt-image-1 reads the reference for
character + lighting + cube-environment cues; the prompt re-poses Kade and
overlays Liquid Clips wordmark + type strip.

Outputs land in assets-wip/banners/whop-liquid-clips/kade-*.png.

Brand kit unchanged (see gen-whop-banners.py). Strapline: CLIP & EARN.
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

# Locked Kade reference — 16:9 landscape, matches banner aspect, already
# in the brand environment (dark cube field + fuchsia haze). The /edits
# endpoint reads it for facial identity, hair, hoodie, vest, and lighting.
KADE_REF = Path.home() / "Desktop/jnr/assets-wip/intro-30s/kade-oasis-16x9-startframe.png"

SIZE = "1536x1024"
MODEL = "gpt-image-1"
QUALITY = "high"

SHARED_KADE_BLOCK = (
    "Keep the SAME boy from the reference image — same auburn / red hair, "
    "same face shape, same direct eye contact, same teen-young-adult age, "
    "same dark hoodie with grey vest and fuchsia trim. He is the Liquid "
    "Clips mascot named Kade. Photorealistic, cinematic lighting, half-"
    "rim fuchsia light from behind, key light cool from camera-left. "
    "Same dark environment as the reference: a floor of dark hex tiles "
    "with reflections, edge-lit fuchsia wireframe glass cubes floating "
    "in deep space around him, soft fuchsia and teal volumetric haze. "
    "Backdrop ink #0B0B10. Sole accent fuchsia #FF1A8C. No other "
    "colours. No people other than Kade. No drop shadows on text. NO "
    "GLOW on letters — typography stays crisp solid white sans-serif "
    "with hard edges, sitting inside a frosted-glass dark strip so the "
    "white is fully legible. Bloom and glow live ONLY on the fuchsia "
    "cubes and scan lines, never on the typography. Spell every word "
    "EXACTLY as written; do not abbreviate or invent letters."
)

WORDMARK_BLOCK = (
    "Place the Liquid Clips wordmark in the lower-left corner inside the "
    "frosted-glass type strip: first a small pink pixel-art space-invader "
    "glyph (~50px), then to its right the words spelled exactly "
    "L-I-Q-U-I-D on the top line and C-L-I-P-S on the bottom line, "
    "stacked, separated by a thin fuchsia slash glyph between the lines. "
    "Both words rendered in tall narrow solid white sans-serif letters, "
    "uppercase, with NO glow on the letters. The wordmark text must read "
    "EXACTLY 'LIQUID' and 'CLIPS' — no missing or extra letters."
)

BANNERS = [
    {
        "name": "kade-01-whop-business-cover",
        "extra": (
            "Composition: Kade stands centre-left, three-quarter body shot, "
            "facing camera with a slight confident lean. Right two-thirds "
            "of canvas: the dark cube field with three fuchsia wireframe "
            "cubes at staggered depths floating around him. A horizontal "
            "frosted-glass dark strip spans the bottom 40% of canvas: "
            "headline 'CLIP & EARN' in oversized condensed solid white "
            "sans uppercase on the left of the strip, beneath it "
            "'Cut long videos into clips. Earn per view. Become a Partner.' "
            "in smaller solid white sans. The Liquid Clips wordmark sits "
            "at the bottom-left of the strip. Thin fuchsia bracket marks "
            "at all four canvas corners."
        ),
    },
    {
        "name": "kade-02-whop-product-banner",
        "extra": (
            "Composition: Kade stands centre-right, three-quarter body, "
            "facing camera. A single LARGE fuchsia wireframe cube rotated "
            "30 degrees floats behind his right shoulder, lit from inside. "
            "Left third of canvas: a vertical frosted-glass dark strip "
            "holding all type. INSIDE the strip top: small uppercase "
            "fuchsia subtitle reading exactly 'LOCAL · MAC · WINDOWS · "
            "NO WATERMARK'. Below: headline 'CLIP & EARN' in oversized "
            "condensed solid white sans uppercase. Below: solid white "
            "sans subhead 'Local-first clip studio. Whop-secure billing.' "
            "Wordmark at strip bottom. Subtle horizontal scan lines "
            "across the lower third behind Kade."
        ),
    },
    {
        "name": "kade-03-content-rewards-campaign-a",
        "extra": (
            "Composition: Kade stands centre-right, three-quarter body, "
            "arms relaxed, half-smiling. Three fuchsia wireframe cubes "
            "float around him at staggered depths. Left third of canvas: "
            "vertical frosted-glass dark strip holding all type. INSIDE "
            "the strip top: small uppercase fuchsia chip reading exactly "
            "'CAMPAIGN A · OPEN'. Below: headline '$5 PER 1K VIEWS' in "
            "oversized condensed solid white sans uppercase, crisp hard "
            "edges, NO glow on any digit. Below: solid white sans "
            "subhead 'Clip Liquid Clips. Post anywhere. Get paid.' "
            "Wordmark at strip bottom. Three small solid fuchsia chevron "
            "arrows pointing right at the bottom-right corner suggesting "
            "flow."
        ),
    },
    {
        "name": "kade-04-content-rewards-campaign-b",
        "extra": (
            "Composition: Kade stands centre-right, three-quarter body, "
            "more serious expression than Campaign A — this is the "
            "premium locked tier. A single fuchsia wireframe cube with a "
            "solid fuchsia padlock icon inset on its front face floats "
            "behind his right shoulder, lit from within. Other cubes "
            "scattered further back in the field, dimmer. Left third of "
            "canvas: vertical frosted-glass dark strip holding all type. "
            "INSIDE the strip top: small uppercase fuchsia chip reading "
            "exactly 'CAMPAIGN B · PARTNER GATED'. Below: headline '$10 "
            "PER 1K VIEWS' in oversized condensed solid white sans "
            "uppercase, crisp hard edges, NO glow on any digit. Below: "
            "solid white sans subhead 'Dedicated Liquid Clips channel "
            "only. Partner-gated.' Wordmark at strip bottom. Heavier "
            "vignette around the canvas edges than Campaign A."
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
    prompt = "\n\n".join([SHARED_KADE_BLOCK, WORDMARK_BLOCK, banner["extra"]])
    print(f"[{banner['name']}] requesting (with Kade reference)…")
    t0 = time.time()
    with KADE_REF.open("rb") as f:
        files = {"image[]": (KADE_REF.name, f, "image/png")}
        data = {
            "model": MODEL,
            "prompt": prompt,
            "size": SIZE,
            "quality": QUALITY,
            "n": "1",
        }
        with httpx.Client(timeout=180.0) as client:
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
    if not KADE_REF.exists():
        print(f"ERROR: Kade reference not found at {KADE_REF}")
        sys.exit(1)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for b in BANNERS:
        if only and only not in b["name"]:
            continue
        generate(b)
        time.sleep(2)
    print(f"\nAll saved to {OUT_DIR}")
