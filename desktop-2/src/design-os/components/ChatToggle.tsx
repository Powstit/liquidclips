/**
 * ChatToggle · v2.2.10
 *
 * Floating bottom-right button that opens the ChatPanel overlay. Lives
 * in AppShell (not ConsoleNav) so the existing 11-item left rail is not
 * disturbed — that preserves the pinned Workstation visual baseline.
 *
 * The visual test masks the toggle's data-testid region so any future
 * pixel-level work on the button does not drift the baseline; functional
 * tests assert behaviour via the testid directly.
 */
import { useState } from "react";

import { ChatPanel } from "./ChatPanel";

export function ChatToggle(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="lc-chat-toggle"
        data-testid="lc-chat-toggle"
        data-open={open}
        onClick={() => setOpen((p) => !p)}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
        aria-controls="lc-chat-panel"
      >
        {open ? "×" : "💬"}
      </button>
      <ChatPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
