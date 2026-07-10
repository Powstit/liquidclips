/**
 * SectionWithFallback · error-isolated section wrapper
 *
 * Lane B · Chapter 4 · Cold-Entry-Mode-B sprint (2026-07-10).
 *
 * Wraps a single "section" (e.g. one strip on WalletDetail) so that a
 * runtime error inside the section renders a `FallbackComponent` INSTEAD
 * of the section — silently — while emitting a single behavioural HQ
 * event so we can see the fallback rate per section per user in HQ.
 *
 * Guarantees
 *   1. If `SectionComponent` renders cleanly, `FallbackComponent` never
 *      mounts. The user sees the real thing.
 *   2. If `SectionComponent` throws (constructor, render, effect-init),
 *      the wrapper catches via `EngineErrorBoundary`, swaps in the
 *      `FallbackComponent`, and emits `section_fallback_triggered` ONCE
 *      per trip with a sanitized error message.
 *   3. Wrapped in Watchdog (id `shell/section-fallback`, cluster
 *      `system`) so the outermost boundary is registered with the
 *      Sovereign-Operator failure registry — HQ Admin can force-disable
 *      or hot-fix the fallback chain if it itself starts crashing.
 *   4. Uses the canonical telemetry rail (`lcDiag` from
 *      `src/lib/diagnosticLogger.ts`). No `*_rendered` telemetry — only
 *      the trip signal.
 *   5. `sanitizeError` scrubs bearer tokens, JWTs, emails, and long
 *      hex/base64 blobs before the message leaves the client.
 *
 * Non-goals
 *   - This wrapper does NOT mount itself into any surface in this
 *     sprint. Lane A owns WalletDetail visual. The parent will mount
 *     these wrappers during the serial pass (Chapter 6/7/8).
 *   - It does NOT swallow errors in FallbackComponent — if the fallback
 *     also throws, EngineErrorBoundary's own inline card renders.
 */

import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { EngineErrorBoundary } from "../design-os/components/EngineErrorBoundary";
import { Watchdog } from "../lib/watchdog/Watchdog";
import { lcDiag } from "../lib/diagnosticLogger";
import "./SectionWithFallback.css";

/** Anything the section (and the fallback) might legitimately receive. */
export type SectionExtraProps = Record<string, unknown>;

export interface SectionWithFallbackProps {
  /** Stable id — powers the HQ event + is safe to log. */
  sectionName: string;
  /** Real section. Must be a component; can be lazy-loaded. */
  SectionComponent: ComponentType<SectionExtraProps>;
  /** Silent replacement rendered when SectionComponent throws. */
  FallbackComponent: ComponentType<SectionExtraProps>;
  /**
   * Optional passthrough. Same props are given to BOTH the section and
   * the fallback so a fallback rendering the same data shape "just
   * works" without a separate prop plumbing pass.
   */
  passthrough?: SectionExtraProps;
  /**
   * Optional user id — surfaced onto the HQ event when the wrapper is
   * mounted inside an authenticated surface. Never required.
   */
  user_id?: string | null;
}

/**
 * Strip sensitive substrings from a raw error message before it leaves
 * the client. Aggressive by design — we'd rather lose signal than leak
 * a token to Railway logs. Kept small + dependency-free so the test
 * suite stays sync + fast.
 */
export function sanitizeError(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : input === undefined
          ? "unknown"
          : String(input);

  let out = raw;

  //  Emails ────────────────────────────────────────────────────────────
  out = out.replace(
    /[a-z0-9._+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi,
    "[email]",
  );

  //  Explicit bearer tokens ────────────────────────────────────────────
  out = out.replace(/bearer\s+[A-Za-z0-9._\-+/=]+/gi, "bearer [redacted]");

  //  Authorization: header shapes ──────────────────────────────────────
  out = out.replace(
    /authorization\s*[:=]\s*[A-Za-z0-9._\-+/=]+/gi,
    "authorization=[redacted]",
  );

  //  JWTs (three dot-separated base64 chunks) ──────────────────────────
  out = out.replace(
    /eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_.+/=\-]+/g,
    "[jwt]",
  );

  //  Long hex / base64 blobs (32+ chars) — API keys, secrets ───────────
  out = out.replace(/\b[A-Fa-f0-9]{32,}\b/g, "[hex]");
  out = out.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, "[blob]");

  //  Cap length so no rogue payload dumps into diag ────────────────────
  return out.slice(0, 300);
}

/**
 * Inner boundary that catches → renders the fallback + emits the diag
 * event EXACTLY once per catch. We can't use `EngineErrorBoundary`'s
 * `fallback` callback for the emit because that's called on every
 * render while erred (React 18 dev + StrictMode both double-render).
 *
 * Instead: `componentDidCatch` fires exactly once per boundary trip.
 * We route the emit through there. The `EngineErrorBoundary` still
 * hosts the crash-metadata log for consistency with the rest of the
 * Design OS bricks — we're just adding a diag-side trip signal on top.
 */
interface EmittingBoundaryProps {
  sectionName: string;
  FallbackComponent: ComponentType<SectionExtraProps>;
  passthrough: SectionExtraProps;
  user_id: string | null | undefined;
  children: ReactNode;
}

interface EmittingBoundaryState {
  err: Error | null;
}

class SectionEmittingBoundary extends Component<EmittingBoundaryProps, EmittingBoundaryState> {
  override state: EmittingBoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): EmittingBoundaryState {
    return { err };
  }

  override componentDidCatch(err: Error, _info: ErrorInfo): void {
    // Emit the trip signal exactly once — componentDidCatch fires once
    // per catch (not per render-while-erred).
    try {
      lcDiag("section_fallback_triggered", {
        section: this.props.sectionName,
        error_message: sanitizeError(err),
        user_id: this.props.user_id ?? null,
      });
    } catch {
      /* diag is best-effort — never re-throw from the boundary */
    }
  }

  override render(): ReactNode {
    if (this.state.err) {
      const F = this.props.FallbackComponent;
      return <F {...this.props.passthrough} />;
    }
    return this.props.children;
  }
}

function InnerBoundary({
  sectionName,
  SectionComponent,
  FallbackComponent,
  passthrough,
  user_id,
}: SectionWithFallbackProps) {
  const props = passthrough ?? {};
  // Outer EngineErrorBoundary keeps the design-os crash-metadata log +
  // uniform Sentry-hook shape. Inner SectionEmittingBoundary owns the
  // diag emit + the fallback swap. Because inner catches FIRST, outer
  // never trips on a section error — it only trips if the FALLBACK
  // itself explodes, in which case EngineErrorBoundary's inline card
  // renders (belt-and-braces).
  return (
    <EngineErrorBoundary route="shell" component={sectionName}>
      <SectionEmittingBoundary
        sectionName={sectionName}
        FallbackComponent={FallbackComponent}
        passthrough={props}
        user_id={user_id}
      >
        <SectionComponent {...props} />
      </SectionEmittingBoundary>
    </EngineErrorBoundary>
  );
}

/**
 * Public surface.
 *
 * Usage (Chapter 6/7/8 will wire this):
 *
 *   <SectionWithFallback
 *     sectionName="wallet-detail/pipeline-strip"
 *     SectionComponent={PipelineStrip}
 *     FallbackComponent={PipelineStripSkeleton}
 *     passthrough={{ summary }}
 *     user_id={user?.id ?? null}
 *   />
 */
export function SectionWithFallback(props: SectionWithFallbackProps) {
  return (
    <Watchdog
      id="shell/section-fallback"
      cluster="system"
      label="Section fallback chain"
      source="src/components/SectionWithFallback.tsx"
    >
      <div className="lc-section-fallback-wrap" data-section={props.sectionName}>
        <InnerBoundary {...props} />
      </div>
    </Watchdog>
  );
}
