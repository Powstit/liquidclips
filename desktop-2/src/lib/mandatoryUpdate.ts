/**
 * mandatoryUpdate · 2026-07-14 · Kade update-gate mandatory contract
 *
 * Owns the "is the active runtime version BELOW the manifest's minimum
 * supported version" decision. The result drives the KadeUpdateGate
 * root-blocking surface (see design-os/update/KadeUpdateGate.tsx).
 *
 * Runtime-only · no shell touches · no Rust · no new npm deps.
 *
 * Scope:
 *
 *   - Deterministic semver comparison (`cmpVersion`) with stable
 *     numeric ordering AND pre-release-tag lexical tie-break for
 *     tagged versions (e.g. `2.2.36-control-tower-1`).
 *   - Pure `isMandatory(active, minSupported)` predicate.
 *   - `fetchUpdatePolicy(backendUrl, channel, active)` reads the
 *     public `/runtime/manifest.json` endpoint (frontend-direct;
 *     shell not involved).
 *   - Cached-policy layer (`readCachedPolicy` / `writeCachedPolicy`)
 *     keyed on `lc.update.policy.v1` in localStorage so a known
 *     mandatory floor remains enforced OFFLINE.
 *   - Never activates a partially-downloaded or unverified bundle:
 *     that concern lives in the existing runtime.rs shell layer
 *     (SHA-256 + Ed25519 signature verification pre-stage). This
 *     module only owns "should the frontend block routes" logic.
 */

// ---------------------------------------------------------------------
// Deterministic version comparison
// ---------------------------------------------------------------------

/**
 * Compare two semver strings (with optional pre-release tag).
 *
 *   `cmpVersion("2.2.36", "2.2.37")`                    → -1
 *   `cmpVersion("2.2.37", "2.2.36")`                    →  1
 *   `cmpVersion("2.2.36", "2.2.36")`                    →  0
 *   `cmpVersion("2.2.36", "2.2.36-control-tower-1")`    →  1  (base > tagged)
 *   `cmpVersion("2.2.36-a", "2.2.36-b")`                → -1  (lexical tag order)
 *   `cmpVersion("2.2.36-a", "2.2.37-b")`                → -1  (numeric wins)
 *
 * Malformed input (non-numeric segments in the numeric prefix) returns
 * `null` — callers MUST treat null as "unknown, do not gate" rather
 * than falling back to string compare. This is why a separate
 * `isMandatory` wrapper exists.
 *
 * Tag rules (SemVer 2.0.0 compliant subset):
 *   - No tag beats any tag (`2.2.36` > `2.2.36-anything`)
 *   - Two tags compared lexically (dot-split, numeric segments as
 *     numbers, string segments as strings — number < string)
 */
export function cmpVersion(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  // Numeric segments equal · compare pre-release tags per SemVer 2.0.0.
  if (pa.tag === null && pb.tag === null) return 0;
  if (pa.tag === null) return 1; // no tag > any tag
  if (pb.tag === null) return -1;
  return cmpTag(pa.tag, pb.tag);
}

interface ParsedVersion {
  nums: [number, number, number];
  tag: string | null;
}

function parseVersion(v: string): ParsedVersion | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Split on first `-` (SemVer pre-release delimiter). Ignore `+build`
  // metadata per SemVer 2.0.0 (never affects ordering).
  const buildIdx = trimmed.indexOf("+");
  const core = buildIdx >= 0 ? trimmed.slice(0, buildIdx) : trimmed;
  const dashIdx = core.indexOf("-");
  const numericPart = dashIdx >= 0 ? core.slice(0, dashIdx) : core;
  const tag = dashIdx >= 0 ? core.slice(dashIdx + 1) : null;
  const parts = numericPart.split(".");
  if (parts.length !== 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number.parseInt(p, 10));
  }
  return { nums: [nums[0], nums[1], nums[2]], tag };
}

function cmpTag(a: string, b: string): number {
  const as = a.split(".");
  const bs = b.split(".");
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i += 1) {
    const ai = as[i];
    const bi = bs[i];
    if (ai === undefined) return -1; // shorter tag ranks lower
    if (bi === undefined) return 1;
    const ain = /^\d+$/.test(ai);
    const bin = /^\d+$/.test(bi);
    if (ain && bin) {
      const na = Number.parseInt(ai, 10);
      const nb = Number.parseInt(bi, 10);
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (ain !== bin) return ain ? -1 : 1; // numeric ranks lower than string
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------
// Mandatory decision
// ---------------------------------------------------------------------

/**
 * `true` when the active runtime version is provably older than the
 * declared minimum supported version. Returns `false` when either
 * value is missing or unparseable — a mandatory gate must NEVER
 * trigger on ambiguous data.
 */
export function isMandatory(
  active: string | null | undefined,
  minSupported: string | null | undefined,
): boolean {
  if (!active || !minSupported) return false;
  const c = cmpVersion(active, minSupported);
  if (c === null) return false;
  return c < 0;
}

// ---------------------------------------------------------------------
// Policy fetch
// ---------------------------------------------------------------------

/** Manifest response shape · fields we care about for the gate. */
export interface RuntimeManifestResponse {
  version: string;
  channel: string;
  sha256: string;
  signature: string;
  url: string;
  minimum_supported_version?: string | null;
}

export interface UpdatePolicy {
  /** Active runtime version at the moment we last fetched. */
  active: string;
  /** Channel the manifest was queried against. */
  channel: string;
  /** Latest published version on that channel (from manifest). */
  latest_version: string | null;
  /** Minimum supported version (from manifest, may be absent). */
  minimum_supported_version: string | null;
  /** Absolute Date.now() of the fetch. */
  fetched_at: number;
}

/**
 * Fetch the runtime manifest and derive an `UpdatePolicy`. Returns
 * `null` when the manifest is unreachable OR returns 204 (no bundle
 * yet). Callers should degrade gracefully in either case (see the
 * cached-policy fallback in `resolveMandatoryStatus`).
 */
export async function fetchUpdatePolicy(
  backendUrl: string,
  channel: string,
  activeVersion: string,
): Promise<UpdatePolicy | null> {
  try {
    const url = `${backendUrl.replace(/\/$/, "")}/runtime/manifest.json?channel=${encodeURIComponent(channel)}&current_version=${encodeURIComponent(activeVersion)}`;
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    if (r.status === 204) {
      // Client is on the active bundle. No mandatory floor to enforce.
      return {
        active: activeVersion,
        channel,
        latest_version: activeVersion,
        minimum_supported_version: null,
        fetched_at: Date.now(),
      };
    }
    if (!r.ok) return null;
    const body = (await r.json()) as RuntimeManifestResponse;
    return {
      active: activeVersion,
      channel,
      latest_version: typeof body.version === "string" ? body.version : null,
      minimum_supported_version:
        typeof body.minimum_supported_version === "string"
        && body.minimum_supported_version.trim().length > 0
          ? body.minimum_supported_version.trim()
          : null,
      fetched_at: Date.now(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Cached-policy layer (offline enforcement)
// ---------------------------------------------------------------------

export const CACHED_POLICY_KEY = "lc.update.policy.v1";

export function readCachedPolicy(): UpdatePolicy | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHED_POLICY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UpdatePolicy>;
    if (
      typeof parsed.active !== "string"
      || typeof parsed.channel !== "string"
      || typeof parsed.fetched_at !== "number"
    ) {
      return null;
    }
    return {
      active: parsed.active,
      channel: parsed.channel,
      latest_version:
        typeof parsed.latest_version === "string" ? parsed.latest_version : null,
      minimum_supported_version:
        typeof parsed.minimum_supported_version === "string"
          ? parsed.minimum_supported_version
          : null,
      fetched_at: parsed.fetched_at,
    };
  } catch {
    return null;
  }
}

export function writeCachedPolicy(policy: UpdatePolicy): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHED_POLICY_KEY, JSON.stringify(policy));
  } catch {
    /* quota / private mode · degrade silently */
  }
}

// ---------------------------------------------------------------------
// Top-level status resolver
// ---------------------------------------------------------------------

export type MandatoryStatus =
  /** Manifest fetched · active >= min supported. App may run normally. */
  | { kind: "ok"; policy: UpdatePolicy }
  /** Manifest fetched · active < min supported. Route entry MUST be blocked. */
  | { kind: "mandatory"; policy: UpdatePolicy }
  /** Manifest unreachable · no cached policy · degrade to warning-only. */
  | { kind: "unknown"; reason: "offline_no_cache" }
  /** Manifest unreachable BUT cached policy proves mandatory floor.
   *  Block routes even offline · Rule 1 of Daniel's startup contract. */
  | { kind: "mandatory_cached"; policy: UpdatePolicy };

export async function resolveMandatoryStatus(
  backendUrl: string,
  channel: string,
  activeVersion: string,
): Promise<MandatoryStatus> {
  const fresh = await fetchUpdatePolicy(backendUrl, channel, activeVersion);
  if (fresh) {
    writeCachedPolicy(fresh);
    if (isMandatory(activeVersion, fresh.minimum_supported_version)) {
      return { kind: "mandatory", policy: fresh };
    }
    return { kind: "ok", policy: fresh };
  }
  // Offline · consult cache.
  const cached = readCachedPolicy();
  if (cached && isMandatory(activeVersion, cached.minimum_supported_version)) {
    return { kind: "mandatory_cached", policy: cached };
  }
  return { kind: "unknown", reason: "offline_no_cache" };
}
