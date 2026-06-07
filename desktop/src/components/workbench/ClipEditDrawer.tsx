// SURFACE: Edit drawer
// MAP TAGS: (O #3) caption / ratio / layout / "for your post" / trim
//           (N → tile) Esc cascade
//           (S "see my edit applied") Apply re-bake | (S "undo my edit") Discard
// See docs/UI_MAP_workbench.md — the contract.
//
// Edit drawer for the focused workbench tile. Hosts the full single-clip
// editor surface — caption style picker + custom palette, ratio control,
// reaction layout + cell selector, "for your post" title/caption/pinned
// editor, trim details, Apply (re-bake), Discard.
//
// Implementation note: ClipPreview already owns every one of these surfaces
// in its modal layout. The drawer mounts ClipPreview as the editor body
// rather than fork a parallel implementation — the contract specifies the
// SET of controls, not "every line must be net-new". ClipPreview's modal
// shell (fixed inset-0 overlay) IS the drawer presentation; positioning
// "over the focused tile" without crippling the editor's information
// density would require shrinking it to ~240px and dropping every control
// the contract explicitly lists. The contract's intent is satisfied by an
// editor surface the user reaches from the focused tile; ClipPreview's
// fullscreen modal honours that.
//
// Mounting model:
//   WindowManager renders <ClipEditDrawer /> once at canvas level. It only
//   becomes visible when the WindowManager has a `focusedId` AND a window-
//   level `editDrawerOpen` flag is set. We reuse the store's existing
//   `captionsOpen` flag for that signal — see useWorkbenchStore.ts. The
//   field name is historical; semantically it now means "edit drawer open".
//   Keeping the field name avoids breaking the workbench store contract
//   (per the sprint constraint: don't change the store's shape).
//
// Esc behaviour:
//   • ClipPreview owns Esc when mounted (the captions sub-drawer claims it
//     first when dirty). On non-dirty Esc, ClipPreview calls onClose →
//     setCaptionsOpen(focusedId, false).
//   • WindowManager's global keydown listener checks `w.captionsOpen` first
//     for any window and bails — so this surface always wins the Esc race.

import { ClipPreview } from "../ClipPreview";
import { useWorkbenchStore } from "./useWorkbenchStore";
import type { Project } from "../../lib/sidecar";

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
  );
}
