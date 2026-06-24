// Thumbnail drawer — uses shared WorkWindowChrome.
// Simulator only — no real thumbnail generator.

import { ImageIcon, Wand2, Link2, Plus, ArrowRight } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Badge } from "../ui/Badge";
import { WorkWindowChrome } from "./WorkWindowChrome";

interface ThumbnailDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenEngine: () => void;
}

export function ThumbnailDrawer({ open, onClose, onOpenEngine }: ThumbnailDrawerProps): JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title="Thumbnails">
      <WorkWindowChrome
        icon={<ImageIcon size={26} strokeWidth={1.4} />}
        title="Create thumbnails"
        subtitle="Generate a thumbnail pack from your source video."
        badge={<Badge tone="soon">SOON</Badge>}
        primary={
          <button type="button" className="lc-btn" data-variant="primary" onClick={onOpenEngine}>
            <Wand2 size={14} /> Generate thumbnails
          </button>
        }
        secondary={
          <>
            <button type="button" className="lc-btn" data-variant="secondary" data-size="sm" onClick={onOpenEngine}>
              <Plus size={14} /> Create 30 thumbnails
            </button>
            <button type="button" className="lc-btn" data-variant="secondary" data-size="sm" onClick={onOpenEngine}>
              <Link2 size={14} /> Use current source
            </button>
          </>
        }
        handoff={
          <button type="button" className="lc-btn" data-variant="ghost" data-size="sm" onClick={onOpenEngine}>
            <ArrowRight size={14} /> Open thumbnail placeholder
          </button>
        }
      />
    </Sheet>
  );
}
