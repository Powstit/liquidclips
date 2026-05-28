#!/usr/bin/env python3
"""
Liquid Clips app-icon generator (temp v0.4.34 design pass).

Produces every PNG size Tauri bundles into the macOS .icns + Windows .ico,
plus standalone PNGs that Tauri references directly.

Design: fuchsia squircle, white inner tile, fuchsia "/" — same brand glyph
as the in-app wordmark (src/components/Logo.tsx). Apple's HIG corner-radius
ratio (~22.37%) is applied so the icon reads as intentional, not a flat
square macOS auto-masks.

Re-run with:  python3 src-tauri/icons/_generate_icons.py
"""
from __future__ import annotations

import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# --- Brand tokens (mirror src/index.css) ---------------------------------
FUCHSIA = (0xFF, 0x1A, 0x8C, 255)   # --color-fuchsia
WHITE   = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

# --- Geometry ratios (constant across sizes) -----------------------------
SQUIRCLE_RADIUS_RATIO = 0.2237   # Apple HIG squircle
TILE_SIZE_RATIO       = 0.48     # inner white tile, 48% of icon side
TILE_RADIUS_RATIO     = 0.18     # tile corners, 18% of tile side
SLASH_THICKNESS_RATIO = 0.16     # slash thickness, 16% of tile side
SLASH_MARGIN_RATIO    = 0.18     # margin from tile edge to slash endpoints


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Outer fuchsia squircle (full bleed)
    r_outer = int(size * SQUIRCLE_RADIUS_RATIO)
    draw.rounded_rectangle((0, 0, size, size), radius=r_outer, fill=FUCHSIA)

    # Centered white tile
    tile = int(size * TILE_SIZE_RATIO)
    tile_x = (size - tile) // 2
    tile_y = (size - tile) // 2
    r_tile = max(1, int(tile * TILE_RADIUS_RATIO))
    draw.rounded_rectangle(
        (tile_x, tile_y, tile_x + tile, tile_y + tile),
        radius=r_tile, fill=WHITE,
    )

    # Slash: parallelogram from bottom-left to top-right of the tile
    margin = int(tile * SLASH_MARGIN_RATIO)
    thickness = max(2, int(tile * SLASH_THICKNESS_RATIO))
    span = tile - 2 * margin
    # Direction unit vector along the slash (bottom-left → top-right):
    # dx_dir, dy_dir for a 45°-ish line; using actual atan2 keeps the slope
    # equal to a forward slash drawn corner-to-corner of the inner area.
    angle = math.atan2(-span, span)  # negative dy = upward
    # Perpendicular offset (half-thickness) for the parallelogram sides
    px = (thickness / 2) * math.cos(angle + math.pi / 2)
    py = (thickness / 2) * math.sin(angle + math.pi / 2)
    bl = (tile_x + margin, tile_y + tile - margin)              # bottom-left
    tr = (tile_x + tile - margin, tile_y + margin)              # top-right
    p1 = (bl[0] - px, bl[1] - py)
    p2 = (bl[0] + px, bl[1] + py)
    p3 = (tr[0] + px, tr[1] + py)
    p4 = (tr[0] - px, tr[1] - py)
    draw.polygon([p1, p2, p3, p4], fill=FUCHSIA)

    return img


def main() -> None:
    icons_dir = Path(__file__).resolve().parent
    print(f"Writing icons into {icons_dir}/")

    # Tauri-referenced PNGs (per tauri.conf.json bundle.icon)
    standalone = {
        "32x32.png":         32,
        "64x64.png":         64,
        "128x128.png":       128,
        "128x128@2x.png":    256,
        "icon.png":          1024,
        "app-icon.png":      1024,
    }
    masters = {}
    for name, size in standalone.items():
        img = render(size)
        out = icons_dir / name
        img.save(out, "PNG", optimize=True)
        masters[size] = img
        print(f"  {name}  ({size}×{size})")

    # ----- macOS .icns via iconutil + .iconset folder --------------------
    iconset_dir = icons_dir / "icon.iconset"
    if iconset_dir.exists():
        shutil.rmtree(iconset_dir)
    iconset_dir.mkdir()
    icns_sizes = [
        ("icon_16x16.png",       16),
        ("icon_16x16@2x.png",    32),
        ("icon_32x32.png",       32),
        ("icon_32x32@2x.png",    64),
        ("icon_128x128.png",     128),
        ("icon_128x128@2x.png",  256),
        ("icon_256x256.png",     256),
        ("icon_256x256@2x.png",  512),
        ("icon_512x512.png",     512),
        ("icon_512x512@2x.png",  1024),
    ]
    for name, size in icns_sizes:
        render(size).save(iconset_dir / name, "PNG", optimize=True)
    icns_out = icons_dir / "icon.icns"
    res = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(icns_out)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        sys.exit(f"iconutil failed: {res.stderr}")
    shutil.rmtree(iconset_dir)
    print(f"  icon.icns ({icns_out.stat().st_size // 1024} KB)")

    # ----- Windows .ico (multi-size, Pillow handles bundling) ------------
    # Windows .ico — Pillow only honors multi-size via `sizes=` (it downscales
    # from the base image). `append_images` is silently ignored for ICO. We
    # feed it a 256-square master so Pillow's downscale stays crisp.
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_out = icons_dir / "icon.ico"
    render(256).save(ico_out, format="ICO", sizes=ico_sizes)
    print(f"  icon.ico  ({ico_out.stat().st_size // 1024} KB)")

    # ----- Windows Store tiles (used by Tauri MSI bundler) ---------------
    store_tiles = {
        "Square30x30Logo.png":   30,
        "Square44x44Logo.png":   44,
        "Square71x71Logo.png":   71,
        "Square89x89Logo.png":   89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png":         50,
    }
    for name, size in store_tiles.items():
        render(size).save(icons_dir / name, "PNG", optimize=True)
    print(f"  + {len(store_tiles)} Windows Store tiles")

    print("Done.")


if __name__ == "__main__":
    main()
