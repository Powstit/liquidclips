"use client";

import {
  LAYOUT_TOPOLOGY,
  type Cell,
} from "./layout-cells";
import type { LayoutKey } from "./LayoutIcon";

export function LayoutCellDiagram({
  kind,
  sourcePath,
}: {
  kind: LayoutKey;
  sourcePath: string | null;
}) {
  const topology = LAYOUT_TOPOLOGY[kind];
  const sourceName = sourcePath?.split("/").pop() ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>{kind === "none" ? "layout" : "b-roll layout"}</span>
        <span>{topology.label}</span>
      </div>

      {/* Read-only launch diagram. The backend currently supports one b-roll
          source + main audio; advanced per-cell/audio editing stays hidden
          until the renderer supports it end-to-end. */}
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-xl border border-line bg-ink">
        {topology.cells.map((cell) => (
          <CellTile
            key={cell.role}
            cell={cell}
            sourceName={cell.isMain ? "main clip" : sourceName}
          />
        ))}
      </div>

      <div className="rounded-xl border border-line bg-paper p-3.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          renderer
        </div>
        <p className="mt-1 font-sans text-[12px] leading-relaxed text-ink">
          {kind === "none"
            ? "Full-frame clip. Pick a b-roll layout above to combine this clip with one source."
            : sourceName
            ? `Using ${sourceName}. Main clip audio is preserved.`
            : "Pick a layout above, then choose one b-roll source."}
        </p>
      </div>
    </div>
  );
}

function CellTile({
  cell,
  sourceName,
}: {
  cell: Cell;
  sourceName: string | null;
}) {
  const style: React.CSSProperties = {
    left: `${cell.rect.x * 100}%`,
    top: `${cell.rect.y * 100}%`,
    width: `${cell.rect.w * 100}%`,
    height: `${cell.rect.h * 100}%`,
  };
  const filled = cell.isMain || !!sourceName;
  return (
    <div
      style={style}
      className={`absolute flex flex-col justify-between p-2 ring-1 ring-paper/30 ${
        filled ? "bg-paper-warm/95" : "bg-ink"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={`font-mono text-[9px] uppercase tracking-[0.12em] ${filled ? "text-ink" : "text-paper/60"}`}>
          {cell.isMain ? "main" : cell.role}
        </span>
        {cell.isMain && (
          <span className="rounded-full bg-fuchsia px-1.5 py-0.5 font-mono text-[8px] uppercase text-paper">
            audio
          </span>
        )}
      </div>
      <span className={`truncate text-left font-sans text-[10px] ${filled ? "text-text-secondary" : "text-paper/60"}`}>
        {cell.isMain
          ? "from this clip"
          : sourceName
          ? sourceName
          : "b-roll source"}
      </span>
    </div>
  );
}
