import { useEffect, useState } from "react";
import { onAchievementUnlocked, type Achievement } from "../lib/achievements";

/**
 * Sprint #18a — Achievement unlock toast. Listens on the global achievement
 * bus and slides in a small card with the new badge sprite + title + blurb
 * for ~5 seconds, then dismisses. Top-right corner; non-blocking; queueing
 * is intentional (if multiple unlock at once, they stack in order — rare).
 *
 * Mount ONCE near the App root. Zero props.
 */
export function AchievementToast() {
  const [queue, setQueue] = useState<Achievement[]>([]);

  useEffect(() => {
    const off = onAchievementUnlocked((ev) => {
      setQueue((q) => [...q, ev.detail.achievement]);
    });
    return off;
  }, []);

  // Auto-dismiss the head of the queue after 5s. Effect re-arms whenever the
  // current head changes (so back-to-back unlocks display in sequence).
  useEffect(() => {
    if (queue.length === 0) return;
    const t = window.setTimeout(() => {
      setQueue((q) => q.slice(1));
    }, 5000);
    return () => window.clearTimeout(t);
  }, [queue]);

  if (queue.length === 0) return null;
  const current = queue[0];

  return (
    <div
      className="fixed right-4 top-20 z-[200] flex w-[300px] gap-3 rounded-2xl border border-fuchsia/40 bg-paper-elev p-3 shadow-[0_12px_40px_rgba(255,26,140,0.25)] backdrop-blur-md"
      style={{ animation: "toast-slide-in 280ms ease-out" }}
    >
      <img
        src={current.art}
        alt={current.title}
        className="h-14 w-14 shrink-0 object-contain"
        style={{ filter: "drop-shadow(0 4px 12px rgba(255,26,140,0.4))" }}
      />
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia-deep">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          unlocked
        </div>
        <div className="font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {current.title}
        </div>
        <div className="font-sans text-[11px] leading-snug text-text-secondary">
          {current.blurb}
        </div>
      </div>
      {queue.length > 1 && (
        <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-fuchsia font-mono text-[10px] font-bold text-paper">
          +{queue.length - 1}
        </span>
      )}
      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
