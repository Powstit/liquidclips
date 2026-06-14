// v0.7.73 — dropContext.
//
// Tiny module-level ref that lets ProjectDetail register itself as the
// active Tauri file-drop target. The global file-drop listener in
// App.tsx (already wired pre-v0.7.73, single-listener) consults this
// before routing the dropped paths.
//
// Why not a second listener:
//   • Tauri's drop API is one global event per window. Registering a
//     second listener double-fires the existing workstation drop path,
//     breaking ingest. Single source of truth, multiple consumers.
//
// Why not React context:
//   • The drop happens at the OS level OUTSIDE React's render scope.
//     By the time the event fires the listener needs the active slug
//     synchronously, with no re-render race.

let _activeProjectSlug: string | null = null;
const _listeners = new Set<(slug: string | null) => void>();

/** Register the currently-active Project as the file-drop target.
 *  Call from ProjectDetail's mount effect. Pass `null` on unmount. */
export function setDropTarget(slug: string | null): void {
  if (_activeProjectSlug === slug) return;
  _activeProjectSlug = slug;
  for (const fn of _listeners) {
    try {
      fn(slug);
    } catch {
      /* listener errors must not break the setter */
    }
  }
}

/** Synchronous read for the Tauri file-drop listener. Returns the slug
 *  the dropped files should be attached to, or `null` if no Project
 *  Detail is currently mounted. */
export function getDropTarget(): string | null {
  return _activeProjectSlug;
}

/** Optional subscription for UI components that want to react to the
 *  drop-target state (e.g. dim Workstation drop affordance when a
 *  Project is the active target). Returns an unsubscribe. */
export function subscribeDropTarget(fn: (slug: string | null) => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
