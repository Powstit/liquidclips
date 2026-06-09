// SURFACE: Earn webview mount (thin wrapper)
// MAP TAGS: (O #5)(O #6)(O #7) hosted Earn surface
// See docs/UI_MAP_embed_surfaces.md — the contract.
//
// As of v0.7.6 the Earn body lives at https://account.liquidclips.app/embed/earn.
// This file used to host the ~470-line native render (cards / filters /
// submissions / etc.); all of that moved to the hosted page so we can ship
// new sponsored placements, bounty card variants, and surface layouts via
// Vercel auto-deploys instead of an installer rebuild.
//
// ship-lens v0.7.14: K5 — mount BountySwipe as native "Discover" sub-tab.
// The webview owns "All bounties" (the existing full embed); BountySwipe
// owns first-touch discovery. Switching sub-tabs closes / reopens the
// native panel because it floats in window coordinates and cannot be
// hidden behind a DOM stacking context.
//
// The component signature stays unchanged so App.tsx's callsite is
// untouched. Most props are no-ops here because the embed handles those
// flows itself (manual bounty entry, resume-project, sign-in) — kept on
// the signature for binary compatibility with the existing parent.

import { EarnPanelMount } from "./EarnPanelMount";
import type { WhopBounty, BountyContext } from "../../lib/sidecar";

export function EarnTab({
  onStartBounty,
  // The embed owns its own manual-bounty / resume-project / sign-in
  // flows. These props remain on the signature so App.tsx doesn't have
  // to change in this sprint; future cleanup can drop them once the
  // hosted page proves out.
  onStartManualBounty: _onStartManualBounty,
  onResumeProject: _onResumeProject,
  onSignIn: _onSignIn,
  userTier,
}: {
  onStartBounty: (bounty: WhopBounty) => void;
  onStartManualBounty: (b: BountyContext, sourceUrl: string) => void;
  onResumeProject: (slug: string) => void;
  onSignIn?: () => void;
  userTier?: "free" | "solo" | "pro" | "agency" | null;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* v0.7.39 — collapsed Discover sub-tab into single primary view.
          The hosted embed at account.liquidclips.app/embed/earn owns all
          bounty discovery + listing; no native sub-tab needed. */}
      <div className="relative min-h-0 flex-1">
        <EarnPanelMount onStartBounty={onStartBounty} userTier={userTier} />
      </div>
    </div>
  );
}

// rememberSubmissionId stayed on this module because callers across the
// app (PublishModal, sidecar event handlers) import it. The hosted embed
// owns submission tracking now, but the desktop still needs to record IDs
// it captures from local Whop posts. Once the embed-side submission flow
// proves out we can drop this too.
const SUBMISSION_IDS_KEY = "junior:my-whop-submissions:v1";

export function rememberSubmissionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SUBMISSION_IDS_KEY);
    const cur: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (cur.includes(id)) return;
    window.localStorage.setItem(
      SUBMISSION_IDS_KEY,
      JSON.stringify([...cur, id].slice(-50)),
    );
  } catch {
    /* private mode / quota — non-fatal */
  }
}
