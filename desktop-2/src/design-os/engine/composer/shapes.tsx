/**
 * Composer shape-primitive renderer · Phase 1a
 *
 * Ports `renderShape(shape)` from
 *   desktop-2/docs/mockups/proposed/kade-composer-simulator.html (~line 3449-3482)
 *
 * Returns a compositional SVG string when a param option has no `symbol`
 * but a `shape` descriptor. Rendered inside the ask-panel glyph slot.
 *
 * Supported kinds (Phase 1a):
 *   - position-corner   · dot in one of 4 corners of a 9:16 frame
 *   - position-bar      · horizontal bar at top / mid / bottom of a 9:16 frame
 *   - layout-split      · single-line split (h or v) inside a 9:16 frame
 *   - slider-mark       · horizontal slider with handle at 0..1 position
 *   - aspect-vertical   · 9:16 outline
 *   - aspect-horizontal · 16:9 outline
 *   - aspect-square     · 1:1 outline
 *
 * No React. Returns a raw SVG string so the ask-panel can render via
 *   dangerouslySetInnerHTML.
 */

export interface ShapeDescriptor {
  kind: string;
  where?: string;
  axis?: "h" | "v";
  value?: number;
  [k: string]: unknown;
}

/**
 * Render a compositional SVG string for a shape descriptor.
 * Empty string on missing / unknown kinds.
 */
export function renderShape(shape: ShapeDescriptor | null | undefined): string {
  if (!shape || !shape.kind) return "";

  // 9:16 aspect · width 24 · height 42 (roughly 4:7 — matches simulator)
  const W = 24;
  const H = 42;
  const rectBg = `<rect x="1" y="1" width="${W - 2}" height="${
    H - 2
  }" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>`;

  if (shape.kind === "position-corner") {
    const w = shape.where || "bottom-right";
    const pad = 5;
    let cx = W - pad;
    let cy = H - pad;
    if (w === "top-left") {
      cx = pad;
      cy = pad;
    } else if (w === "top-right") {
      cx = W - pad;
      cy = pad;
    } else if (w === "bottom-left") {
      cx = pad;
      cy = H - pad;
    } else if (w === "bottom-right") {
      cx = W - pad;
      cy = H - pad;
    }
    return `<svg viewBox="0 0 ${W} ${H}" fill="none">${rectBg}<circle cx="${cx}" cy="${cy}" r="2.6" fill="#ff1a8c"/></svg>`;
  }

  if (shape.kind === "position-bar") {
    const w = shape.where || "bottom";
    let y: number;
    if (w === "top") y = 4;
    else if (w === "mid") y = H / 2 - 1.5;
    else y = H - 7; // bottom
    return `<svg viewBox="0 0 ${W} ${H}" fill="none">${rectBg}<rect x="4" y="${y}" width="${
      W - 8
    }" height="3" rx="0.5" fill="#ff1a8c"/></svg>`;
  }

  if (shape.kind === "layout-split") {
    const axis = shape.axis || "h";
    const line =
      axis === "h"
        ? `<path d="M2 ${H / 2} L${W - 2} ${H / 2}" stroke="currentColor" stroke-width="1.4"/>`
        : `<path d="M${W / 2} 2 L${W / 2} ${H - 2}" stroke="currentColor" stroke-width="1.4"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" fill="none">${rectBg}${line}</svg>`;
  }

  if (shape.kind === "slider-mark") {
    const v = Math.max(0, Math.min(1, shape.value ?? 0.5));
    const cx = 3 + v * (W - 6);
    return `<svg viewBox="0 0 ${W} ${H}" fill="none"><line x1="3" y1="${H / 2}" x2="${
      W - 3
    }" y2="${H / 2}" stroke="currentColor" stroke-width="1.4"/><circle cx="${cx}" cy="${
      H / 2
    }" r="3.2" fill="#ff1a8c"/></svg>`;
  }

  // ------------------------------------------------------------------------
  // Aspect outlines (new · used by canvas.set-aspect capability)
  // ------------------------------------------------------------------------
  if (shape.kind === "aspect-vertical") {
    // 9:16
    return `<svg viewBox="0 0 24 42" fill="none"><rect x="4" y="1" width="16" height="40" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>`;
  }
  if (shape.kind === "aspect-horizontal") {
    // 16:9
    return `<svg viewBox="0 0 42 24" fill="none"><rect x="1" y="4" width="40" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>`;
  }
  if (shape.kind === "aspect-square") {
    // 1:1
    return `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>`;
  }

  return "";
}

/** List of shape kinds this renderer supports · handy for consumer introspection. */
export const SUPPORTED_SHAPE_KINDS = [
  "position-corner",
  "position-bar",
  "layout-split",
  "slider-mark",
  "aspect-vertical",
  "aspect-horizontal",
  "aspect-square",
] as const;

export type ShapeKind = (typeof SUPPORTED_SHAPE_KINDS)[number];
