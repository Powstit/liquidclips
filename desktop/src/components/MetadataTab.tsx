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
    <div className="rounded-2xl border border-line bg-paper p-5">
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
