// Desktop funnel analytics — PHASE 1 SCAFFOLD (no sink yet).
//
// This is the desktop's half of the affiliate-flywheel funnel
// (CLAUDE_POSTHOG_AFFILIATE_FUNNEL_ARCHITECTURE.md). Phase 1 deliberately ships
// only the event vocabulary + call sites + a no-op-safe `track()`. It does NOT
// send anywhere yet, on purpose:
//
//   1. Junior is local-first ("your files never leave your machine"). Emitting
//      product analytics from a user's desktop is a posture decision for Daniel,
//      not something to switch on silently.
//   2. Identity stitching is unsolved here: the backend keys PostHog on clerk_id,
//      but the desktop only holds backend_user_id (JWT `sub`). Sending with a
//      different distinct_id would split one person into two in dashboards.
//
// Phase 2 wires the real sink — either POST to a backend ingest endpoint (which
// already knows clerk_id + affiliate_id) or posthog-js keyed on clerk_id from
// /me. Until then `track()` no-ops (logs in dev) so the call sites stay honest.
//
// Privacy rule (enforced by sanitize): IDs only — never email, name, file paths,
// filenames, transcripts, tokens, or JWTs.

// Closed funnel vocabulary — the desktop-emitted subset of the full chain.
// Sprint #26 adds the lift + publish + caption-style + leaderboard verbs so
// the full launch funnel can be measured once Phase 2 wires a real sink.
export type DesktopAnalyticsEvent =
  | "first_bounty_workspace_created"
  | "bounty_clip_exported"
  // Lift transcript flow (Script mode)
  | "lift_started"
  | "lift_completed"
  | "lift_failed"
  | "lift_canceled"
  // Clip pipeline flow
  | "pipeline_started"
  | "pipeline_completed"
  | "pipeline_failed"
  | "clip_exported"
  // Publishing flow (Ayrshare)
  | "publish_attempted"
  | "publish_success"
  | "publish_failed"
  // Settings / connections
  | "ayrshare_profile_connected"
  | "ayrshare_profile_disconnected"
  | "openai_key_saved"
  // Caption styles (sprint #2 lands these properly)
  | "caption_style_changed"
  | "caption_style_default_set"
  // Game engagement (Invaders splash + mid-pipeline)
  | "invaders_opened"
  | "invaders_closed"
  | "invaders_new_high_score"
  // Earn / leaderboard (sprint #14a lands the surface)
  | "leaderboard_viewed"
  | "leaderboard_rank_changed";

const FORBIDDEN_KEYS = new Set([
  "email", "user_email", "primary_email",
  "token", "access_token", "id_token", "jwt", "license_jwt",
  "api_key", "secret", "password",
  "path", "filename", "transcript", "source_filename", "source_path",
  // slug derives from the source filename/title — treat as content/PII.
  "slug", "project_slug",
]);

function sanitize(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

// No-op-safe emitter. No PostHog config → does nothing (logs in dev only).
export function track(event: DesktopAnalyticsEvent, properties?: Record<string, unknown>): void {
  const clean = sanitize(properties);
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[analytics:noop]", event, clean);
  }
  // Phase 2: route `clean` to the real sink here.
}

// first_bounty_workspace_created must fire once per user (per the spec). The
// desktop is single-user-local, so a localStorage flag is the right dedup.
const FIRST_BOUNTY_FLAG = "jnr_first_bounty_workspace_sent";

export function trackFirstBountyWorkspace(props: Record<string, unknown>): void {
  try {
    if (localStorage.getItem(FIRST_BOUNTY_FLAG)) return;
    track("first_bounty_workspace_created", props);
    localStorage.setItem(FIRST_BOUNTY_FLAG, "1");
  } catch {
    // localStorage unavailable — fire without dedup rather than crash.
    track("first_bounty_workspace_created", props);
  }
}
