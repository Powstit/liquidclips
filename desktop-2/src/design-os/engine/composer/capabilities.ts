/**
 * Composer capability graph · Phase 1a
 *
 * Port of the CAPABILITIES map from
 *   desktop-2/docs/mockups/proposed/kade-composer-simulator.html
 *
 * Each capability declares:
 *   - id / feature / module / label
 *   - `intents` regexes (used by router.matchCapability)
 *   - `params` (extract fn + option graph for the ask-panel)
 *   - `depends_on` / `feeds_into` (graph edges, informational for Phase 1)
 *   - `flow` name (matched against React-layer flow map in Phase 1b/1c)
 *   - `writes_to` dot-path into CockpitSettings (drift-mapped in enums below)
 *
 * CRITICAL · parameter drift
 * ---------------------------
 * The simulator invented friendly labels ("Bold", "Reactions PIP", "Reaction audio").
 * The real cockpit enums (verified 2026-07-18 from
 *   desktop-2/src/design-os/engine/cockpit/CockpitContext.tsx:31-48)
 * use different values. Every `params.<name>.options[].value` in this file
 * uses the REAL enum value; the `label` stays human-friendly.
 *
 * NOTE · `full-overlay` is a Phase 1c extension of ReactionLayoutKey.
 * The real union today is
 *   "solo" | "side-by-side" | "top-bottom" | "pip-tl" | "pip-tr" | "pip-bl" | "pip-br"
 * Phase 1c adds `"full-overlay"` — declared here as a valid write target.
 *
 * No React. No side effects. Pure data + regex.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CapabilityId = string;

export type ParamType = "enum" | "int" | "bool" | "string";

export interface CapabilityParamOption<T = string> {
  /** REAL enum value written into CockpitSettings (not the simulator's label) */
  value: T;
  /** Human-friendly label rendered by the AskPanel */
  label: string;
  /** Key into SYMBOLS map · optional */
  symbol?: string;
  /** Compositional shape fallback when no symbol is available */
  shape?: { kind: string; [k: string]: unknown };
  /** Secondary hint line under label in ask-panel */
  hint?: string;
}

export interface CapabilityParam<T = string> {
  type: ParamType;
  required?: boolean;
  ask_prompt?: string;
  options?: Array<CapabilityParamOption<T>>;
  default?: T;
  /** Regex/keyword extractor. Returns null if the raw query doesn't yield a value. */
  extract?: (text: string) => T | null;
  range?: [number, number];
}

export interface Capability {
  id: CapabilityId;
  feature: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "BASE";
  module: string;
  label: string;
  intents: RegExp[];
  params: Record<string, CapabilityParam>;
  depends_on: string[];
  feeds_into: string[];
  /** Matches a flow function name in the React layer (Phase 1b/1c). */
  flow: string;
  /** Dot-path into CockpitSettings — used by Phase 1b to translate resolved value → state write. */
  writes_to?: string;
}

// ---------------------------------------------------------------------------
// Drift-mapped enums · MUST match CockpitContext.tsx:31-48
// ---------------------------------------------------------------------------

/** Phase 1c EXTENDS ReactionLayoutKey with `"full-overlay"`. */
export type ComposerReactionLayoutKey =
  | "solo"
  | "side-by-side"
  | "top-bottom"
  | "pip-tl"
  | "pip-tr"
  | "pip-bl"
  | "pip-br"
  | "full-overlay";

export type ComposerReactionAudioSource = "main" | "broll" | "muted";

export type ComposerCaptionStyleKey =
  | "fuchsia-pop"
  | "mono-clean"
  | "amber-soft"
  | "cyan-bold";

export type ComposerCaptionPositionKey = "top" | "mid" | "bottom";

export type ComposerStylePresetKey = "uncle-daniel" | "mono" | "loud";

export type ComposerScheduleLane = "tiktok" | "youtube" | "instagram" | "x";
export type ComposerScheduleRepeat = "none" | "daily" | "weekly";

export type ComposerExportFormatKey = "mp4" | "mov";
export type ComposerExportPresetKey =
  | "9:16 · 1080p"
  | "1:1 · 1080p"
  | "16:9 · 1080p";

export type ComposerAspect = "9:16" | "16:9" | "1:1";

export type ComposerWatermarkPreset = "corner-br" | "corner-bl" | "full-bar";

// ---------------------------------------------------------------------------
// CAPABILITIES · 12 flows + 5 base actions = 17 total
// ---------------------------------------------------------------------------

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  // -------------------------------------------------------------------------
  // F5 · Reactions · add (with drift-mapped layout + audioSource)
  // -------------------------------------------------------------------------
  "reactions.add": {
    id: "reactions.add",
    feature: "F5",
    module: "reactions",
    label: "Add reaction",
    intents: [/\bmy\s+reaction\b/i, /\badd.*reaction\b/i, /\brecord.*reaction\b/i],
    params: {
      layout: {
        type: "enum",
        required: true,
        ask_prompt: "Which layout?",
        options: [
          // Simulator "PIP" → real enum default corner is top-right
          { value: "pip-tr", label: "PIP · top-right", symbol: "corner-tr" },
          { value: "pip-tl", label: "PIP · top-left", symbol: "corner-tl" },
          { value: "pip-br", label: "PIP · bottom-right", symbol: "corner-br" },
          { value: "pip-bl", label: "PIP · bottom-left", symbol: "corner-bl" },
          { value: "top-bottom", label: "Top / Bottom", symbol: "layout-split-h" },
          { value: "side-by-side", label: "Side by side", symbol: "layout-split-v" },
          { value: "full-overlay", label: "Full overlay", symbol: "layout-full" },
          { value: "solo", label: "Solo (no reaction)", symbol: "layout-full" },
        ],
        default: "pip-tr",
        extract: (t: string): string | null => {
          if (/\bpip\b|picture in picture/i.test(t)) {
            if (/top.?left|tl\b/i.test(t)) return "pip-tl";
            if (/bottom.?left|bl\b/i.test(t)) return "pip-bl";
            if (/bottom.?right|br\b/i.test(t)) return "pip-br";
            return "pip-tr"; // default corner
          }
          if (/top.*bottom|stack|horizontal split/i.test(t)) return "top-bottom";
          if (/side.*side|split vertical|left.*right/i.test(t)) return "side-by-side";
          if (/full.*overlay|takeover/i.test(t)) return "full-overlay";
          if (/\bsolo\b|no reaction/i.test(t)) return "solo";
          return null;
        },
      },
      audioSource: {
        type: "enum",
        required: false,
        ask_prompt: "Whose audio?",
        options: [
          { value: "main", label: "Main audio", symbol: "speaker" },
          { value: "broll", label: "Reaction audio", symbol: "waveform" },
          { value: "muted", label: "Duck audio", symbol: "duck" },
        ],
        default: "main",
        extract: (t: string): string | null => {
          if (/\bduck\b|mute|silence/i.test(t)) return "muted";
          if (/reaction audio|b.?roll|broll/i.test(t)) return "broll";
          if (/main audio|primary audio/i.test(t)) return "main";
          return null;
        },
      },
    },
    depends_on: ["slot.selected", "source.exists"],
    feeds_into: ["timeline.reaction_track", "ship.export"],
    flow: "flowReaction",
    writes_to: "reaction.layout",
  },

  // -------------------------------------------------------------------------
  // F5 · Reactions · beat-lock (deep sync)
  // -------------------------------------------------------------------------
  "reactions.beatlock": {
    id: "reactions.beatlock",
    feature: "F5",
    module: "reactions",
    label: "Lock reaction to beat",
    intents: [
      /sync reaction/i,
      /lock to beat/i,
      /reaction timing/i,
      /snap to beat/i,
      /beat lock/i,
    ],
    params: {},
    depends_on: ["reaction.exists", "audio.exists"],
    feeds_into: ["timeline.reaction_track"],
    flow: "flowReactionsDeep",
  },

  // -------------------------------------------------------------------------
  // F3 · Captions · style + position (drift-mapped to CaptionStyleKey)
  // -------------------------------------------------------------------------
  "captions.style": {
    id: "captions.style",
    feature: "F3",
    module: "captions",
    label: "Style captions",
    intents: [/\bcaptions?\b/i, /subtitle/i, /text style/i, /\bfont\b/i],
    params: {
      preset: {
        type: "enum",
        required: true,
        ask_prompt: "Which caption style?",
        options: [
          // Simulator "Bold" → fuchsia-pop
          { value: "fuchsia-pop", label: "Bold", symbol: "caption-bold" },
          // Simulator "Pop" → cyan-bold
          { value: "cyan-bold", label: "Pop", symbol: "caption-pop" },
          // Simulator "Subtle" → amber-soft
          { value: "amber-soft", label: "Subtle", symbol: "caption-subtle" },
          // Approved 4th style · mono-clean (new)
          { value: "mono-clean", label: "Clean", symbol: "caption-clean" },
        ],
        default: "fuchsia-pop",
        extract: (t: string): string | null => {
          if (/\bbold\b|fuchsia/i.test(t)) return "fuchsia-pop";
          if (/\bpop\b|karaoke|highlight|cyan/i.test(t)) return "cyan-bold";
          if (/\bsubtle\b|amber|small/i.test(t)) return "amber-soft";
          if (/\bclean\b|minimal|mono/i.test(t)) return "mono-clean";
          return null;
        },
      },
      position: {
        type: "enum",
        required: false,
        ask_prompt: "Where should the caption sit?",
        options: [
          { value: "top", label: "Top", shape: { kind: "position-bar", where: "top" } },
          { value: "mid", label: "Middle", shape: { kind: "position-bar", where: "mid" } },
          { value: "bottom", label: "Bottom", shape: { kind: "position-bar", where: "bottom" } },
        ],
        default: "bottom",
        extract: (t: string): string | null => {
          if (/\btop\b/i.test(t)) return "top";
          if (/\bmiddle\b|\bmid\b|centre|center/i.test(t)) return "mid";
          if (/\bbottom\b/i.test(t)) return "bottom";
          return null;
        },
      },
    },
    depends_on: ["source.exists"],
    feeds_into: ["ship.export"],
    flow: "flowCaptions",
    writes_to: "caption.style",
  },

  // -------------------------------------------------------------------------
  // F4 · Library search
  // -------------------------------------------------------------------------
  "library.search": {
    id: "library.search",
    feature: "F4",
    module: "library",
    label: "Find clip in library",
    intents: [/\bfind\b/i, /\bsearch\b/i, /\blibrary\b/i, /\bhormozi\b/i, /clip about/i],
    params: {},
    depends_on: [],
    feeds_into: ["region.push"],
    flow: "flowLibrary",
  },

  // -------------------------------------------------------------------------
  // F2 · Trim / cut
  // -------------------------------------------------------------------------
  "trim.cut": {
    id: "trim.cut",
    feature: "F2",
    module: "trim",
    label: "Trim clip",
    intents: [/\btrim\b/i, /\bcut\b/i, /boring intro/i, /\bshorten\b/i],
    params: {},
    depends_on: ["source.exists"],
    feeds_into: ["ship.export"],
    flow: "flowTrim",
  },

  // -------------------------------------------------------------------------
  // F1 · Discovery · find N clips
  // -------------------------------------------------------------------------
  "discovery.scrub": {
    id: "discovery.scrub",
    feature: "F1",
    module: "discovery",
    label: "Find 3 clips",
    intents: [
      /3 clips/i,
      /three clips/i,
      /find clips/i,
      /give me.*clips/i,
      /\bdiscover\b/i,
      /\bscrub\b/i,
    ],
    params: {},
    depends_on: ["source.exists"],
    feeds_into: ["clip.stack"],
    flow: "flowDiscovery",
  },

  // -------------------------------------------------------------------------
  // F7 · Campaign match
  // -------------------------------------------------------------------------
  "campaign.match": {
    id: "campaign.match",
    feature: "F7",
    module: "campaign",
    label: "Match this brief",
    intents: [
      /match this brief/i,
      /\bcampaign\b/i,
      /check the rules/i,
      /uncle daniel/i,
      /creator brief/i,
    ],
    params: {},
    depends_on: [],
    feeds_into: ["campaign.brief"],
    flow: "flowCampaign",
  },

  // -------------------------------------------------------------------------
  // F8 · Record · capture source picker
  // -------------------------------------------------------------------------
  "record.capture": {
    id: "record.capture",
    feature: "F8",
    module: "record",
    label: "Record capture",
    intents: [
      /record my screen/i,
      /screen record/i,
      /screen recording/i,
      /\bcapture\b/i,
      /^\s*record\s*$/i,
      /\brecord\b/i,
    ],
    params: {
      source: {
        type: "enum",
        required: true,
        ask_prompt: "Tutorial or normal?",
        options: [
          {
            value: "tutorial",
            label: "Tutorial · demo Kade",
            symbol: "sparkle",
            hint: "Kade stays in frame · watermark visible · get paid twice",
          },
          { value: "display", label: "Full screen", symbol: "screen" },
          { value: "window", label: "Just window", symbol: "window" },
          { value: "screen-mic", label: "Screen + mic", symbol: "mic" },
          { value: "camera", label: "Camera only", symbol: "camera" },
        ],
        default: "tutorial",
        extract: (t: string): string | null => {
          if (/tutorial|demo.*kade|record.*kade|record.*session|show.*tool|record.*tool/i.test(t))
            return "tutorial";
          if (/full screen|display|whole screen/i.test(t)) return "display";
          if (/\bwindow\b|just window|one window/i.test(t)) return "window";
          if (/\bmic\b|screen.*mic/i.test(t)) return "screen-mic";
          if (/\bcamera\b|just me|face only/i.test(t)) return "camera";
          return null;
        },
      },
    },
    depends_on: [],
    feeds_into: ["region.push"],
    flow: "flowRecord",
  },

  // -------------------------------------------------------------------------
  // F9 · Frame + hook text
  // -------------------------------------------------------------------------
  "frame.hook": {
    id: "frame.hook",
    feature: "F9",
    module: "frame",
    label: "Frame + hook text",
    intents: [
      /hook text/i,
      /add hook/i,
      /\bframe\b/i,
      /put text on it/i,
      /\b9:16\b/i,
      /safe.?zone/i,
    ],
    params: {},
    depends_on: ["source.exists"],
    feeds_into: ["ship.export"],
    flow: "flowFrame",
  },

  // -------------------------------------------------------------------------
  // F10 · Audio mix
  // -------------------------------------------------------------------------
  "audio.mix": {
    id: "audio.mix",
    feature: "F10",
    module: "audio",
    label: "Audio mix",
    intents: [/duck the audio/i, /add music/i, /mix audio/i, /duck audio/i, /\blofi\b/i],
    params: {},
    depends_on: ["source.exists"],
    feeds_into: ["ship.export"],
    flow: "flowAudio",
  },

  // -------------------------------------------------------------------------
  // F11 · Timeline
  // -------------------------------------------------------------------------
  "timeline.show": {
    id: "timeline.show",
    feature: "F11",
    module: "timeline",
    label: "Show timeline",
    intents: [
      /show timeline/i,
      /\btracks\b/i,
      /arrange tracks/i,
      /multi[-\s]?track/i,
      /\btimeline\b/i,
    ],
    params: {},
    depends_on: [],
    feeds_into: [],
    flow: "flowTimeline",
  },

  // -------------------------------------------------------------------------
  // F12 · Watermark
  // -------------------------------------------------------------------------
  "watermark.set": {
    id: "watermark.set",
    feature: "F12",
    module: "watermark",
    label: "Watermark",
    intents: [
      /show my watermark/i,
      /\bwatermark\b/i,
      /\breferral\b/i,
      /who gets paid/i,
      /my handle/i,
    ],
    params: {
      preset: {
        type: "enum",
        required: true,
        ask_prompt: "Which watermark preset?",
        options: [
          { value: "corner-br", label: "Corner · BR", symbol: "watermark-br" },
          { value: "corner-bl", label: "Corner · BL", symbol: "watermark-bl" },
          { value: "full-bar", label: "Full bar", symbol: "watermark-bar" },
        ],
        default: "corner-br",
        extract: (t: string): string | null => {
          if (/full.?bar|bottom bar|strip|band/i.test(t)) return "full-bar";
          if (/bottom.?left|bl\b/i.test(t)) return "corner-bl";
          if (/bottom.?right|br\b|corner/i.test(t)) return "corner-br";
          return null;
        },
      },
    },
    depends_on: [],
    feeds_into: ["ship.export"],
    flow: "flowWatermark",
    writes_to: "style.watermark",
  },

  // =========================================================================
  // BASE ACTIONS (5) — direct manipulation, still declared for graph completeness
  // =========================================================================

  // BASE · layout picker (aspect-independent split/grid/single)
  "layout.set": {
    id: "layout.set",
    feature: "BASE",
    module: "layout",
    label: "Set layout",
    intents: [/\bsplit\b/i, /grid/i, /layout/i, /left.*right/i, /top.*bottom/i],
    params: {
      layout: {
        type: "enum",
        required: true,
        ask_prompt: "Which layout?",
        options: [
          { value: "split-vertical", label: "Split · V", symbol: "layout-split-v" },
          { value: "split-horizontal", label: "Split · H", symbol: "layout-split-h" },
          { value: "grid-2x2", label: "Grid 2×2", symbol: "layout-grid" },
          { value: "single", label: "Single", symbol: "layout-full" },
        ],
        default: "split-vertical",
        extract: (t: string): string | null => {
          if (/vertical|left.*right|split.?v\b/i.test(t)) return "split-vertical";
          if (/horizontal|top.*bottom|split.?h\b/i.test(t)) return "split-horizontal";
          if (/2x2|grid|two by two/i.test(t)) return "grid-2x2";
          if (/single|solo|one/i.test(t)) return "single";
          return null;
        },
      },
    },
    depends_on: [],
    feeds_into: ["window.layout"],
    flow: "__legacy_layout",
    writes_to: "baseWindow.layout",
  },

  // BASE · slot select (requires layout.multi)
  "slot.select": {
    id: "slot.select",
    feature: "BASE",
    module: "slots",
    label: "Select slot",
    intents: [/select slot [abcd]/i],
    params: {},
    depends_on: ["layout.multi"],
    feeds_into: [],
    flow: "__legacy_selectSlot",
  },

  // BASE · slot fill
  "slot.fill": {
    id: "slot.fill",
    feature: "BASE",
    module: "slots",
    label: "Add to slot",
    intents: [/add\s+.*\bto slot [abcd]/i],
    params: {},
    depends_on: ["slot.selected"],
    feeds_into: ["region.push"],
    flow: "__legacy_addToSlot",
  },

  // BASE · slot mute
  "slot.mute": {
    id: "slot.mute",
    feature: "BASE",
    module: "slots",
    label: "Mute slot",
    intents: [/mute slot [abcd]/i],
    params: {},
    depends_on: ["slot.selected"],
    feeds_into: [],
    flow: "__legacy_muteSlot",
  },

  // BASE · borrow audio between slots
  "slot.borrow_audio": {
    id: "slot.borrow_audio",
    feature: "BASE",
    module: "slots",
    label: "Borrow audio",
    intents: [/borrow audio from slot [abcd]/i],
    params: {},
    depends_on: ["slot.selected"],
    feeds_into: [],
    flow: "__legacy_borrowAudio",
  },

  // =========================================================================
  // Bonus BASE · aspect intents (canvas.set-aspect)
  // Not part of the 17-count; included per spec addendum so aspect intents
  // route through the graph instead of a hard-coded switch.
  // =========================================================================

  "canvas.set-aspect": {
    id: "canvas.set-aspect",
    feature: "BASE",
    module: "canvas",
    label: "Set aspect ratio",
    intents: [
      /^(9:16|vertical|portrait|shorts|reel|reels|tiktok|tall)$/i,
      /^(16:9|horizontal|landscape|widescreen|wide|youtube)$/i,
      /^(1:1|square)$/i,
      /\b(make|set|go|change|switch)\b.*\b(9:16|vertical|portrait|tall|shorts|reel)\b/i,
      /\b(make|set|go|change|switch)\b.*\b(16:9|horizontal|landscape|wide)\b/i,
      /\b(make|set|go|change|switch)\b.*\b(1:1|square)\b/i,
    ],
    params: {
      aspect: {
        type: "enum",
        required: true,
        ask_prompt: "Which aspect ratio?",
        options: [
          {
            value: "9:16",
            label: "Vertical · 9:16",
            symbol: "layout-split-h",
            shape: { kind: "aspect-vertical" },
          },
          {
            value: "16:9",
            label: "Landscape · 16:9",
            symbol: "layout-split-v",
            shape: { kind: "aspect-horizontal" },
          },
          {
            value: "1:1",
            label: "Square · 1:1",
            symbol: "layout-full",
            shape: { kind: "aspect-square" },
          },
        ],
        default: "9:16",
        extract: (t: string): string | null => {
          if (/9:16|vertical|portrait|shorts|reel|tall/i.test(t)) return "9:16";
          if (/16:9|horizontal|landscape|wide/i.test(t)) return "16:9";
          if (/1:1|square/i.test(t)) return "1:1";
          return null;
        },
      },
    },
    depends_on: [],
    feeds_into: [],
    flow: "flowAspect",
    writes_to: "baseWindow.aspect",
  },
};

// ---------------------------------------------------------------------------
// Convenience introspection
// ---------------------------------------------------------------------------

/** Ordered list of capability IDs · stable iteration order for the router. */
export const CAPABILITY_ORDER: CapabilityId[] = Object.keys(CAPABILITIES);

/** Retrieve a capability by id · null if missing. */
export function getCapability(id: CapabilityId): Capability | null {
  return CAPABILITIES[id] ?? null;
}
