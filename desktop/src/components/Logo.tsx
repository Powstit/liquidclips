import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

// Canonical brand mark — fuchsia pill, white tile, ink slash. Matches
// partner-app/account-app for cross-surface brand continuity (spec §3.2).
// Version pill sits to the right so users can see at a glance which build
// they're on (and confirm an auto-update landed).
export function Logo({ size = 26 }: { size?: number }) {
  void size;
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="inline-flex items-center gap-2">
      {/* The wordmark + inner tile are part of the brand mark, not the surface
          theme — hard-code white text + a true-white inner tile so the mark
          renders the same in light and dark UI. In 0.4.27 the surface flipped
          to dark, which made `bg-paper` near-black and turned the inner tile
          into a black square with a pink slash on fuchsia — exactly the
          regression Daniel caught testing 0.4.32. */}
      <div className="inline-flex items-center gap-2 rounded-[9px] bg-fuchsia px-[14px] py-[9px] pl-[9px] font-mono text-[16px] font-bold leading-none text-white">
        <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md bg-white font-mono text-[15px] font-bold leading-none text-fuchsia">
          /
        </span>
        <span>
          junior<span className="text-white">/</span>employee
        </span>
      </div>
      {version && (
        <span className="rounded-full border border-line bg-paper px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          v{version}
        </span>
      )}
    </div>
  );
}
