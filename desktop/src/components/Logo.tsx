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
      <div className="inline-flex items-center gap-2 rounded-[9px] bg-fuchsia px-[14px] py-[9px] pl-[9px] font-mono text-[16px] font-bold leading-none text-paper">
        <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md bg-paper font-mono text-[15px] font-bold leading-none text-fuchsia">
          /
        </span>
        <span>
          junior<span className="text-ink">/</span>employee
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
