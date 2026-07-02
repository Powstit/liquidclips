import { useCallback, useSyncExternalStore } from "react";

export type PresenceVisibility = "online" | "invisible";

const STORAGE_KEY = "lc.community.visibility.v1";
const listeners = new Set<() => void>();

function read(): PresenceVisibility {
  if (typeof window === "undefined") return "online";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "invisible"
      ? "invisible"
      : "online";
  } catch {
    return "online";
  }
}

let current: PresenceVisibility = read();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(next: PresenceVisibility): void {
  current = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Private mode/quota: keep the control usable in memory this render. */
    }
  }
  for (const listener of listeners) listener();
}

export function usePresencePreference(): {
  visibility: PresenceVisibility;
  setVisibility: (next: PresenceVisibility) => void;
} {
  const visibility = useSyncExternalStore<PresenceVisibility>(
    subscribe,
    () => current,
    () => "online",
  );
  const setVisibility = useCallback((next: PresenceVisibility) => write(next), []);
  return { visibility, setVisibility };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = read();
    for (const listener of listeners) listener();
  });
}
