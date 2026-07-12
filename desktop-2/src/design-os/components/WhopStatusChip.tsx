/**
 * WhopStatusChip · BUG-004 + BUG-014 · Wave 2 · Train A2 · 2026-07-12.
 *
 * Persistent Whop-connection status affordance. Mounted twice:
 *   1. TopHud pill strip — always visible for JWT-holding users
 *   2. Home hero (CommandRoom) — full CTA card, unlinked state only
 *
 * BC-002 class-elimination pattern: ``state.whop-connection`` has ONE
 * canonical source — ``useMe().snapshot.whopUserId``. Every visible
 * Whop CTA in the app reads that source through this component. No
 * component that renders a "Connect Whop" affordance derives its own
 * connection state.
 *
 * Four locked states (deterministic priority):
 *   1. ``no-jwt``   · ``!hasJwt``                          → render nothing
 *   2. ``linking``  · ``linkingRef`` transient window       → "Linking…"
 *                     between click + activation:complete
 *   3. ``linked``   · ``!!whopUserId``                     → "Whop linked"
 *   4. ``unlinked`` · ``hasJwt && !whopUserId``            → "Connect Whop"
 *
 * Telemetry (via existing ``lcDiag``):
 *   * ``whop_status_chip_impression`` `{state, mount_site}` on first render
 *   * ``whop_connect_cta_clicked`` `{mount_site}` on click
 *   * ``whop_status_transition`` `{from, to, elapsedMs}` when whopUserId
 *     truthiness flips (measured against last known state timestamp)
 *
 * No new npm deps · no new backend endpoints · no new bus events
 * beyond what ``connectWhop()`` already fires. Reads ``useMe`` (RO for
 * A2 per OWNERSHIP_MATRIX_TRAIN_A.md) + ``useAuth`` (RO) + calls the
 * existing ``connectWhop()`` helper (Whop OAuth start flow).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../state/useMe";
import { useAuth } from "../../lib/useAuth";
import { connectWhop } from "../../lib/whopConnect";
import { lcDiag } from "../../lib/diagnosticLogger";
import { bus } from "../bridge";

export type WhopChipMountSite = "top-hud" | "home-hero";
export type WhopChipState = "no-jwt" | "unlinked" | "linking" | "linked";

export interface WhopStatusChipProps {
  /**
   * Where the chip is being mounted. Used for telemetry
   * differentiation so Doctor can see how many CTAs each surface
   * fires. Also drives the visual variant — TopHud uses a compact
   * pill; Home hero uses a full CTA card.
   */
  mountSite: WhopChipMountSite;
}

/**
 * Derive the current chip state from the canonical sources. Kept as a
 * pure function so the same derivation runs in every mount + is easy
 * to unit-test.
 *
 * Priority order (deterministic):
 *   1. ``!hasJwt`` → ``no-jwt`` · auth path always wins
 *   2. truthy whopUserId → ``linked`` · connection already exists, a
 *      transient ``linking`` flag that survived the round-trip must
 *      not stall the chip on the pending copy
 *   3. transient ``linking`` flag → ``linking`` · click-to-oauth window
 *   4. otherwise → ``unlinked`` · JWT but no Whop yet · the money CTA
 */
export function deriveWhopChipState(
  hasJwt: boolean,
  whopUserId: string | null | undefined,
  linking: boolean,
): WhopChipState {
  if (!hasJwt) return "no-jwt";
  if (whopUserId) return "linked";
  if (linking) return "linking";
  return "unlinked";
}

export function WhopStatusChip({ mountSite }: WhopStatusChipProps) {
  const { hasJwt } = useAuth();
  const me = useMe();
  const whopUserId = me.snapshot?.whopUserId ?? null;

  /* ``linking`` is a transient client-only window. Fires when the user
   * clicks the CTA; clears when ``activation:complete`` lands OR the
   * ``whopUserId`` flips truthy (backend caught up). Ensures the chip
   * shows "Linking…" during the OAuth round-trip instead of flickering
   * back to "Connect Whop" while the deep-link flow completes. */
  const [linking, setLinking] = useState(false);

  const state = useMemo(
    () => deriveWhopChipState(hasJwt, whopUserId, linking),
    [hasJwt, whopUserId, linking],
  );

  /* Track the previous whopUserId truthiness so we can fire
   * ``whop_status_transition`` when the state moves. ``lastFlipAtRef``
   * lets us report the elapsed time between transitions — Doctor uses
   * this to confirm activation:complete round-trips inside the OAuth
   * SLA (~10s). */
  const previousLinkedRef = useRef<boolean | null>(null);
  const lastFlipAtRef = useRef<number>(Date.now());
  const impressionFiredRef = useRef<boolean>(false);

  /* Impression fires on first render for the current mount site.
   * Uses a mount-scoped ref so a state change within the same mount
   * does not re-fire — only remount fires a fresh impression. Mount
   * site is included so Doctor can see chip visibility per surface. */
  useEffect(() => {
    if (impressionFiredRef.current) return;
    if (state === "no-jwt") return; // no chip is rendered · no impression
    impressionFiredRef.current = true;
    try {
      lcDiag("whop_status_chip_impression", {
        state,
        mount_site: mountSite,
      });
    } catch {
      /* diagnostic failures never block the render */
    }
  }, [state, mountSite]);

  /* Transition telemetry · fires only when the whop connection
   * truthiness flips. ``linking`` transitions are intentionally NOT
   * reported here so the telemetry stays focused on the customer-
   * visible connection event, not the click-side transient. */
  useEffect(() => {
    const nextLinked = !!whopUserId;
    const previous = previousLinkedRef.current;
    if (previous === null) {
      // First observation for this mount · seed the ref, no emit.
      previousLinkedRef.current = nextLinked;
      lastFlipAtRef.current = Date.now();
      return;
    }
    if (previous === nextLinked) return;
    const now = Date.now();
    const elapsedMs = now - lastFlipAtRef.current;
    try {
      lcDiag("whop_status_transition", {
        from: previous ? "linked" : "unlinked",
        to: nextLinked ? "linked" : "unlinked",
        elapsedMs,
        mount_site: mountSite,
      });
    } catch {
      /* silent */
    }
    previousLinkedRef.current = nextLinked;
    lastFlipAtRef.current = now;
    // Auto-clear the linking flag once we observe a truthy whopUserId.
    if (nextLinked && linking) setLinking(false);
  }, [whopUserId, mountSite, linking]);

  /* Also clear ``linking`` when ``activation:complete`` fires, even
   * if useMe hasn't caught up yet. Guards against the OAuth flow
   * completing but /me not yet re-fetched — the transient chip state
   * would otherwise persist stale. */
  useEffect(() => {
    if (!linking) return;
    const off = bus.on("activation:complete", () => {
      setLinking(false);
    });
    return off;
  }, [linking]);

  const onClick = () => {
    try {
      lcDiag("whop_connect_cta_clicked", { mount_site: mountSite });
    } catch {
      /* silent */
    }
    setLinking(true);
    void connectWhop().catch((err) => {
      // Fallback if the OAuth start fails — clear linking so the user
      // can retry, surface a customer-safe toast.
      setLinking(false);
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't open Whop",
        body: err instanceof Error ? err.message : "Please try again.",
      });
    });
  };

  if (state === "no-jwt") return null;

  if (mountSite === "home-hero") {
    // Full hero CTA card · only rendered in the unlinked state (the
    // other states are handled by the top-hud chip). Kept
    // self-contained so CommandRoom doesn't have to know the wiring.
    if (state !== "unlinked") return null;
    return (
      <div
        className="lc-whop-hero-cta"
        data-testid="whop-hero-cta"
        data-whop-chip-state={state}
        data-whop-chip-mount="home-hero"
        style={{
          marginTop: 16,
          padding: "16px 20px",
          borderRadius: 14,
          border: "1px solid var(--color-fuchsia, #ff1a8c)",
          background: "rgba(255, 26, 140, 0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--color-fuchsia, #ff1a8c)",
            }}
          >
            Recurring MRR
          </span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            Connect Whop to activate paid clips
          </span>
        </div>
        <button
          type="button"
          onClick={onClick}
          data-testid="whop-hero-cta-button"
          aria-label="Connect Whop"
          style={{
            padding: "10px 18px",
            borderRadius: 9999,
            border: "1px solid var(--color-fuchsia, #ff1a8c)",
            background: "var(--color-fuchsia, #ff1a8c)",
            color: "var(--color-paper, #14141b)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Connect Whop →
        </button>
      </div>
    );
  }

  // top-hud mount · compact pill · every state (except no-jwt) renders.
  const copy =
    state === "linked"
      ? "Whop linked"
      : state === "linking"
        ? "Linking…"
        : "Connect Whop";
  const dot =
    state === "linked" ? "#22c55e" : state === "linking" ? "#f59e0b" : "#ff1a8c";
  const isClickable = state === "unlinked";
  return (
    <button
      type="button"
      className="lc-pill lc-pill-whop"
      data-testid="whop-status-chip"
      data-whop-chip-state={state}
      data-whop-chip-mount="top-hud"
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      aria-label={
        state === "linked"
          ? "Whop connection linked"
          : state === "linking"
            ? "Linking Whop connection…"
            : "Connect Whop"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: isClickable ? "pointer" : "default",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          background: dot,
          boxShadow: `0 0 8px ${dot}`,
        }}
      />
      <span>{copy}</span>
    </button>
  );
}
