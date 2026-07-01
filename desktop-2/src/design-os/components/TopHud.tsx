/**
 * TopHud · the top compact glass-pill bar
 *
 * Phase 4B-rev rule: NEVER DSEG here. Pills are Inter + Geist Mono small caps.
 * Collision rule: each pill flex-shrinks/min-widths so the search expands and
 * fixed pills hold their own.
 *
 * UI-1 · adds the Clipper / Agency mode pill between News and Streak. Mode
 * is persisted in localStorage ("lc.mode") and broadcast on `mode:change`
 * so workstation defaults can adapt in UI-2.
 */

import { useEffect, useRef, useState } from "react";
import { bus, useEvent, type AppMode } from "../bridge";
import { getJwt, clearJwt } from "../../lib/authStorage";
import { unreadCount } from "../../inbox";
import { InboxSheet } from "../../shell/InboxSheet";
import { TrialStatusPill } from "./TrialStatusPill";
import "./TopHud.css";

const MODE_STORAGE_KEY = "lc.mode";

function readPersistedMode(): AppMode {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    return raw === "agency" ? "agency" : "clipper";
  } catch { return "clipper"; }
}

export interface TopHudProps {
  greetingEyebrow?: string;
  greetingName?: string;
  /** Free-form right-hand chips. Daniel: keep small. */
  newsCount?: number;
  streakDays?: number;
  userName?: string;
  userTier?: string;
}

export function TopHud({
  greetingEyebrow = "Good evening ✦",
  // BUG-001 · "Daniel" leaked into every new-user TopHud because the
  // /me hook hadn't resolved. Use a generic on-brand fallback so the
  // chrome reads honestly until the real user is loaded.
  greetingName = "Guest",
  // Beta-honest default — until an Inbox/Notifications surface ships in DOS,
  // we don't fake a NEWS count. The chip stays hidden when count is 0, and
  // re-appears the moment a real notifications hook starts pushing values.
  // Pairs with `Phase 6E-NewsChip-Hide` in TopHud.tsx render branch below.
  newsCount = 0,
  streakDays = 7,
  userName = "Guest",
  // BUG-001 · was "Beta". The product's actual entry tier is "Free" —
  // "Beta" implied invite-only access that doesn't exist. Real tier from
  // /me overrides this whenever billing has resolved.
  userTier = "Free",
}: TopHudProps) {
  const [mode, setMode] = useState<AppMode>(() => readPersistedMode());

  useEffect(() => {
    try { window.localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* noop */ }
    bus.emit("mode:change", { mode });
  }, [mode]);

  /* 2026-06-26 · C2 hardening · TopHud's mode state used to be write-only
   * (emit mode:change when its own pill flipped, but never listen). That
   * left the .on class out-of-sync with any external mode flip — the
   * splash-and-agency-palette test emits mode:change programmatically
   * via window.__lcBus and the pill stayed on the prior mode. Subscribe
   * so external flips reach the pill render. setMode is idempotent for
   * the same value, so the round-trip with the emit effect above does
   * not create a feedback loop. */
  useEvent("mode:change", (p) => setMode(p.mode));

  // BUG-046 · the user pill in TopHud is the customer-visible avatar
  // affordance on every Design OS route. Until now it was a decorative
  // div — Settings was unreachable from the chrome. Convert into a real
  // dropdown menu (Settings / Notifications / Sign out · the last item
  // only when a JWT is actually present).
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unread, setUnread] = useState<number>(() => unreadCount());
  const [hasJwt, setHasJwt] = useState<boolean>(() => !!getJwt());
  const menuRootRef = useRef<HTMLDivElement>(null);

  /* FEATURE-001 · subscribe to inbox bus events so the badge updates
   * even when the InboxSheet is closed. Without this, the badge would
   * only refresh through the InboxSheet's onUnreadChange callback,
   * which means a new notification arriving in the background would
   * leave the badge stale until the user opens the sheet. */
  useEffect(() => {
    const refresh = () => setUnread(unreadCount());
    const off1 = bus.on("inbox:added", refresh);
    const off2 = bus.on("inbox:read", refresh);
    return () => { off1(); off2(); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRootRef.current) return;
      if (!menuRootRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const goSettings = () => {
    setMenuOpen(false);
    bus.emit("nav:click", { route: "settings" });
  };
  const goNotifications = () => {
    setMenuOpen(false);
    setInboxOpen(true);
  };
  const doSignOut = () => {
    setMenuOpen(false);
    try { clearJwt(); } catch { /* honest no-op */ }
    setHasJwt(false);
    bus.emit("toast", {
      kind: "info",
      title: "Signed out",
      body: "Reload the app to sign in again.",
    });
  };

  return (
    <header className="lc-hud">
      <div className="lc-hud-greet">
        <span className="lc-hud-greet-eb">{greetingEyebrow}</span>
        <span className="lc-hud-greet-name">{greetingName}</span>
      </div>

      <div className="lc-pill lc-pill-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input placeholder="Search clips, campaigns, missions…" />
        <span className="lc-hud-kbd">⌘F</span>
      </div>

      <div
        className="lc-pill lc-pill-mode"
        role="radiogroup"
        aria-label="App mode"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "clipper"}
          className={`lc-hud-mode-opt ${mode === "clipper" ? "on" : ""}`}
          onClick={() => {
            // 2026-06-23 · mark explicit user toggle so AgencyPreviewBanner
            // fires its first-time notification only on real intent, not
            // programmatic mode flips from tests or deep-link routes.
            try { window.sessionStorage.setItem("lc.mode-toggled-by-user", "1"); } catch { /* noop */ }
            setMode("clipper");
          }}
        >Clipper</button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "agency"}
          className={`lc-hud-mode-opt ${mode === "agency" ? "on" : ""}`}
          onClick={() => {
            try { window.sessionStorage.setItem("lc.mode-toggled-by-user", "1"); } catch { /* noop */ }
            setMode("agency");
          }}
        >Agency</button>
      </div>

      {/* Phase 6E-NewsChip-Hide — the inbox surface isn't wired yet, so a
          static "2 NEWS" chip is just a dead counter. Render only when a
          real signal pushes the count above zero (and at that point also
          wire an onClick to the inbox route — TBD). */}
      {newsCount > 0 && (
        <div className="lc-pill" role="status">
          <span className="lc-hud-dot" />
          <span>{newsCount} NEWS</span>
        </div>
      )}

      {/* v2.2.15 · trial countdown pill. Hides for paid users + non-trial
       *  states · so the workstation baseline (Guest/Free) doesn't drift. */}
      <TrialStatusPill />

      <div className="lc-pill lc-pill-streak">
        <img
          src="/brand/icons/metric/streak-flame.svg"
          alt=""
          style={{ width: 13, height: 13, filter: "drop-shadow(0 0 6px rgba(245,158,11,.55))" }}
        />
        <span className="lc-hud-streak-num">{streakDays}</span>
        <span className="lc-hud-streak-unit">day</span>
      </div>

      <div
        ref={menuRootRef}
        className="lc-hud-user-wrap"
        data-testid="avatar-orbit-root"
        data-menu-open={menuOpen ? "1" : "0"}
        style={{ position: "relative" }}
      >
        <button
          type="button"
          className="lc-pill lc-pill-user lc-pill-user-btn"
          data-testid="avatar-orbit-button"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <div className="lc-hud-avatar" aria-hidden="true" />
          <div className="lc-hud-user-text">
            <span className="lc-hud-user-name">{userName}</span>
            <span className="lc-hud-user-tier">{userTier}</span>
          </div>
          {unread > 0 && (
            <span
              data-testid="avatar-orbit-badge"
              style={{
                marginLeft: 6,
                background: "rgba(255, 26, 140, 0.9)",
                color: "#fff",
                borderRadius: 9999,
                padding: "1px 7px",
                fontSize: 11,
              }}
            >{unread}</span>
          )}
        </button>

        {menuOpen && (
          <div
            role="menu"
            data-testid="avatar-orbit-menu"
            className="lc-hud-user-menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 208,
              padding: 6,
              borderRadius: 12,
              background: "rgba(20, 12, 22, 0.97)",
              border: "1px solid rgba(255, 26, 140, 0.32)",
              boxShadow: "0 12px 30px rgba(0, 0, 0, 0.55)",
              zIndex: 5_000,
            }}
          >
            <HudMenuItem
              testId="avatar-orbit-settings"
              label="Settings"
              onClick={goSettings}
            />
            <HudMenuItem
              testId="avatar-orbit-notifications"
              label={unread > 0 ? `Notifications · ${unread}` : "Notifications"}
              onClick={goNotifications}
            />
            {hasJwt && (
              <HudMenuItem
                testId="avatar-orbit-signout"
                label="Sign out"
                onClick={doSignOut}
              />
            )}
          </div>
        )}

        <InboxSheet
          open={inboxOpen}
          onClose={() => setInboxOpen(false)}
          onUnreadChange={setUnread}
        />
      </div>
    </header>
  );
}

function HudMenuItem({
  testId, label, onClick,
}: { testId: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "8px 12px",
        borderRadius: 8,
        border: "0",
        background: "transparent",
        color: "rgba(255, 255, 255, 0.92)",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: 13,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 26, 140, 0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}
