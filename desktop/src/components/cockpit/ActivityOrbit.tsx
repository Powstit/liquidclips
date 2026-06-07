// ship-lens v0.7.14: K-δ — ActivityOrbit (parent container)
// CONTRACT: src/contracts/useActivityEvents.ts (Claude C5)
//
// Wraps Kimi's ActivityOrbitParticles + the AvatarOrbit ring. When an event
// particle is clicked, the orbit dispatches an app-level event that the
// AvatarPanel listens for to open its inbox mode focused on that event.

import { useCallback } from "react";
import { useActivityEvents, type ActivityEventKind } from "../../contracts/useActivityEvents";
import { ActivityOrbitParticles } from "./ActivityOrbitParticles";

type ParticleEvent = {
  id: string;
  kind: ActivityEventKind;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
};

export function ActivityOrbit({ onOpenInbox }: { onOpenInbox?: (eventId: string) => void }) {
  const { events, markRead } = useActivityEvents();

  const handleEventClick = useCallback(
    (eventId: string) => {
      markRead(eventId);
      onOpenInbox?.(eventId);
      // Fall-through event bus so any sibling surface (e.g. a future
      // toast preview) can also react without prop-drilling.
      window.dispatchEvent(
        new CustomEvent("lc:activity-orbit-click", { detail: { eventId } }),
      );
    },
    [markRead, onOpenInbox],
  );

  // ActivityOrbitParticles expects only unread events, sorted newest-first.
  // useActivityEvents already returns newest-first; filter to unread here.
  const unread: ParticleEvent[] = events.filter((e) => !e.read);

  return <ActivityOrbitParticles events={unread} onEventClick={handleEventClick} />;
}
