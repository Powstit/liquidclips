// Dim layer rendered behind the BrowseOverlay. Pure black 55% + 6 px blur per
// Daniel's locked decision. Click the scrim to close.
//
// Mounted from <App>; only renders when the browser overlay is open.

import { useBrowseOverlay } from "../../state/browseOverlay";

export function BrowserScrim(): JSX.Element | null {
  const open = useBrowseOverlay((s) => s.open);
  const close = useBrowseOverlay((s) => s.close);
  if (!open) return null;
  return (
    <div
      className="lc-browse-scrim"
      role="presentation"
      onClick={close}
      aria-hidden="true"
    />
  );
}
