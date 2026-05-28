#!/usr/bin/env python3
"""
Rasterize Tauri's full icon set from a single 1024x1024 master PNG.

Replaces what _generate_icons.py does procedurally, but uses a gpt-image-1
master (per the Catjack asset pipeline rule: every raster icon comes from
gpt-image-1, not procedural). Pillow handles all downscaling with LANCZOS
which is the right call for icon work.

Run:  python3 src-tauri/icons/_rasterize-icons.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

SOURCE = Path(__file__).resolve().parent / "_icon-source.png"


def load_master() -> Image.Image:
    if not SOURCE.exists():
        sys.exit(f"Master image missing: {SOURCE}. Re-run gpt-image-1 first.")
    im = Image.open(SOURCE).convert("RGBA")
    if im.size != (1024, 1024):
        # Force-resize to 1024x1024 in case gpt-image-1 returned a different size.
        im = im.resize((1024, 1024), Image.LANCZOS)
    return im


def main() -> None:
    icons_dir = Path(__file__).resolve().parent
    master = load_master()
    print(f"Master: {SOURCE.name} {master.size}")

    standalone = {
        "32x32.png":       32,
        "64x64.png":       64,
        "128x128.png":     128,
        "128x128@2x.png":  256,
        "icon.png":        1024,
        "app-icon.png":    1024,
    }
    for name, size in standalone.items():
        out = icons_dir / name
        master.resize((size, size), Image.LANCZOS).save(out, "PNG", optimize=True)
        print(f"  {name}  ({size}x{size})")

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
        master.resize((size, size), Image.LANCZOS).save(iconset_dir / name, "PNG", optimize=True)
    icns_out = icons_dir / "icon.icns"
    res = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(icns_out)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        sys.exit(f"iconutil failed: {res.stderr}")
    shutil.rmtree(iconset_dir)
    print(f"  icon.icns ({icns_out.stat().st_size // 1024} KB, 10 sizes embedded)")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_out = icons_dir / "icon.ico"
    master.resize((256, 256), Image.LANCZOS).save(ico_out, format="ICO", sizes=ico_sizes)
    print(f"  icon.ico  ({ico_out.stat().st_size // 1024} KB, 7 sizes embedded)")

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
        master.resize((size, size), Image.LANCZOS).save(icons_dir / name, "PNG", optimize=True)
    print(f"  + {len(store_tiles)} Windows Store tiles")
    print("Done.")


if __name__ == "__main__":
    main()
