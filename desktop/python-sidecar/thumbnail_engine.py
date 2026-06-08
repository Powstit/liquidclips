"""
thumbnail_engine.py — character-consistent thumbnail engine (Python port).

This is the ENGINE ONLY — the IP. Ported 1:1 from the proven production
generator (gennext.js): the EMO expression rotation + PAT stop-power layouts +
two-world / in-scene / vary-the-pose / anti-AI-glossy formula are the click
drivers and live here as constants. Identity comes from reference images, never
from words (re-describing a face makes it drift).

NO CLI, wizard, display server, batch loop, or config-file loader — the host app
owns all of that. One public function: `generate()`.

Stdlib only (urllib) — no third-party dependencies.

    from thumbnail_engine import generate, CancelledError, BillingLimitError

    result = generate(
        item={"text": "RENT OR OWN?", "metaphor": "a key vs a chain",
              "accent": "blue", "order": 1},
        output_path=Path("out/01_rent_or_own.png"),
        config={"brand": "Uncle Daniel",
                "identity": "bald head, full beard, strong muscular broad build",
                "wardrobe": "a black t-shirt with a white logo",
                "references_dir": "references"},
        cancel_marker=Path("out/.cancel"),     # optional
        prop=None,                              # optional; or prop_for(index)
    )
    # -> {"output_path", "cost_usd", "model", "completed_at", "prompt_used"}
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ── exceptions ───────────────────────────────────────────────────────────────
class CancelledError(Exception):
    """Raised when the cancel_marker file exists (host requested cancellation)."""


class BillingLimitError(Exception):
    """Raised when OpenAI returns billing_hard_limit — stop the queue cleanly."""


# ── defaults (host app normally overrides via `config`) ───────────────────────
DEFAULT_CONFIG = {
    "brand": "the character",
    # the distinctive, consistent look to lock (the only physical-identity words):
    "identity": "their distinct, consistent facial features and build",
    "wardrobe": "",                       # e.g. "a black t-shirt with a white logo"; "" = none
    "model": "gpt-image-2",               # see NOTE on model name below
    "size": "1536x1024",
    "quality": "medium",                  # low | medium | high
    "references_dir": "references",       # folder of face crops = identity lock
    "api_key": None,                      # explicit key wins
    "api_key_file": "~/.openai_key",      # else read from here, else env OPENAI_API_KEY
    "accents": {
        "orange": "orange", "yellow_gold": "yellow/gold", "green": "green",
        "teal_cyan": "teal/cyan", "blue": "blue", "purple_violet": "purple/violet",
        "pink_magenta": "pink/magenta", "red": "red",
    },
}

# NOTE on model: the production generator uses "gpt-image-2" and it works on the
# owner's account (224 thumbnails shipped). OpenAI's *public* docs name the image
# model "gpt-image-1". If your account 404s on gpt-image-2, pass
# config={"model": "gpt-image-1"}. The request shape is identical either way.

# rough $/image by quality (for the host's cost ledger). Tune to your billing.
COST_USD = {"low": 0.05, "medium": 0.07, "high": 0.20}


# ── THE FORMULA (fixed IP — ported verbatim from gennext.js) ──────────────────
# EMO: rotate a dramatic expression on every thumbnail (the CTR driver).
EMO = [
    "eyes wide in genuine shock, eyebrows raised",
    "a knowing smug smirk, one eyebrow raised",
    "jaw dropped in disbelief",
    "leaning in toward the camera, intense and gripped",
    "pointing directly at the viewer, calling them out",
    "calm and analytical, quietly certain",
    "mouth open mid 'wait, what?', caught off guard",
    "a slow confident grin, in on the secret",
]
# PAT: rotate a stop-power layout treatment. {BRAND} is substituted at build time.
PAT = [
    "TIGHT CLOSE-UP: {BRAND}'s face fills about 40% of the frame, the key metaphor object large in the foreground.",
    "BIG STAT: a single huge bold number or stat from the topic dominates one side as the focal point (still ONE accent colour).",
    "VS SPLIT: a clean split composition - the old/wrong world on one side with a subtle red-X feel, the smart/hidden world on the other, {BRAND} at the seam.",
    "CURIOSITY REVEAL: {BRAND}'s hand lifting a curtain or cracking a surface to reveal the hidden world behind the obvious one.",
    "FUN-WORLD OBJECT: anchor the metaphor on a recognizable playful game/arcade-style object (generic, no trademarks or logos).",
]
# PROPS: playful personality props, host applies to ~1 in 7 (see prop_for()).
PROPS = [
    "wearing sleek dark sunglasses (cool, unbothered energy)",
    "holding a detective's magnifying glass up, investigating the hidden truth",
    "wearing a tiny crown tilted with a knowing smirk",
    "peering skeptically over reading glasses pulled down the nose",
]


def prop_for(index: int) -> Optional[str]:
    """The production rotation: a prop on every 7th item, else None.

    `index` is the host's running 0-based counter across the batch.
    Pass the return value to generate(prop=...). Host may ignore and pass None.
    """
    if index % 7 == 6:
        return PROPS[(index // 7) % len(PROPS)]
    return None


def build_prompt(config: dict, item: dict, prop: Optional[str] = None) -> str:
    """Compose the full image prompt. Pure function — no I/O. This is the IP.

    item keys: text (required), metaphor (defaults to text), accent, order (1-based).
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    brand = cfg.get("brand") or "the character"
    accents = cfg.get("accents") or {}
    accent_word = accents.get(item.get("accent")) or item.get("accent") or ""
    i = (item.get("order") or 1) - 1
    emo = EMO[i % len(EMO)]
    pat = PAT[i % len(PAT)].replace("{BRAND}", brand)
    wardrobe = (", " + cfg["wardrobe"]) if cfg.get("wardrobe") else ""
    identity = cfg.get("identity") or DEFAULT_CONFIG["identity"]
    metaphor = item.get("metaphor") or item.get("text", "")
    text = item.get("text", "")

    p = (
        f"Use the attached image(s) as the EXACT fixed identity of the recurring character {brand} "
        f"- same face, skin tone, {identity}, eyes, nose, lips, jaw{wardrobe}. "
        f"{brand}'s EXPRESSION for this thumbnail: {emo} (big, genuine emotion - this is the click driver). "
        "Do NOT create a different person, no slimmer/older/younger/AI-glossy. "
        "Ultra-realistic cinematic photoreal YouTube thumbnail, premium founder-documentary look. "
        f"{brand} is INSIDE the scene as the protagonist - hands physically interacting with the key "
        "metaphor object, embedded in a real 3D environment with strong foreground depth, camera at eye "
        "level, face reacting. LIVING the metaphor, NOT standing beside a flat split-screen explaining it. "
        "The HAND GESTURE and body reaction MUST change to match THIS metaphor's emotion - vary it, never "
        "repeat a pose. "
        f"Visual metaphor: {metaphor}. "
    )
    if accent_word:
        p += (f"Accent colour {accent_word} used ONLY on the key word, glow, arrow, underline or "
              "metaphor object. ")
    p += (
        "Bright premium cinematic exposure, high contrast, one clear symbolic metaphor, no clutter. "
        f"Show a COLLISION OF TWO WORLDS: the normal/visible world vs the hidden/smarter world, with "
        f"{brand} at the tension point. "
        f"STOP-POWER TREATMENT: {pat} "
        f'Bold readable thumbnail text only: "{text}" (2-4 words). '
        "The on-image text uses a HEAVY BOLD CONDENSED ALL-CAPS sans-serif display font (Anton / Druk "
        "Wide Bold style): very thick strokes, tight spacing, slightly squared, premium modern YouTube "
        "look, white with the key/accent word in the accent colour and a subtle drop shadow. "
        "No cartoon/anime/cyberpunk/AI-plastic-skin/broken-hands/extra-logos."
    )
    if prop:
        p += (f" PLAYFUL CHARACTER PROP: {brand} is naturally {prop}, premium and intentional, keep "
              "exact facial identity unchanged.")
    return p


# ── plumbing ──────────────────────────────────────────────────────────────────
def _read_key(cfg: dict) -> str:
    if cfg.get("api_key"):
        return cfg["api_key"]
    kf = cfg.get("api_key_file")
    if kf:
        try:
            return Path(os.path.expanduser(kf)).read_text(encoding="utf-8").strip()
        except OSError:
            pass
    return os.environ.get("OPENAI_API_KEY", "")


def _ref_files(cfg: dict) -> list[Path]:
    d = Path(os.path.expanduser(str(cfg.get("references_dir") or "references")))
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))


def _post_multipart(url: str, token: str, fields: dict, files: list) -> dict:
    """POST multipart/form-data using only urllib. files: [(name, (filename, bytes, ctype))]."""
    boundary = "----thumbgen" + uuid.uuid4().hex
    crlf = b"\r\n"
    body = bytearray()
    for name, val in fields.items():
        body += b"--" + boundary.encode() + crlf
        body += f'Content-Disposition: form-data; name="{name}"'.encode() + crlf + crlf
        body += str(val).encode() + crlf
    for name, (fname, data, ctype) in files:
        body += b"--" + boundary.encode() + crlf
        body += f'Content-Disposition: form-data; name="{name}"; filename="{fname}"'.encode() + crlf
        body += f"Content-Type: {ctype}".encode() + crlf + crlf
        body += data + crlf
    body += b"--" + boundary.encode() + b"--" + crlf
    req = urllib.request.Request(url, data=bytes(body), method="POST")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post_json(url: str, token: str, payload: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _err_code(body: str) -> str:
    # v0.7.31 P2-21 — proxy 502s and similar can return an empty body. Don't
    # surface "" as the error code; fall through to a recognisable string so
    # the user (and humanError) sees something actionable.
    try:
        code = (json.loads(body).get("error") or {}).get("code")
        if code:
            return code
    except Exception:
        pass
    snippet = body[:160].strip()
    return snippet or "empty error body (likely upstream 502/timeout)"


# ── the one public entry point ────────────────────────────────────────────────
def generate(
    item: dict,
    output_path,
    *,
    config: Optional[dict] = None,
    cancel_marker=None,
    prop: Optional[str] = None,
) -> dict:
    """Generate ONE thumbnail and write it to output_path.

    Args:
        item: {"text", "metaphor"?, "accent"?, "order"?, "quality"?}
        output_path: where to write the PNG (str or Path).
        config: brand config (merged over DEFAULT_CONFIG). See module docstring.
        cancel_marker: optional path; if it exists at start or before write,
                       raise CancelledError (host cancellation).
        prop: optional personality prop string (see prop_for()).

    Returns:
        {"output_path", "cost_usd", "model", "completed_at", "prompt_used"}

    Raises:
        CancelledError      — cancel_marker present.
        BillingLimitError   — OpenAI billing_hard_limit; stop the queue.
        RuntimeError        — missing key or any other API failure.
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    output_path = Path(output_path)
    marker = Path(cancel_marker) if cancel_marker else None

    if marker and marker.exists():
        raise CancelledError("cancelled before start")

    token = _read_key(cfg)
    if not token:
        raise RuntimeError("no OpenAI API key (set config['api_key'], api_key_file, or OPENAI_API_KEY)")

    prompt = build_prompt(cfg, item, prop)
    model = cfg["model"]
    size = cfg["size"]
    quality = item.get("quality") or cfg["quality"]
    refs = _ref_files(cfg)

    try:
        if refs:  # identity-locked edit with reference faces
            files = [("image[]", (f"r{i}.png", p.read_bytes(), "image/png")) for i, p in enumerate(refs)]
            data = _post_multipart(
                "https://api.openai.com/v1/images/edits", token,
                {"model": model, "size": size, "quality": quality, "prompt": prompt}, files,
            )
        else:  # no references yet: plain generation
            data = _post_json(
                "https://api.openai.com/v1/images/generations", token,
                {"model": model, "prompt": prompt, "size": size, "quality": quality},
            )
    except urllib.error.HTTPError as e:
        code = _err_code(e.read().decode("utf-8", "replace"))
        if "billing_hard_limit" in code:
            raise BillingLimitError(code) from e
        raise RuntimeError(f"OpenAI HTTP {e.code}: {code}") from e

    if "data" not in data:
        code = (data.get("error") or {}).get("code") or json.dumps(data)[:160]
        if "billing_hard_limit" in code:
            raise BillingLimitError(code)
        raise RuntimeError(str(code))

    if marker and marker.exists():
        raise CancelledError("cancelled before write")

    items = data.get("data") or []
    if not items:
        # Content-filter rejection or other zero-result response. Without this
        # guard the `[0]` access throws IndexError and the user sees a raw
        # Python trace.
        raise RuntimeError(
            "OpenAI returned no image data (content filter? Try a different metaphor.)"
        )
    png = base64.b64decode(items[0]["b64_json"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(png)

    return {
        "output_path": str(output_path),
        "cost_usd": COST_USD.get(quality, COST_USD["medium"]),
        "model": model,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "prompt_used": prompt,
    }
