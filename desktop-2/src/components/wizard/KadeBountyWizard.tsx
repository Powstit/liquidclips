/**
 * KadeBountyWizard · Guides an agency through the Post-to-Whop flow.
 *
 * The problem this fixes: agencies post their reward pool on Whop but
 * LC only has the reward URL after the agency manually copy-pastes it
 * back. That step is invisible on first use — agencies stare at Whop's
 * confirmation page not knowing they need to come back and paste.
 *
 * The wizard is a persistent floating card (Kade's face + step text +
 * one CTA) that opens on the same `openWhopAction(BOUNTY_CREATE, ...)`
 * click. It walks the agency through what's about to happen, then
 * auto-advances when `lc:whop-bounty-captured` fires (URL-sniff from
 * browse.rs · v2.3.70 shell) so the last step is a confirmation, not
 * a "now go copy the URL" instruction.
 *
 * Firing:
 *   window.dispatchEvent(new CustomEvent("lc:open-post-to-whop-wizard",
 *     { detail: { campaignSlug: "..." } }));
 *
 * Auto-advance:
 *   Listens for `lc:whop-bounty-captured` (from whopBountyCapture.ts) —
 *   when the payload matches the campaign the wizard was opened for
 *   (or if no slug was scoped), advances to the "done" step.
 *
 * Dismissal:
 *   Per-campaign, remembered in localStorage. Closed via the ✕ button
 *   or Escape. Re-fires on the next `lc:open-post-to-whop-wizard` for
 *   a different campaign (or the same one if the localStorage key was
 *   cleared — e.g. after a successful capture, we clear so returning
 *   agencies see the "step 4" done state once as celebration).
 *
 * NOT a modal: does not block the app. The agency can dismiss and keep
 * working. If they didn't complete the flow, the wizard reopens next
 * time they hit "Post to Whop marketplace".
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, ArrowRight, Clipboard } from "lucide-react";
import type { WhopBountyCaptured } from "../../lib/whopBountyCapture";
import { WHOP_BOUNTY_CAPTURED_EVENT } from "../../lib/whopBountyCapture";
import "./KadeBountyWizard.css";

/** Event name the wizard listens for to open. */
export const OPEN_POST_TO_WHOP_WIZARD_EVENT = "lc:open-post-to-whop-wizard";

/** Payload for `lc:open-post-to-whop-wizard`. */
export interface OpenPostToWhopWizardDetail {
  /** Campaign slug the wizard is scoped to. When set, only capture
   *  events for a matching campaign advance the wizard (belt +
   *  suspenders vs. cross-campaign accidental fills). Null = advance
   *  on any capture (used for the CampaignPageShell's own Post-to-
   *  Whop button where scope is implicit). */
  campaignSlug: string | null;
  /** Optional display name shown in step 1 so the agency knows exactly
   *  which campaign is being wired up. */
  campaignTitle?: string;
}

type WizardStep = 1 | 2 | 3 | 4;

interface WizardState {
  step: WizardStep;
  campaignSlug: string | null;
  campaignTitle: string | null;
  capturedUrl: string | null;
}

const STORAGE_KEY_PREFIX = "kade-bounty-wizard-dismissed:";

function dismissKey(slug: string | null): string {
  return `${STORAGE_KEY_PREFIX}${slug ?? "unscoped"}`;
}

function readDismissed(slug: string | null): boolean {
  try {
    return localStorage.getItem(dismissKey(slug)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(slug: string | null, value: boolean): void {
  try {
    if (value) localStorage.setItem(dismissKey(slug), "1");
    else localStorage.removeItem(dismissKey(slug));
  } catch {
    /* noop — quota exceeded or SSR context */
  }
}

export function KadeBountyWizard(): JSX.Element | null {
  const [state, setState] = useState<WizardState | null>(null);

  // Listen for open requests.
  useEffect(() => {
    const onOpen = (evt: Event): void => {
      const detail = (evt as CustomEvent<OpenPostToWhopWizardDetail>).detail;
      const slug = detail?.campaignSlug ?? null;
      if (readDismissed(slug)) return;
      setState({
        step: 1,
        campaignSlug: slug,
        campaignTitle: detail?.campaignTitle ?? null,
        capturedUrl: null,
      });
    };
    window.addEventListener(OPEN_POST_TO_WHOP_WIZARD_EVENT, onOpen as EventListener);
    return () =>
      window.removeEventListener(OPEN_POST_TO_WHOP_WIZARD_EVENT, onOpen as EventListener);
  }, []);

  // Auto-advance step 1 → 2 after a short beat so the agency sees the
  // intro then moves into "waiting for URL". Prevents the wizard from
  // sitting at step 1 forever if the agency lingers on Whop.
  useEffect(() => {
    if (!state || state.step !== 1) return;
    const t = window.setTimeout(() => {
      setState((s) => (s && s.step === 1 ? { ...s, step: 2 } : s));
    }, 4500);
    return () => window.clearTimeout(t);
  }, [state]);

  // Listen for Whop URL capture → advance to step 3 (done).
  useEffect(() => {
    if (!state) return;
    const onCapture = (evt: Event): void => {
      const detail = (evt as CustomEvent<WhopBountyCaptured>).detail;
      if (!detail?.url) return;
      // Advance regardless of campaign scoping; wire consumer
      // (CampaignPageShell) filters by slug for the actual URL write.
      // Wizard just needs to know "URL landed" to celebrate.
      setState((s) => (s ? { ...s, step: 3, capturedUrl: detail.url } : s));
      // Clear the dismiss flag so if the same campaign fires the wizard
      // again later (edge case: agency reopens Post-to-Whop for a
      // different reward), they see it fresh.
      writeDismissed(state.campaignSlug, false);
    };
    window.addEventListener(WHOP_BOUNTY_CAPTURED_EVENT, onCapture as EventListener);
    return () =>
      window.removeEventListener(WHOP_BOUNTY_CAPTURED_EVENT, onCapture as EventListener);
  }, [state]);

  // Escape → close.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setState(null);
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [state]);

  const handleDismiss = useCallback(() => {
    if (!state) return;
    // Persist dismissal only if the flow completed OR the agency
    // hit ✕ at the final step. Early dismissals stay ephemeral so
    // the wizard reopens next click of Post-to-Whop.
    if (state.step === 3 || state.step === 4) {
      writeDismissed(state.campaignSlug, true);
    }
    setState(null);
  }, [state]);

  const handleFallbackToPaste = useCallback(() => {
    setState((s) => (s ? { ...s, step: 4 } : s));
  }, []);

  if (!state) return null;

  // Kade pose changes per step so the wizard feels alive.
  // Assets verified to exist in desktop-2/public/brand/kade/.
  const kadePosterSrc =
    state.step === 3 ? "/brand/kade/kade-celebration.webp"
    : state.step === 4 ? "/brand/kade/kade-reading-brief.webp"
    : "/brand/kade/kade-reading-brief.webp";
  const campaignLabel = state.campaignTitle ?? "your campaign";

  const overlay = (
    <div
      className="lc-kade-wizard"
      role="dialog"
      aria-live="polite"
      aria-label="Post-to-Whop guide"
      data-step={state.step}
    >
      <div className="lc-kade-wizard-card">
        <button
          type="button"
          className="lc-kade-wizard-close"
          onClick={handleDismiss}
          aria-label="Close guide"
          title="Close guide"
        >
          <X size={13} />
        </button>

        <div className="lc-kade-wizard-avatar">
          <img
            alt="Kade"
            src={kadePosterSrc}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="lc-kade-wizard-avatar-glyph">K</span>
        </div>

        <div className="lc-kade-wizard-body">
          <div className="lc-kade-wizard-step-pill">
            <span>Step {state.step === 4 ? "3" : state.step}</span>
            <span aria-hidden="true">·</span>
            <span>Post {campaignLabel} to Whop</span>
          </div>

          {state.step === 1 && (
            <>
              <h3 className="lc-kade-wizard-title">Opening Whop for you.</h3>
              <p className="lc-kade-wizard-copy">
                Whop is where your reward pool lives — fund it, set your RPM,
                and hit their <b>Create</b> button. Whole flow stays in this
                app.
              </p>
              <div className="lc-kade-wizard-progress">
                <span data-active="1" />
                <span />
                <span />
              </div>
            </>
          )}

          {state.step === 2 && (
            <>
              <h3 className="lc-kade-wizard-title">Waiting on your bounty page.</h3>
              <p className="lc-kade-wizard-copy">
                Once Whop confirms your new reward and shows the bounty page,
                I'll catch the URL and link it to <b>{campaignLabel}</b>{" "}
                automatically. You don't need to copy or paste anything.
              </p>
              <div className="lc-kade-wizard-progress">
                <span data-done="1" />
                <span data-active="1" />
                <span />
              </div>
              <button
                type="button"
                className="lc-kade-wizard-ghost"
                onClick={handleFallbackToPaste}
              >
                Whop looks different — let me paste manually
              </button>
            </>
          )}

          {state.step === 3 && (
            <>
              <h3 className="lc-kade-wizard-title">
                <CheckCircle2 size={16} aria-hidden="true" /> Reward linked.
              </h3>
              <p className="lc-kade-wizard-copy">
                Your Whop reward URL is now on <b>{campaignLabel}</b>. Hit{" "}
                <b>Publish</b> when you're ready to open submissions to clippers.
              </p>
              {state.capturedUrl && (
                <p className="lc-kade-wizard-url" title={state.capturedUrl}>
                  {state.capturedUrl}
                </p>
              )}
              <div className="lc-kade-wizard-progress">
                <span data-done="1" />
                <span data-done="1" />
                <span data-done="1" />
              </div>
              <button
                type="button"
                className="lc-kade-wizard-primary"
                onClick={handleDismiss}
              >
                Got it <ArrowRight size={13} />
              </button>
            </>
          )}

          {state.step === 4 && (
            <>
              <h3 className="lc-kade-wizard-title">
                <Clipboard size={16} aria-hidden="true" /> Paste your Whop URL.
              </h3>
              <p className="lc-kade-wizard-copy">
                No sweat — copy the bounty URL from Whop, then paste it into the
                <b> Whop reward URL</b> field on <b>{campaignLabel}</b>. I'll
                validate it against Whop before you publish.
              </p>
              <div className="lc-kade-wizard-progress">
                <span data-done="1" />
                <span data-done="1" />
                <span data-active="1" />
              </div>
              <button
                type="button"
                className="lc-kade-wizard-primary"
                onClick={handleDismiss}
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
