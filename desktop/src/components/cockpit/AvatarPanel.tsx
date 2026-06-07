// ship-lens v0.7.8: S7 — meAffiliate() no longer swallows UnauthorizedError into the empty-affiliate render; the lifetime / clipping / affiliate stat strip and the referral row gain a top-of-panel "Session expired — re-activate" banner so a paying user with an aged-out JWT sees the actual remediation path instead of a $0 dashboard that lies about their earnings. v0.7.7 carry-over: meStatus() migrated to meStatusLegacy() (panel only needs `.email`/`.effective_tier` for HUD copy).
// v0.6.35 — Avatar Panel (dropdown HUD).
//
// Summoned by tapping AvatarOrbit. Holds every signal the v0.6.4 stickiness
// dashboard used to render on Workstation — but on demand, not always-on, so
// the home page stays calm. Sections, top to bottom:
//
//   1. Profile header (avatar + name + tier + lifetime)
//   2. Earnings strip (lifetime · clipping · affiliate)
//   3. Affiliate link row (copy + share)
//   4. Scheduled (top 3, "all → Schedule" link)
//   5. Active clips (top 3, "all → Earn" link)
//   6. Leaderboard preview (top 3 + caller)
//   7. Footer rail: Refresh · Notifications · Settings · Sign out
//
// One source of data per section (re-using the same RPCs the previous
// dashboard used) so we don't drift from /me, /me/affiliate, /leaderboard,
// and the local schedule store.

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Bell,
  Calendar as CalendarIcon,
  Copy as CopyIcon,
  Crown,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  Trophy,
  Upload as UploadIcon,
  Link as LinkIcon,
} from "lucide-react";
// v0.7.7 ship-lens fix #9 — AvatarPanel reads `.email`/`.effective_tier` only
// for HUD copy. The new meStatus discriminated union is owned by Settings.tsx
// (re-activate banner UX); the panel stays on the legacy `MeStatus | null`
// shim so existing render paths don't need to branch on the union.
import {
  meStatusLegacy,
  meAffiliate,
  leaderboardGet,
  UnauthorizedError,
  type MeStatus,
  type AffiliateMeResponse,
  type LeaderboardResponse,
} from "../../lib/backend";
import { openAuthPanel } from "../auth/useAuthPanel";
import { sidecar, type LocalScheduleItem } from "../../lib/sidecar";
import { useSubmissions } from "../../lib/submissions";
import { fmtUsd } from "../../lib/payoutsAggregations";
import { useAvatar, avatarSrc, initialsOf } from "../../lib/avatar";

type Tier = "free" | "solo" | "pro" | "agency" | "growth" | "autopilot" | null;

export function AvatarPanel({
  open,
  onClose,
  tier,
  refreshing,
  onRefresh,
  onOpenNotifications,
  onOpenSettings,
  onOpenSchedule,
  onOpenEarn,
  onSignOut,
  // K-δ inbox mode props
  inboxMode,
  events,
  focusedEventId,
  onMarkRead,
}: {
  open: boolean;
  onClose: () => void;
  tier: Tier;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onOpenSchedule: () => void;
  onOpenEarn: () => void;
  /** v0.6.38 — Accepts async so the real sign-out can clear LICENSE_JWT
   *  before resolving. AvatarPanel doesn't await; the underlying handler
   *  fires its own confirm + JWT-delete + view-flip chain. */
  onSignOut?: () => void | Promise<void>;
  // K-δ inbox mode
  inboxMode?: boolean;
  events?: Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    timestamp: number;
    read: boolean;
  }>;
  focusedEventId?: string | null;
  onMarkRead?: (id: string) => void;
}) {
  const url = useAvatar((s) => s.url);
  const bustKey = useAvatar((s) => s.bustKey);
  const [me, setMe] = useState<MeStatus | null>(null);
  const [aff, setAff] = useState<AffiliateMeResponse | null>(null);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [scheduled, setScheduled] = useState<LocalScheduleItem[]>([]);
  // v0.7.8 S7 — true when meAffiliate() (or any /me read) rejected with
  // UnauthorizedError. Pre-fix every failure mapped to `aff === null` and
  // the panel rendered $0 stats with no nudge. Now the top of the panel
  // shows a fuchsia "Session expired — re-activate" banner the user can
  // click to open the auth panel in sign-in mode.
  const [sessionExpired, setSessionExpired] = useState(false);
  const { submissions } = useSubmissions();

  useEffect(() => {
    if (!open) return;
    void meStatusLegacy().then(setMe).catch(() => setMe(null));
    void meAffiliate()
      .then((data) => {
        setAff(data);
        setSessionExpired(false);
      })
      .catch((e) => {
        setAff(null);
        if (e instanceof UnauthorizedError) {
          setSessionExpired(true);
        }
      });
    void leaderboardGet().then(setBoard).catch(() => setBoard(null));
    void sidecar
      .localScheduleList()
      .then((r) => {
        const pending = (r.items ?? []).filter((i) => i.status === "pending");
        pending.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
        setScheduled(pending.slice(0, 3));
      })
      .catch(() => setScheduled([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const email = me?.email ?? null;
  const initials = initialsOf(email);
  const displayName = email
    ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Welcome";
  const renderedSrc = avatarSrc({ url, bustKey });
  const isPaid = tier !== null && tier !== "free";

  const affEarnings = Number(aff?.affiliate?.total_referral_earnings_usd ?? "0") || 0;
  const clippingEarnings = 0; // placeholder — same convention as v0.6.4 RankStrip
  const lifetime = affEarnings + clippingEarnings;
  const referralUrl = aff?.affiliate?.referral_url ?? null;
  const referrals = aff?.affiliate?.total_referrals_count ?? 0;

  const rank = board?.caller_rank;
  const total = board?.total_ranked;
  const top = board?.entries?.slice(0, 3) ?? [];
  const caller = board?.caller_entry ?? null;
  const callerInTop = caller && top.some((e) => e.is_caller);

  const recentClips = [...submissions]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 3);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — soft dim, dismiss on click. Lower opacity than the
              upload portal because the cockpit needs to stay legible behind. */}
          <motion.div
            className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />

          <motion.div
            className="avatar-panel fixed right-4 top-[80px] z-50 flex w-[400px] max-h-[calc(100vh-100px)] flex-col gap-3 overflow-hidden rounded-3xl border border-fuchsia/30 bg-paper-elev p-4 shadow-2xl"
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Profile and dashboard"
          >
            {/* Scrollable inner column so the footer rail can stay sticky. */}
            <div className="flex flex-col gap-3 overflow-y-auto pr-1">
              {/* v0.7.8 S7 — Session-expired banner. Mounts only when the
                  meAffiliate fetch rejected with UnauthorizedError, i.e.
                  the backend explicitly rejected the local JWT. Pre-fix
                  this branch fell through to the regular HUD with $0
                  stats; the user had no signal their account was actually
                  fine and just needed a fresh activation. */}
              {sessionExpired && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    openAuthPanel("sign-in");
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl border border-fuchsia/50 bg-fuchsia-soft/40 px-3 py-2.5 text-left transition-colors hover:bg-fuchsia-soft/60"
                  aria-label="Session expired — re-activate this device"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia">
                      session expired
                    </span>
                    <span className="font-sans text-[12px] leading-snug text-fuchsia-deep">
                      Re-activate this device to keep earning →
                    </span>
                  </div>
                </button>
              )}
              {/* 2. Inbox section (K-δ) */}
              {inboxMode && events && events.length > 0 && (
                <div className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
                      Inbox
                    </span>
                    <span className="font-mono text-[10px] text-text-tertiary">
                      {events.filter(e => !e.read).length} unread
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {events.map((event) => (
                      <button
                        key={event.id}
                        onClick={() => onMarkRead?.(event.id)}
                        className={`flex flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors ${
                          event.read
                            ? "bg-transparent opacity-50"
                            : "bg-paper-deep hover:bg-paper-elev"
                        } ${focusedEventId === event.id ? "ring-1 ring-fuchsia/30" : ""}`}
                      >
                        <span className="font-sans text-[12px] font-medium text-ink">
                          {event.title}
                        </span>
                        <span className="font-sans text-[11px] text-text-secondary line-clamp-2">
                          {event.body}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
                          {new Date(event.timestamp).toLocaleDateString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Profile header */}
              <header className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-3">
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-fuchsia/40 bg-gradient-to-br from-fuchsia to-fuchsia-deep">
                  {renderedSrc ? (
                    <img src={renderedSrc} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center font-display text-[16px] font-bold text-white">
                      {initials}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <h2 className="line-clamp-1 font-display text-[16px] font-semibold leading-tight tracking-[-0.015em] text-ink">
                    {displayName}
                  </h2>
                  <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                    {isPaid && <Crown className="h-3 w-3 text-fuchsia" />}
                    <span>{tier ?? "loading"} tier</span>
                    {rank != null && total != null && (
                      <>
                        <span className="text-text-tertiary/50">·</span>
                        <span>#{rank.toLocaleString()} of {total.toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>
              </header>

              {/* 2. Earnings strip */}
              <section className="flex items-stretch justify-between gap-2 rounded-2xl border border-line bg-paper px-4 py-3">
                <Stat label="lifetime" value={fmtUsd(lifetime)} accent />
                <span className="w-px bg-line" aria-hidden="true" />
                <Stat label="clipping" value={fmtUsd(clippingEarnings)} />
                <span className="w-px bg-line" aria-hidden="true" />
                <Stat label="affiliate" value={fmtUsd(affEarnings)} />
              </section>

              {/* 3. Affiliate link row */}
              {referralUrl && (
                <AffiliateRow url={referralUrl} referrals={referrals} earnings={affEarnings} />
              )}

              {/* 4. Scheduled */}
              <Section
                title="scheduled"
                icon={<CalendarIcon className="h-3 w-3" />}
                trailing={
                  <button
                    onClick={() => {
                      onClose();
                      onOpenSchedule();
                    }}
                    className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-fuchsia"
                  >
                    all →
                  </button>
                }
              >
                {scheduled.length === 0 ? (
                  <EmptyHint text="Nothing queued. Schedule a clip from any card." />
                ) : (
                  <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                    {scheduled.map((it) => (
                      <ScheduledRow key={it.id} item={it} />
                    ))}
                  </ul>
                )}
              </Section>

              {/* 5. Active clips */}
              <Section
                title="your active clips"
                icon={<UploadIcon className="h-3 w-3" />}
                trailing={
                  submissions.length > 3 ? (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenEarn();
                      }}
                      className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-fuchsia"
                    >
                      all →
                    </button>
                  ) : null
                }
              >
                {recentClips.length === 0 ? (
                  <EmptyHint text="No clips logged yet. Submit one to see live view counts here." />
                ) : (
                  <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                    {recentClips.map((c) => (
                      <ClipRow key={c.id} clip={c} />
                    ))}
                  </ul>
                )}
              </Section>

              {/* 6. Leaderboard */}
              <Section
                title="leaderboard"
                icon={<Trophy className="h-3 w-3" />}
                trailing={
                  <button
                    onClick={() => {
                      onClose();
                      onOpenEarn();
                    }}
                    className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-fuchsia"
                  >
                    full →
                  </button>
                }
              >
                {top.length === 0 ? (
                  <EmptyHint text="Leaderboard refresh pending." />
                ) : (
                  <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                    {top.map((e) => (
                      <BoardRow key={e.rank} entry={e} />
                    ))}
                    {!callerInTop && caller && (
                      <>
                        <li className="flex items-center justify-center bg-paper-warm/40 px-3 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-text-tertiary">
                          · · ·
                        </li>
                        <BoardRow entry={caller} />
                      </>
                    )}
                  </ul>
                )}
              </Section>
            </div>

            {/* 7. Footer rail (sticky bottom) — the 4 buttons that used to
                live in the top header chrome. Single row, big tap targets. */}
            <footer className="mt-1 flex items-stretch gap-2 border-t border-line pt-3">
              <FooterButton
                icon={<RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} strokeWidth={2} />}
                label="Refresh"
                onClick={onRefresh}
                disabled={refreshing}
              />
              <FooterButton
                icon={<Bell className="h-4 w-4" strokeWidth={2} />}
                label="Inbox"
                onClick={() => {
                  onClose();
                  onOpenNotifications();
                }}
              />
              <FooterButton
                icon={<SettingsIcon className="h-4 w-4" strokeWidth={2} />}
                label="Settings"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
              />
              {onSignOut && (
                <FooterButton
                  icon={<LogOut className="h-4 w-4" strokeWidth={2} />}
                  label="Sign out"
                  onClick={() => {
                    onClose();
                    void onSignOut();
                  }}
                />
              )}
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── helper components ──────────────────────────────────────────────── */

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-start">
      <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-text-tertiary">{label}</span>
      <span
        className={`font-display text-[15px] font-bold leading-none tracking-[-0.02em] ${
          accent ? "text-fuchsia" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  icon,
  trailing,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-fuchsia">
          {icon}
          {title}
        </div>
        {trailing}
      </header>
      {children}
    </section>
  );
}

function FooterButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-paper px-2 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia disabled:cursor-wait disabled:opacity-60"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-line bg-paper px-3 py-2.5 font-sans text-[11px] leading-relaxed text-text-secondary">
      {text}
    </p>
  );
}

function AffiliateRow({ url, referrals, earnings }: { url: string; referrals: number; earnings: number }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent */
    }
  }, [url]);

  return (
    <section className="rounded-2xl border border-line bg-paper px-4 py-3">
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia">
        <LinkIcon className="h-3 w-3" />
        affiliate
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-ink/40 px-2 py-1.5 font-mono text-[11px] text-ink">
          {url}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-elev px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
        >
          <CopyIcon className="h-3 w-3" />
          {copied ? "✓" : "copy"}
        </button>
      </div>
      <div className="mt-1.5 flex gap-3 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
        <span>{referrals} ref{referrals === 1 ? "" : "s"}</span>
        <span>·</span>
        <span className="text-fuchsia">{fmtUsd(earnings)} earned</span>
      </div>
    </section>
  );
}

function ScheduledRow({ item }: { item: LocalScheduleItem }) {
  const due = relativeFuture(item.scheduled_for);
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper-warm font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia">
        {item.platform.slice(0, 2).toUpperCase()}
      </div>
      <p className="line-clamp-1 flex-1 font-sans text-[12px] text-ink">{item.clip_title}</p>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">{due}</span>
    </li>
  );
}

function ClipRow({ clip }: { clip: ReturnType<typeof useSubmissions>["submissions"][number] }) {
  const earnings = Number(clip.actual_payout || clip.estimated_payout || "0") || 0;
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-paper-warm font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia">
        {clip.platform.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-1 font-sans text-[12px] text-ink">
          {clip.post_url || clip.clip_path.split("/").pop() || "Untitled"}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
          {clip.views.toLocaleString()} views
        </span>
      </div>
      <span className="font-display text-[12px] font-semibold leading-none tracking-[-0.015em] text-fuchsia">
        {fmtUsd(earnings)}
      </span>
    </li>
  );
}

function BoardRow({ entry }: { entry: { rank: number; display_handle: string; lifetime_earnings_usd: string; paid_referrals: number; is_caller: boolean } }) {
  const earned = Number(entry.lifetime_earnings_usd) || 0;
  return (
    <li className={`flex items-center gap-2 px-3 py-2 ${entry.is_caller ? "bg-fuchsia/10" : ""}`}>
      <span className={`w-6 shrink-0 font-mono text-[11px] font-semibold ${entry.rank === 1 ? "text-fuchsia" : "text-text-tertiary"}`}>
        #{entry.rank}
      </span>
      <span className={`flex-1 truncate font-sans text-[12px] ${entry.is_caller ? "font-semibold text-ink" : "text-ink"}`}>
        {entry.display_handle}{entry.is_caller ? " (you)" : ""}
      </span>
      <span className="font-display text-[12px] font-semibold leading-none tracking-[-0.015em] text-fuchsia">
        {fmtUsd(earned)}
      </span>
    </li>
  );
}

function relativeFuture(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const ms = target - now;
  if (ms <= 0) return "due now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `in ${days}d`;
  const d = new Date(target);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
