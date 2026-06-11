import { useEffect, useState } from "react";
import { sidecar, humanError } from "../lib/sidecar";
import { CopyButton } from "./CopyButton";

const TAB_TO_FILE: Record<string, string> = {
  chapters: "chapters",
  description: "description",
  titles: "titles",
  thread: "tweet-thread",
  linkedin: "linkedin",
};

export function MetadataTab({ slug, tab }: { slug: string; tab: string }) {
  const [metadata, setMetadata] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMetadata(null);
    setError(null);
    sidecar
      .getMetadata(slug)
      .then((res) => {
        if (!cancelled) setMetadata(res.metadata);
      })
      .catch((e) => {
        if (!cancelled) setError(humanError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const fileKey = TAB_TO_FILE[tab] ?? tab;
  const content = metadata?.[fileKey];

  if (error) {
    return <p className="font-mono text-[12px] text-[var(--color-danger)]">{error}</p>;
  }
  if (!metadata) {
    return (
      <p className="font-mono text-[12px] text-text-tertiary">
        Loading<span className="blink">_</span>
      </p>
    );
  }
  if (!content) {
    return (
      <p className="font-mono text-[12px] text-text-tertiary">
        No {tab} written for this project.
      </p>
    );
  }

  return (
    // v0.7.50 — Brand-kit pass. Solid `border border-line` card chrome
    // retired (banned by IG-012 brand kit's Don't list); now uses
    // library-card-corner bracket spans + warm paper bg for the same
    // visual hierarchy without the SaaS-card look.
    <div className="library-card relative rounded-2xl bg-paper-warm/40 p-5">
      <span className="library-card-corner library-card-corner-tl" />
      <span className="library-card-corner library-card-corner-tr" />
      <span className="library-card-corner library-card-corner-bl" />
      <span className="library-card-corner library-card-corner-br" />
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          {tab}
        </span>
        <CopyButton text={content} />
      </div>
      <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-ink">{content}</pre>
    </div>
  );
}
