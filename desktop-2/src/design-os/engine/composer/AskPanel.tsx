/**
 * AskPanel · Composer Phase 1b
 *
 * Reusable multiple-choice card. When the router returns
 * { kind: "ask", capability, needsAsk } the Composer mounts this panel
 * over the canvas. User taps an option → onResolve(paramName, value) fires
 * and Composer continues the flow.
 *
 * The panel renders the FIRST unresolved param in needsAsk. Options are
 * pulled from capability.params[paramName].options and reduced via
 * narrowOptions(options, session) — so the user sees at most 2 tap-choices
 * whenever the router can confidently narrow.
 *
 * Each option renders via 3-tier fallback:
 *   1. Named symbol → dangerouslySetInnerHTML with SYMBOLS[opt.symbol]
 *   2. Shape hint → renderShape(opt.shape) (returns SVG string)
 *   3. Text-only chip with opt.label
 *
 * Radix Dialog is NOT installed (verified 2026-07-18 · package.json). We
 * fall back to a plain div with role="dialog" + aria-modal + manual focus
 * trap. Kade bubbles "Which one?" via bus.emit("kade:speak", …).
 *
 * IRON GATE IG-LC2-016 is preserved — this panel does NOT touch
 * useCockpit().focusedClip. The Composer's Ask flow works even when no
 * clip is selected because the ask-panel is capability-scoped, not
 * clip-scoped.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import { bus } from "../../bridge";
import type {
  Capability,
  CapabilityParam,
  CapabilityParamOption,
} from "./capabilities";
import { SYMBOLS } from "./SYMBOLS";
import { renderShape, type ShapeDescriptor } from "./shapes";
import { narrowOptions, type SessionState } from "./router";
import "./AskPanel.css";

export interface AskPanelRequest {
  name: string;
  spec: CapabilityParam;
}

export interface AskPanelProps {
  capability: Capability;
  needsAsk: AskPanelRequest[];
  onResolve: (paramName: string, value: unknown) => void;
  onDismiss: () => void;
  session: SessionState;
}

/**
 * Manual focus trap · keeps Tab / Shift+Tab inside the ask-panel while it's
 * mounted. Escape closes.
 */
function useFocusTrap(
  panelRef: React.RefObject<HTMLDivElement>,
  onDismiss: () => void,
) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // Focus first option on mount
    const firstBtn = panel.querySelector<HTMLButtonElement>(
      "button.ask-option",
    );
    firstBtn?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("button.ask-option"),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelRef, onDismiss]);
}

/**
 * Toggle `data-canvas-asking` on the closest ancestor with
 * `data-canvas-loaded` — dims material while the ask-panel is open.
 * Preserved from the simulator's idle-state fix.
 */
function useCanvasAskingAttribute(
  panelRef: React.RefObject<HTMLDivElement>,
) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const canvas = panel.closest<HTMLElement>("[data-canvas-loaded]");
    if (!canvas) return;
    canvas.setAttribute("data-canvas-asking", "true");
    return () => {
      canvas.removeAttribute("data-canvas-asking");
    };
  }, [panelRef]);
}

/**
 * Render an option's glyph slot using the 3-tier fallback.
 * Returns null when nothing renders (caller drops the glyph frame).
 */
function OptionGlyph({
  option,
}: {
  option: CapabilityParamOption;
}): ReactElement | null {
  if (option.symbol && SYMBOLS[option.symbol]) {
    return (
      <span
        className="ask-option-glyph"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: SYMBOLS[option.symbol] }}
      />
    );
  }
  if (option.shape) {
    const svg = renderShape(option.shape as ShapeDescriptor);
    if (svg) {
      return (
        <span
          className="ask-option-glyph"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      );
    }
  }
  return null;
}

export function AskPanel(props: AskPanelProps): ReactElement | null {
  const { capability, needsAsk, onResolve, onDismiss, session } = props;
  const panelRef = useRef<HTMLDivElement>(null);

  const current = needsAsk[0] ?? null;

  const options = useMemo<CapabilityParamOption[]>(() => {
    if (!current) return [];
    const raw = current.spec.options ?? [];
    return narrowOptions(raw, session);
  }, [current, session]);

  // Kade bubble on mount / param-change
  useEffect(() => {
    if (!current) return;
    const prompt =
      current.spec.ask_prompt ?? `Which ${current.name}?`;
    bus.emit("kade:speak", {
      title: "Which one?",
      body: prompt,
      severity: "info",
    });
  }, [current]);

  useFocusTrap(panelRef, onDismiss);
  useCanvasAskingAttribute(panelRef);

  const handlePick = useCallback(
    (opt: CapabilityParamOption) => {
      if (!current) return;
      onResolve(current.name, opt.value);
      onDismiss();
    },
    [current, onResolve, onDismiss],
  );

  if (!current) return null;

  const promptLabel = capability.params[current.name]?.ask_prompt ?? "Which one?";
  const optionCount = options.length;

  // Scale-in style · set data-visible after first paint so CSS transitions fire
  const visibleStyle: CSSProperties = {};

  return (
    <div
      ref={panelRef}
      className="ask-panel"
      data-visible="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-panel-title"
      aria-describedby="ask-panel-hint"
      style={visibleStyle}
      tabIndex={-1}
    >
      <div className="ask-panel-header">
        <span className="ask-panel-eb">{capability.label}</span>
        <span id="ask-panel-title" className="ask-panel-title">
          {promptLabel}
        </span>
      </div>

      <div
        className="ask-panel-options"
        data-count={String(optionCount)}
        role="group"
        aria-label={promptLabel}
      >
        {options.map((opt, idx) => (
          <button
            key={`${opt.value}-${idx}`}
            type="button"
            className="ask-option"
            onClick={() => handlePick(opt)}
          >
            <OptionGlyph option={opt} />
            <span className="ask-option-label">{opt.label}</span>
            {opt.hint ? (
              <span className="ask-option-hint">{opt.hint}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div id="ask-panel-hint" className="ask-panel-hint">
        Tap to pick · Esc to close
      </div>
    </div>
  );
}

export default AskPanel;
