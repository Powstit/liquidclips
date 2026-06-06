#!/usr/bin/env python3
"""Generate Liquid Clips hero + background plates via gpt-image-1.

Usage:
  source ~/.claude-credentials/openai.env
  python3 scripts/generate-hero-plates.py
"""
import os
import sys
import json
import base64
import time
import ssl
import urllib.request
import urllib.error

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

API_KEY = os.environ.get("OPENAI_API_KEY")
if not API_KEY:
    # Fall back to reading ~/.claude-credentials/openai.env directly
    cred_path = os.path.expanduser("~/.claude-credentials/openai.env")
    if os.path.exists(cred_path):
        with open(cred_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                if "=" in line:
                    k, v = line.split("=", 1)
                    v = v.strip().strip("'").strip('"')
                    if k.strip() == "OPENAI_API_KEY":
                        API_KEY = v
                        break
if not API_KEY:
    print("ERROR: OPENAI_API_KEY not set in env and not in ~/.claude-credentials/openai.env", file=sys.stderr)
    sys.exit(1)

OUT_DIR = "/Users/dipdip/Desktop/jnr/liquidclips-marketing/public/cinematic"
ENDPOINT = "https://api.openai.com/v1/images/generations"

JOBS = [
    {
        "filename": "hero-cabinet-v1.png",
        "size": "1536x1024",
        "prompt": (
            "A photorealistic 80s neon-lit arcade cabinet centered in a dark room. "
            "The marquee text reads 'LIQUID CLIPS' in bright fuchsia letters (#ff1a8c) "
            "with cyan rim-light (#00e5ff). The CRT screen glows fuchsia and cyan, showing "
            "the silhouette of a clip workflow with a video timeline and thumbnail cards. "
            "Smoke billows at the base of the cabinet. Dust particles drift through fuchsia "
            "light beams. Cabinet sides have glowing neon strips. Wet arcade-floor reflection "
            "below. Shot from a low front angle, cinematic shallow depth of field. "
            "Multi-layer depth: foreground cabinet sharp, midground 6px blur, background 24px blur. "
            "Volumetric fog, chromatic aberration on highlights, subtle CRT scan-lines on the screen. "
            "Paper-black room (#0b0b10), warm ink white accents (#f4f1ea). "
            "Background fades to deep black. Octane-render quality, hyper-detailed, cinematic."
        ),
    },
    {
        "filename": "hero-cabinet-v2.png",
        "size": "1536x1024",
        "prompt": (
            "A photorealistic 80s neon-lit arcade cabinet shot from a 3/4 isometric angle in a dark room. "
            "Marquee reads 'LIQUID CLIPS' in bright fuchsia (#ff1a8c) with cyan rim-light (#00e5ff). "
            "A small pixel-art fuchsia Space Invader sprite floats above the marquee like a halo guardian, "
            "glowing softly. Heavy volumetric fog filling the room with fuchsia and cyan light shafts. "
            "The CRT screen shows a silhouetted creator's profile clipping a video, timeline visible. "
            "Cabinet sides edge-lit with neon strips. Floor reflection wet and glossy. "
            "Multi-layer depth: foreground cabinet sharp, midground 6px blur, background 24px blur. "
            "Dust particles drifting, chromatic aberration, subtle CRT scan-lines on the screen. "
            "Paper-black (#0b0b10), warm ink white (#f4f1ea). Cinematic shallow depth-of-field, "
            "octane-render quality, ultra-detailed."
        ),
    },
    {
        "filename": "hero-cabinet-v3.png",
        "size": "1536x1024",
        "prompt": (
            "A photorealistic 80s neon-lit arcade cabinet shot straight-on, centered. "
            "The marquee text reads 'LIQUID/CLIPS' with a forward slash between the words, "
            "in bright fuchsia (#ff1a8c) with cyan rim-light (#00e5ff). "
            "A row of three pixel-art fuchsia Space Invader sprites marches across the top "
            "of the marquee like an arcade attract-mode demo, evenly spaced. "
            "The room around the cabinet is only implied: neon strip lighting on the dark walls "
            "to the left and right, no other detail. The CRT glows with the silhouette of a clip "
            "workspace UI. Smoke at the cabinet base, dust particles drifting in fuchsia beams. "
            "Wet floor reflection. Multi-layer depth: cabinet sharp, walls in 24px blur. "
            "Volumetric fog, chromatic aberration, CRT scan-lines. "
            "Paper-black (#0b0b10), warm ink white (#f4f1ea). Cinematic, octane-render quality."
        ),
    },
    {
        "filename": "hero-cabinet-screen.png",
        "size": "1536x1024",
        "prompt": (
            "Tight close-crop of a CRT arcade-cabinet screen, the curved glass bezel visible "
            "around all edges. Inside the screen: a clip-editing workspace UI rendered in the "
            "style of a retro 80s arcade game. A long horizontal film-strip timeline runs across "
            "the bottom half with frame thumbnails. Above it, a stack of clip cards in fuchsia "
            "(#ff1a8c) and cyan (#00e5ff). Pixel-art HUD elements at the corners. "
            "Heavy CRT scan-lines across the entire screen, slight phosphor bloom, "
            "chromatic aberration at the edges, curvature distortion. "
            "Dark CRT bezel in paper-black (#0b0b10) with warm ink-white (#f4f1ea) labels. "
            "Subtle reflection on the glass. Cinematic, hyper-detailed, photorealistic close-up."
        ),
    },
    {
        "filename": "bg-neon-corridor.png",
        "size": "1024x1536",
        "prompt": (
            "A long neon corridor receding to a single vanishing point, vertical composition. "
            "Fuchsia (#ff1a8c) strip lights run along the floor and ceiling on both sides, "
            "stretching into the distance. Cyan (#00e5ff) tile patterns line the walls, "
            "glowing softly. Mist and fog rolling along the floor. The corridor looks like the "
            "entry hallway to an 80s arcade. Multi-layer depth: foreground walls sharp, "
            "midground 6px blur, far vanishing point 24px blur. "
            "Dust particles in the air, volumetric light beams, chromatic aberration. "
            "Paper-black surfaces (#0b0b10), warm ink-white floor edges (#f4f1ea). "
            "Cinematic shallow depth of field, octane-render quality, atmospheric and moody."
        ),
    },
    {
        "filename": "bg-floor-glow.png",
        "size": "1536x1024",
        "prompt": (
            "A deep black polished floor stretching to the horizon, photographed from a low angle. "
            "Fuchsia (#ff1a8c) floor-glow reflections puddle across the surface like wet neon "
            "spilled on dark tile. Faint cyan (#00e5ff) grid lines recede into the distance "
            "and fade to nothing. Dust particles float low to the ground in volumetric light. "
            "Multi-layer depth: foreground floor sharp with crisp reflections, midground 6px blur, "
            "far distance 24px blur. Chromatic aberration on the highlights. "
            "Paper-black (#0b0b10) dominant, warm ink-white (#f4f1ea) accents. "
            "Cinematic, moody, no horizon line objects, abstract atmospheric floor plate."
        ),
    },
    {
        "filename": "bg-crt-grid-tile.png",
        "size": "1024x1024",
        "prompt": (
            "A seamlessly tileable texture. A precise 32-pixel dark-cyan (#00e5ff at low brightness) "
            "grid drawn on a near-black background (#0b0b10). At every grid intersection, a tiny "
            "fuchsia (#ff1a8c) node-point glows softly. Very faint horizontal CRT scan-lines "
            "overlay the whole texture. Perfectly seamless and repeating, no vignette, no center focus, "
            "even lighting across the whole tile. Flat-on top-down view, no perspective. "
            "Clean, technical, minimal — designed for use as a repeating background tile."
        ),
    },
    {
        "filename": "pattern-scanlines.png",
        "size": "1024x1024",
        "prompt": (
            "A seamlessly tileable pattern of horizontal 1-pixel white scan-lines, "
            "evenly spaced every 2-3 pixels, at low opacity, on a transparent-looking dark background. "
            "Flat, even, no center focus, no vignette. Perfectly horizontal, perfectly straight lines. "
            "Designed as a CSS overlay scan-line texture. Pure black background (#0b0b10) with "
            "warm ink-white (#f4f1ea) scan-lines. Minimal, technical, repeating."
        ),
    },
    {
        "filename": "pattern-dust-particles.png",
        "size": "1024x1024",
        "prompt": (
            "Floating dust and light particles scattered across a deep black background (#0b0b10). "
            "Particles in fuchsia (#ff1a8c) and cyan (#00e5ff), with varying sizes from tiny pinpricks "
            "to small soft orbs with bloom halos. Volumetric and sparse — lots of negative space "
            "between particles. Subtle depth: some particles in sharp focus, others 6px blurred, "
            "others 24px blurred, suggesting depth. No dominant subject, even distribution across "
            "the canvas. Designed as an overlay particle texture. Cinematic, atmospheric, moody."
        ),
    },
    {
        "filename": "noise-grain.png",
        "size": "1024x1024",
        "prompt": (
            "A fine-grain film grain texture, seamlessly tileable, near-monochrome with a very subtle "
            "warm tint pulling toward warm ink-white (#f4f1ea). High frequency noise, no clumping, "
            "even distribution across the whole image. No vignette, no center focus, no patterns — "
            "just pure organic film grain. Designed to overlay at 4% opacity site-wide. "
            "Subtle, technical, even."
        ),
    },
]


def generate(job):
    fname = job["filename"]
    out_path = os.path.join(OUT_DIR, fname)
    payload = {
        "model": "gpt-image-1",
        "prompt": job["prompt"],
        "size": job["size"],
        "quality": "high",
        "output_format": "png",
        "n": 1,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300, context=SSL_CTX) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"X {fname} HTTP {e.code}: {err_body[:500]}", flush=True)
        return False
    except Exception as e:
        print(f"X {fname} ERROR: {e}", flush=True)
        return False

    try:
        b64 = data["data"][0]["b64_json"]
    except (KeyError, IndexError) as e:
        print(f"X {fname} parse error: {e}; payload={json.dumps(data)[:300]}", flush=True)
        return False

    raw = base64.b64decode(b64)
    with open(out_path, "wb") as f:
        f.write(raw)
    print(f"OK {fname} ({len(raw)} bytes)", flush=True)
    return True


def main():
    results = []
    for i, job in enumerate(JOBS, 1):
        print(f"[{i}/{len(JOBS)}] generating {job['filename']} ({job['size']})...", flush=True)
        t0 = time.time()
        ok = generate(job)
        dt = time.time() - t0
        results.append((job["filename"], ok, dt))
        print(f"   ({dt:.1f}s)", flush=True)
        if i < len(JOBS):
            time.sleep(1.5)

    print("\n=== MANIFEST ===", flush=True)
    for name, ok, dt in results:
        status = "OK" if ok else "FAIL"
        path = os.path.join(OUT_DIR, name)
        size = os.path.getsize(path) if os.path.exists(path) else 0
        print(f"{status:4} {name:32} {size:>10} bytes  ({dt:.1f}s)", flush=True)


if __name__ == "__main__":
    main()
