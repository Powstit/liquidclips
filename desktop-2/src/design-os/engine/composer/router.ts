/**
 * Composer 3-tier confidence router · Phase 1a
 *
 * Ports:
 *   - matchCapability      · simulator ~4386-4396
 *   - narrowOptions        · simulator ~4400-4431
 *   - routeThroughCapabilities · simulator ~4528-4555
 *
 * The router is pure logic. No React, no fetch, no DOM. The cache is a
 * module-scope `Map<string, RoutedIntent>` — deliberately in-memory only
 * (Phase 1a scope: no localStorage).
 *
 * 3 tiers:
 *   1. Regex        · CAPABILITIES[*].intents
 *   2. Cache        · exact-query memo
 *   3. LLM (stub)   · disabled in Phase 1a → miss
 *
 * Consumers (Phase 1b React panels) receive a discriminated union:
 *   { kind: "execute" } → dispatch flow with resolved params
 *   { kind: "ask" }     → show AskPanel with needsAsk[]
 *   { kind: "miss" }    → nothing matched — surface fallback UI
 */

import {
  CAPABILITIES,
  CAPABILITY_ORDER,
  type Capability,
  type CapabilityId,
  type CapabilityParam,
  type CapabilityParamOption,
} from "./capabilities";

// ---------------------------------------------------------------------------
// Session state shape · minimum surface Phase 1a needs to run narrowOptions.
// Phase 1b will pass in real CockpitSettings via a facade.
// ---------------------------------------------------------------------------

export interface SessionState {
  /** Last source aspect the user seeded · "wide" | "vertical" | null */
  lastSource?: "wide" | "vertical" | null;
  /** Base window layout mirror · used by narrowOptions */
  baseWindow?: {
    window?: {
      layout?: string;
    };
  };
  /** Resolved-param memo · keyed by capability id */
  resolvedParams?: Record<CapabilityId, Record<string, CapabilityParamOption>>;
}

// ---------------------------------------------------------------------------
// Public discriminated union
// ---------------------------------------------------------------------------

export interface AskPanelRequest {
  name: string;
  spec: CapabilityParam;
}

export type RoutedIntent =
  | {
      kind: "execute";
      capability: Capability;
      /** Map of param-name → resolved option value (real enum, never label). */
      resolved: Record<string, unknown>;
    }
  | {
      kind: "ask";
      capability: Capability;
      needsAsk: AskPanelRequest[];
    }
  | { kind: "miss" };

// ---------------------------------------------------------------------------
// Tier 1 · regex intent matcher
// ---------------------------------------------------------------------------

export function matchCapability(rawQuery: string): Capability | null {
  if (!rawQuery) return null;
  for (const key of CAPABILITY_ORDER) {
    const cap = CAPABILITIES[key];
    if (!cap || !cap.intents || !cap.intents.length) continue;
    for (const rx of cap.intents) {
      if (rx.test(rawQuery)) return cap;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// narrowOptions · pre-narrow to the 2 highest-signal choices for the session
// ---------------------------------------------------------------------------

export function narrowOptions(
  options: CapabilityParamOption[] | undefined,
  session: SessionState | null | undefined,
): CapabilityParamOption[] {
  if (!Array.isArray(options)) return [];
  if (options.length <= 2) return options.slice();

  const src = session?.lastSource ?? null;
  const layout = session?.baseWindow?.window?.layout ?? null;
  const values = options.map((o) => o.value);

  // Reaction layouts · prefer PIP + Side-by-side when wide, PIP + Full-overlay when vertical
  // Real enum uses "pip-tr" instead of "pip"; keep both branches tolerant.
  const hasPip = values.includes("pip-tr") || values.includes("pip");
  if (
    hasPip &&
    values.includes("side-by-side") &&
    values.includes("full-overlay")
  ) {
    if (src === "wide") {
      return options.filter(
        (o) =>
          o.value === "pip-tr" ||
          o.value === "pip" ||
          o.value === "side-by-side",
      );
    }
    if (src === "vertical") {
      return options.filter(
        (o) =>
          o.value === "pip-tr" || o.value === "pip" || o.value === "full-overlay",
      );
    }
  }

  // Record source → prefer Tutorial (paid demo) + Full-screen
  if (values.includes("tutorial") && values.includes("display")) {
    return options.filter((o) => o.value === "tutorial" || o.value === "display");
  }
  if (values.includes("display") && values.includes("window")) {
    return options.filter((o) => o.value === "display" || o.value === "window");
  }

  // Watermark preset → prefer Corner-BR + Full-bar
  if (values.includes("corner-br") && values.includes("full-bar")) {
    return options.filter((o) => o.value === "corner-br" || o.value === "full-bar");
  }

  // Layout · session already multi → prefer split + grid
  if (values.includes("split-vertical") && values.includes("split-horizontal")) {
    if (layout && layout !== "single") {
      return options.filter(
        (o) => o.value === "split-vertical" || o.value === "grid-2x2",
      );
    }
    return options.filter(
      (o) => o.value === "split-vertical" || o.value === "split-horizontal",
    );
  }

  // Fallback · first two
  return options.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Tier 2 · cache (module-scope Map · trivial memo, no LRU eviction Phase 1a)
// ---------------------------------------------------------------------------

const ROUTE_CACHE = new Map<string, RoutedIntent>();

function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

export function clearRouteCache(): void {
  ROUTE_CACHE.clear();
}

// ---------------------------------------------------------------------------
// Tier 3 · LLM fallback (stub · disabled in Phase 1a)
// ---------------------------------------------------------------------------

/**
 * Phase 2 reserved interface. Implementations should return `null` on
 * miss / low-confidence so the router falls through to `kind: "miss"`.
 */
export interface LLMRouter {
  extract(
    text: string,
    graph: typeof CAPABILITIES,
  ): Promise<{
    capability_id: CapabilityId;
    params: Record<string, unknown>;
    confidence: number;
  } | null>;
}

/** Phase 1a stub. Always returns null so the router terminates at "miss". */
let LLM_ROUTER: LLMRouter | null = null;

/** Phase 2 hook · lets the composer plug in a real extractor. */
export function setLLMRouter(router: LLMRouter | null): void {
  LLM_ROUTER = router;
}

/** Introspection · unused in Phase 1a but wired for Phase 2 tests. */
export function getLLMRouter(): LLMRouter | null {
  return LLM_ROUTER;
}

// ---------------------------------------------------------------------------
// Main entry · routeIntent
// ---------------------------------------------------------------------------

/**
 * Resolve a raw query into a RoutedIntent.
 *
 * Contract:
 *   - Empty query → miss
 *   - Regex match with all required params extractable → execute
 *   - Regex match with some required params missing → ask
 *   - Cache hit reuses the last decision for the same query text
 *   - Cache miss + no regex match → miss (LLM stub disabled)
 */
export function routeIntent(query: string, session: SessionState): RoutedIntent {
  // Session is part of the public contract · Phase 1b narrows options at the
  // ask-panel boundary via `narrowOptions(spec.options, session)`. Keeping the
  // reference here so cache-hits still see the same object identity in Phase 1b.
  void session;
  const q = (query ?? "").trim();
  if (!q) return { kind: "miss" };

  // Tier 2 · cache
  const key = cacheKey(q);
  const cached = ROUTE_CACHE.get(key);
  if (cached) return cached;

  // Tier 1 · regex
  const cap = matchCapability(q);
  if (!cap) {
    const miss: RoutedIntent = { kind: "miss" };
    ROUTE_CACHE.set(key, miss);
    return miss;
  }

  // Extract required params
  const needsAsk: AskPanelRequest[] = [];
  const resolved: Record<string, unknown> = {};
  const paramNames = Object.keys(cap.params || {});

  for (const name of paramNames) {
    const spec = cap.params[name];
    if (!spec) continue;

    // Try extract
    let extracted: string | number | boolean | null = null;
    if (typeof spec.extract === "function") {
      extracted = spec.extract(q);
    }

    if (extracted != null) {
      resolved[name] = extracted;
      continue;
    }

    if (spec.required) {
      needsAsk.push({ name, spec });
    } else if (spec.default !== undefined) {
      // Non-required + has default · seed the default so the flow gets a value
      resolved[name] = spec.default;
    }
  }

  const result: RoutedIntent =
    needsAsk.length === 0
      ? { kind: "execute", capability: cap, resolved }
      : { kind: "ask", capability: cap, needsAsk };

  ROUTE_CACHE.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Helper · convert an AskPanel pick into an execute intent
// (used by the React layer after the user resolves the last missing param)
// ---------------------------------------------------------------------------

export function resolveAskPick(
  capability: Capability,
  priorResolved: Record<string, unknown>,
  paramName: string,
  chosen: CapabilityParamOption,
  remaining: AskPanelRequest[],
): RoutedIntent {
  const nextResolved: Record<string, unknown> = { ...priorResolved, [paramName]: chosen.value };
  if (remaining.length === 0) {
    return { kind: "execute", capability, resolved: nextResolved };
  }
  return { kind: "ask", capability, needsAsk: remaining };
}
