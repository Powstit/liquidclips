import { useEffect, useState } from "react";
import { sidecar } from "../lib/sidecar";

/**
 * Header bell. Inert (no badge, "Sign in to enable inbox" tooltip) when no
 * license JWT presence is recorded; active (pressable, opens the sheet) when
 * presence says a JWT lives in the keychain.
 *
 * v0.7.56 P0 — Zero automatic keychain reads.
 *
 * This bell used to call `sidecar.licenseJwtRead()` on mount AND poll every
 * 30 s for `notifications.unreadCount(jwt)`. Both routes triggered
 * `keyring.get_password()`, which on a rebuilt/renamed sidecar binary
 * prompts macOS for a Keychain password before the user does anything. The
 * earlier patch deferred the read by 8 s; that was still a "background
 * polling" violation of Daniel's tightened directive: no automatic keychain
 * reads, ever — only on explicit user action.
 *
 * Today:
 *   * On mount we check `licenseJwtPresence()` (presence file, no keychain).
 *   * If presence is false → bell stays inactive forever. No badge, no read.
 *   * If presence is true → bell renders active. No badge (we don't have an
 *     unread count without polling), no automatic keychain read.
 *   * On click → parent's `onOpen` renders `NotificationSheet`, which does
 *     the (now once-cached) keychain read inside its own load() because
 *     opening the sheet IS an explicit user action.
 */
export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { present } = await sidecar.licenseJwtPresence();
        if (cancelled) return;
        setActive(present);
      } catch {
        if (cancelled) return;
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      onClick={onOpen}
      title={active ? "Open inbox" : "Sign in to enable inbox"}
      className="relative rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
    >
      Inbox
    </button>
  );
}
