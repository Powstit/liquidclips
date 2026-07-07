/**
 * AnnouncementBanner · v2.2.9
 *
 * Fixed-position banner stack rendered at the top of every Design-OS
 * route surface. Consumes `useAnnouncements()` (which reads /sync
 * `active_announcements`) and renders one motion.div per active row,
 * tinted by severity:
 *   info     → fuchsia (Liquid Clips brand accent)
 *   warning  → amber
 *   critical → red
 *
 * Default-hide invariant: when the hook returns `[]` the component
 * returns `null` and paints nothing — the pinned visual baseline
 * (Workstation post-complete, no /sync.active_announcements key) stays
 * at 0% pixel drift.
 *
 * Layout: the stack is `position: fixed` at top:0 / left:0 / right:0
 * with z-index above ConsoleNav + TopHud. It does NOT take flow space,
 * so the in-flow content underneath does not shift when announcements
 * arrive. Spacer styling that pushes content down belongs in a future
 * iteration if a sticky banner becomes mandatory; for v1 we paint over
 * the top chrome since broadcasts are read-then-dismissed.
 */
import { AnimatePresence, motion } from "framer-motion";

import {
  useAnnouncements,
  type ActiveAnnouncement,
  type AnnouncementSeverity,
} from "../../lib/announcements";
import { openInApp } from "../../lib/openInApp";
// ag-21 · 2026-07-06 · Watchdog wrap · Sovereign-Operator Protocol.
// DEMO tier: Announcements read from /sync.active_announcements; posting still
// happens on Whop. The banner stack is fixed-position on top of every Design-OS
// route, so a crash inside a BannerRow (bad CTA URL open, bad severity token
// lookup, framer-motion regression) must render KadeRepairScreen instead of
// white-screening the shell chrome underneath.
import { Watchdog } from "../../lib/watchdog/Watchdog";

interface SeverityTokens {
  /** Solid background tint · slightly translucent so the world layer
   *  behind it still reads as Liquid Clips chrome. */
  background: string;
  border: string;
  text: string;
  badge: string;
  badgeText: string;
}

const SEVERITY_PALETTE: Record<AnnouncementSeverity, SeverityTokens> = {
  info: {
    background: "rgba(255, 26, 140, 0.94)", // fuchsia · LC brand accent
    border: "rgba(255, 105, 180, 0.9)",
    text: "#ffffff",
    badge: "rgba(255, 255, 255, 0.18)",
    badgeText: "#ffffff",
  },
  warning: {
    background: "rgba(245, 158, 11, 0.95)", // amber
    border: "rgba(252, 211, 77, 0.95)",
    text: "#1f1300",
    badge: "rgba(31, 19, 0, 0.18)",
    badgeText: "#1f1300",
  },
  critical: {
    background: "rgba(220, 38, 38, 0.96)", // red
    border: "rgba(252, 165, 165, 0.95)",
    text: "#ffffff",
    badge: "rgba(255, 255, 255, 0.18)",
    badgeText: "#ffffff",
  },
};

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  info: "Update",
  warning: "Heads up",
  critical: "Action needed",
};

function BannerRow({ row }: { row: ActiveAnnouncement }): JSX.Element {
  const tokens = SEVERITY_PALETTE[row.severity];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      role="status"
      data-testid="lc-announcement-banner"
      data-severity={row.severity}
      data-scope={row.scope}
      style={{
        background: tokens.background,
        borderBottom: `1px solid ${tokens.border}`,
        color: tokens.text,
        padding: "10px 22px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: 14,
        lineHeight: 1.4,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "0 6px 18px -10px rgba(0, 0, 0, 0.45)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "3px 10px",
          borderRadius: 999,
          background: tokens.badge,
          color: tokens.badgeText,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {SEVERITY_LABEL[row.severity]}
        {row.scope === "agency" ? " · Agency" : ""}
      </span>
      <span style={{ fontWeight: 600 }}>{row.title}</span>
      {row.body_markdown ? (
        <span style={{ opacity: 0.92, fontWeight: 400 }}>
          {row.body_markdown}
        </span>
      ) : null}
      {row.cta_text && row.cta_url ? (
        <a
          href={row.cta_url}
          onClick={(event) => {
            event.preventDefault();
            void openInApp(row.cta_url as string, { intent: "read-only" });
          }}
          style={{
            marginLeft: "auto",
            color: tokens.text,
            background: tokens.badge,
            padding: "6px 12px",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {row.cta_text}
        </a>
      ) : null}
    </motion.div>
  );
}

export function AnnouncementBanner(): JSX.Element | null {
  const { items } = useAnnouncements();
  if (items.length === 0) return null;
  return (
    <Watchdog
      id="agency/ag-21/announcements"
      label="Announcements banner"
      cluster="agency"
      source="design-os/components/AnnouncementBanner.tsx:149"
    >
      <div
        data-testid="lc-announcement-banner-stack"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 90,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
        }}
      >
        <AnimatePresence initial={false}>
          {items.map((row) => (
            <BannerRow key={row.id} row={row} />
          ))}
        </AnimatePresence>
      </div>
    </Watchdog>
  );
}
