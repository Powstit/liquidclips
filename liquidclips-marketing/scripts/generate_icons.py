#!/usr/bin/env python3
"""Generate Liquid Clips iconography set via OpenAI gpt-image-1."""
import os, json, base64, urllib.request, urllib.error, re, ssl


def _build_ssl_context():
    # Try certifi first
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
        return ctx
    except Exception:
        pass
    # macOS system bundle
    for p in ("/etc/ssl/cert.pem", "/usr/local/etc/openssl@3/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem"):
        if os.path.exists(p):
            try:
                return ssl.create_default_context(cafile=p)
            except Exception:
                continue
    return ssl.create_default_context()


SSL_CTX = _build_ssl_context()


def _load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # support: export KEY=VAL   and   KEY=VAL   and quoted values
            m = re.match(r'^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line)
            if not m:
                continue
            k, v = m.group(1), m.group(2).strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            os.environ.setdefault(k, v)


_load_env_file(os.path.expanduser("~/.claude-credentials/openai.env"))

api_key = os.environ["OPENAI_API_KEY"]
OUT = "/Users/dipdip/Desktop/jnr/liquidclips-marketing/public/icons"
os.makedirs(OUT, exist_ok=True)

BRAND = ("Liquid Clips 80s arcade-game-company brand. Strict palette: fuchsia #ff1a8c, "
         "cyan #00e5ff, paper black #0b0b10, ink warm-white #f4f1ea. Consistent rim-light "
         "from upper-left in fuchsia, fill from lower-right in cyan. Subtle CRT scanlines. "
         "Transparent background, centred, generous padding.")

ISO = (BRAND + " Isometric 3D perspective at true 30/60/90 degrees. Identical stroke weight "
              "across the set. Same vanishing point. Neon glow bloom. Crisp clean rendering at 1024px.")

PIX = (BRAND + " Pixel-art arcade-cabinet aesthetic, chunky pixels, CRT scanlines, neon glow. "
              "Retro 80s arcade game sprite style. Transparent background.")

COIN = (BRAND + " Round 3D-rendered arcade pickup coin, embossed details, fuchsia and cyan rim "
               "light, glowing neon edge, transparent background, centred composition.")

JOBS = [
    ("pillar-drop.png", ISO + " A glowing fuchsia film-strip with sprocket holes falling and dropping downward into an open cyan portal box. The film-strip is mid-fall, slight tilt, motion lines. Isometric 3D glyph. Single hero object on transparent BG."),
    ("pillar-clip.png", ISO + " Neon fuchsia 3D scissors cutting diagonally through a cyan film-strip. Sparks of light at the cut point. Isometric 3D glyph. Single hero object on transparent BG."),
    ("pillar-reframe.png", ISO + " An isometric smartphone in portrait orientation showing a 9:16 video clip on screen. Neon fuchsia and cyan corner-bracket reframe handles at the four corners of the clip. Subtle resize indicators. Isometric 3D glyph. Single hero object on transparent BG."),
    ("pillar-caption.png", ISO + " A 3D isometric speech-bubble shape filled with neon horizontal text bars / caption lines in alternating fuchsia and cyan. Bottom tail of the bubble points down-left. Isometric 3D glyph. Single hero object on transparent BG."),
    ("pillar-publish.png", ISO + " A film-strip launching upward like a rocket with a long neon trail of fuchsia and cyan flame underneath. Strip curls slightly. Isometric 3D glyph. Single hero object on transparent BG."),
    ("pillar-earn.png", ISO + " A neat stack of three glowing 3D arcade coins, fuchsia and cyan rim, the top coin has a chunky embossed dollar sign $ glyph. Isometric 3D glyph. Single hero object on transparent BG."),
    ("platform-tiktok.png", PIX + " Pixel-art musical eighth-note sprite dancing inside a CRT arcade-cabinet screen with a thick fuchsia-and-cyan neon border. Chunky pixels, retro arcade vibe. Single icon, centred, transparent BG. Do NOT reproduce the real TikTok logo."),
    ("platform-reels.png", PIX + " Pixel-art film-reel sprite spinning inside an arcade-cabinet CRT screen with fuchsia-and-cyan neon border. Chunky pixels, retro arcade vibe. Single icon, centred, transparent BG. Do NOT reproduce the real Instagram Reels logo."),
    ("platform-shorts.png", PIX + " Pixel-art lightning-bolt sprite glowing inside a CRT arcade-cabinet screen with fuchsia-and-cyan neon border. Chunky pixels, retro arcade vibe. Single icon, centred, transparent BG. Do NOT reproduce the real YouTube Shorts logo."),
    ("platform-x.png", PIX + " Pixel-art capital letter X glyph with thick neon fuchsia and cyan glow inside an arcade-cabinet CRT screen frame. Chunky pixels, retro arcade vibe. Single icon, centred, transparent BG. Do NOT reproduce the real X / Twitter logo."),
    ("platform-youtube.png", PIX + " Pixel-art retro CRT television set with a chunky play-arrow sprite on the screen, fuchsia and cyan neon rim. Antenna on top. Chunky pixels, retro arcade vibe. Single icon, centred, transparent BG. Do NOT reproduce the real YouTube logo."),
    ("platform-whop.png", PIX + " Pixel-art treasure chest sprite open and spilling glowing arcade coins, fuchsia and cyan neon rim around the chest. Chunky pixels, retro arcade vibe. Single icon, centred, transparent BG."),
    ("achievement-100-clips.png", COIN + " Front-facing round arcade coin with the chunky embossed pixel-digit number '100' large in the centre. The words 'FREE CLIPS' embossed in pixel-style lettering curving around the upper edge of the coin. Fuchsia and cyan neon glow."),
    ("achievement-notarized.png", COIN + " Front-facing round arcade coin with a clean embossed Apple-style checkmark glyph in the centre. The word 'NOTARIZED' embossed in pixel-style lettering curving around the edge. Fuchsia and cyan neon glow."),
    ("achievement-local.png", COIN + " Front-facing round arcade coin with a tiny pixel-art laptop/computer glyph embossed in the centre. The words 'LOCAL-FIRST' embossed in pixel-style lettering curving around the edge. Fuchsia and cyan neon glow."),
]


def gen(prompt, out_path):
    body = json.dumps({
        "model": "gpt-image-1",
        "prompt": prompt,
        "size": "1024x1024",
        "quality": "high",
        "output_format": "png",
        "background": "transparent",
        "n": 1,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300, context=SSL_CTX) as r:
        payload = json.loads(r.read().decode("utf-8"))
    raw = base64.b64decode(payload["data"][0]["b64_json"])
    with open(out_path, "wb") as f:
        f.write(raw)
    return len(raw)


if __name__ == "__main__":
    N = len(JOBS)
    results = []
    for i, (fname, prompt) in enumerate(JOBS, 1):
        out = os.path.join(OUT, fname)
        print(f"[{i}/{N}] generating {fname} ...", flush=True)
        try:
            n = gen(prompt, out)
            print(f"OK {fname} ({n} bytes)", flush=True)
            results.append((fname, "ok", n))
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")[:500]
            print(f"FAIL {fname} HTTP {e.code} {err}", flush=True)
            results.append((fname, "http_error", f"{e.code} {err}"))
        except Exception as e:
            print(f"FAIL {fname} {e!r}", flush=True)
            results.append((fname, "error", repr(e)))

    print("\n=== MANIFEST ===", flush=True)
    for fname, status, info in results:
        print(f"{status:10} {fname:35} {info}")
