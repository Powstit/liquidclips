// v0.6.35 — Avatar Orbit.
//
// Replaces the v0.6.34 top-right header chrome (sidecar status pulse,
// NotificationBell, Refresh button, Settings button). One circle, one orbital
// ring, one ambient signal: lifetime earnings. Click to summon AvatarPanel.
//
// The orbit ring carries the dopamine signal so the user gets a glance every
// session without the home page itself surfacing a dashboard. The ring also
// reflects sidecar health — heartbeat is fuchsia when ready, amber when
// starting, red when failed.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Crown } from "lucide-react";
import { useAvatar, avatarSrc, initialsOf } from "../../lib/avatar";
import { meStatus, meAffiliate, type MeStatus, type AffiliateMeResponse } from "../../lib/backend";
import { fmtUsd } from "../../lib/payoutsAggregations";

type SidecarStatus = "starting" | "ready" | "failed";
type Tier = "free" | "solo" | "pro" | "agency" | "growth" | "autopilot" | null;

export function AvatarOrbit({
  sidecarStatus,
  notificationCount,
  tier,
  onOpen,
}: {
  sidecarStatus: SidecarStatus;
  notificationCount: number;
  tier: Tier;
  onOpen: () => void;
}) {
  const url = useAvatar((s) => s.url);
  const bustKey = useAvatar((s) => s.bustKey);
  const refresh = useAvatar((s) => s.refresh);
  const [me, setMe] = useState<MeStatus | null>(null);
  const [aff, setAff] = useState<AffiliateMeResponse | null>(null);

  useEffect(() => {
    void refresh();
    void meStatus().then(setMe).catch(() => setMe(null));
    void meAffiliate().then(setAff).catch(() => setAff(null));
  }, [refresh]);

  const email = me?.email ?? null;
  const initials = initialsOf(email);
  const renderedSrc = avatarSrc({ url, bustKey });
  const lifetime = Number(aff?.affiliate?.total_referral_earnings_usd ?? "0") || 0;

  // Sidecar health → orbit colour. Fuchsia is the resting truth; amber +
  // red are exception states the user should notice without us blasting a
  // toast at them.
  const ringColour =
    sidecarStatus === "ready"
      ? "var(--color-fuchsia)"
      : sidecarStatus === "failed"
      ? "#DC2626"
      : "#F59E0B";

  // Paid tier gets the crown nested inside the ring. Free stays clean —
  // upgrading is a status symbol, not a default.
  const isPaid = tier !== null && tier !== "free";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="avatar-orbit relative inline-flex h-16 w-16 items-center justify-center"
      aria-label="Open profile menu"
    >
      {/* Outer orbital ring — heartbeat scale 1 → 1.06 over 4s. The
          dot-bearing wrapper rotates a slow 24s, so the lifetime chip below
          orbits without us animating its position math. */}
      <motion.span
        aria-hidden="true"
        className="avatar-orbit-ring"
        style={{ borderColor: ringColour }}
        animate={{ scale: [1, 1.06, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Lifetime earnings chip riding the ring. Tiny mono, always-on, the
          single dopamine signal that survived the home-page strip. */}
      {lifetime > 0 && (
        <span className="avatar-orbit-chip">
          <span aria-hidden="true" className="avatar-orbit-chip-dot" />
          {fmtUsd(lifetime)}
        </span>
      )}

      {/* Notification badge — only when there's something. No "0" spam. */}
      {notificationCount > 0 && (
        <span className="avatar-orbit-badge" aria-label={`${notificationCount} new notifications`}>
          {notificationCount > 9 ? "9+" : notificationCount}
        </span>
      )}

      {/* Avatar circle. PNG if uploaded; else initials gradient — same
          formula as the v0.6.4 RankStrip so the look is continuous. */}
      <span className="avatar-orbit-face">
        {renderedSrc ? (
          <img
            src={renderedSrc}
            alt=""
            className="h-full w-full rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="avatar-orbit-initials">{initials}</span>
        )}
        {/* Tier crown — nested top-right so it reads as a class indicator,
            not a notification. Hidden for free tier. */}
        {isPaid && (
          <span aria-hidden="true" className="avatar-orbit-crown">
            <Crown className="h-3 w-3" strokeWidth={2} />
          </span>
        )}
      </span>
    </button>
  );
}
