"use client";

// /channel-linked — bounce page for Ayrshare OAuth completion.
//
// SERVES: NAVIGATION in the Connect-channel flow (per UI_MAP_workbench.md
// `## SURFACE: Connect-channel flow`). NO OUTCOMES of its own — every
// outcome (proof of link, channel binding, etc.) is owned by the desktop
// surface that subscribes to the `junior:channel-linked` deep link.
//
// Ayrshare's hosted OAuth (TikTok / Instagram / etc.) redirects the user
// back to this URL with `?cid=<channel_id>` once OAuth completes. We
// immediately hand back to the desktop via the `liquidclips://` scheme so
// the running app sees the deep link and fires `junior:channel-linked`.
// The visible UI is the fallback for browsers that block scheme handlers
// or where the desktop isn't running on this machine.
//
// NO auth, NO data fetch, NO Clerk gate — TikTok specifically refuses to
// complete OAuth if its redirect target 404s or requires a login round-
// trip, and a Clerk gate here would re-introduce that failure mode.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function ChannelLinkedInner() {
  const searchParams = useSearchParams();
  const [deepLink, setDeepLink] = useState<string | null>(null);

  useEffect(() => {
    const cid = searchParams?.get("cid") ?? searchParams?.get("channel_id") ?? null;
    // Build the deep link even without a cid so a stray load still routes
    // back to the app — the desktop listener tolerates a missing channelId
    // (it falls back to a full listChannels refresh).
    const url = cid
      ? `liquidclips://channel-linked?cid=${encodeURIComponent(cid)}`
      : `liquidclips://channel-linked`;
    setDeepLink(url);
    // window.location.replace so the bounce doesn't litter browser history
    // — the user can close the tab once the desktop confirms.
    try {
      window.location.replace(url);
    } catch {
      /* some browsers throw on custom-scheme replace; the fallback link
         below still works. */
    }
  }, [searchParams]);

  return (
    <Shell>
      {deepLink && (
        <a
          href={deepLink}
          className="font-mono text-[12px] uppercase tracking-[0.14em] text-text-secondary underline-offset-4 transition-colors hover:text-fuchsia hover:underline"
        >
          Open Liquid Clips
        </a>
      )}
    </Shell>
  );
}

export default function ChannelLinkedPage() {
  return (
    <Suspense fallback={<Shell />}>
      <ChannelLinkedInner />
    </Suspense>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-paper px-6 py-12">
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          channel linked
        </div>
        <span
          className="inline-grid h-[44px] w-[44px] place-items-center rounded-lg bg-fuchsia font-mono text-[22px] font-bold leading-none text-paper"
          aria-hidden
        >
          /
        </span>
        <h1 className="max-w-[460px] text-center font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          Liquid Clips is updating your channel. You can close this tab.
        </h1>
        {children}
      </div>
    </div>
  );
}
