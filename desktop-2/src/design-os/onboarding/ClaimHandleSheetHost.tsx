/**
 * ClaimHandleSheetHost · Wave 1 gap-closure (2026-07-12).
 *
 * Top-level mount host for :func:`ClaimHandleSheet`. Listens for the
 * ``identity:open-claim-sheet`` bus event and opens the sheet with the
 * matching ``mountReason``. Mounted once at the design-os AppShell so
 * every route can trigger the sheet without threading a mount prop
 * through the tree.
 *
 * Separate from :file:`ClaimHandleSheet.tsx` so the sheet itself stays
 * as a pure component; the host owns the imperative open/close state
 * driven by bus events.
 */

import { useCallback, useEffect, useState } from "react";
import { useEvent } from "../bridge";
import type { ClaimSheetMountReason } from "./ClaimHandleSheet";
import { ClaimHandleSheet } from "./ClaimHandleSheet";

export function ClaimHandleSheetHost(): React.ReactElement | null {
  const [open, setOpen] = useState<{ mountReason: ClaimSheetMountReason } | null>(null);

  useEvent("identity:open-claim-sheet", (payload) => {
    setOpen({ mountReason: payload.mountReason });
  });

  // Close on Escape (defensive: the sheet also handles Escape locally
  // but if it's null-rendered while closing the local handler wouldn't
  // fire).
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onClose = useCallback(() => setOpen(null), []);

  if (open === null) return null;
  return (
    <ClaimHandleSheet
      mountReason={open.mountReason}
      onClose={onClose}
    />
  );
}
