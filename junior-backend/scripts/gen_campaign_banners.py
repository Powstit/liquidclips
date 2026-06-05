#!/usr/bin/env python3
"""
Generate sponsored campaign banners for the Liquid Clips Earn carousel.

Layout — 1200×300 (4:1 per memory `liquid_clips_sponsored_rewards.md`):

    [Logo + Wordmark]   [Brand · $X RPM · Budget]   [Kade portrait]
     left third             middle third              right third

Inputs:
- Liquid Clips logo + wordmark   ../desktop/src/assets/brand/glyph.png
                                  or assets-wip/brand-logo/liquidclips-spaceinvader-v1.png
- Kade portrait                  assets-wip/character/hero-character-LOCKED.png
                                  (auto-cropped centre-right so torso fills the band)

Run from repo root:
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \\
      junior-backend/scripts/gen_campaign_banners.py
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ─── Paths ──────────────────────────────────────────────────────────────────

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "junior-backend/app/static/campaigns"
OUT.mkdir(parents=True, exist_ok=True)

LOGO_PATH = REPO / "desktop/src/assets/brand/wordmark-nav-v1.png"
LOGO_INVADER_PATH = REPO / "assets-wip/brand-logo/liquidclips-spaceinvader-v1.png"
KADE_PATH = REPO / "assets-wip/character/hero-character-LOCKED.png"

# ─── Brand palette ──────────────────────────────────────────────────────────

PAPER = (11, 11, 16, 255)         # near-black
INK = (244, 241, 234, 255)        # cream
FUCHSIA = (255, 26, 140, 255)
FUCHSIA_DEEP = (199, 0, 102, 255)
TEXT_TERTIARY = (138, 133, 126, 255)

# ─── Dimensions ─────────────────────────────────────────────────────────────

W, H = 1200, 300
LEFT_W = 360       # logo area
RIGHT_W = 340      # Kade area
MIDDLE_W = W - LEFT_W - RIGHT_W  # 500

# ─── Campaigns (live API: api.jnremployee.com/campaigns) ───────────────────
# Skipping liquid-clips-affiliate — it uses an mp4 banner, not a PNG.

CAMPAIGNS = [
    # slug,              brand label,                   subtitle,                         rpm, budget_$, tone
    ("ddb",              "Daniel Diyepriye Beauty",     "Skincare · UK · Recurring",       9,  50_000, "live"),
    ("liquid-lift",      "Liquid Lift",                 "Shopify overlay · Recurring",     9,  50_000, "live"),
    ("influencer",       "Influencer Launch",           "14 days · Open to all paid tiers",5,  15_000, "live"),
    ("music",            "Music Creators",              "Indie label partnerships",        6,  20_000, "soon"),
    ("fashion",          "Fashion Editorial",           "Designer brand campaigns",       12,  40_000, "soon"),
    ("lifestyle",        "Lifestyle Briefs",            "Creator economy bonuses",         5,  15_000, "soon"),
]

# ─── Fonts ──────────────────────────────────────────────────────────────────

def load_font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    """Helvetica Neue at the requested weight. Falls back to default if missing."""
    candidates = [
        ("/System/Library/Fonts/HelveticaNeue.ttc", 0 if weight == "regular" else (3 if weight == "bold" else 0)),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
    ]
    for path, idx in candidates:
        try:
            return ImageFont.truetype(path, size=size, index=idx)
        except Exception:
            continue
    return ImageFont.load_default()


F_BRAND = load_font(34, "bold")
F_RPM = load_font(56, "bold")
F_BUDGET = load_font(15)
F_SUBTITLE = load_font(13)
F_EYEBROW = load_font(11)

# ─── Helpers ────────────────────────────────────────────────────────────────


def draw_text_with_shadow(draw, xy, text, font, fill, shadow=(0, 0, 0, 120), offset=(0, 2)):
    """Soft drop-shadow so text floats over the painted backdrop."""
    sx, sy = offset
    draw.text((xy[0] + sx, xy[1] + sy), text, font=font, fill=shadow)
    draw.text(xy, text, font=font, fill=fill)


def round_corners(im: Image.Image, radius: int) -> Image.Image:
    """Round the corners of `im` (RGBA) with `radius` px."""
    mask = Image.new("L", im.size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, im.size[0], im.size[1]), radius=radius, fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out


def fit_logo(logo: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """Resize the logo so the longer edge fits while preserving aspect."""
    w, h = logo.size
    scale = min(max_w / w, max_h / h)
    return logo.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def crop_kade(src: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Crop the Kade portrait so his face/torso fills the right band of the banner."""
    sw, sh = src.size
    target_aspect = target_w / target_h
    src_aspect = sw / sh
    if src_aspect > target_aspect:
        # source is wider — crop sides, keep full height. Bias toward left half
        # because the painted hero portrait has Kade on the left side of the canvas.
        new_w = int(sh * target_aspect)
        left = max(0, int(sw * 0.08))
        cropped = src.crop((left, 0, left + new_w, sh))
    else:
        # source is taller — crop top/bottom, keep full width. Bias toward upper third.
        new_h = int(sw / target_aspect)
        top = max(0, int(sh * 0.10))
        cropped = src.crop((0, top, sw, top + new_h))
    return cropped.resize((target_w, target_h), Image.LANCZOS)


# ─── Backdrop builders ──────────────────────────────────────────────────────


def make_backdrop() -> Image.Image:
    """Dark paper + soft fuchsia glow on the right band where Kade lands."""
    canvas = Image.new("RGBA", (W, H), PAPER)

    # Subtle fuchsia hex-grid backdrop on the right — soft, low alpha
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    # Big soft fuchsia radial behind where Kade sits
    cx, cy = W - RIGHT_W // 2, H // 2
    for r, alpha in [(220, 50), (160, 90), (110, 130), (70, 170)]:
        g.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 26, 140, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=42))
    canvas = Image.alpha_composite(canvas, glow)

    # Thin fuchsia top + bottom rule
    line = ImageDraw.Draw(canvas)
    line.rectangle((0, 0, W, 2), fill=FUCHSIA)
    line.rectangle((0, H - 2, W, H), fill=FUCHSIA)

    return canvas


def place_logo(canvas: Image.Image) -> None:
    """Liquid Clips wordmark + space-invader bug on the left."""
    # Prefer the combined wordmark; if missing fall back to the invader-only.
    p = LOGO_PATH if LOGO_PATH.exists() else LOGO_INVADER_PATH
    if not p.exists():
        return
    logo = Image.open(p).convert("RGBA")
    logo = fit_logo(logo, max_w=LEFT_W - 60, max_h=H - 80)
    # Vertically centre, left-padded 30
    x = 36
    y = (H - logo.height) // 2
    canvas.alpha_composite(logo, (x, y))


def place_kade(canvas: Image.Image) -> None:
    """Painted Kade portrait, cropped to the right band, soft fuchsia bevel."""
    if not KADE_PATH.exists():
        return
    src = Image.open(KADE_PATH).convert("RGBA")
    kade = crop_kade(src, RIGHT_W - 10, H - 16)
    kade = round_corners(kade, radius=18)

    # Soft fuchsia outer glow behind Kade
    glow = Image.new("RGBA", (kade.size[0] + 60, kade.size[1] + 60), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.rounded_rectangle((10, 10, glow.size[0] - 10, glow.size[1] - 10),
                        radius=24, fill=(255, 26, 140, 110))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=22))

    x = W - RIGHT_W
    y = (H - kade.height) // 2
    canvas.alpha_composite(glow, (x - 30, y - 30))
    canvas.alpha_composite(kade, (x, y))


def place_copy(canvas: Image.Image, brand: str, subtitle: str, rpm: int, budget_k: int, tone: str) -> None:
    """Brand name + big $X RPM + budget + status pill in the middle band."""
    draw = ImageDraw.Draw(canvas)

    x0 = LEFT_W + 24
    y = 60

    # status pill (top)
    status_text = "LIVE" if tone == "live" else "COMING SOON"
    status_fill = FUCHSIA if tone == "live" else (40, 40, 50, 255)
    pill_w = draw.textlength(status_text, font=F_EYEBROW)
    draw.rounded_rectangle((x0, y - 24, x0 + pill_w + 18, y - 24 + 22),
                           radius=11, fill=status_fill)
    draw.text((x0 + 9, y - 22), status_text, font=F_EYEBROW,
              fill=INK if tone == "live" else TEXT_TERTIARY)

    # brand name
    draw_text_with_shadow(draw, (x0, y), brand, F_BRAND, INK)
    y += 46

    # big RPM
    rpm_text = f"${rpm} RPM"
    draw_text_with_shadow(draw, (x0, y), rpm_text, F_RPM, FUCHSIA, shadow=(0, 0, 0, 160), offset=(0, 3))
    # measure for inline budget
    rpm_w = draw.textlength(rpm_text, font=F_RPM)

    # budget inline to the right of RPM
    budget_text = f"  ·  ${budget_k:,} pool"
    draw.text((x0 + rpm_w, y + 22), budget_text, font=F_BUDGET, fill=TEXT_TERTIARY)
    y += 70

    # subtitle
    draw.text((x0, y), subtitle, font=F_SUBTITLE, fill=INK)


# ─── Builder ────────────────────────────────────────────────────────────────


def build(slug: str, brand: str, subtitle: str, rpm: int, budget_k: int, tone: str) -> Path:
    canvas = make_backdrop()
    place_logo(canvas)
    place_kade(canvas)
    place_copy(canvas, brand, subtitle, rpm, budget_k, tone)
    out = OUT / f"{slug}.png"
    canvas.convert("RGB").save(out, format="PNG", optimize=True)
    return out


def main() -> None:
    print(f"Output dir: {OUT}")
    print(f"Logo:       {LOGO_PATH if LOGO_PATH.exists() else LOGO_INVADER_PATH}")
    print(f"Kade:       {KADE_PATH}")
    print(f"Banner WxH: {W}x{H} (4:1, per sponsored-rewards spec)")
    print()
    for slug, brand, subtitle, rpm, budget_k, tone in CAMPAIGNS:
        p = build(slug, brand, subtitle, rpm, budget_k, tone)
        kb = p.stat().st_size // 1024
        print(f"  ✓ {slug:<14}  ${rpm} RPM  ·  {kb} KB  ·  {tone}")


if __name__ == "__main__":
    main()
