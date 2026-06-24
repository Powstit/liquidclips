// Script drawer — uses shared WorkWindowChrome.
// Simulator only — no real transcript/lift pipeline.

import { FileText, Wand2, Scissors, ArrowRight } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Textarea } from "../ui/Textarea";
import { Badge } from "../ui/Badge";
import { WorkWindowChrome } from "./WorkWindowChrome";

interface ScriptDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenEngine: () => void;
}

export function ScriptDrawer({ open, onClose, onOpenEngine }: ScriptDrawerProps): JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title="Script">
      <WorkWindowChrome
        icon={<FileText size={26} strokeWidth={1.4} />}
        title="Write script"
        subtitle="Write hooks and turn scripts into clip rows."
        badge={<Badge tone="soon">SOON</Badge>}
        primary={
          <button type="button" className="lc-btn" data-variant="primary" onClick={onOpenEngine}>
            <FileText size={14} /> Write script
          </button>
        }
        secondary={
          <>
            <button type="button" className="lc-btn" data-variant="secondary" data-size="sm" onClick={onOpenEngine}>
              <Wand2 size={14} /> Generate hooks
            </button>
            <button type="button" className="lc-btn" data-variant="secondary" data-size="sm" onClick={onOpenEngine}>
              <Scissors size={14} /> Turn script into clips
            </button>
          </>
        }
        handoff={
          <button type="button" className="lc-btn" data-variant="ghost" data-size="sm" onClick={onOpenEngine}>
            <ArrowRight size={14} /> Open script placeholder
          </button>
        }
      >
        <Textarea
          rows={5}
          placeholder="Paste or write your script here…"
        />
      </WorkWindowChrome>
    </Sheet>
  );
}
