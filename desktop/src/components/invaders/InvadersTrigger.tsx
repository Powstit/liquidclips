import { useEffect, useState } from "react";
import { Button } from "../primitives";
import { openInvaders } from "../../lib/invaders/store";

type Props = {
  // Optional delay (ms) before the trigger shows. Defaults to 5000 — only
  // appears after 5s of waiting so it doesn't pop in for fast operations.
  delayMs?: number;
};

export function InvadersTrigger({ delayMs = 5000 }: Props) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);
  if (!visible) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={openInvaders}
      title="Play Invaders while you wait"
    >
      Play while it loads ▶
    </Button>
  );
}
