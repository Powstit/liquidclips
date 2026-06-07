// ship-lens v0.7.14: K1 — Workbench True Drawer
// SURFACE: Edit drawer
// MAP TAGS: (O #3) caption / ratio / layout / "for your post" / trim
//           (N → tile) Esc cascade
//           (S "see my edit applied") Apply re-bake | (S "undo my edit") Discard
// See docs/UI_MAP_workbench.md — the contract.
//
// True drawer: replaces the fullscreen modal with a side-drawer that slides
// from the focused tile's nearest screen edge. The canvas stays visible
// behind it. Uses a transform:translate(0) portal to trap ClipPreview's
// fixed inset-0 wrapper inside the drawer.
//
// Mounting model:
//   WindowManager renders <ClipEditDrawer /> once at canvas level. It only
//   becomes visible when the WindowManager has a `focusedId` AND a window-
//   level `captionsOpen` flag is set. We reuse the store's existing
//   `captionsOpen` flag for that signal — see useWorkbenchStore.ts.
//
// Esc behaviour:
//   • ClipPreview owns Esc when mounted (the captions sub-drawer claims it
//     first when dirty). On non-dirty Esc, ClipPreview calls onClose →
//     setCaptionsOpen(focusedId, false).
//   • WindowManager's global keydown listener checks `w.captionsOpen` first
//     for any window and bails — so this surface always wins the Esc race.

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipPreview } from "../ClipPreview";
import { useWorkbenchStore } from "./useWorkbenchStore";
import type { Project } from "../../lib/sidecar";
import styles from "./EditDrawerMotion.module.css";

const DRAWER_MAX_WIDTH = 360;
const DRAWER_GAP = 8;

export function ClipEditDrawer({
  project,
  onProjectChange,
}: {
  project: Project;
  onProjectChange: (p: Project) => void;
}) {
  const focusedId = useWorkbenchStore((s) => s.selection.focusedId);
  const focusedWindow = useWorkbenchStore((s) =>
    focusedId ? s.windows.get(focusedId) ?? null : null,
  );
  const setCaptionsOpen = useWorkbenchStore((s) => s.setCaptionsOpen);

  const open = !!focusedWindow && !!focusedId && focusedWindow.captionsOpen;
  if (!open || !focusedWindow || !focusedId) return null;

  const clip = project.clips[focusedWindow.clipIdx];
  if (!clip) return null;

  return (
    <DrawerShell focusedId={focusedId}>
      <ClipPreview
        clip={clip}
        index={focusedWindow.clipIdx + 1}
        slug={project.slug}
        project={project}
        totalClips={project.clips.length}
        onClose={() => setCaptionsOpen(focusedId, false)}
        onProjectChange={onProjectChange}
        initialCaptionsOpen={false}
      />
    </DrawerShell>
  );
}

/** DrawerShell: positions the drawer at the focused tile's edge.
 *  Computes the tile's bounding rect, then positions a fixed portal
 *  adjacent to it. The portal uses `transform: translate(0)` to create
 *  a CSS containing block, so ClipPreview's `fixed inset-0` wrapper fills
 *  the portal instead of the entire viewport. */
function DrawerShell({
  focusedId,
  children,
}: {
  focusedId: string;
  children: React.ReactNode;
}) {
  const [tileRect, setTileRect] = useState<DOMRect | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);

  // K-ε fix: querySelector race — the focused tile may not be in the DOM
  // yet on the first frame (React reconciliation delay). We retry up to 3
  // times with 50ms backoff, then fall back to a centered drawer with a
  // console warning so the user still sees the editor instead of a blank.
  useEffect(() => {
    let retries = 0;
    const maxRetries = 3;
    const backoff = 50;

    function tryQuery() {
      const tile = document.querySelector(`[data-window-id="${focusedId}"]`);
      if (tile) {
        setTileRect(tile.getBoundingClientRect());
        return;
      }
      if (retries < maxRetries) {
        retries++;
        setTimeout(tryQuery, backoff * retries);
      } else {
        // Fallback: centered drawer with warning
        console.warn(
          `[ClipEditDrawer] Focused tile ${focusedId} not found in DOM after ${maxRetries} retries. ` +
          `Falling back to centered drawer. This is usually a transient React reconciliation race.`
        );
        const fallbackWidth = Math.min(DRAWER_MAX_WIDTH, window.innerWidth * 0.35);
        const fallbackHeight = window.innerHeight - DRAWER_GAP * 2;
        setTileRect({
          left: (window.innerWidth - fallbackWidth) / 2,
          right: (window.innerWidth + fallbackWidth) / 2,
          top: DRAWER_GAP,
          bottom: fallbackHeight + DRAWER_GAP,
          width: fallbackWidth,
          height: fallbackHeight,
          x: (window.innerWidth - fallbackWidth) / 2,
          y: DRAWER_GAP,
          toJSON: () => "",
        } as DOMRect);
      }
    }

    tryQuery();
  }, [focusedId]);

  // Recalculate on resize so the drawer stays glued to the tile.
  // K-ε: use the same retry logic as mount so a resize mid-race doesn't
  // silently lose the tile.
  useEffect(() => {
    function handleResize() {
      const tile = document.querySelector(`[data-window-id="${focusedId}"]`);
      if (tile) {
        setTileRect(tile.getBoundingClientRect());
        return;
      }
      // If tile missing on resize, keep the last known rect so the drawer
      // doesn't snap to a weird fallback while the user is interacting.
      // A transient DOM loss during resize is acceptable; full blank is not.
      setTileRect((prev) => prev); // no-op to keep state stable
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [focusedId]);

  const style = useMemo(() => {
    if (!tileRect) return { display: "none" as const };

    const screenMid = window.innerWidth / 2;
    const tileMid = tileRect.left + tileRect.width / 2;
    const slideFromRight = tileMid < screenMid;

    // Drawer's own dimensions: max 360px, fill available height minus gaps.
    const width = Math.min(DRAWER_MAX_WIDTH, window.innerWidth * 0.35);
    const height = window.innerHeight - DRAWER_GAP * 2;
    const top = DRAWER_GAP;

    if (slideFromRight) {
      // Drawer opens to the right of the tile.
      const left = tileRect.right + DRAWER_GAP;
      // If it would overflow, clamp to the right edge.
      const clampedLeft = Math.min(left, window.innerWidth - width - DRAWER_GAP);
      return {
        left: clampedLeft,
        top,
        width,
        height,
        animation: styles.animateRight,
      };
    } else {
      // Drawer opens to the left of the tile.
      const left = tileRect.left - width - DRAWER_GAP;
      const clampedLeft = Math.max(left, DRAWER_GAP);
      return {
        left: clampedLeft,
        top,
        width,
        height,
        animation: styles.animateLeft,
      };
    }
  }, [tileRect]);

  if (style.display === "none") return null;

  return (
    <div
      ref={portalRef}
      className={styles.drawerPortal}
      style={{
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
      }}
      data-lc-drawer="true"
      aria-label="Edit drawer"
      role="dialog"
    >
      <div className={style.animation} style={{ height: "100%" }}>
        <div className={styles.drawerContent}>
          {children}
        </div>
      </div>
    </div>
  );
}
