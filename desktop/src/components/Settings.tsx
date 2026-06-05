import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Camera, Trash2 } from "lucide-react";
import { sidecar, humanError, type HardwareInfo, type SecretName } from "../lib/sidecar";
import { useAvatar, avatarSrc, initialsOf } from "../lib/avatar";

// Single source of truth — pulled from package.json so a stale constant can't
// land in the Settings → About row again after a ship.
import pkg from "../../package.json";
// v0.6.4 — painted cover retired (Whop-pattern Settings is strict utility).
// import settingsCover from "../assets/decks/settings.png";
const APP_VERSION: string = pkg.version;
const SUPPORT_EMAIL = "hello@liquidclips.app";
import { syncStatus, meStatus, meAffiliate, socialGetConnection, type SyncStatus, type MeStatus } from "../lib/backend";
import { applyUpdate, checkForUpdate, readLastUpdateCheck, type LastUpdateCheck, type UpdateState } from "../lib/updater";
import { ChevronRight } from "lucide-react";
import { getTelemetryConsent, setTelemetryConsent } from "../lib/telemetry";
import { BadgeShelf } from "./BadgeShelf";

// Settings panel per spec §3.8 screen 8 — one scrollable page.
// Opens as a modal sheet from the gear icon in the header.

type Tier = "free" | "solo" | "growth" | "autopilot";

const ACCOUNT_URL = "https://liquidclips.app/dashboard";
const WHOP_MANAGE_URL = "https://whop.com/jnremployee";

// v0.6.4 — Strict-utility (Whop-pattern) Settings.
// Categories drive what the right pane shows; left rail switches between
// them. No painted decoration inside chrome (the v0.6.3 cover hero retired).
type SettingsCategory = "account" | "connections" | "keys" | "about";

const CATEGORY_LABELS: Record<SettingsCategory, string> = {
  account: "Account",
  connections: "Connections",
  keys: "API keys",
  about: "About",
};

export function Settings({ onClose, onSignOut, onOpenSchedule, tier = "free" }: { onClose: () => void; onSignOut?: () => void; onOpenSchedule?: () => void; tier?: Tier }) {
  const [secrets, setSecrets] = useState<Record<SecretName, boolean> | null>(null);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [editingKey, setEditingKey] = useState<SecretName | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });
  const [lastUpdateCheck, setLastUpdateCheck] = useState<LastUpdateCheck | null>(() => readLastUpdateCheck());
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncChecked, setSyncChecked] = useState(false);
  // v0.6.3 — /me load for the compact header + WhoAmI section.
  const [me, setMe] = useState<MeStatus | null>(null);
  // v0.6.4 — Whop-pattern left-rail / right-pane layout.
  const [category, setCategory] = useState<SettingsCategory>("account");
  useEffect(() => {
    void meStatus().then(setMe).catch(() => setMe(null));
  }, []);

  async function onCheckForUpdate() {
    setUpdateState({ kind: "checking" });
    setUpdateState(await checkForUpdate());
    setLastUpdateCheck(readLastUpdateCheck());
  }

  async function onApplyUpdate() {
    if (updateState.kind !== "available") return;
    await applyUpdate(updateState.update, setUpdateState);
  }

  useEffect(() => {
    void sidecar.secretsStatus().then((r) => setSecrets(r.secrets));
    void sidecar.hardwareInfo().then(setHw);
    void syncStatus()
      .then(setSync)
      .finally(() => setSyncChecked(true));
    void onCheckForUpdate();
  }, []);

  async function saveSecret(name: SecretName) {
    if (!draftValue.trim()) return;
    await sidecar.secretSet(name, draftValue.trim());
    setDraftValue("");
    setEditingKey(null);
    const refreshed = await sidecar.secretsStatus();
    setSecrets(refreshed.secrets);
  }

  async function clearSecret(name: SecretName) {
    await sidecar.secretDelete(name);
    const refreshed = await sidecar.secretsStatus();
    setSecrets(refreshed.secrets);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      {/* v0.5.1 — Loadout Deck. Cool slate top-edge band signals "inventory
          cockpit" — neutral, private, no signal colour bleed. See
          docs/RPO_VISUAL_LANGUAGE.md. */}
      <div
        className="flex h-full w-full max-w-[760px] flex-col bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* v0.6.4 — Whop-pattern compact header. No painted cover, no glow,
            no animation. Single line: initials + name + tier + email +
            close. Stays calm — Settings is a utility surface, not theatre. */}
        <SettingsCompactHeader me={me} sync={sync} tier={tier} onClose={onClose} />

        {/* Two-column body: left rail of categories, right pane shows the
            active category's content. Single page, no subpages, no back
            button. Inner pane keeps its own scroll. */}
        <div className="flex min-h-0 flex-1 flex-row">
          <SettingsLeftRail active={category} onSelect={setCategory} />
          <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-7 py-7" key={category}>
          {category === "account" && (
            <>
              <Section eyebrow="profile" title="Your face on the orbit.">
                <ProfileAvatarRow email={me?.email ?? null} />
              </Section>

              <Section eyebrow="achievements" title="Your earned badges.">
                <BadgeShelf />
              </Section>

              <Section eyebrow="class" title="Class + subscription">
                <Row
                  label="Class"
                  value={sync ? (sync.tier === "free" ? "Free · Try" : capitalise(sync.tier)) : (tier === "free" ? "Free · Try" : capitalise(tier))}
                />
                {sync?.paid_until && (
                  <Row
                    label={sync.subscription_status === "canceled" ? "Access until" : "Renews"}
                    value={new Date(sync.paid_until).toLocaleDateString()}
                  />
                )}
                <SubscriptionAction syncChecked={syncChecked} sync={sync} />
                <p className="font-mono text-[11px] text-text-tertiary">
                  {!syncChecked
                    ? "Checking activation…"
                    : !sync
                    ? "Not activated — click Sign in to activate this device."
                    : sync.billing_provider === "whop"
                    ? "Whop holds your card. Cancel / update card / change plan all happen there."
                    : "Manage plan + payment method on your account page."}
                </p>
              </Section>
            </>
          )}

          {category === "keys" && (
          <Section eyebrow="api keys" title="Bring your own.">
            <p className="font-sans text-[13px] text-text-secondary">
              <strong className="text-ink">An OpenAI key is required for clip selection</strong> on
              every plan today — Liquid Clips runs locally and hosted AI (no key needed) is in private beta.
              Stored encrypted in your OS keychain, decrypted in-memory at call time.
              Never sent to our servers, never logged.
            </p>
            {secrets && (
              <div className="flex flex-col gap-2">
                {(Object.keys(secrets) as SecretName[]).map((name) => (
                    <SecretRow
                      key={name}
                      name={name}
                      present={secrets[name]}
                      editing={editingKey === name}
                      draftValue={draftValue}
                      onEdit={() => {
                        setEditingKey(name);
                        setDraftValue("");
                      }}
                      onDraftChange={setDraftValue}
                      onCancel={() => {
                        setEditingKey(null);
                        setDraftValue("");
                      }}
                      onSave={() => void saveSecret(name)}
                      onClear={() => void clearSecret(name)}
                    />
                  ))}
              </div>
            )}
          </Section>
          )}

          {category === "connections" && <ConnectionsSection onOpenSchedule={onOpenSchedule} />}

          {category === "account" && <AffiliatePayoutsSection />}

          {category === "account" && (
            <Section eyebrow="notifications" title="Coming soon.">
              <p className="font-sans text-[13px] text-text-secondary">
                Push + email notifications for payouts, new campaigns, and rank-ups land in v0.7. For now, everything surfaces on the Workspace dashboard.
              </p>
            </Section>
          )}

          {category === "about" && (
          <Section eyebrow="output folder" title="Where Liquid Clips writes everything.">
            <Row label="Folder" value="~/LiquidClips" mono />
            <p className="font-sans text-[13px] text-text-secondary">
              Every project gets its own subfolder with source, audio, transcript, clips, thumbnails,
              and metadata. Open it any time and find every asset the app made.
            </p>
            <button
              onClick={() => void openExternal(`${homeDir()}/LiquidClips`)}
              className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia"
            >
              Open in Finder →
            </button>
          </Section>
          )}

          {category === "about" && (
          <Section eyebrow="captions" title="One default style.">
            <p className="font-sans text-[13px] text-text-secondary">
              Helvetica, white text, thick black outline, vertical-friendly margin. Burned into
              every clip in stage 6.
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              Multi-style presets land in v1.1
            </p>
          </Section>
          )}

          {category === "about" && (
          <Section eyebrow="updates" title="Liquid Clips updates itself.">
            <p className="font-sans text-[13px] text-text-secondary">
              Liquid Clips checks the signed update manifest every time the app opens. Settings runs the same check
              again so you can verify the current install without guessing.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={onCheckForUpdate}
                disabled={updateState.kind === "checking" || updateState.kind === "downloading" || updateState.kind === "installing"}
                className="rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50"
              >
                {updateState.kind === "checking" ? "Checking…" : "Check for updates"}
              </button>
              {updateState.kind === "up-to-date" && (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                  ● up to date
                </span>
              )}
              {updateState.kind === "available" && (
                <>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
                    ● {updateState.update.version} ready
                  </span>
                  <button
                    onClick={onApplyUpdate}
                    className="rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
                  >
                    Install + relaunch →
                  </button>
                </>
              )}
              {updateState.kind === "downloading" && (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary">
                  ↓ downloading…
                  {updateState.total ? ` ${Math.round((updateState.downloaded / updateState.total) * 100)}%` : ""}
                </span>
              )}
              {updateState.kind === "installing" && (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
                  installing — Liquid Clips will relaunch
                </span>
              )}
              {updateState.kind === "error" && (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#DC2626]">
                  {updateState.message}
                </span>
              )}
            </div>
            {lastUpdateCheck && (
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                Last manifest check: {new Date(lastUpdateCheck.checkedAt).toLocaleString()}
                {" · "}
                {lastUpdateCheck.kind === "available"
                  ? `update ${lastUpdateCheck.version} ready`
                  : lastUpdateCheck.kind === "up-to-date"
                  ? "up to date"
                  : "error"}
              </p>
            )}
          </Section>
          )}

          {category === "about" && (
          <Section eyebrow="about" title='"Made with Liquid Clips" + privacy.'>
            <Toggle label="Show 'Made with Liquid Clips' watermark on clips" defaultOn={false} />
            <Toggle
              label="Send anonymous telemetry (no video content, no transcripts)"
              defaultOn={false}
              initial={() => getTelemetryConsent()}
              onChange={(next) => setTelemetryConsent(next)}
            />
            <Row label="Version" value={APP_VERSION} mono />
            {hw && <Row label="Machine" value={`${hw.ram_gb}GB RAM · ${hw.cpu_count} CPU · ${hw.free_disk_gb}GB free`} />}
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                onClick={() => void openExternal("https://liquidclips.app/privacy")}
                className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
              >
                Privacy policy →
              </a>
              <a
                onClick={() => void openExternal("https://liquidclips.app/terms")}
                className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
              >
                Terms →
              </a>
            </div>
          </Section>
          )}

          {category === "account" && <WhoAmISection />}

          {category === "about" && <SupportSection />}

          {/* v0.6.3 — Sign-out moved to the anchored bottom-bar so it's
              always reachable without scrolling. Right-pane scroll wrap
              below. */}
          </div>
        </div>

        {/* v0.6.3 — Anchored bottom bar. Discord pattern: bold red Log Out
            button + monospace version chip. Sticky so it survives the
            scroll list above. */}
        <SettingsBottomBar
          onSignOut={async () => {
            if (!confirm("Sign out of Liquid Clips? You'll sign in again to come back in.")) return;
            try {
              await sidecar.secretDelete("LICENSE_JWT");
            } catch {
              /* best-effort */
            }
            onClose();
            onSignOut?.();
          }}
        />
      </div>
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  // v0.6.39 cockpit pass — transparent panel, fuchsia HUD bracket corners,
  // no plate. Section is the main reusable "category card" in Settings, so
  // changing here covers Account / API keys / About at once.
  return (
    <section className="relative flex flex-col gap-3 p-5">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia">{eyebrow}</div>
      <h3 className="font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-line/60 pt-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className={mono ? "font-mono text-[12px] text-ink" : "font-sans text-[14px] text-ink"}>{value}</span>
    </div>
  );
}

function SecretRow({
  name,
  present,
  editing,
  draftValue,
  onEdit,
  onDraftChange,
  onCancel,
  onSave,
  onClear,
}: {
  name: SecretName;
  present: boolean;
  editing: boolean;
  draftValue: string;
  onEdit: () => void;
  onDraftChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  if (editing) {
    return (
      <div className="rounded-xl border border-fuchsia/40 bg-paper p-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia-deep">{name}</div>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={draftValue}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={name === "OPENAI_API_KEY" ? "sk-proj-..." : "your key"}
          className="mt-2 w-full rounded-full border border-line bg-transparent px-4 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={onSave}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright"
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between border-t border-line/60 pt-2">
      <div className="flex items-center gap-2 font-mono text-[12px]">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${present ? "bg-fuchsia" : "bg-text-tertiary"}`}
        />
        <span className="text-ink">{name}</span>
        <span className="text-text-tertiary">{present ? "stored" : "not set"}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
        >
          {present ? "Replace" : "Add"}
        </button>
        {present && (
          <button
            onClick={onClear}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626]"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectionsSection({ onOpenSchedule }: { onOpenSchedule?: () => void }) {
  // v0.6.5 — Connections is now a thin summary surface. Linking + per-platform
  // management live in Schedule. We just report the live count from
  // /social/connections and deep-link the user across.
  const [linkedCount, setLinkedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void socialGetConnection()
      .then((s) => {
        if (cancelled) return;
        setLinkedCount(s?.platforms?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) setLinkedCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countLabel =
    linkedCount === null
      ? "Checking linked accounts…"
      : `${linkedCount} account${linkedCount === 1 ? "" : "s"} linked · Manage in Schedule →`;

  return (
    <Section eyebrow="connected accounts" title="Where Liquid Clips posts on your behalf.">
      <p className="font-sans text-[13px] text-text-secondary">
        Each account stays under your control — Liquid Clips reads the handle back from your platform; your password never touches us.
      </p>

      <button
        type="button"
        onClick={onOpenSchedule}
        disabled={!onOpenSchedule}
        className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-transparent px-4 py-3 text-left transition-colors hover:border-fuchsia disabled:cursor-default disabled:opacity-60 disabled:hover:border-line"
      >
        <span className="font-sans text-[13px] font-medium text-ink">{countLabel}</span>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-text-tertiary transition-colors group-hover:text-fuchsia"
        />
      </button>

      <WhopConnectionRow />
    </Section>
  );
}


// Affiliate payouts explainer (Daniel feedback 2026-06-01) — crystal clear
// "how you get paid" by RAIL. Whop users see Whop's process. Stripe Connect
// users see Stripe's bank-capture flow + their current status. Not-yet-signed-
// in users see a generic "how it works" explainer.
function AffiliatePayoutsSection() {
  type Aff = Awaited<ReturnType<typeof meAffiliate>>;
  const [data, setData] = useState<Aff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void meAffiliate()
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Section eyebrow="affiliate payouts" title="How you get paid.">
        <p className="font-mono text-[11px] text-text-tertiary">Reading your account<span className="blink">_</span></p>
      </Section>
    );
  }

  // Not signed in / no JWT → generic explainer
  if (!data) {
    return (
      <Section eyebrow="affiliate payouts" title="How you get paid.">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Liquid Clips pays affiliates two ways. If you signed up via Whop, payouts run through Whop on their schedule. If you signed up via Clerk, you connect a bank account through Stripe and payouts arrive on Stripe's schedule. Sign in to see your specific setup.
        </p>
      </Section>
    );
  }

  const aff = data.affiliate;
  const customer = data.customer;
  const isWhop = aff.payout_provider === "whop";
  const isStripe = aff.payout_provider === "stripe_connect";
  const earned = aff.total_referral_earnings_usd
    ? `$${Number(aff.total_referral_earnings_usd).toFixed(2)}`
    : "$0";

  if (isWhop) {
    return (
      <Section eyebrow="affiliate payouts · whop rail" title="How you get paid through Whop.">
        <div className="rounded-2xl border border-fuchsia/40 bg-fuchsia-soft/30 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
            you're on the whop rail
          </p>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">
            Whop tracks every paid referral on your link and pays you <strong>50% recurring</strong> on every customer you refer to Liquid Clips, for the lifetime of their subscription.
          </p>
          <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
            Lifetime earned: <span className="font-medium text-ink">{earned}</span>. Whop holds your KYC + bank details and runs payouts on their schedule (typically monthly, after a hold period for chargebacks). You don't enter bank details with Liquid Clips — Whop owns that surface.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            onClick={() => void openExternal(aff.partner_dashboard_url)}
            className="cursor-pointer rounded-full bg-ink px-4 py-2 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia"
          >
            Open Whop partner dashboard →
          </a>
          <a
            onClick={() => void openExternal("https://whop.com/dashboard/payouts")}
            className="cursor-pointer rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-ink hover:border-fuchsia"
          >
            Manage card + payout settings →
          </a>
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          your referral link · {aff.referral_url ?? "open dashboard to copy"}
        </p>
      </Section>
    );
  }

  if (isStripe) {
    const needsBank = aff.payout_status === "setup_required";
    return (
      <Section eyebrow="affiliate payouts · stripe connect" title="How you get paid through Stripe.">
        <div className={`rounded-2xl border p-4 ${needsBank ? "border-fuchsia bg-fuchsia-soft/40" : "border-line bg-transparent"}`}>
          <p className={`font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] ${needsBank ? "text-fuchsia-deep" : "text-text-tertiary"}`}>
            you're on the stripe connect rail
          </p>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">
            Liquid Clips pays you <strong>50% recurring</strong> on every customer you refer, the lifetime of their subscription. Bank details + KYC run through Stripe Connect Express — Stripe holds the credentials, not us.
          </p>
          {needsBank ? (
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              <strong className="text-fuchsia-deep">Action needed:</strong> set up your bank account so commissions have somewhere to land. Stripe handles the entire flow on their hosted onboarding (name, address, SSN/ID where required, account number, sort code). Takes ~3 minutes.
            </p>
          ) : (
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              Bank setup is complete. Lifetime earned: <span className="font-medium text-ink">{earned}</span>. Stripe runs payouts on their standard schedule (every 2-7 days depending on your country, after a 7-day rolling hold for new accounts).
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            onClick={() => void openExternal(aff.payout_setup_url || "https://account.liquidclips.app/dashboard#payouts")}
            className={`cursor-pointer rounded-full px-4 py-2 font-sans text-[12px] font-medium ${needsBank ? "bg-fuchsia text-paper hover:bg-fuchsia-bright" : "border border-line bg-paper text-ink hover:border-fuchsia"}`}
          >
            {needsBank ? "Set up Stripe payouts →" : "Manage Stripe payouts →"}
          </a>
        </div>
        {customer.referrer_affiliate_id && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            referred by · {customer.referrer_affiliate_id}
          </p>
        )}
      </Section>
    );
  }

  // Fallback — shouldn't normally fire
  return (
    <Section eyebrow="affiliate payouts" title="How you get paid.">
      <p className="font-sans text-[13px] text-text-secondary">
        We couldn't determine your payout rail. Try signing out and back in, or open Settings → Connections to set up Whop / Stripe.
      </p>
    </Section>
  );
}


function Toggle({
  label,
  defaultOn,
  initial,
  onChange,
}: {
  label: string;
  defaultOn: boolean;
  /** Read once on mount to hydrate from persisted state (e.g. localStorage).
   * If provided, takes precedence over defaultOn. */
  initial?: () => boolean;
  /** Fired on every flip with the new boolean. Use to persist. */
  onChange?: (next: boolean) => void;
}) {
  const [on, setOn] = useState<boolean>(() => (initial ? initial() : defaultOn));
  function flip() {
    setOn((v) => {
      const next = !v;
      onChange?.(next);
      return next;
    });
  }
  return (
    <button
      onClick={flip}
      className="flex items-center justify-between gap-3 border-t border-line/60 pt-2 text-left"
    >
      <span className="font-sans text-[13px] text-ink">{label}</span>
      <span
        className={`relative inline-block h-[20px] w-[36px] rounded-full transition-colors ${
          on ? "bg-fuchsia" : "bg-line"
        }`}
      >
        <span
          className={`absolute top-[2px] inline-block h-[16px] w-[16px] rounded-full bg-paper transition-transform ${
            on ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

function homeDir(): string {
  // Tauri exposes the home dir on demand; this is the simple form for the
  // "Open in Finder" button — we always read/write ~/LiquidClips on macOS.
  return "/Users";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function SubscriptionAction({
  syncChecked,
  sync,
}: {
  syncChecked: boolean;
  sync: SyncStatus | null;
}) {
  // Three states:
  //   1. activation unknown / no JWT yet → marketing Upgrade flow (jnremployee.com)
  //   2. Whop-signup user → Whop's hosted manage page (PCI + retention live there)
  //   3. Clerk direct-signup user → in-app account portal at liquidclips.app/dashboard
  const isWhop = sync?.billing_provider === "whop";
  const url = isWhop ? WHOP_MANAGE_URL : ACCOUNT_URL;
  const label = !syncChecked
    ? "Checking…"
    : isWhop
    ? "Manage subscription on Whop →"
    : sync
    ? "Manage subscription →"
    : "Upgrade →";

  return (
    <button
      onClick={() => void openExternal(url)}
      disabled={!syncChecked}
      className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia disabled:opacity-50"
    >
      {label}
    </button>
  );
}


// "Who am I?" — surfaces the backend's canonical view of the current user so
// there's no ambiguity between Clerk metadata, the desktop's keychain state,
// and what the server actually believes. Hits /me which applies admin
// override + reports billing provider truthfully.
function WhoAmISection() {
  const [me, setMe] = useState<MeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [whopSource, setWhopSource] = useState<string>("…");

  useEffect(() => {
    void (async () => {
      const [m, sess] = await Promise.all([
        meStatus(),
        sidecar.whopSessionStatus().catch(() => null),
      ]);
      setMe(m);
      setWhopSource(sess?.source ?? "none");
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <Section eyebrow="account" title="Who Liquid Clips thinks you are.">
        <p className="font-mono text-[12px] text-text-tertiary">
          Reading from backend<span className="blink">_</span>
        </p>
      </Section>
    );
  }

  if (!me) {
    return (
      <Section eyebrow="account" title="Who Liquid Clips thinks you are.">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Couldn't reach the backend. Sign in via{" "}
          <a
            onClick={() => void openExternal("https://account.liquidclips.app/dashboard")}
            className="cursor-pointer text-fuchsia hover:text-fuchsia-deep"
          >
            account.liquidclips.app
          </a>
          {" "}then come back.
        </p>
      </Section>
    );
  }

  return (
    <Section eyebrow="account" title="Who Liquid Clips thinks you are.">
      <p className="font-sans text-[12px] text-text-secondary">
        Source of truth: junior-backend. Use this row when something looks off
        — backend wins over Clerk metadata or anything cached locally.
      </p>
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-transparent p-3 font-mono text-[12px]">
        <DebugRow label="Email" value={me.email ?? "—"} />
        <DebugRow label="Backend user id" value={me.backend_user_id} mono />
        <DebugRow label="Clerk id" value={me.clerk_id ?? "—"} mono />
        <DebugRow label="Whop user id" value={me.whop_user_id ?? "—"} mono />
        <DebugRow label="Affiliate id" value={me.affiliate_id ?? "—"} mono />
        <DebugRow
          label="Effective tier"
          value={`${me.effective_tier}${
            me.admin_override ? " · admin override" : ""
          }${me.effective_founder ? " · founder" : ""}`}
        />
        <DebugRow label="Raw tier (db)" value={`${me.raw_tier}${me.raw_founder ? " · founder" : ""}`} />
        <DebugRow label="Subscription" value={me.subscription_status} />
        <DebugRow label="Billing provider" value={me.billing_provider} />
        <DebugRow
          label="Account limit"
          value={
            me.account_limit >= 9999
              ? "unlimited"
              : `${me.account_limit}${me.extra_accounts_purchased > 0 ? ` · +${me.extra_accounts_purchased} extra account${me.extra_accounts_purchased === 1 ? "" : "s"}` : ""}`
          }
        />
        <DebugRow label="Clips exported (lifetime)" value={String(me.clips_created)} />
        <DebugRow
          label="Whop Content Rewards auth"
          value={
            me.whop_backend_key_configured
              ? `backend app key · desktop session: ${whopSource}`
              : `backend key missing — desktop session: ${whopSource}`
          }
        />
      </div>
    </Section>
  );
}


function DebugRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-1 first:border-t-0 first:pt-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span
        className={`truncate ${mono ? "font-mono text-[11px]" : "font-sans text-[12px]"} text-ink`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}


// Whop sits inside the Connections section as a "bounty source" — distinct
// from publish targets (YouTube/TikTok/IG/X) but presented with the same
// shape so users have one place to manage all platform plumbing. The
// connection lives in the desktop's OS keychain (JUNIOR_WHOP_TOKEN) and the
// OAuth flow + session status come from the sidecar, not the backend.
function WhopConnectionRow() {
  const [status, setStatus] = useState<
    "iframe" | "env_user" | "keychain" | "seller_key" | "none" | "loading"
  >("loading");
  const [phase, setPhase] = useState<"idle" | "awaiting">("idle");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const s = await sidecar.whopSessionStatus();
      setStatus(s.authenticated ? s.source : "none");
    } catch {
      setStatus("none");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function connect() {
    setError(null);
    setPhase("awaiting");
    try {
      const { authorize_url } = await sidecar.whopOAuthStart();
      void openExternal(authorize_url).catch(() => undefined);
      const deadline = Date.now() + 10 * 60 * 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() > deadline) {
          throw new Error("Whop sign-in timed out.");
        }
        await new Promise((r) => setTimeout(r, 1000));
        const st = await sidecar.whopOAuthStatus();
        if (st.status === "success") {
          await load();
          break;
        }
        if (st.status === "error") {
          throw new Error(st.error || "Whop sign-in failed.");
        }
        if (st.status === "idle") {
          throw new Error("Listener stopped — try again.");
        }
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setPhase("idle");
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Whop? You'll need to reconnect to browse Content Rewards again.")) return;
    try {
      await sidecar.whopClearSessionToken();
      await sidecar.secretDelete("JUNIOR_WHOP_TOKEN");
    } finally {
      await load();
    }
  }

  const connected = status !== "none" && status !== "loading";
  const sourceLabel =
    status === "iframe"
      ? "iframe preview"
      : status === "env_user"
        ? "env"
        : status === "keychain"
          ? "OAuth · keychain"
          : status === "seller_key"
            ? "dev seller key"
            : "";

  return (
    <div className="rounded-xl border border-line bg-paper p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-fuchsia font-mono text-[14px] font-bold leading-none text-white">
            /
          </span>
          <div>
            <div className="font-sans text-[14px] font-medium text-ink">Whop — Content Rewards</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              {status === "loading"
                ? "checking your session…"
                : connected
                  ? `signed in · ${sourceLabel}`
                  : "sign in to load reward campaigns in the Earn tab"}
            </div>
          </div>
        </div>
        {connected ? (
          <button
            onClick={() => void disconnect()}
            className="rounded-full border border-line bg-paper px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626]"
          >
            disconnect
          </button>
        ) : (
          <button
            onClick={() => void connect()}
            disabled={phase === "awaiting"}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia-bright disabled:opacity-40"
            title="Opens whop.com in your browser to authorize Liquid Clips"
          >
            {phase === "awaiting" ? "waiting for browser…" : "Sign in with Whop →"}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 pl-11 font-mono text-[11px] text-[#DC2626]">{error}</p>
      )}
    </div>
  );
}


// Beta dignity: a place to email support and copy diagnostic info into the
// clipboard so a user can paste it back into the email. Logs live in
// ~/LiquidClips/ — the project folder + .progress.json per run — so we point
// users there for full traces rather than shipping log files to the
// clipboard (privacy + size).
function SupportSection() {
  const [copied, setCopied] = useState(false);
  const [hw, setHw] = useState<HardwareInfo | null>(null);

  useEffect(() => {
    void sidecar.hardwareInfo().then(setHw).catch(() => undefined);
  }, []);

  async function buildDiagnostic(): Promise<string> {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "n/a";
    const lines = [
      `Liquid Clips version: ${APP_VERSION}`,
      `Platform: ${hw?.platform ?? "unknown"}`,
      `RAM: ${hw?.ram_gb ?? "?"} GB · CPUs: ${hw?.cpu_count ?? "?"} · Free disk: ${hw?.free_disk_gb ?? "?"} GB`,
      hw?.warnings?.length ? `Warnings: ${hw.warnings.join(", ")}` : "",
      `Logs folder: ~/LiquidClips/projects/<slug>/.progress.json (per run)`,
      `User agent: ${ua}`,
      `Time: ${new Date().toISOString()}`,
    ].filter(Boolean);
    return lines.join("\n");
  }

  async function onCopyDiagnostic() {
    try {
      const dump = await buildDiagnostic();
      await writeText(dump);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* silent — copy failure is non-critical */
    }
  }

  async function onReportIssue() {
    const dump = await buildDiagnostic();
    const subject = encodeURIComponent(`Liquid Clips ${APP_VERSION} — issue report`);
    const body = encodeURIComponent(
      "Describe what you were doing when the issue happened:\n\n\n" +
        "--- diagnostic (please keep) ---\n" +
        dump +
        "\n",
    );
    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    void openExternal(url).catch(() => undefined);
  }

  return (
    <Section eyebrow="support" title="Stuck on something? We're here.">
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Report an issue and we'll get back to you within a working day.
        Diagnostic info auto-fills so we can debug without a 20-question thread.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void onReportIssue()}
          className="rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright"
        >
          Report an issue →
        </button>
        <button
          onClick={() => void onCopyDiagnostic()}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          {copied ? "Copied ✓" : "Copy diagnostic"}
        </button>
        <a
          onClick={() => void openExternal(`mailto:${SUPPORT_EMAIL}`)}
          className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary hover:text-fuchsia-deep"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
    </Section>
  );
}

// =====================================================================
// v0.6.3 — Discord-pattern Settings hero + anchored bottom bar.
// =====================================================================

// v0.6.4 — Strict-utility compact header. Single line, no painted cover,
// no idle animation. Whop-pattern: identity surface + close action only.
function SettingsCompactHeader({
  me,
  sync,
  tier,
  onClose,
}: {
  me: MeStatus | null;
  sync: SyncStatus | null;
  tier: Tier;
  onClose: () => void;
}) {
  const email = me?.email ?? null;
  const displayName = email
    ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Sign in to Liquid Clips";
  const initials = email
    ? email
        .split("@")[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "?"
    : "?";
  const effectiveTier = (sync?.tier ?? me?.effective_tier ?? tier) as string;
  const tierLabel = effectiveTier === "free" ? "tier · free" : `tier · ${effectiveTier}`;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-6 py-4">
      <div
        aria-hidden="true"
        className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia to-fuchsia-deep font-display text-[14px] font-bold text-white"
      >
        {initials}
      </div>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {displayName}
        </span>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="rounded-full border border-fuchsia/60 px-2 py-[1px] text-fuchsia">
            {tierLabel}
          </span>
          {email ? <span className="truncate lowercase tracking-[0.04em] text-text-secondary">{email}</span> : null}
        </div>
      </div>
      <button
        onClick={onClose}
        className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-ink"
      >
        Close
      </button>
    </header>
  );
}

function SettingsLeftRail({
  active,
  onSelect,
}: {
  active: SettingsCategory;
  onSelect: (c: SettingsCategory) => void;
}) {
  const items: SettingsCategory[] = ["account", "connections", "keys", "about"];
  return (
    <nav
      className="flex w-[180px] shrink-0 flex-col gap-1 border-r border-line bg-transparent px-3 py-5"
      aria-label="Settings categories"
    >
      {items.map((c) => {
        const isActive = c === active;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onSelect(c)}
            className={
              isActive
                ? "flex items-center gap-2 rounded-xl bg-paper-elev px-3 py-2 font-sans text-[13px] font-medium text-ink"
                : "flex items-center gap-2 rounded-xl px-3 py-2 font-sans text-[13px] text-text-secondary transition-colors hover:bg-paper-elev/60 hover:text-ink"
            }
            aria-current={isActive ? "page" : undefined}
          >
            <span
              aria-hidden="true"
              className={
                isActive
                  ? "h-1.5 w-1.5 rounded-full bg-fuchsia shadow-[0_0_8px_var(--color-fuchsia)]"
                  : "h-1.5 w-1.5 rounded-full bg-text-tertiary/60"
              }
            />
            {CATEGORY_LABELS[c]}
          </button>
        );
      })}
    </nav>
  );
}

function SettingsBottomBar({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  return (
    <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-line bg-paper/85 px-6 py-4 backdrop-blur-[20px]">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        v{APP_VERSION} · all systems go
      </span>
      <button
        onClick={() => void onSignOut()}
        className="lc-settings-logout rounded-full bg-[#DC2626] px-5 py-2 font-sans text-[13px] font-semibold text-white shadow-[0_0_18px_rgba(220,38,38,0.4)] transition-all hover:bg-[#B91C1C] hover:shadow-[0_0_28px_rgba(220,38,38,0.65)]"
      >
        Log out
      </button>
    </footer>
  );
}

// v0.6.35 — Avatar upload row. Drives the same useAvatar store the cockpit
// AvatarOrbit + AvatarPanel + RankStrip all read from, so a save here lights
// up every surface instantly via the bustKey counter.
function ProfileAvatarRow({ email }: { email: string | null }) {
  const url = useAvatar((s) => s.url);
  const bustKey = useAvatar((s) => s.bustKey);
  const loading = useAvatar((s) => s.loading);
  const error = useAvatar((s) => s.error);
  const uploadAvatar = useAvatar((s) => s.upload);
  const clearAvatar = useAvatar((s) => s.clear);

  const renderedSrc = avatarSrc({ url, bustKey });
  const initials = initialsOf(email);

  async function pick() {
    if (loading) return;
    const picked = await openFileDialog({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof picked === "string") {
      try {
        await uploadAvatar(picked);
      } catch {
        /* error already captured in store */
      }
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-paper px-4 py-4">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-fuchsia/40 bg-gradient-to-br from-fuchsia to-fuchsia-deep">
        {renderedSrc ? (
          <img src={renderedSrc} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-display text-[20px] font-bold text-white">
            {initials}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Your avatar shows on the cockpit orbit (top-right) and inside the HUD panel. PNG / JPG / WEBP, resized to 256px.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void pick()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-transparent px-3.5 py-2 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia disabled:cursor-wait disabled:opacity-50"
          >
            <Camera className="h-3.5 w-3.5" strokeWidth={2} />
            {renderedSrc ? "Replace" : "Upload"}
          </button>
          {renderedSrc && (
            <button
              type="button"
              onClick={() => void clearAvatar()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-transparent px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary transition-colors hover:border-[#DC2626] hover:text-[#DC2626] disabled:cursor-wait disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Remove
            </button>
          )}
        </div>
        {error && (
          <p className="font-mono text-[11px] text-[#DC2626]">{error}</p>
        )}
      </div>
    </div>
  );
}
