// v0.6.0 — Direct-OAuth platform tile. Replaces the old "static chip with
// a mono label" with a click-to-connect tile that lands the user STRAIGHT
// on Google / TikTok / Instagram / X OAuth — no Ayrshare login modal in
// between. The backend mints an Ayrshare JWT scoped with allowedSocial so the
// chosen platform is the only linking target the user sees.
//
// Daniel's UX rule: "social connections should be seamless and easy for
// a 15-year-old to handle."

import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Loader2 } from "lucide-react";
import { PlatformIcon } from "../PlatformIcon";
import { socialStartLink, type ConnectionPlatform } from "../../lib/backend";

type Props = {
  platform: ConnectionPlatform;
  isLinked: boolean;
  /** Called after the OAuth browser opens so the parent can re-pull
   *  connection state and flip the chip to "linked." */
  onConnected: () => void;
};

const PLATFORM_LABEL: Record<ConnectionPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
};

const PLATFORM_API_KEY: Record<ConnectionPlatform, "youtube" | "tiktok" | "instagram" | "x"> = {
  youtube: "youtube",
  tiktok: "tiktok",
  instagram: "instagram",
  x: "x",
};

export function PlatformConnectTile({ platform, isLinked, onConnected }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (busy || isLinked) return;
    setBusy(true);
    setError(null);
    try {
      const { link_url } = await socialStartLink(PLATFORM_API_KEY[platform]);
      // Google/YouTube blocks OAuth in embedded WebViews. Use the user's
      // system browser for every platform so Google and Meta auth both land
      // in a trusted user agent.
      await openExternal(link_url);
      onConnected();
      window.setTimeout(onConnected, 3_000);
      window.setTimeout(onConnected, 10_000);
      window.setTimeout(onConnected, 25_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the connect window. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = PLATFORM_LABEL[platform];

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={busy || isLinked}
      className={`group relative flex aspect-[5/4] flex-col items-center justify-center gap-2 rounded-2xl border-2 px-3 py-4 outline-none transition-all ${
        isLinked
          ? "border-fuchsia/50 bg-fuchsia-soft/30 cursor-default"
          : busy
          ? "border-fuchsia/30 bg-paper cursor-wait"
          : "border-line bg-paper hover:border-fuchsia hover:bg-fuchsia-soft/20 hover:shadow-[var(--glow-sm)] hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
      }`}
      aria-label={isLinked ? `${label} connected` : `Connect ${label}`}
    >
      {/* The platform's actual logo as the hero — 40px so the visual is
          the logo, not the mono label. */}
      <PlatformIcon
        id={platform}
        className={`h-10 w-10 transition-transform ${
          isLinked ? "text-fuchsia-deep" : "text-ink group-hover:scale-105"
        }`}
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary">
        {isLinked ? "✓ connected" : "connect"}
      </span>
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-paper/80 backdrop-blur-sm">
          <Loader2 className="h-5 w-5 animate-spin text-fuchsia" strokeWidth={2.5} />
        </div>
      )}
      {error && (
        <p className="absolute left-2 right-2 -bottom-1 translate-y-full text-center font-mono text-[10px] text-[#DC2626]">
          {error}
        </p>
      )}
    </button>
  );
}
