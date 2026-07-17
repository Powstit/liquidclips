/**
 * FounderMoments · closed-door recognition + celebration overlays.
 * 2026-07-17
 *
 * Two moments the cold-invited founder deserves that were silent
 * before this component landed:
 *
 *   1. Post-payment recognition — on `activation:complete`, render a
 *      full-view Kade seat-unlocked hero for ~6s. Marks
 *      `lc:founder-welcomed:<lcId>` so it fires once per user, ever.
 *
 *   2. First-clip celebration — on the first `billing:settled`
 *      event of the session (LLM finished, clips arrived), render a
 *      Kade "you found gold" celebration for ~3s. Marks
 *      `lc:first-clip-celebrated:<lcId>` so it fires once per user.
 *
 * Both moments are portal-mounted overlays via the shared
 * `useModalPortal` + `useRegisterModal` stack so Esc handling +
 * scroll-lock coordinate LIFO with every other portal-mounted modal
 * (AssetRansomPaywall / FreePreviewDisclosureCard / InboxSheet /
 * PublishModal / SubmitToWhopModal / EngineEditorOverlay).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { bus } from "../../design-os/bridge/events";
import { useMe } from "../../design-os/state/useMe";
import { useModalPortal, useRegisterModal } from "../../design-os/components/ModalPortal";

// Scoped keys resolve to `${prefix}:${lcId}` via `keyFor` below. The
// bare prefix (no `:lcId` suffix) was the legacy global key shipped
// briefly on 2026-07-17 — a user who saw the welcome under that
// pre-scoping build should be migrated to the scoped equivalent so
// they aren't re-welcomed. See `migrateLegacyFlags` below.
const WELCOMED_KEY = "lc:founder-welcomed";
const FIRST_CLIP_KEY = "lc:first-clip-celebrated";

const WELCOME_HOLD_MS = 6000;
const FIRST_CLIP_HOLD_MS = 3000;

type Moment =
  | { kind: "welcome"; source: string }
  | { kind: "first-clip" };

function keyFor(prefix: string, lcId: string | null | undefined): string {
  return lcId ? `${prefix}:${lcId}` : prefix;
}

function safeGet(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string): void {
  try { window.localStorage.setItem(k, v); } catch { /* noop */ }
}
function safeRemove(k: string): void {
  try { window.localStorage.removeItem(k); } catch { /* noop */ }
}

/** Migrate legacy unscoped flags into scoped keys the first time we
 * see a signed-in user. Called once per lcId change. The legacy read
 * uses the bare prefix (no `:lcId` suffix), which was what the pre-
 * scoping build wrote for a very short window on 2026-07-17. */
function migrateLegacyFlags(lcId: string | null | undefined): void {
  if (!lcId) return;
  for (const prefix of [WELCOMED_KEY, FIRST_CLIP_KEY]) {
    if (safeGet(prefix) !== "1") continue;
    // Only migrate if the scoped key isn't already set. If the user
    // switched laptops the legacy key won't exist here.
    if (safeGet(keyFor(prefix, lcId)) !== "1") {
      safeSet(keyFor(prefix, lcId), "1");
    }
    safeRemove(prefix);
  }
}

export function FounderMoments(): ReactElement | null {
  const me = useMe();
  const lcId = me.snapshot?.lcId ?? null;
  const [moment, setMoment] = useState<Moment | null>(null);
  const timerRef = useRef<number | null>(null);

  // Migrate any legacy global flags to lcId-scoped once we know who
  // we are. Runs whenever lcId changes (sign-in / account switch).
  useEffect(() => {
    migrateLegacyFlags(lcId);
  }, [lcId]);

  // Reset local moment state on sign-out so a fresh sign-in on a
  // different account can trigger fresh moments (matches
  // MembershipGate's auth:signed-out handler).
  useEffect(() => {
    const off = bus.on("auth:signed-out", () => {
      setMoment(null);
    });
    return () => {
      try { off(); } catch { /* noop */ }
    };
  }, []);

  // Subscribe to activation moment. lcId-scoped flag ensures re-signin
  // never re-plays. First-clip celebration is triggered by a separate
  // effect below that watches the allowanceUsedSeconds transition,
  // NOT the raw `billing:settled` event — see comment there.
  useEffect(() => {
    const offActivation = bus.on("activation:complete", (payload) => {
      const k = keyFor(WELCOMED_KEY, lcId);
      if (safeGet(k) === "1") return;
      safeSet(k, "1");
      const src = (payload as { source?: string } | null)?.source ?? "unknown";
      setMoment({ kind: "welcome", source: src });
    });
    return () => {
      try { offActivation(); } catch { /* noop */ }
    };
  }, [lcId]);

  // P2-R2-002 fix (2026-07-17) · trigger first-clip celebration on
  // `allowanceUsedSeconds` transitioning from 0 → positive rather than
  // raw `billing:settled`. This ensures the "you found gold" hero
  // fires only when a genuine free-user analysis lands, not on
  // background-restored project settlements or paying-tier settles
  // that also emit `billing:settled` via `tauri-adapter.ts:275`.
  const prevAllowanceUsedRef = useRef<number>(me.snapshot?.allowanceUsedSeconds ?? 0);
  useEffect(() => {
    const current = me.snapshot?.allowanceUsedSeconds ?? 0;
    const previous = prevAllowanceUsedRef.current;
    prevAllowanceUsedRef.current = current;
    // Only celebrate the first transition from zero to positive within
    // this account's lifetime. Every subsequent settle is silent.
    if (previous > 0 || current <= 0) return;
    const k = keyFor(FIRST_CLIP_KEY, lcId);
    if (safeGet(k) === "1") return;
    safeSet(k, "1");
    setMoment({ kind: "first-clip" });
  }, [me.snapshot?.allowanceUsedSeconds, lcId]);

  // Auto-dismiss after the moment's hold window.
  useEffect(() => {
    if (!moment) return;
    const hold = moment.kind === "welcome" ? WELCOME_HOLD_MS : FIRST_CLIP_HOLD_MS;
    timerRef.current = window.setTimeout(() => setMoment(null), hold);
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [moment]);

  // Esc dismisses via the shared LIFO modal registrar. Also add a
  // capture-phase document listener so Esc still fires when an
  // iframe (e.g. Whop checkout) currently holds focus.
  useRegisterModal({
    open: moment != null,
    onEscape: () => setMoment(null),
    id: `founder-moment/${moment?.kind ?? "idle"}`,
  });
  useEffect(() => {
    if (!moment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoment(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [moment]);

  const portalHost = useModalPortal();

  if (!moment) return null;

  const body = moment.kind === "welcome"
    ? (
      <div
        className="lc-founder-moment lc-founder-moment--welcome"
        role="status"
        aria-live="polite"
        data-testid="founder-moment-welcome"
      >
        <img
          src="/brand/founder/seat-unlocked-static.png"
          alt=""
          className="lc-founder-moment-art"
          loading="eager"
          decoding="async"
        />
        <p className="lc-founder-moment-eb">Welcome, Founder</p>
        <h2 className="lc-founder-moment-title">Your seat is locked.</h2>
        <p className="lc-founder-moment-sub">
          100 hours of AI clipping · watermark off · rate held for life.
        </p>
      </div>
    )
    : (
      <div
        className="lc-founder-moment lc-founder-moment--first-clip"
        role="status"
        aria-live="polite"
        data-testid="founder-moment-first-clip"
      >
        <img
          src="/brand/kade/kade-first-clip-celebration.png"
          alt=""
          className="lc-founder-moment-art"
          loading="eager"
          decoding="async"
        />
        <p className="lc-founder-moment-eb">First clips landed</p>
        <h2 className="lc-founder-moment-title">You found gold.</h2>
        <p className="lc-founder-moment-sub">
          Pick your favourites · export the ones you love.
        </p>
      </div>
    );

  const rendered = (
    <>
      {body}
      <style>{MOMENT_STYLES}</style>
    </>
  );

  return portalHost ? createPortal(rendered, portalHost) : createPortal(rendered, document.body);
}

const MOMENT_STYLES = `
.lc-founder-moment {
  position: fixed;
  /* Reserve top 28px so packaged Tauri titlebar / traffic lights
     stay visible even during the celebration hold. */
  top: 28px;
  right: 0;
  bottom: 0;
  left: 0;
  /* Above every other portal overlay (AssetRansomPaywall 10500,
     FreePreviewDisclosureCard 9998, AgencyWelcome 9500, InboxSheet
     9000, ActivateFounderPanel 50) but below BootErrorBoundary
     999999. Land in the empty band at 10800. */
  z-index: 10800;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  background: radial-gradient(
    ellipse at center,
    rgba(20, 6, 18, 0.86) 0%,
    rgba(4, 2, 8, 0.94) 60%,
    rgba(0, 0, 0, 0.98) 100%
  );
  animation: lc-founder-moment-in 320ms ease-out;
  pointer-events: none;
  color: #f4f1ea;
  font-family: "Inter", system-ui, sans-serif;
}
@keyframes lc-founder-moment-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.lc-founder-moment-art {
  width: min(360px, 60vw);
  height: auto;
  border-radius: 22px;
  filter: drop-shadow(0 24px 60px rgba(255, 26, 140, 0.4));
  animation: lc-founder-moment-art-rise 480ms cubic-bezier(.2,.7,.2,1);
}
@keyframes lc-founder-moment-art-rise {
  from { transform: translateY(24px) scale(0.96); opacity: 0; }
  to   { transform: translateY(0)    scale(1);    opacity: 1; }
}
.lc-founder-moment-eb {
  margin: 18px 0 0;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: #ff66b8;
  text-shadow: 0 0 12px rgba(255, 102, 184, 0.55);
}
.lc-founder-moment-title {
  margin: 4px 0 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #f4f1ea;
  text-align: center;
}
.lc-founder-moment-sub {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: rgba(244, 241, 234, 0.76);
  text-align: center;
  max-width: 460px;
}
`;
