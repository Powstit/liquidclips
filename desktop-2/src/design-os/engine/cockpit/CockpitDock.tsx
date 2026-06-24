/**
 * CockpitDock · UI-2
 *
 * The persistent bottom-cockpit. Replaces the UI-1 label-strip placeholder.
 *
 * Composition:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [Clip pill]   [Reaction] [Caption] [Trim] [Style] [Sched.] │
 *   │   [Publish]                                  [Back to Home] │
 *   ├────────────────────────────────────────────────────────────┤
 *   │   ActiveModule body (Reaction / Caption / Trim / Style …)  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Portaled to body (escapes the legacy `.lc-section` containing block).
 * Settings are per-clip; switching focused clip reseeds defaults.
 */

import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { bus, useEvent } from "../../bridge";
import { useModalPortal } from "../../components/ModalPortal";
import { useCockpit } from "./CockpitContext";
import { StatePillNav, type PillSpec } from "./StatePillNav";
import { ReactionModule } from "./ReactionModule";
import { CaptionModule }  from "./CaptionModule";
import { TrimModule }     from "./TrimModule";
import { StyleModule }    from "./StyleModule";
import { ScheduleModule } from "./ScheduleModule";
import { PublishModule }  from "./PublishModule";
import "./CockpitDock.css";

const DOCK_OPEN_KEY = "lc.dock.open";

function readPersistedOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(DOCK_OPEN_KEY);
    return raw === null ? true : raw === "1";
  } catch { return true; }
}

export type ModuleKey =
  | "reaction" | "caption" | "trim" | "style" | "schedule" | "publish";

const PILLS: ReadonlyArray<PillSpec<ModuleKey>> = [
  { id: "reaction", label: "Reaction", icon: <IconReaction /> },
  { id: "caption",  label: "Caption",  icon: <IconCaption /> },
  { id: "trim",     label: "Trim",     icon: <IconTrim /> },
  { id: "style",    label: "Style",    icon: <IconStyle /> },
  { id: "schedule", label: "Schedule", icon: <IconSchedule /> },
  { id: "publish",  label: "Publish",  icon: <IconPublish /> },
];

/**
 * CockpitDock — pure consumer of `useCockpit()`.
 *
 * BUG-032 P0 lift · the `CockpitProvider` now lives one level higher, in
 * `Workstation.tsx`, so the dock and the focused-clip preview
 * (`ClipPreviewShell`) share the same context value. The dock no longer
 * wraps its own provider and no longer falls back to `FIXTURE_PROJECT` —
 * if there is no focused clip, the dock simply does not render.
 *
 * Required ancestors:
 *   <CockpitProvider clip={focusedClip} slug={slug}> ... <CockpitDock /> ...
 */
export function CockpitDock() {
  const modalHost = useModalPortal();
  if (!modalHost) return null;
  return createPortal(<DockShell />, modalHost);
}

function DockShell() {
  const [active, setActive] = useState<ModuleKey>("reaction");
  // Bug 2 · dock open/collapsed state. Defaults open (preserves first-run UX),
  // persists across reloads, and emits a CSS var on `<html>` so Workstation can
  // size its padding-bottom dynamically (Bug 3). The head strip stays visible
  // when collapsed so tabs + clip pill + Back-to-Home remain reachable.
  const [open, setOpen] = useState<boolean>(() => readPersistedOpen());
  const { focusedClip } = useCockpit();
  const rootRef = useRef<HTMLElement | null>(null);
  // Re-seed on clip switch lives inside CockpitProvider now (IG-LC2-018).
  // DockShell only needs the focused clip to label the head pill.

  // UI-3 · ClipCard "Export" CTA brings the user straight to the Publish module.
  // Also force-open the dock so the Publish module is actually visible.
  useEvent("clip:open-export", () => {
    setActive("publish");
    setOpen(true);
  });

  // BUG-031 · ClipCard "Edit" CTA brings the user into Reaction with the
  // dock guaranteed open. The accompanying onOpen callback in ClipCard has
  // already set focusedClipIdx in Workstation, so the cockpit re-seeds from
  // the new clip's persisted settings the next render tick.
  useEvent("clip:open-edit", () => {
    setActive("reaction");
    setOpen(true);
  });

  // Persist open state.
  useEffect(() => {
    try { window.localStorage.setItem(DOCK_OPEN_KEY, open ? "1" : "0"); } catch { /* noop */ }
  }, [open]);

  // Bug 3 · publish the live dock height as `--lc-dock-h` on the documentElement.
  // Workstation.css consumes this var for `padding-bottom`, so when the dock
  // collapses (or the viewport changes) the dead gap closes immediately.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const write = (h: number) => {
      document.documentElement.style.setProperty("--lc-dock-h", `${Math.round(h)}px`);
    };
    write(el.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) write(e.contentRect.height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--lc-dock-h");
    };
  }, []);

  const ActiveBody = useMemo(() => {
    switch (active) {
      case "reaction": return <ReactionModule />;
      case "caption":  return <CaptionModule />;
      case "trim":     return <TrimModule />;
      case "style":    return <StyleModule />;
      case "schedule": return <ScheduleModule />;
      case "publish":  return <PublishModule />;
    }
  }, [active]);

  const dur = focusedClip.duration_s ?? Math.max(1, focusedClip.end - focusedClip.start);

  return (
    <aside
      ref={rootRef}
      className="lc-cockpit-dock"
      data-module={active}
      data-open={open ? "1" : "0"}
    >
      <div className="lc-cd-head">
        <div className="lc-cd-clip" aria-label={`Focused clip · ${focusedClip.title}`}>
          <span className="lc-cd-clip-num">#{focusedClip.idx + 1}</span>
          <span className="lc-cd-clip-title">{focusedClip.title}</span>
          <span className="lc-cd-clip-meta">{fmtSec(dur)} · score {focusedClip.score ?? "—"}</span>
        </div>

        <StatePillNav items={PILLS} active={active} onChange={setActive} />

        <div className="lc-cd-actions">
          <button
            type="button"
            className="lc-cd-toggle"
            aria-expanded={open}
            aria-label={open ? "Collapse cockpit" : "Expand cockpit"}
            title={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronIcon open={open} />
          </button>
          <button
            type="button"
            className="lc-cd-back"
            onClick={() => bus.emit("nav:click", { route: "home" })}
          >Back to Home</button>
        </div>
      </div>

      {open && (
        <div className="lc-cd-panel" role="tabpanel" aria-label={active}>
          {ActiveBody}
        </div>
      )}
    </aside>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 180ms ease" }}
    >
      <path d="M6 15 L12 9 L18 15" />
    </svg>
  );
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/* ============================================================
   Inline state-pill icons — code, not assets.
   ============================================================ */

function IconReaction() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="13" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}
function IconCaption() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <line x1="7" y1="14" x2="13" y2="14" />
      <line x1="7" y1="17" x2="17" y2="17" />
    </svg>
  );
}
function IconTrim() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M7 7 v10" />
      <path d="M17 7 v10" />
      <circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconStyle() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19 L8 6 L12 14 L16 4 L19 19" />
    </svg>
  );
}
function IconSchedule() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9 v4 l2.5 1.6" />
      <path d="M9 3 l-2 2" />
      <path d="M15 3 l2 2" />
    </svg>
  );
}
function IconPublish() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14 v4 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 v-4" />
      <line x1="12" y1="4" x2="12" y2="15" />
      <path d="M7 9 L12 4 L17 9" />
    </svg>
  );
}
