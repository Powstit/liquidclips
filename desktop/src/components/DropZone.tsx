import { useState } from "react";

const URL_RE = /^https?:\/\//i;

export function DropZone({
  onPickFile,
  onPasteUrl,
  onLiftTranscript,
  remainingExports = null,
}: {
  onPickFile: (brief: string) => void;
  onPasteUrl: (url: string, brief: string) => void;
  onLiftTranscript: (url: string) => void;
  // Free clip exports left on the starter pass. null = unlimited (paid /
  // founder / unactivated) — counter is hidden in that case.
  remainingExports?: number | null;
}) {
  const [brief, setBrief] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function tryUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste a URL first.");
      return;
    }
    if (!URL_RE.test(trimmed)) {
      setError("That doesn't look like a URL. Paste a YouTube / Twitch / podcast link.");
      return;
    }
    setError(null);
    onPasteUrl(trimmed, brief);
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col items-stretch gap-4">
      <button
        onClick={() => onPickFile(brief)}
        className="group flex h-[300px] w-full cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-line bg-paper transition-all hover:border-fuchsia hover:bg-fuchsia-soft/20"
      >
        <p className="font-display text-[26px] font-medium tracking-[-0.02em] text-ink">
          Drop a video file
        </p>
        <p className="mt-2 font-sans text-[14px] text-text-secondary">
          Your videos never leave your machine.
        </p>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary group-hover:text-fuchsia-deep">
          click to browse — or drag a file anywhere
        </p>
      </button>

      {remainingExports !== null && (
        <p className="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {remainingExports} free export{remainingExports === 1 ? "" : "s"} left
        </p>
      )}

      <div className="flex items-center gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <div className="rounded-2xl border border-line bg-paper p-4">
        <label className="block font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          paste a youtube / instagram / tiktok / x link
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") tryUrl();
          }}
          placeholder="https://instagram.com/reel/..."
          className="mt-2 w-full bg-transparent font-mono text-[13px] text-ink placeholder:text-text-tertiary focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            choose your move
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={tryUrl}
              className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[13px] font-medium text-ink transition-all hover:border-fuchsia hover:bg-fuchsia-soft/30 hover:text-fuchsia-deep hover:shadow-[0_8px_24px_rgba(255,26,140,0.18)]"
            >
              Fetch + clip →
            </button>
            <button
              onClick={() => {
                const trimmed = url.trim();
                if (!trimmed) {
                  setError("Paste a URL first.");
                  return;
                }
                if (!URL_RE.test(trimmed)) {
                  setError("That doesn't look like a URL.");
                  return;
                }
                setError(null);
                onLiftTranscript(trimmed);
              }}
              className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[13px] font-medium text-ink transition-all hover:border-fuchsia hover:bg-fuchsia-soft/30 hover:text-fuchsia-deep hover:shadow-[0_8px_24px_rgba(255,26,140,0.18)]"
            >
              Lift transcript →
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-2 font-mono text-[11px] text-[#DC2626]">{error}</p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-paper-warm/40 p-4">
        <label className="block font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          brief — optional
        </label>
        <input
          type="text"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="What should Junior focus on? e.g. 'the personal stories'"
          className="mt-2 w-full bg-transparent font-sans text-[15px] text-ink placeholder:text-text-tertiary focus:outline-none"
        />
      </div>
    </div>
  );
}
