// Open/close signal for the Invaders overlay. Pub/sub pattern matches the
// existing lib/browse.ts singleton (see useBrowsePanel) so consumers don't
// need to lift state.

import { useEffect, useState } from "react";

type Listener = (open: boolean) => void;
let _open = false;
const listeners = new Set<Listener>();

export function openInvaders(): void {
  if (_open) return;
  _open = true;
  for (const l of listeners) l(true);
}

export function closeInvaders(): void {
  if (!_open) return;
  _open = false;
  for (const l of listeners) l(false);
}

export function useInvadersOpen(): boolean {
  const [open, setOpen] = useState(_open);
  useEffect(() => {
    listeners.add(setOpen);
    setOpen(_open);
    return () => { listeners.delete(setOpen); };
  }, []);
  return open;
}
