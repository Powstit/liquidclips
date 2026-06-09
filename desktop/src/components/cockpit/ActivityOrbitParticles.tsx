// ship-lens v0.7.14: K-δ — ActivityOrbitParticles
// Orbiting particles that show unread activity events around the avatar ring.
// Up to 5 particles, each with a color based on event kind. Click opens detail.

import { useMemo } from "react";

const BADGE_COLORS: Record<string, string> = {
  "channel-linked": "#00e5ff",
  "publish-success": "#a3e635",
  "publish-failed": "#ef4444",
  payout: "#ff1a8c",
  "bounty-match": "#ff66b8",
};

interface ActivityEvent {
  id: string;
  kind: keyof typeof BADGE_COLORS;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

interface ActivityOrbitParticlesProps {
  events: ActivityEvent[];
  onEventClick: (eventId: string) => void;
}

export function ActivityOrbitParticles({ events, onEventClick }: ActivityOrbitParticlesProps) {
  // Distribute particles evenly around the orbit (72° apart for 5 max)
  const particles = useMemo(() => {
    return events.slice(0, 5).map((event, i) => ({
      ...event,
      angle: (i * 72) - 90, // Start from top, go clockwise
    }));
  }, [events]);

  if (particles.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {particles.map((p) => (
        <button
          key={p.id}
          onClick={(e) => {
            e.stopPropagation();
            onEventClick(p.id);
          }}
          className="pointer-events-auto absolute grid h-3 w-3 place-items-center rounded-full transition-transform hover:scale-150"
          style={{
            backgroundColor: BADGE_COLORS[p.kind] || "#ff1a8c",
            boxShadow: `0 0 8px ${BADGE_COLORS[p.kind] || "#ff1a8c"}`,
            // Position on the orbit ring: center + rotate(angle) + translate(radius)
            left: "50%",
            top: "50%",
            transform: `rotate(${p.angle}deg) translateX(26px) rotate(-${p.angle}deg) translate(-50%, -50%)`,
          }}
          title={p.title}
          aria-label={p.title}
        />
      ))}
    </div>
  );
}
