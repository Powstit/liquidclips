/**
 * StatePillNav · UI-2
 *
 * Carousel-style pill nav across the cockpit dock. Each pill represents one
 * module. The active pill gets the fuchsia fill + inner shadow; inactive pills
 * stay quiet. Click flips the active module — keyboard arrows move between.
 */

import type { ReactNode } from "react";

export interface PillSpec<K extends string> {
  id: K;
  label: string;
  icon: ReactNode;
}

export interface StatePillNavProps<K extends string> {
  items: ReadonlyArray<PillSpec<K>>;
  active: K;
  onChange: (id: K) => void;
}

export function StatePillNav<K extends string>({ items, active, onChange }: StatePillNavProps<K>) {
  return (
    <nav className="lc-cd-pills" role="tablist" aria-label="Cockpit modules">
      {items.map((it, idx) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={`lc-cd-pill ${on ? "on" : ""}`}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") onChange(items[(idx + 1) % items.length].id);
              else if (e.key === "ArrowLeft") onChange(items[(idx - 1 + items.length) % items.length].id);
            }}
          >
            <span className="lc-cd-pill-ico" aria-hidden="true">{it.icon}</span>
            <span className="lc-cd-pill-label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
