"""
Single structured LLM call that returns the entire output bundle (per spec §1.3).

We send the transcript and a small framing prompt, and get back:
- 15-25 clip ranges with virality scores, titles, descriptions, themes
- 5 video title variants
- SEO long-form description
- chapter list
- tags
- tweet thread
- LinkedIn post

Validated through Pydantic so a malformed response surfaces a clear error.

LLM provider: OpenAI today (key in ~/.claude-credentials/openai.env). The spec
prefers Anthropic for embedded-key tiers; we'll add an `anthropic` branch when
the Anthropic key is provisioned. Both providers support the same JSON-schema
output contract used here.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError


# --- output schema -----------------------------------------------------

# Spec §1.1 + §1.5: clips are 30-75 seconds. Shorter than 30 doesn't read on
# TikTok/Shorts/X; longer than 75 drops engagement. We enforce in the schema
# AND post-filter — the LLM still ignores instructions when it feels like it.
CLIP_MIN_SECONDS = 30.0
CLIP_MAX_SECONDS = 75.0


class ScoreBreakdown(BaseModel):
    # v0.6.8 — branded sub-scores surfaced on ClipCard under the LC Score badge.
    # Each is 0-100 and matches the four levers the LLM evaluates a clip on.
    hook: int = Field(..., ge=0, le=100, description="Strength of the first 1-3 seconds — does it stop the scroll?")
    retention: int = Field(..., ge=0, le=100, description="Likelihood the clip holds viewers to the end (payoff arrives, no dead air).")
    clarity: int = Field(..., ge=0, le=100, description="Is the point clean and easy to follow without prior context?")
    shareability: int = Field(..., ge=0, le=100, description="Does it carry a quotable line, a number, or an opinion worth saving / forwarding?")


class Clip(BaseModel):
    start: float = Field(..., ge=0, description="Clip start time in seconds, inclusive.")
    end: float = Field(..., gt=0, description="Clip end time in seconds, exclusive.")
    title: str = Field(..., min_length=4, max_length=120, description="Hook-led short title for this clip.")
    description: str = Field("", max_length=400, description="2-3 sentence post body for this clip.")
    theme: str = Field("", max_length=40, description="One-tag theme for dedup across the drip.")
    virality: int = Field(..., ge=0, le=100, description="Estimated virality score 0–100 on the fuchsia ladder. Surfaced as the LC Score on the ClipCard.")
    slug: str = Field(..., min_length=3, max_length=60, description="kebab-case slug for the filename.")
    title_variants: list[str] = Field(default_factory=list, description="3-5 alternate hooks.")
    pinned_comment: str = Field(
        "",
        max_length=220,
        description="One-line engagement-bait comment the creator pins under the post.",
    )
    # v0.6.8 — Optional sub-scores + reason. Optional for backwards-compat with
    # old project JSON; new LLM responses always populate them so the ClipCard
    # surface and ClipPreview tooltip can explain the LC Score.
    score_breakdown: ScoreBreakdown | None = Field(
        None,
        description="Per-axis breakdown explaining the virality score. All four axes must be populated together.",
    )
    score_reason: str = Field(
        "",
        max_length=240,
        description="One-line plain-English answer to 'Why this clip?' — what makes it work or what's at risk.",
    )
    # Duration constraint is enforced in post-processing (auto-extend / trim)
    # because OpenAI structured outputs ignore model_validator logic. Keeping
    # validation strict here would crash the entire LLM stage every time the
    # model picked a 25-second clip — which it does often.


class Chapter(BaseModel):
    start: float = Field(..., ge=0)
    title: str = Field(..., min_length=3, max_length=80)


class ScoredTitle(BaseModel):
    text: str = Field(..., min_length=4, max_length=100, description="Title candidate, ≤100 chars (YouTube hard cap).")
    score: int = Field(..., ge=0, le=100, description="Estimated click-through-rate score 0–100.")
    reason: str = Field(..., min_length=8, max_length=160, description="One-line why this scored this way — what hook it uses, what risk.")


class EndScreenCTA(BaseModel):
    cue: str = Field(..., min_length=4, max_length=80, description="What the creator should say or show in the last 15-20s.")
    payoff: str = Field(..., min_length=4, max_length=120, description="What the viewer gets if they follow it.")


class ClipBundle(BaseModel):
    clips: list[Clip] = Field(..., min_length=1, max_length=30)
    chapters: list[Chapter] = Field(default_factory=list)
    description: str = Field("", max_length=2000, description="Long-form video description (SEO). 200-500 words is the sweet spot.")
    video_title_variants: list[str] = Field(default_factory=list, min_length=0, max_length=10, description="Plain title strings — kept for backwards compat. Prefer scored_titles.")
    scored_titles: list[ScoredTitle] = Field(default_factory=list, min_length=0, max_length=8, description="Title candidates ranked by CTR potential, each with reasoning.")
    tags: list[str] = Field(default_factory=list, max_length=30)
    hashtags: list[str] = Field(default_factory=list, max_length=8, description="3-5 hashtags that go at the end of the description (NOT in the title). Use single words like #productivity, no spaces.")
    pinned_video_comment: str = Field("", max_length=400, description="Comment the creator pins under their own video to drive engagement. Curiosity prompt, poll, or specific question.")
    end_screen_ctas: list[EndScreenCTA] = Field(default_factory=list, max_length=3, description="2-3 ideas for the last 15-20s — what to point viewers to.")
    tweet_thread: list[str] = Field(default_factory=list, max_length=15)
    linkedin_post: str = Field("", max_length=1500)


# --- prompt ------------------------------------------------------------

_VOICE_RULES = (
    "Voice: past tense for done things, no exclamation marks, specifics over vibes, no emojis."
)

SYSTEM_PROMPT_BOTH = (
    "You are Junior — a quiet, competent editor who turns recordings into ready-to-post short clips "
    "AND a polished YouTube long-form upload. "
    "From the supplied transcript, do BOTH: "
    "(A) pick clips that would work as standalone TikTok / YouTube Shorts / X posts; "
    "(B) prepare every field a creator needs to publish the full video on YouTube — chapters, 200-500 word SEO description "
    "with hook in the first sentence, scored_titles (4-6 candidates each ≤100 chars with 0-100 CTR score + one-line reason), "
    "tags (10-20), hashtags (3-5, single word, end of description), pinned_video_comment, end_screen_ctas (2-3 cue+payoff). "
    "EVERY CLIP MUST BE BETWEEN 30 AND 75 SECONDS LONG. Clips outside this range are rejected. "
    "For long-form input (15+ minutes), aim for 15-25 clips. For shorter input, return as many clips "
    "of 30-75s as the content naturally supports. If input is shorter than 30s, return zero clips. "
    "Favour clear hooks. Start at complete sentences, end on punchlines. Use times matching transcript word boundaries. "
    + _VOICE_RULES +
    " Every clip MUST include: start, end, title (4-120 chars), description (2-3 sentences), theme, virality (0-100), "
    "slug (kebab-case), title_variants (3-5), pinned_comment, "
    "score_breakdown ({hook,retention,clarity,shareability} each 0-100; consistent with virality — high virality means "
    "at least three sub-scores ≥75), and score_reason (one short plain line explaining the LC Score, like "
    "'Opens with a named number and resolves in 12s — strong hook + clean payoff'). "
    "Return JSON matching the schema exactly."
)

SYSTEM_PROMPT_CLIPS = (
    "You are Junior — a quiet, competent short-form editor. From the supplied transcript, pick clips that work "
    "as standalone TikTok / YouTube Shorts / X posts. "
    "EVERY CLIP MUST BE BETWEEN 30 AND 75 SECONDS LONG. Clips outside this range are rejected. "
    "For long-form input (15+ minutes), aim for 15-25 clips. For shorter input, return as many 30-75s clips as "
    "the content naturally supports. If input is shorter than 30s, return zero clips. "
    "Favour clear hooks: surprising lines, blunt opinions, vivid stories, named numbers, definitive takes. "
    "Start at complete sentences, end on punchlines. Use times matching transcript word boundaries. "
    + _VOICE_RULES +
    " Every clip MUST include: start, end, title (4-120 chars), description (2-3 sentences), theme, virality (0-100), "
    "slug (kebab-case), title_variants (3-5), pinned_comment, "
    "score_breakdown ({hook,retention,clarity,shareability} each 0-100; consistent with virality — high virality means "
    "at least three sub-scores ≥75), and score_reason (one short plain line explaining the LC Score). "
    "IMPORTANT: This is the CLIPS-ONLY path. Return chapters=[], description='', video_title_variants=[], tags=[], "
    "tweet_thread=[], linkedin_post='' — only the clips array matters. Return JSON matching the schema exactly."
)

SYSTEM_PROMPT_YOUTUBE = (
    "You are Junior — a quiet, competent YouTube long-form editor. From the supplied transcript, prepare everything "
    "the creator needs to publish this video on YouTube. "
    "Produce: "
    "(1) chapters (3-12 of them, each with start time at a natural topic shift and a 3-8 word title); "
    "(2) a long-form SEO description, 200-500 words, opens with the primary hook in the first sentence, 2-4 paragraphs, "
    "ends with a soft CTA pointing to a related video or the creator's site; "
    "(3) scored_titles — 4-6 title candidates each ≤100 chars (YouTube hard cap is 100), each with a 0-100 CTR score "
    "and a one-line `reason` (e.g. 'curiosity gap on a named number — high CTR', 'too generic — burns CTR'); "
    "    populate video_title_variants too (just the text values) for backwards compat; "
    "(4) tags — 10-20 SEO tags, lowercase, comma-friendly; "
    "(5) hashtags — 3-5 single-word hashtags that go AT THE END of the description (e.g. #productivity #sales); "
    "(6) pinned_video_comment — one short engagement-bait line the creator pins under their own video (curiosity prompt or specific question); "
    "(7) end_screen_ctas — 2-3 ideas for what to say/show in the last 15-20s, each with a `cue` (what to say) and `payoff` (what viewer gets); "
    "(8) optional tweet_thread (3-8 tweets) and optional linkedin_post (200-400 words, professional tone). "
    + _VOICE_RULES +
    " IMPORTANT: This is the YOUTUBE-ONLY path. Return clips=[] — no clip extraction. Return JSON matching the schema exactly."
)


def _system_prompt_for(intent: str) -> str:
    if intent == "clips":
        return SYSTEM_PROMPT_CLIPS
    if intent == "youtube":
        return SYSTEM_PROMPT_YOUTUBE
    return SYSTEM_PROMPT_BOTH


# Back-compat for any external import.
SYSTEM_PROMPT = SYSTEM_PROMPT_BOTH


def _clip_transcript_for_prompt(transcript: dict[str, Any], max_chars: int = 30000) -> str:
    """Compose a compact, time-stamped transcript view for the prompt.

    For long videos we'd page through; v1.0 trims to the most-information-dense
    middle section. A real solution is implementing semantic chunking in Sprint 1.5.
    """
    lines: list[str] = []
    for seg in transcript.get("segments", []):
        ts = f"[{seg['start']:.1f}-{seg['end']:.1f}]"
        lines.append(f"{ts} {seg['text']}")
    joined = "\n".join(lines)
    if len(joined) <= max_chars:
        return joined
    # Trim the middle 70% of the doc as a single block.
    head = joined[: max_chars // 4]
    tail = joined[-max_chars // 4 :]
    return f"{head}\n\n[...transcript trimmed for length...]\n\n{tail}"


def _build_user_message(transcript: dict[str, Any], brief: str | None) -> str:
    parts: list[str] = []
    duration = transcript.get("duration") or 0
    language = transcript.get("language") or "unknown"
    parts.append(f"Source duration: {duration:.1f}s · Language: {language}")
    if brief:
        parts.append(f"Creator brief: {brief}")
    parts.append("Transcript:")
    parts.append(_clip_transcript_for_prompt(transcript))
    return "\n\n".join(parts)


# --- call --------------------------------------------------------------

# gpt-4o-mini caps structured-output completions at 16384 tokens. Leave a small
# margin so the API can include its own response wrapper.
_MAX_COMPLETION_TOKENS = 15000


def _call_with_retry(client, model: str, user_message: str, intent: str) -> "ClipBundle":
    """Call OpenAI with a defensive token cap + one retry on length-finish.
    On retry, ask for fewer clips so the response fits.
    """
    from openai import LengthFinishReasonError
    try:
        completion = client.beta.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": _system_prompt_for(intent)},
                {"role": "user", "content": user_message},
            ],
            response_format=ClipBundle,
            temperature=0.4,
            max_completion_tokens=_MAX_COMPLETION_TOKENS,
        )
        bundle = completion.choices[0].message.parsed
        if bundle is None:
            refusal = completion.choices[0].message.refusal
            raise RuntimeError(f"LLM refused to produce clips: {refusal}")
        return bundle
    except LengthFinishReasonError:
        # Surface the retry to the UI — otherwise the user sees nothing while we
        # call OpenAI again with a tighter cap. Best-effort: don't fail the
        # stage if the emit itself errors.
        try:
            from stages import _emit_stage_progress
            _emit_stage_progress("llm", 0.0, 1.0, last_text="Trimming response — retrying with fewer clips…")
        except Exception:  # noqa: BLE001
            pass
        # Response truncated. Retry with a stricter instruction to keep output small.
        capped_prompt = (
            _system_prompt_for(intent)
            + " IMPORTANT: Return at most 8 clips and keep all descriptions under 200 chars."
        )
        completion = client.beta.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": capped_prompt},
                {"role": "user", "content": user_message},
            ],
            response_format=ClipBundle,
            temperature=0.3,
            max_completion_tokens=_MAX_COMPLETION_TOKENS,
        )
        bundle = completion.choices[0].message.parsed
        if bundle is None:
            refusal = completion.choices[0].message.refusal
            raise RuntimeError(f"LLM refused to produce clips on retry: {refusal}")
        return bundle
    except ValidationError as e:
        raise RuntimeError(f"LLM returned an invalid bundle: {e.errors()[:3]}") from e


def _call_split(client, model: str, user_message: str) -> "ClipBundle":
    """For 'both' intent, run two parallel calls (clips + youtube extras) and
    merge. Halves the per-call output, dodges the token cap, faster wall-clock."""
    import concurrent.futures

    def _clips():
        return _call_with_retry(client, model, user_message, "clips")

    def _youtube():
        return _call_with_retry(client, model, user_message, "youtube")

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_clips = pool.submit(_clips)
        f_yt = pool.submit(_youtube)
        clips_bundle = f_clips.result()
        yt_bundle = f_yt.result()

    # Merge: take clips from the clips call, everything else from the youtube call.
    merged = ClipBundle(
        clips=clips_bundle.clips,
        chapters=yt_bundle.chapters,
        description=yt_bundle.description,
        video_title_variants=yt_bundle.video_title_variants,
        scored_titles=yt_bundle.scored_titles,
        tags=yt_bundle.tags,
        hashtags=yt_bundle.hashtags,
        pinned_video_comment=yt_bundle.pinned_video_comment,
        end_screen_ctas=yt_bundle.end_screen_ctas,
        tweet_thread=yt_bundle.tweet_thread,
        linkedin_post=yt_bundle.linkedin_post,
    )
    return merged




def resolve_openai_key() -> str | None:
    """Single source of truth for the OpenAI key the LLM clip-picker uses:
    env → OS keychain → dev file. Used both at clip time and by the desktop's
    pre-run key guard so the check matches what the pipeline will actually find."""
    return os.environ.get("OPENAI_API_KEY") or _read_keychain_openai_key() or _read_dev_openai_key()


def openai_key_available() -> bool:
    return bool(resolve_openai_key() or _hosted_llm_maybe_available())


def _license_jwt() -> str | None:
    try:
        from secrets_store import get_secret
        return get_secret("LICENSE_JWT")
    except Exception:
        return None


def _backend_url() -> str:
    return os.environ.get("JUNIOR_BACKEND_URL", "http://localhost:8000")


def _hosted_llm_maybe_available() -> bool:
    jwt_token = _license_jwt()
    if not jwt_token:
        return False
    try:
        import httpx
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(
                f"{_backend_url()}/me",
                headers={"Authorization": f"Bearer {jwt_token}"},
            )
    except Exception:
        return False
    if resp.status_code != 200:
        return False
    body = resp.json()
    tier = str(body.get("effective_tier") or body.get("raw_tier") or "free")
    return bool(body.get("effective_founder")) or tier in {"pro", "agency", "autopilot"}


def _call_hosted_with_retry(model: str, user_message: str, intent: str) -> "ClipBundle":
    """Call junior-backend's Pro+ hosted LLM proxy.

    The backend holds the OpenAI key, validates the license JWT + tier, and
    returns the same ClipBundle schema used locally. Free/Solo users still need
    a BYO key, so backend 403s are turned into an upgrade/BYO-key hint.
    """
    import httpx

    jwt_token = _license_jwt()
    if not jwt_token:
        raise RuntimeError(
            "No OpenAI key available. Open Settings → API keys to paste one, "
            "or sign in with a Pro/Agency license to use hosted AI."
        )

    payload = {
        "intent": intent,
        "system_prompt": _system_prompt_for(intent),
        "user_message": user_message,
        "model": model,
        "temperature": 0.4,
        "max_completion_tokens": _MAX_COMPLETION_TOKENS,
    }
    try:
        with httpx.Client(timeout=150.0) as client:
            resp = client.post(
                f"{_backend_url()}/proxy/llm/clip-bundle",
                json=payload,
                headers={"Authorization": f"Bearer {jwt_token}"},
            )
    except httpx.HTTPError as e:
        raise RuntimeError(f"Couldn't reach hosted AI: {e}") from e

    if resp.status_code == 403:
        raise RuntimeError("Hosted AI requires Pro or Agency. Add your own OpenAI key or upgrade.")
    if resp.status_code == 402:
        raise RuntimeError("Hosted AI monthly quota reached. Add your own OpenAI key to keep going.")
    if resp.status_code == 503:
        raise RuntimeError("Hosted AI is not configured yet. Add your own OpenAI key in Settings.")
    if resp.status_code != 200:
        raise RuntimeError(f"Hosted AI failed: HTTP {resp.status_code} — {resp.text[:240]}")

    body = resp.json()
    return ClipBundle.model_validate(body.get("bundle") or {})


def _call_hosted_split(model: str, user_message: str) -> "ClipBundle":
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_clips = pool.submit(_call_hosted_with_retry, model, user_message, "clips")
        f_yt = pool.submit(_call_hosted_with_retry, model, user_message, "youtube")
        clips_bundle = f_clips.result()
        yt_bundle = f_yt.result()

    return ClipBundle(
        clips=clips_bundle.clips,
        chapters=yt_bundle.chapters,
        description=yt_bundle.description,
        video_title_variants=yt_bundle.video_title_variants,
        scored_titles=yt_bundle.scored_titles,
        tags=yt_bundle.tags,
        hashtags=yt_bundle.hashtags,
        pinned_video_comment=yt_bundle.pinned_video_comment,
        end_screen_ctas=yt_bundle.end_screen_ctas,
        tweet_thread=yt_bundle.tweet_thread,
        linkedin_post=yt_bundle.linkedin_post,
    )


def pick_clips_from_transcript(
    transcript: dict[str, Any],
    brief: str | None = None,
    intent: str = "both",
) -> dict[str, Any]:
    api_key = resolve_openai_key()
    model = os.environ.get("JUNIOR_LLM_MODEL", "gpt-4o-mini")
    user_message = _build_user_message(transcript, brief)

    if api_key:
        from openai import OpenAI
        # Cap each request + cap SDK-level retries. Without these the SDK silently
        # retries with exponential backoff on a flaky connection — observed to take
        # 6+ minutes with zero UI feedback. timeout=45 + max_retries=2 caps any
        # single clip-pick at ~135s worst case (3 attempts × 45s); bumped from
        # max_retries=1 so transient 429s don't surface as user-visible failures.
        client = OpenAI(api_key=api_key, timeout=45.0, max_retries=2)
        # "Both" intent produces clips + YouTube extras + scored titles + chapters +
        # tweet thread + LinkedIn post in one structured response. For long videos
        # that can blow gpt-4o-mini's 16384 completion-token cap. Split into two
        # parallel calls so each fits comfortably; merge the bundles after.
        if intent == "both":
            bundle = _call_split(client, model, user_message)
        else:
            bundle = _call_with_retry(client, model, user_message, intent)
    else:
        if intent == "both":
            bundle = _call_hosted_split(model, user_message)
        else:
            bundle = _call_hosted_with_retry(model, user_message, intent)

    # Normalise each clip to the 30-75s window. The LLM consistently picks
    # short clips even when the prompt forbids it, so we auto-extend instead
    # of rejecting: push `end` later (or `start` earlier) until we hit the
    # floor or run out of transcript. Anything we genuinely can't extend
    # (e.g. clip sits at the very end of a short video) gets skipped.
    duration = float(transcript.get("duration") or 0)
    # Effective minimum is the LESSER of CLIP_MIN_SECONDS and the source duration.
    # For sources shorter than 30s the whole video IS the clip — don't reject
    # the LLM's pick because we can't extend past the source. (User dropped a
    # 18s clip → returns one 18s clip; user dropped a podcast → still 30-75s.)
    effective_min = min(CLIP_MIN_SECONDS, duration) if duration else CLIP_MIN_SECONDS
    out_clips: list[dict[str, Any]] = []
    rejected: list[str] = []
    for c in bundle.clips:
        start = max(0.0, c.start)
        end = c.end if not duration else min(duration, c.end)
        clip_duration = end - start

        # Short → grow toward effective_min. Prefer extending `end`; fall back
        # to pulling `start` earlier if we'd run past the source.
        if clip_duration < effective_min:
            shortfall = effective_min - clip_duration
            if duration:
                grow_end = min(duration - end, shortfall)
                end += grow_end
                shortfall -= grow_end
            if shortfall > 0:
                grow_start = min(start, shortfall)
                start -= grow_start
                shortfall -= grow_start
            clip_duration = end - start

        # Long → trim end down to the ceiling.
        if clip_duration > CLIP_MAX_SECONDS:
            end = start + CLIP_MAX_SECONDS
            clip_duration = end - start

        if clip_duration < effective_min:
            rejected.append(
                f"{c.start:.1f}-{c.end:.1f}s ({c.end - c.start:.1f}s) — could not extend to {effective_min:.0f}s"
            )
            continue

        out_clips.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "title": c.title,
            "description": c.description,
            "theme": c.theme,
            "virality": int(c.virality),
            "slug": _kebab(c.slug or c.title),
            "title_variants": c.title_variants,
            "pinned_comment": c.pinned_comment,
            # v0.7.14 — Per-clip platform targeting + overlay template.
            # Mirrors create_imported_pack defaults so cut-from-source and
            # imported clips both surface the empty-state to the UI cleanly.
            "platforms": [],
            "overlay_template": None,
        })

    # When the user only asked for YouTube extras we expect no clips — that's
    # the contract, not a failure. The clips array stays empty by design.
    if not out_clips and intent != "youtube":
        msg = f"LLM returned no clips in the {effective_min:.0f}-{CLIP_MAX_SECONDS:.0f}s window after auto-extend."
        if rejected:
            msg += f" Rejected: {'; '.join(rejected[:5])}"
        raise RuntimeError(msg)

    # Title variants: prefer scored_titles when the model returned them, else
    # fall back to the plain video_title_variants list (older models / cached
    # paths). We always emit both shapes so the UI can rely on `scored_titles`.
    scored = [
        {"text": s.text, "score": int(s.score), "reason": s.reason}
        for s in (bundle.scored_titles or [])
    ]
    if not scored and bundle.video_title_variants:
        scored = [
            {"text": t, "score": 60, "reason": "unscored — generated without ranking pass"}
            for t in bundle.video_title_variants
        ]
    flat_titles = [s["text"] for s in scored] or list(bundle.video_title_variants)

    return {
        "clips": out_clips,
        "chapters": [{"start": round(ch.start, 2), "title": ch.title} for ch in bundle.chapters],
        "description": bundle.description,
        "video_title_variants": flat_titles,
        "scored_titles": scored,
        "tags": bundle.tags,
        "hashtags": [h.lstrip("#") for h in bundle.hashtags],
        "pinned_video_comment": bundle.pinned_video_comment,
        "end_screen_ctas": [{"cue": e.cue, "payoff": e.payoff} for e in bundle.end_screen_ctas],
        "tweet_thread": bundle.tweet_thread,
        "linkedin_post": bundle.linkedin_post,
        "model": model,
    }


# --- utils -------------------------------------------------------------

def _parse_json_loosely(raw: str) -> dict[str, Any]:
    """OpenAI with json_object usually returns clean JSON; this is defensive."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Strip code fences if any.
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
        return json.loads(cleaned)


def _kebab(s: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return base[:60] or "clip"


def _read_keychain_openai_key() -> str | None:
    """Pull OPENAI_API_KEY from the OS keychain via secrets_store.

    Set via Settings → API keys in the desktop UI. The user's key never
    leaves their machine.
    """
    try:
        from secrets_store import get_secret
        return get_secret("OPENAI_API_KEY")
    except Exception:
        return None


def _read_dev_openai_key() -> str | None:
    """SECURITY (CRIT-001): the legacy ~/.claude-credentials/openai.env fallback
    has been removed. The shipping app reads OPENAI_API_KEY from the OS keychain
    (via Settings → API keys) or the OPENAI_API_KEY env var only. Reading API
    keys from a plaintext file in the user's home directory is unsafe: any other
    process running as the user can steal the key. Kept as a no-op so existing
    callers don't need to change.
    """
    return None
