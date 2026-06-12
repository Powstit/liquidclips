"use client";

import { useEffect, useState } from "react";

// PWA install CTA — surfaces only when the browser fires the
// `beforeinstallprompt` event (Chrome, Edge, Opera, Brave; not Safari).
// We capture the deferred event, show an "Install web app" button next
// to the desktop-download link, and call .prompt() on click.
//
// Copy is deliberately "Install web app" — separate from the
// "Download desktop app" link in Nav so users never confuse the
// browser/PWA install with the Mac DMG.
//
// Hidden when:
//   • browser doesn't fire beforeinstallprompt (Safari, etc.)
//   • already running standalone (display-mode: standalone)
//   • user dismissed/installed during this session

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !deferred) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") setInstalled(true);
        setDeferred(null);
      }}
      className="hidden rounded-full border border-fuchsia-soft bg-fuchsia-soft/30 px-4 py-2 font-sans text-[13px] font-medium text-fuchsia-deep transition-colors hover:bg-fuchsia hover:text-paper sm:inline-flex"
      data-cta="pwa-install"
    >
      Install web app
    </button>
  );
}
