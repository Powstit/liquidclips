// Minimal Collapsible wrapper for inline expand panels.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface CollapsibleProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

export function Collapsible({ open, children, className = "" }: CollapsibleProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);

  useEffect(() => {
    if (!ref.current) return;
    if (open) {
      setHeight(ref.current.scrollHeight);
      const id = setTimeout(() => setHeight(undefined), 250);
      return () => clearTimeout(id);
    }
    setHeight(ref.current.scrollHeight);
    const id = requestAnimationFrame(() => setHeight(0));
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <div
      className={["overflow-hidden transition-[height] duration-200 ease-out", className].join(" ")}
      style={{ height }}
    >
      <div ref={ref}>{children}</div>
    </div>
  );
}
