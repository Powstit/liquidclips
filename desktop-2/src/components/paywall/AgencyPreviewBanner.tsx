/**
 * AgencyPreviewBanner · 2026-06-23 monetisation pass · Batch X.
 *
 * Renders when a non-Agency user is in Agency mode. Explains the
 * preview-mode contract: they can build/edit/preview campaigns for free,
 * but publishing/launching requires the Agency plan. Replaces the old
 * "hide Agency mode behind a paywall" pattern that killed conversion.
 *
 * Visibility rules:
 *   - mode === "agency" && tier !== "agency"       → full banner
 *   - mode === "agency" && tier === "agency"       → small "Agency active" pill
 *   - mode === "clipper"                            → renders nothing
 *
 * First-time entry fires `notifyAgencyPreviewUnlocked` to the inbox so
 * the user has a trail. Subsequent toggles do NOT re-fire (localStorage
 * flag `lc.agency-preview.seen.v1`).
 */

import { useEffect, useState } from "react";
import { bus, useMode } from "../../design-os/bridge";
import { useTierCaps } from "../../design-os/state/useTierCaps";
import { useBillingState } from "../../lib/billing/adapter";
import { notifyAgencyPreviewUnlocked } from "../../inbox/notify";
import { PLAN_CATALOG } from "../../lib/billing/types";
import "./AgencyPreviewBanner.css";

/** Persist key for once-per-user notification dispatch. Prevents the inbox
 *  from filling on every programmatic mode flip (brand-consistency walk
 *  used to trigger this on every route mount). */
const SEEN_KEY = "lc.agency-preview.seen.v1";

/**
 * Outer shell · cheap. Only calls useMode + early-returns when not in
 * agency mode. This keeps clipper-mode renders (the default for ~95% of
 * routes) at zero hook cost · the brand-consistency walk used to take
 * +11s when every route mount called useTierCaps + useBillingState
 * here. Heavy hooks moved to AgencyPreviewBannerInner below, which only
 * mounts under body[data-app-mode="agency"]. */
export function AgencyPreviewBanner() {
  const mode = useMode();
  if (mode !== "agency") return null;
  return <AgencyPreviewBannerInner />;
}

function AgencyPreviewBannerInner() {
  const tier = useTierCaps();
  const billing = useBillingState();
  const isAgencyTier = tier.tier === "agency";

  // 2026-06-23 · fire-once inbox notification when a non-Agency user
  // EXPLICITLY toggles into Agency Preview Mode (TopHud click). The
  // sessionStorage gate (set by TopHud onClick) ensures the notification
  // doesn't fire from programmatic mode flips during test walks or
  // deep-link route loads. Guarded by lc.agency-preview.seen.v1 so it
  // only fires once per browser even after multiple intentional toggles.
  useEffect(() => {
    if (isAgencyTier) return; // Agency users skip the preview notification
    if (typeof window === "undefined") return;
    try {
      const userToggled = window.sessionStorage.getItem("lc.mode-toggled-by-user") === "1";
      if (!userToggled) return; // mounted programmatically · don't pollute inbox
      const seen = window.localStorage.getItem(SEEN_KEY);
      if (seen) return;
      window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
      notifyAgencyPreviewUnlocked();
    } catch {
      /* privacy mode · honest no-op */
    }
  }, [isAgencyTier]);

  // Agency users get the success pill, not the full banner.
  if (isAgencyTier) {
    return (
      <div className="lc-agency-pill" data-testid="agency-active-pill" data-state="active">
        <span className="lc-agency-pill-dot" aria-hidden="true" />
        Agency active
      </div>
    );
  }

  const agencyPlan = PLAN_CATALOG.agency;
  const ctaLabel = `Upgrade to ${agencyPlan.displayName} · $${agencyPlan.priceMonthlyUsd}/mo`;

  // 2026-06-26 · button-audit P0 · the prior `void billing.adapter
  // .startCheckout(...)` swallowed every failure silently (Tauri shell
  // plugin permission was missing from capabilities). Now: async handler,
  // catch the outcome, surface a user-visible toast on failure. Honest
  // payment truth · we never claim checkout succeeded when it didn't.
  //
  // 2026-06-26 second pass · file-based diagnostic channel because the
  // production build has no DevTools. Every step writes to
  // appdata/debug/agency-upgrade-click.json so the operator can read the
  // last click's full trace from disk without the user inspecting
  // anything. STRICTLY observational · removed after the cause lands.
  const [pending, setPending] = useState(false);
  async function writeDiag(steps: Array<Record<string, unknown>>): Promise<void> {
    try {
      const fs = await import("@tauri-apps/plugin-fs");
      await fs
        .mkdir("debug", { baseDir: fs.BaseDirectory.AppData, recursive: true })
        .catch(() => undefined);
      await fs.writeTextFile(
        "debug/agency-upgrade-click.json",
        JSON.stringify({ at: Date.now(), steps }, null, 2),
        { baseDir: fs.BaseDirectory.AppData },
      );
    } catch {
      /* fs unavailable · keep handler honest */
    }
  }
  async function onUpgradeClick(): Promise<void> {
    const trace: Array<Record<string, unknown>> = [];
    const log = (step: string, extra: Record<string, unknown> = {}) => {
      trace.push({ step, at: Date.now(), ...extra });
      void writeDiag(trace);
    };
    log("handler_entered", { pendingBefore: pending });
    if (pending) {
      log("handler_aborted_already_pending");
      return;
    }
    setPending(true);
    log("pending_state_set");
    try {
      log("opener_import_started", {
        adapterIsMock: billing.adapter.isMock,
        snapshotState: billing.state ?? null,
      });
      /* LC-UI-P0-001 · 2026-06-26 · short-circuit when we're on the mock
       * adapter. The mock fake-grants `state: active` and returns
       * `{ok:true}` even though no checkout URL ever opened — that's the
       * silent-success bug the banner used to ship. The mock is ONLY a
       * dev-preview adapter; an upgrade CTA on a real preview banner
       * should ALWAYS toast in mock mode, never claim success. */
      if (billing.adapter.isMock) {
        log("opener_short_circuit_mock");
        bus.emit("toast", {
          kind: "error",
          title: "Couldn't open checkout",
          body: "Sign in first · checkout is unavailable in preview mode.",
        });
        log("toast_emit_done");
        return;
      }
      log("opener_call_started", { plan: "agency" });
      const outcome = await billing.adapter.startCheckout("agency");
      log("opener_call_resolved", { outcomeOk: outcome.ok, error: outcome.error ?? null });
      if (outcome.ok) {
        log("opener_success", { planKey: outcome.planKey });
      } else {
        log("opener_error", { reason: outcome.error ?? "unspecified" });
        log("toast_emit_started", { kind: "error" });
        bus.emit("toast", {
          kind: "error",
          title: "Couldn't open checkout",
          body:
            outcome.error ??
            "Open Settings → Plan → Manage plan on Whop and pick Agency from there.",
        });
        log("toast_emit_done");
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : String(err ?? "unknown");
      log("opener_throw", { message: msg });
      log("toast_emit_started", { kind: "error", source: "catch" });
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't open checkout",
        body:
          err instanceof Error && err.message
            ? err.message
            : "Open Settings → Plan → Manage plan on Whop and pick Agency from there.",
      });
      log("toast_emit_done");
    } finally {
      setPending(false);
      log("finally_reset");
    }
  }

  return (
    <div
      className="lc-agency-preview"
      data-testid="agency-preview-banner"
      data-state="preview"
      data-current-tier={tier.tier}
      role="region"
      aria-label="Agency Preview Mode"
    >
      <div className="lc-agency-preview-body">
        <span className="lc-agency-preview-eb">Agency Preview Mode</span>
        <span className="lc-agency-preview-title">
          Build your campaign now. Upgrade to Agency to launch, publish, invite clients, and activate rewards.
        </span>
        <span className="lc-agency-preview-sub">
          You can draft and preview campaigns for free. Payment is only required when you launch.
        </span>
      </div>
      <button
        type="button"
        className="lc-agency-preview-cta"
        data-testid="agency-preview-upgrade-cta"
        data-checkout-pending={pending ? "1" : "0"}
        disabled={pending}
        aria-busy={pending}
        onClick={onUpgradeClick}
      >
        {pending ? "Opening checkout…" : ctaLabel}
      </button>
    </div>
  );
}
