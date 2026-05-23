import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import { sidecar } from "../lib/sidecar";

/**
 * Header bell + unread badge. Polls the backend every 30 s while focused.
 * Inert (no badge) when the user has no license JWT yet — the inbox is
 * server-backed, so without auth there's nothing to fetch.
 *
 * Click → opens the parent's onOpen callback (which renders <NotificationSheet />).
 */
export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const [unread, setUnread] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (!jwt) {
          if (!cancelled) {
            setActive(false);
            setUnread(0);
          }
          return;
        }
        const n = await backend.notifications.unreadCount(jwt);
        if (!cancelled) {
          setActive(true);
          setUnread(n);
        }
      } catch {
        if (!cancelled) {
          setActive(false);
          setUnread(0);
        }
      }
    }

    void tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <button
      onClick={onOpen}
      title={active ? `${unread} unread` : "Sign in to enable inbox"}
      className="relative rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
    >
      Inbox
      {active && unread > 0 && (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-fuchsia px-1 font-mono text-[9px] font-bold leading-none text-paper">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
