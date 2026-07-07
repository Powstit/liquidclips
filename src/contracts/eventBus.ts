// Liquid Clips 2.0 — typed event bus skeleton.
// Sections publish events; other sections subscribe via read-only selectors.
// Sections must NOT import each other's stores. The bus is the one allowed
// inter-section channel.
//
// Payload schemas freeze at Phase 0 (see docs/lc2/CONTRACTS/CONTRACT_EVENT_BUS.md).
// Adding a new event name = updating that contract doc + this map together.

export type EventMap = {
  "clip.created": { clipIds: string[]; projectId: string | null };
  "export.completed": { exportId: string; clipId: string; watermarked: boolean };
  "project.created": { projectId: string };
  "channel.connected": { platform: string; profileId: string };
  "schedule.published": { scheduleId: string; platforms: string[] };
  "license.refreshed": { tier: string };
  "deeplink.received": { sectionId: string; params: Record<string, string> };
};

type EventName = keyof EventMap;
type Listener<E extends EventName> = (payload: EventMap[E]) => void;

const listeners = new Map<EventName, Set<Listener<EventName>>>();

export function subscribe<E extends EventName>(event: E, fn: Listener<E>): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set<Listener<EventName>>();
    listeners.set(event, set);
  }
  set.add(fn as Listener<EventName>);
  return () => {
    listeners.get(event)?.delete(fn as Listener<EventName>);
  };
}

export function publish<E extends EventName>(event: E, payload: EventMap[E]): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      (fn as Listener<E>)(payload);
    } catch (err) {
      // Listeners must not break the bus. Log and continue.
      console.error(`[eventBus] listener for "${event}" threw:`, err);
    }
  }
}
