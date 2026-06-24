# App Icons Handoff

## Source
`/Users/dipdip/Desktop/Liquid_Clips_2_Starter_Kit/01_BRAND_KIT/app-icons/`

## Target (when ready to ship)
`/Users/dipdip/code/jnr/desktop-2/src-tauri/icons/`

## Contents
The source folder contains the full Tauri-compatible icon bundle:
- macOS: `icon.icns`
- Windows: `icon.ico`, `Square*.png`, `StoreLogo.png`
- Linux: `128x128.png`, `128x128@2x.png`, `32x32.png`, etc.
- iOS: `ios/`
- Android: `android/`
- Source raster: `icon.png`, `app-icon.png`, `_icon-source.png`
- Helper scripts: `_generate_icons.py`, `_rasterize-icons.py`

## Action
Copying these files into `src-tauri/icons/` is safe and non-disruptive to the
React/Vite source. It only replaces binary bundle assets consumed by Tauri at
build time.

## Recommendation
Do this as a **separate commit** from the brand-asset sync so the binary diff is
isolated and easy to review/rollback.
