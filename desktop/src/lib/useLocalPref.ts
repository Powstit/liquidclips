import { useCallback, useEffect, useState } from "react";

// Tiny localStorage-backed preference hook. JSON serialization, SSR-safe
// initial read, and cross-tab sync via the `storage` event so two desktop
// webviews observing the same key stay in step. Throws-safe — quotaexceeded
// / private-mode failures fall back to in-memory state.

export function useLocalPref<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      if (raw == null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });

  const write = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Persisting failed — state still updates so the session works.
        }
        return resolved;
      });
    },
    [key],
  );

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== key || e.newValue == null) return;
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        // Ignore malformed cross-tab updates.
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return [value, write] as const;
}
