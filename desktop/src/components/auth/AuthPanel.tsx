import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";

// AuthPanel — host the Clerk-routed sign-in / sign-up / upgrade page inside
// the desktop instead of bouncing through Safari. The native child webview
// (auth_panel.rs) does the heavy lifting: it owns the cookie partition for
// account.jnremployee.com, so a user who's already signed in renders
// already-authed on first paint.
//
// React owns ONLY the chrome bar — title eyebrow on the left, close button
// on the right. The native webview occupies the rest of the centered modal.
//
// On close we fire onClose(), which the parent should hook to a /sync refresh
// so a successful Stripe Checkout / new sign-in flips the tier immediately
// without waiting for the next window-focus poll in useTier.

export type AuthPanelMode = "sign-in" | "sign-up" | "upgrade" | "dashboard" | "payouts";

const ACCOUNT_HOST = "https://account.jnremployee.com";

function urlFor(mode: AuthPanelMode): string {
  switch (mode) {
    case "sign-in":  return `${ACCOUNT_HOST}/sign-in?redirect_url=/dashboard`;
    case "sign-up":  return `${ACCOUNT_HOST}/sign-up?redirect_url=/dashboard`;
    case "upgrade":  return `${ACCOUNT_HOST}/upgrade`;
    case "dashboard":return `${ACCOUNT_HOST}/dashboard`;
    case "payouts":  return `${ACCOUNT_HOST}/dashboard#payouts`;
  }
}

function titleFor(mode: AuthPanelMode): { eyebrow: string; heading: string } {
  switch (mode) {
    case "sign-in":   return { eyebrow: "sign in",   heading: "Sign in to Liquid Clips" };
    case "sign-up":   return { eyebrow: "create",    heading: "Create your Liquid Clips account" };
    case "upgrade":   return { eyebrow: "upgrade",   heading: "Unlock Liquid Clips" };
    case "dashboard": return { eyebrow: "account",   heading: "Your Liquid Clips account" };
    case "payouts":   return { eyebrow: "payouts",   heading: "Stripe payouts" };
  }
}

export function AuthPanel({
  open,
  mode,
  onClose,
}: {
  open: boolean;
  mode: AuthPanelMode;
  /** Fires when the user closes the panel (X button OR the native webview
   *  emits auth-panel-closed). Parent should refresh /sync here. */
  onClose: () => void;
}) {
  // Mount/unmount the native child webview in lockstep with the React shell.
  // The shell shows a fuchsia chrome strip; the webview owns everything below.
  useEffect(() => {
    if (!open) return;
    void invoke("open_auth_panel", { url: urlFor(mode) }).catch((e) => {
      console.warn("open_auth_panel failed", e);
      // If the native side fails (rare), fall back to system browser so the
      // user still has a route to billing — don't strand them in a dead modal.
      void import("@tauri-apps/plugin-shell").then((m) => m.open(urlFor(mode)));
      onClose();
    });
    return () => {
      void invoke("close_auth_panel").catch(() => undefined);
    };
  }, [open, mode, onClose]);

  // Re-navigate when mode changes mid-session (e.g. upgrade → dashboard after
  // success). The Rust side preserves the cookie partition on re-navigate.
  useEffect(() => {
    if (!open) return;
    void invoke("open_auth_panel", { url: urlFor(mode) }).catch(() => undefined);
  }, [mode, open]);

  // Listen for native close events — if the webview is torn down by the
  // user clicking X on the system close decoration (or our own close cmd
  // fires the event), close the React shell too.
  useEffect(() => {
    if (!open) return;
    const unsubscribePromise = listen("auth-panel-closed", () => {
      onClose();
    });
    return () => {
      void unsubscribePromise.then((unsub) => unsub());
    };
  }, [open, onClose]);

  // Esc closes — small UX rule that makes the modal feel like a modal even
  // though most of it is native chrome we don't fully control.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const { eyebrow, heading } = titleFor(mode);

  return (
    <>
      {/* Dimmer behind the native webview. The webview is placed centered on
          the main window by auth_panel.rs; this dimmer fills the rest so the
          user reads it as a modal overlay. pointer-events-none so a stray
          click on the dimmer doesn't fight the webview underneath. */}
      <div
        className="pointer-events-none fixed inset-0 z-40 bg-paper/85 backdrop-blur-md"
        aria-hidden="true"
      />

      {/* React-owned chrome strip — eyebrow + heading + close button, fixed
          above the webview's centered position (~16px from top). The webview
          sits behind this strip; we don't try to overlap or rely on z-index
          tricks since the native webview is on its own layer. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <div className="pointer-events-auto flex w-full max-w-[900px] items-center justify-between gap-3 rounded-t-2xl border border-fuchsia/20 bg-paper px-5 py-3 shadow-[var(--glow-sm)]">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-fuchsia">
              {eyebrow}
            </span>
            <span className="font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {heading}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-paper text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </>
  );
}
