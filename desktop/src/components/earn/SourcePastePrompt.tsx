import { useState } from "react";
import type { WhopBounty } from "../../lib/sidecar";
import { isSupportedSourceUrl } from "../../lib/sourceHosts";

// Shown when Junior couldn't find a yt-dlp-compatible source link in a Whop
// bounty's description. Most Content Rewards bounties either link the source
// in the brief (we auto-extract) or expect the clipper to find it themselves
// in the brand's channel. This panel makes the second case feel intentional:
// the clipper is told *why* we need a URL and what kinds of URLs work.
//
// Replaces an earlier window.prompt() call — that was a placeholder, not a
// production UX.

const ACCEPTED = [
  { label: "YouTube", example: "youtube.com/watch?v=…" },
  { label: "TikTok", example: "tiktok.com/@user/video/…" },
  { label: "Instagram Reels", example: "instagram.com/reel/…" },
  { label: "Vimeo", example: "vimeo.com/…" },
  { label: "X / Twitter video", example: "x.com/i/status/…" },
];

export function SourcePastePrompt({
  bounty,
  onSubmit,
  onCancel,
}: {
  bounty: WhopBounty;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function tryConfirm() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a link to the source video.");
      return;
    }
    if (!isSupportedSourceUrl(trimmed)) {
      setError(
        "Junior can only lift from YouTube, TikTok, Instagram Reels, Vimeo, or X. " +
          "Drop one of those links.",
      );
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <div className="w-full max-w-[560px]">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn · clip a bounty
      </div>

      <h2 className="mt-3 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Paste the source link from the bounty brief.
      </h2>

      <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
        Whop bounties don't carry the source video as data — only as a link in
        the brief. Drop the URL the creator wants clipped and Junior takes it
        from there.
      </p>

      <div className="mt-5 rounded-2xl border border-line bg-paper p-4">
        <div className="flex items-start gap-3 border-b border-line pb-3">
          <span
            className="mt-0.5 inline-grid h-7 w-7 flex-none place-items-center rounded-md bg-fuchsia font-mono text-[14px] font-bold leading-none text-paper"
            aria-hidden
          >
            /
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
              clipping for whop bounty
            </p>
            <p className="mt-0.5 truncate font-sans text-[14px] font-medium text-ink">
              {bounty.title}
            </p>
            {bounty.rewardPerUnitAmount > 0 && (
              <p className="mt-0.5 font-mono text-[11px] text-text-tertiary">
                {bounty.currency || "USD"} {bounty.rewardPerUnitAmount} per 1k views
              </p>
            )}
          </div>
        </div>

        <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          source video url
        </label>
        <input
          type="url"
          autoFocus
          inputMode="url"
          spellCheck={false}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") tryConfirm();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="https://youtube.com/watch?v=…"
          className="mt-2 w-full rounded-lg border border-line bg-paper-warm/40 px-3.5 py-2.5 font-mono text-[13px] text-ink focus:border-fuchsia focus:outline-none focus:ring-2 focus:ring-fuchsia/20"
        />
        {error && (
          <p className="mt-2 font-mono text-[11px] text-[#DC2626]">{error}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {ACCEPTED.map((p) => (
            <span
              key={p.label}
              className="rounded-full border border-line bg-paper-warm/40 px-2.5 py-1 font-mono text-[10px] text-text-secondary"
              title={p.example}
            >
              {p.label}
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={tryConfirm}
            disabled={!url.trim()}
            className="rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_8px_24px_rgba(255,26,140,0.25)] disabled:opacity-40"
          >
            Start clipping →
          </button>
          <button
            onClick={onCancel}
            className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
