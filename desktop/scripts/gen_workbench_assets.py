"""Generate the 12 workbench assets via gpt-image-1.

Per Catjack pipeline rule: gpt-image-1 only, NOT DALL-E. All assets target
the Liquid Clips brand: fuchsia #FF1A8C, ink #0B0B10, paper #F4F1EA, sharp
pixel-art arcade aesthetic, cockpit-tile HUD corners.

Run:
  source ~/.claude-credentials/openai.env
  python3 desktop/scripts/gen_workbench_assets.py

Files write to desktop/src/assets/workbench/. Idempotent — skips assets
that already exist; pass `--force` to regenerate.
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

import httpx

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "workbench"

BRAND = "Fuchsia #FF1A8C, ink #0B0B10, paper #F4F1EA. Pixel-art arcade aesthetic, sharp 1px edges, transparent background, no shading, no gradient unless specified."

ASSETS: list[tuple[str, str]] = [
    (
        "mode-toggle-grid.png",
        "3x3 grid of glowing fuchsia squares (cockpit HUD radar tile), neon fuchsia outlines on warm paper squares, looks like a Galaga radar mini-map. "
        + BRAND,
    ),
    (
        "mode-toggle-workbench.png",
        "Cockpit HUD icon of four asymmetric rectangular panes — one wide left, three stacked right — fuchsia neon outlines on paper, two panes containing tiny tick checkmarks. Reads as a Logic Pro mixer mini-map. "
        + BRAND,
    ),
    (
        "window-chrome-tick-empty.png",
        "Tiny square neon outline checkbox, fuchsia 1px outline, empty interior. Arcade UI vibe. "
        + BRAND,
    ),
    (
        "window-chrome-tick-filled.png",
        "Tiny square fuchsia solid fill with a single bright white pixel-art checkmark inside, faint neon glow halo. Arcade UI. "
        + BRAND,
    ),
    (
        "master-action-fan.png",
        "Central fuchsia square with 4 arrows fanning outward to four smaller corner squares, neon outline, 90s arcade radar aesthetic, glow halo. "
        + BRAND,
    ),
    (
        "master-action-broadcast.png",
        "Broadcast-tower icon: three concentric arcs in fuchsia neon radiating from a small ink square base. Cockpit HUD vibe. "
        + BRAND,
    ),
    (
        "window-empty-bind.png",
        "A small ink-coloured silhouette icon of a person, surrounded by a dashed fuchsia neon ring with a glowing plus sign at the top-right. Cockpit empty-state glyph. "
        + BRAND,
    ),
    (
        "workbench-canvas-empty.png",
        "Subtle blueprint grid pattern: faint fuchsia 1px gridlines on dark ink, cockpit HUD corner brackets at the four corners. No text, no logo. Tileable. "
        + BRAND,
    ),
    (
        "onboarding-arrow.png",
        "Hand-drawn dashed fuchsia neon arrow curving from top-left to bottom-right, glowing slightly. Arcade UI vibe, no text. "
        + BRAND,
    ),
    (
        "pool-indicator-active.png",
        "Single bright fuchsia dot with strong glow halo, perfectly round. Cockpit LED indicator. "
        + BRAND,
    ),
    (
        "pool-indicator-poster.png",
        "Single hollow ink circle outline (1px), no fill. Inactive cockpit LED. "
        + BRAND,
    ),
    (
        "add-window-tile.png",
        "Dashed-line fuchsia neon square outline with a large centered + sign in fuchsia, on warm paper, cockpit corner brackets at the four corners. Like an arcade slot waiting for a coin. "
        + BRAND,
    ),
]


def gen_one(client: httpx.Client, filename: str, prompt: str, force: bool) -> str:
    out_path = OUT_DIR / filename
    if out_path.exists() and not force:
        return f"skip (exists): {filename}"
    body = {
        "model": "gpt-image-1",
        "prompt": prompt,
        "size": "1024x1024",
        "n": 1,
    }
    r = client.post("/images/generations", json=body, timeout=180.0)
    if r.status_code >= 400:
        return f"FAIL {filename}: HTTP {r.status_code} {r.text[:200]}"
    data = r.json()
    if not data.get("data") or not data["data"][0].get("b64_json"):
        return f"FAIL {filename}: no b64_json in response"
    png_bytes = base64.b64decode(data["data"][0]["b64_json"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(png_bytes)
    return f"ok: {filename} ({len(png_bytes) // 1024} KB)"


def main() -> int:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        print(
            "OPENAI_API_KEY missing — source ~/.claude-credentials/openai.env first",
            file=sys.stderr,
        )
        return 2
    force = "--force" in sys.argv
    client = httpx.Client(
        base_url="https://api.openai.com/v1",
        headers={"Authorization": f"Bearer {key}"},
    )
    print(f"target dir: {OUT_DIR}")
    for filename, prompt in ASSETS:
        result = gen_one(client, filename, prompt, force)
        print(result, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
