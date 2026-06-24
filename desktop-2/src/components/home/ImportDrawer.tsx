// Import drawer — uses shared WorkWindowChrome so all three drawers
// (Import / Thumbnail / Script) share the same lead · body · footer rhythm.
// Simulator only — no real OS file picker or processing.

import { Upload, Link2, ArrowRight, HardDrive } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { WorkWindowChrome } from "./WorkWindowChrome";

interface ImportDrawerProps {
  open: boolean;
  onClose: () => void;
  onSendToEngine: () => void;
}

export function ImportDrawer({ open, onClose, onSendToEngine }: ImportDrawerProps): JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title="Import video">
      <WorkWindowChrome
        icon={<Upload size={26} strokeWidth={1.4} />}
        title="Drop video file"
        subtitle="Drag and drop a video here, or click to browse."
        primary={
          <button type="button" className="lc-btn" data-variant="primary" onClick={onSendToEngine}>
            <Upload size={14} /> Import video
          </button>
        }
        secondary={
          <button type="button" className="lc-btn" data-variant="secondary" data-size="sm" onClick={onSendToEngine}>
            <HardDrive size={14} /> Select source
          </button>
        }
        handoff={
          <button type="button" className="lc-btn" data-variant="ghost" data-size="sm" onClick={onSendToEngine}>
            <ArrowRight size={14} /> Send to Engine
          </button>
        }
      >
        <div className="lc-import-dropzone">
          <Upload size={36} strokeWidth={1.2} />
          <div className="lc-import-drop-formats">
            <Badge tone="default">MP4</Badge>
            <Badge tone="default">MOV</Badge>
            <Badge tone="default">MKV</Badge>
            <Badge tone="default">AVI</Badge>
          </div>
        </div>
        <div className="lc-import-url-row">
          <Link2 size={14} className="text-text-tertiary" />
          <Input placeholder="Or paste a YouTube / file URL…" />
        </div>
      </WorkWindowChrome>
    </Sheet>
  );
}
