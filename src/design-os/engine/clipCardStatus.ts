/**
 * clipCardStatus · UI-3
 *
 * Client-derived enum for the clip's posting / submission lifecycle. The
 * sidecar contract doesn't carry a `status` field today — Batch D adds it.
 * Until then, defaults come from clip fixture data + local UI mutations.
 *
 * Mock-only · lives in React/localStorage, not in any backend.
 */

export type ClipStatus =
  | "draft"      // generated · not edited / exported yet
  | "ready"      // edited · export-ready
  | "scheduled"  // queued to post
  | "posted"     // posted / shared externally
  | "submitted"; // submitted to a Whop reward

export const STATUS_LABEL: Record<ClipStatus, string> = {
  draft:     "Draft",
  ready:     "Ready",
  scheduled: "Scheduled",
  posted:    "Posted",
  // UX-4 · attribute the destination · keeps the Whop boundary visible
  // anywhere the badge surfaces (ClipCard + SubmitToWhopModal preview row).
  submitted: "Submitted · Whop",
};

/** Maps status → CSS modifier (paired with `.lc-clip-status-${tone}` in CSS). */
export const STATUS_TONE: Record<ClipStatus, string> = {
  draft:     "dim",
  ready:     "fuchsia",
  scheduled: "cyan",
  posted:    "amber",
  submitted: "fuchsia-glow",
};

/** Returns the next status given a UI action; idempotent if already past it. */
export function nextStatusFor(
  action: "edit" | "schedule" | "post" | "submit",
  current: ClipStatus,
): ClipStatus {
  switch (action) {
    case "edit":     return current === "draft" ? "ready" : current;
    case "schedule": return current === "posted" || current === "submitted" ? current : "scheduled";
    case "post":     return current === "submitted" ? current : "posted";
    case "submit":   return "submitted";
  }
}

/** Which CTAs are visible / enabled for a clip in a given state.
 *  - Edit / Export are always visible.
 *  - Post is hidden once `posted` or `submitted`.
 *  - Submit only appears once the clip has been posted; in `submitted` it
 *    becomes a disabled "Submitted" pill.
 */
export interface CtaVisibility {
  showPost: boolean;
  showSubmit: boolean;
  submitDisabled: boolean;
}
export function ctaVisibilityFor(status: ClipStatus): CtaVisibility {
  return {
    showPost:       status !== "posted" && status !== "submitted",
    showSubmit:     status === "posted" || status === "submitted",
    submitDisabled: status === "submitted",
  };
}
