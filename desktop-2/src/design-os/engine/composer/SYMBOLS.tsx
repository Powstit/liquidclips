/**
 * Composer SYMBOL library · Phase 1a
 *
 * Ported verbatim from
 *   desktop-2/docs/mockups/proposed/kade-composer-simulator.html (~line 3406-3442)
 *
 * Every glyph:
 *   - `viewBox="0 0 24 24"` unless noted
 *   - `stroke="currentColor"` so brand tokens paint them
 *   - Kept under ~300 chars each · these are hints, not artwork
 *
 * Consumers should render as:
 *   <span dangerouslySetInnerHTML={{ __html: SYMBOLS[key] }} />
 * or via the helper below.
 *
 * 29 symbols total (28 spec + `caption-clean` new 4th caption glyph).
 */

export const SYMBOLS: Record<string, string> = {
  // Layout hints
  "layout-pip":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="13" y="13" width="7" height="6" rx="1" fill="currentColor" stroke="none"/></svg>',
  "layout-split-h":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/></svg>',
  "layout-split-v":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></svg>',
  "layout-full":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" fill-opacity="0.3"/></svg>',
  "layout-grid":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/></svg>',

  // Corner hints
  "corner-tl":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="7" cy="7" r="2.5" fill="currentColor"/></svg>',
  "corner-tr":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="17" cy="7" r="2.5" fill="currentColor"/></svg>',
  "corner-bl":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="7" cy="17" r="2.5" fill="currentColor"/></svg>',
  "corner-br":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="17" cy="17" r="2.5" fill="currentColor"/></svg>',

  // Audio + capture hints
  waveform:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h2l2-6 3 12 2-8 2 5 2-3 3 6 2-4h1"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 12a7 7 0 0 0 14 0M12 19v3"/></svg>',
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg>',
  screen:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  window:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/></svg>',
  speaker:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6h4l6 4V5l-6 4z"/><path d="M17 8a5 5 0 0 1 0 8"/></svg>',

  // Caption style hints
  "caption-bold":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 5h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z"/></svg>',
  "caption-pop":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l3 12M9 6l-3 12M14 6h5M14 6v12h5M14 12h4" stroke-width="2.5"/><circle cx="20" cy="4" r="2" fill="currentColor"/></svg>',
  "caption-subtle":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 8h16M4 12h12M4 16h14"/></svg>',
  // New · monospace ABC for the mono-clean 4th caption style
  "caption-clean":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" font-family="ui-monospace,monospace"><rect x="2" y="6" width="20" height="12" rx="1.5"/><text x="12" y="15.5" font-size="8" text-anchor="middle" fill="currentColor" stroke="none" font-family="ui-monospace,monospace" font-weight="600">ABC</text></svg>',

  // Watermark hints
  "watermark-br":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="14" y="16" width="5" height="3" rx="0.5" fill="currentColor"/></svg>',
  "watermark-bl":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="5" y="16" width="5" height="3" rx="0.5" fill="currentColor"/></svg>',
  "watermark-bar":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="5" y="17" width="14" height="2.5" rx="0.5" fill="currentColor"/></svg>',

  // Generic UI hints
  sparkle:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z"/></svg>',
  checkmark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5L20 6"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',

  // Duck / silence + music hints
  duck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-6 4 12 3-6h4"/><path d="M20 6l-2 2M18 6l2 2" stroke-width="1.5"/></svg>',
  music:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
};

/** Lookup helper · returns empty string when the key is unknown. */
export function getSymbol(key: string | undefined | null): string {
  if (!key) return "";
  return SYMBOLS[key] ?? "";
}

/** Named keys of the SYMBOL library · handy for type-narrowing in consumers. */
export type SymbolKey = keyof typeof SYMBOLS;
