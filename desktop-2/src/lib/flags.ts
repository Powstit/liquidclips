/**
 * IG-FLAGS-DEFINED · Reliability Sprint L6 · Feature flags + staged
 * rollout · client-side gate for every launch-critical feature.
 *
 * The flags system is a two-part contract:
 *
 *   1. A frozen registry of flag definitions with:
 *        - `enabled`     · master kill switch (false = off for everyone)
 *        - `rolloutPct`  · 0..1 · deterministic bucket by session/user id
 *        - `killedAt`    · optional revert timestamp for audit
 *
 *   2. Deterministic `isFlagEnabled(name, id)` that hashes the id into
 *      a 0..1 bucket. Same id + same flag = same answer every call, so
 *      the user experience never flickers mid-session.
 *
 * Staged rollout runner (`scripts/rollout-runner.sh`) walks a flag from
 * 0 → 10 → 50 → 100 with an SLO check between each step. If any SLO
 * breaches, the runner sets `enabled: false` and reverts the promoted
 * bundle. Sources: LaunchDarkly beta-rollout playbook · ConfigCat
 * canary release guide · Google SRE canary chapter.
 *
 * NEVER remove or rename a flag mid-flight — retiring a flag requires
 * a two-step ship: (a) route consumers to the always-on branch, (b) in
 * a follow-up release delete the flag entry.
 */

export interface FlagDef {
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly killedAt?: string;
  readonly description: string;
  readonly ownerContact: string;
}

export const FLAGS = Object.freeze({
  /**
   * Screen recording tiles 1-4 (Display/Window/Scr+mic/Scr+audio).
   * OFF · getDisplayMedia is not available in Tauri WKWebView on macOS
   * so these tiles are "Coming Soon" until Rust scap MP4 encoder lands.
   */
  "recording.desktop-capture-tiles": {
    enabled: false,
    rolloutPct: 0,
    killedAt: "2026-07-22",
    description:
      "Enables record tiles 1-4 (Display/Window/Scr+mic/Scr+audio). Blocked on Rust scap MP4 encoder.",
    ownerContact: "daniel@liquidclips.app",
  },

  /**
   * Remote-any-user support impersonation (per PROPOSAL_REMOTE_ANY_USER.md).
   * OFF · design-only until consent + audit-per-session backend ships.
   */
  "support.impersonate-any-user": {
    enabled: false,
    rolloutPct: 0,
    description:
      "Support staff can request time-boxed impersonation with user consent.",
    ownerContact: "daniel@liquidclips.app",
  },

  /**
   * Install-count telemetry endpoint (per PROPOSAL_INSTALL_TELEMETRY.md).
   * OFF · pending HQ endpoint deploy + install:* events wire-up.
   */
  "telemetry.install-events": {
    enabled: false,
    rolloutPct: 0,
    description:
      "Fires install:first-boot / install:activate / install:daily-return.",
    ownerContact: "daniel@liquidclips.app",
  },

  /**
   * Chaos-mode dev-tool banner (Reliability Sprint L4).
   * ON in dev builds only · gated by environment inside consumer code.
   */
  "chaos.dev-banner": {
    enabled: true,
    rolloutPct: 1,
    description:
      "Shows chaos-mode banner + fault-injection toggles in dev builds.",
    ownerContact: "daniel@liquidclips.app",
  },

  /**
   * SLO snapshot HUD in the diagnostic center.
   * ON at 100% · read-only, no user-visible impact if it breaks.
   */
  "observability.slo-hud": {
    enabled: true,
    rolloutPct: 1,
    description: "Renders live SLO snapshot on DiagnosticCenter route.",
    ownerContact: "daniel@liquidclips.app",
  },
} as const);

export type FlagName = keyof typeof FLAGS;

function hash01(name: FlagName, id: string): number {
  let h = 0;
  const combined = `${name}::${id}`;
  for (let i = 0; i < combined.length; i++) {
    h = (h * 31 + combined.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 10000) / 10000;
}

/**
 * Read the localStorage override for a flag (dev/QA helper). Never
 * used in prod — the check is short-circuited if the environment is
 * not `dev`. Returns `null` if no override or the runtime does not
 * expose localStorage (SSR, tests without jsdom, etc).
 */
function readOverride(name: FlagName): boolean | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (!env?.DEV) return null;
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`lc.flag.${name}`);
    if (raw === "on") return true;
    if (raw === "off") return false;
    return null;
  } catch {
    return null;
  }
}

export function isFlagEnabled(name: FlagName, id: string): boolean {
  const override = readOverride(name);
  if (override !== null) return override;
  const def = FLAGS[name];
  if (!def) return false;
  if (!def.enabled) return false;
  if (def.rolloutPct <= 0) return false;
  if (def.rolloutPct >= 1) return true;
  return hash01(name, id) < def.rolloutPct;
}

export function flagDef(name: FlagName): FlagDef {
  return FLAGS[name];
}

export function listFlags(): readonly {
  name: FlagName;
  def: FlagDef;
}[] {
  return (Object.keys(FLAGS) as FlagName[]).map((name) => ({
    name,
    def: FLAGS[name],
  }));
}
