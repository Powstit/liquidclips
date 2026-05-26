import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import { InfoHint } from "../InfoHint";
import { allowedPlatforms, formatPayout } from "./types";
import type { DetectedSource } from "../../lib/sourceParser";

type Source = { kind: "url"; url: string } | { kind: "file"; path: string };

// Focused, bounty-specific setup screen shown after "Start clipping". The
// clipper should feel they're working *this bounty*, not lost in a generic
// upload flow — so the bounty's payout, platforms, and brief stay on screen
// while they choose where the source video comes from.
export function BountySourceSetup({
  bounty,
  detectedSources,
  onCancel,
  onContinue,
}: {
  bounty: WhopBounty;
  /**
   * Every plausible source URL we found in `bounty.description`, classified
   * into supported (Junior can ingest) and unsupported (Drive/Dropbox/etc. —
   * open in browser, drag the file back). Comes from `extractSourceUrls`.
   */
  detectedSources: DetectedSource[];
  onCancel: () => void;
  onContinue: (source: Source) => void;
}) {
  const platforms = allowedPlatforms(bounty);
  const [pasted, setPasted] = useState("");
  const [briefOpen, setBriefOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function useUrl(url: string) {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("That doesn't look like a video link. Paste a full https:// URL or upload a file.");
      return;
    }
    onContinue({ kind: "url", url: trimmed });
  }

  async function pickFile() {
    setError(null);
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] }],
    });
    if (typeof picked === "string") onContinue({ kind: "file", path: picked });
  }

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6">
      <button
        onClick={onCancel}
        className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
      >
        ← earn
      </button>

      {/* Bounty context stays pinned so the source step feels bounty-specific. */}
      <header className="rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/20 p-5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          setting up your reward clip
        </div>
        <h1 className="mt-2 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {bounty.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            payout
            <InfoHint text="What this reward pays per 1,000 views on an approved clip. Whop tracks the views and pays you — Junior doesn't." />
            <span className="font-display text-[14px] font-semibold text-ink">{formatPayout(bounty)}</span>
          </span>
          {bounty.user.username && <span>by @{bounty.user.username}</span>}
          {bounty.spotsRemaining > 0 && (
            <span className="inline-flex items-center gap-1.5">
              {bounty.spotsRemaining} spots left
              <InfoHint text="How many accepted submissions the brand still has budget for. When it hits zero the reward is full." />
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            allowed platforms
            <InfoHint text="Only clips posted to these platforms count for this reward. Post elsewhere and it won't be eligible." />
          </span>
          {platforms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper/70 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary"
            >
              <PlatformIcon id={p} className="h-3 w-3" />
              {p}
            </span>
          ))}
          {platforms.length === 0 && <span className="font-mono text-[11px] text-text-tertiary">any platform</span>}
        </div>

        {bounty.description && (
          <div className="mt-4 border-t border-fuchsia-soft/60 pt-3">
            <button
              onClick={() => setBriefOpen((v) => !v)}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep hover:text-ink"
            >
              {briefOpen ? "▾" : "▸"} brief & rules
              <InfoHint text="The brand's instructions. Clips that ignore the brief usually get rejected — read it before you clip." />
            </button>
            {briefOpen && (
              <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">
                {bounty.description}
              </p>
            )}
          </div>
        )}
      </header>

      {/* Source choice */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          choose your source video
          <InfoHint text="The long video Junior clips from. Use the brand's source link if they gave one, paste any public video URL, or upload your own file." />
        </div>

        {detectedSources.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
              detected in the brief
              <InfoHint text="Junior scanned the brand's brief and found these source links. Pick the one you want to clip from — Junior ingests it for you." />
            </div>
            <div className="flex flex-col gap-2">
              {detectedSources.map((src) => (
                <div
                  key={src.url}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/25 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
                      <span>{src.label}</span>
                      {!src.supported && (
                        <span className="rounded-full border border-fuchsia-soft bg-paper/70 px-2 py-0.5 text-[9px] tracking-[0.1em] text-text-tertiary">
                          opens in browser
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-ink">
                      {src.url}
                    </div>
                  </div>
                  {src.supported ? (
                    <button
                      onClick={() => onContinue({ kind: "url", url: src.url })}
                      className="shrink-0 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
                    >
                      Use this source →
                    </button>
                  ) : (
                    <button
                      onClick={() => void openExternal(src.url)}
                      className="shrink-0 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
                      title="Junior can't fetch this host directly. Open in your browser, download the file, then drop it below."
                    >
                      Open ↗
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-paper p-4">
          <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            paste a source URL
            <InfoHint text="YouTube, TikTok, Twitch, Vimeo, Instagram, X and more. Public videos only — login-walled links can't be fetched." />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              spellCheck={false}
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") useUrl(pasted);
              }}
              placeholder="https://youtube.com/watch?v=…"
              className="flex-1 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            />
            <button
              onClick={() => useUrl(pasted)}
              disabled={!pasted.trim()}
              className="shrink-0 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-40"
            >
              Use this URL
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-line" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <button
          onClick={() => void pickFile()}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-paper-warm/40 px-4 py-4 font-sans text-[14px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Upload a local video instead
          <InfoHint text="Already downloaded the source? Pick a file from your Mac and Junior clips it directly — nothing leaves your machine to fetch it." />
        </button>

        {error && <p className="font-mono text-[11px] text-[#DC2626]">{error}</p>}
      </section>
    </div>
  );
}
