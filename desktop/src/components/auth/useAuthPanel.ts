import { useEffect, useState } from "react";
import type { AuthPanelMode } from "./AuthPanel";

// Singleton-style controller for AuthPanel. Any component (UpgradeLockCard,
// PublishModal, Settings, App quota wall) can dispatch a panel-open without
// the parent threading callbacks through every layer. App.tsx mounts ONE
// <AuthPanel /> subscribed to this store and reacts to dispatches.
//
// The pattern is intentionally tiny — no zustand, no context provider — just
// a module-level subscription set so anything in the tree can call
// openAuthPanel("upgrade") and the same modal pops.

type Listener = (mode: AuthPanelMode | null) => void;

const listeners = new Set<Listener>();
let currentMode: AuthPanelMode | null = null;

export function openAuthPanel(mode: AuthPanelMode): void {
  currentMode = mode;
  for (const listener of listeners) listener(mode);
}

export function closeAuthPanel(): void {
  currentMode = null;
  for (const listener of listeners) listener(null);
}

export function useAuthPanel(): { mode: AuthPanelMode | null; open: boolean } {
  const [mode, setMode] = useState<AuthPanelMode | null>(currentMode);

  useEffect(() => {
    const listener: Listener = (next) => setMode(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { mode, open: mode !== null };
}
