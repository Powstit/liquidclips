// Lane 5 redesign — Settings.tsx
// Calm, premium, customer-facing utility surface. Four tabs only:
// Account / API keys / Privacy / About.
//
// Key invariants preserved:
//   * performAtomicSignOutWipe is the single source of truth for sign-out.
//   * openUpgradeWhenSignedIn() gates the upgrade CTA for signed-out users.
//   * activate({ via: "browser" }) drives re-activation.
//   * API-key status reads (sidecar.secretsStatus / sidecar.openaiKeyStatus)
//     are deferred until the API keys tab is opened — no passive Keychain
//     prompt when Settings mounts.

import { useEffect, useState } from "react";
import { openSmart as openExternal } from "../lib/openSmart";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { relaunch } from "@tauri-apps/plugin-process";
import { Camera, Trash2, User, Key, Shield, Info, ChevronLeft, Droplet, Mail, Copy } from "lucide-react";
import { sidecar, humanError, type HardwareInfo, type SecretName } from "../lib/sidecar";
import { useAvatar, avatarSrc, initialsOf } from "../lib/avatar";
import { performAtomicSignOutWipe } from "../App";
import { useTier } from "../lib/useTier";

import pkg from "../../package.json";
import {
  syncStatus,
  meStatus,
  meAffiliate,
  UnauthorizedError,
  type SyncStatus,
  type MeStatus,
  type MeStatusResult,
} from "../lib/backend";
import { openAuthPanel } from "./auth/useAuthPanel";
import { openUpgradeWhenSignedIn } from "../lib/upgradeWithAuth";
import { useActivation } from "../lib/activation";
import { getCachedLicenseJwt } from "../lib/authStorage";
import { applyUpdate, checkForUpdate, readLastUpdateCheck, type LastUpdateCheck, type UpdateState } from "../lib/updater";
import { getTelemetryConsent, setTelemetryConsent } from "../lib/telemetry";
import { resetIntroSeen } from "../lib/intro";
import { BadgeShelf } from "./BadgeShelf";
import { ConfirmDialog } from "./ConfirmDialog";
import { MadeWithLiquidClips } from "./brand/MadeWithLiquidClips";

const APP_VERSION: string = pkg.version;
const SUPPORT_EMAIL = "hello@liquidclips.app";
type BuildEnv = ImportMetaEnv & {
  readonly VITE_BUILD_HASH?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_COMMIT_SHA?: string;
};
const BUILD_HASH =
  (import.meta.env as BuildEnv).VITE_BUILD_HASH ??
  (import.meta.env as BuildEnv).VITE_GIT_SHA ??
  (import.meta.env as BuildEnv).VITE_COMMIT_SHA ??
  import.meta.env.MODE;
const CLIP_STORAGE_PATH = "~/LiquidClips/";
const LOG_PATH = "~/LiquidClips/projects/<slug>/.progress.json";

const WHOP_MANAGE_URL = "https://whop.com/liquidclips";

type Tier = "free" | "solo" | "growth" | "autopilot";

export type SettingsCategory = "account" | "api-keys" | "privacy" | "about";

type DepsInfo = {
  ok: boolean;
  missing: string[];
  errors: Record<string, string>;
  python: string;
};

const CATEGORY_LABELS: Record<SettingsCategory, string> = {
  account: "Account",
  "api-keys": "API keys",
  privacy: "Privacy",
  about: "About",
};

const CATEGORY_ICONS: Record<SettingsCategory, React.ComponentType<{ className?: string }>> = {
  account: User,
  "api-keys": Key,
  privacy: Shield,
  about: Info,
};

const PROVIDER_KEYS: SecretName[] = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GIPHY_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
];

export function Settings({
  onClose,
  onSignOut,
  onOpenSchedule,
  tier = "free",
  initialTab,
}: {
  onClose: () => void;
  onSignOut?: () => void;
  onOpenSchedule?: (subtab?: "queue" | "channels" | "analytics") => void;
  tier?: Tier;
  initialTab?: SettingsCategory;
}) {
  const { resolved } = useTier();
  const [category, setCategory] = useState<SettingsCategory>(initialTab ?? "account");

  // API keys — loaded only when the tab opens.
  const [secrets, setSecrets] = useState<Record<SecretName, boolean> | null>(null);
  const [openaiAvailable, setOpenaiAvailable] = useState<boolean | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);

  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [editingKey, setEditingKey] = useState<SecretName | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });
  const [lastUpdateCheck, setLastUpdateCheck] = useState<LastUpdateCheck | null>(() => readLastUpdateCheck());
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncChecked, setSyncChecked] = useState(false);
  const [deps, setDeps] = useState<DepsInfo | null>(null);
  const [depsError, setDepsError] = useState<string | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [introReset, setIntroReset] = useState(false);
  const [me, setMe] = useState<MeStatus | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [home, setHome] = useState<string | null>(null);
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({});
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [bootErrors, setBootErrors] = useState<string[]>([]);

  const [confirmApplyUpdateOpen, setConfirmApplyUpdateOpen] = useState(false);
  const [confirmClearSecret, setConfirmClearSecret] = useState<SecretName | null>(null);
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const { activate } = useActivation();

  // Respond to external "open this tab" requests.
  useEffect(() => {
    function onOpenTab(e: Event) {
      const ce = e as CustomEvent<{ tab?: string }>;
      const tab = ce.detail?.tab;
      if (tab === "channels") {
        onOpenSchedule?.("channels");
        onClose();
        return;
      }
      if (tab === "keys" || tab === "api-keys") {
        setCategory("api-keys");
        return;
      }
      if (tab && (["account", "privacy", "about"] as SettingsCategory[]).includes(tab as SettingsCategory)) {
        setCategory(tab as SettingsCategory);
      }
    }
    window.addEventListener("lc:settings-open-tab", onOpenTab as EventListener);
    return () => window.removeEventListener("lc:settings-open-tab", onOpenTab as EventListener);
  }, [onClose, onOpenSchedule]);

  // Auth/session state.
  useEffect(() => {
    function load(): void {
      const jwt = getCachedLicenseJwt();
      if (!jwt) {
        setMe(null);
        setSessionExpired(false);
        return;
      }
      void meStatus()
        .then((r: MeStatusResult) => {
          if (r.kind === "ok") {
            setMe(r.data);
            setSessionExpired(false);
          } else if (r.kind === "expired") {
            setMe(null);
            setSessionExpired(true);
          } else {
            setMe(null);
            setSessionExpired(false);
          }
        })
        .catch(() => {
          setMe(null);
          setSessionExpired(false);
        });
    }
    load();
    const onAuthReady = (): void => {
      setSessionExpired(false);
      load();
    };
    window.addEventListener("lc:desktop-auth-ready", onAuthReady);
    window.addEventListener("lc:tier-refresh", onAuthReady);
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        load();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("lc:desktop-auth-ready", onAuthReady);
      window.removeEventListener("lc:tier-refresh", onAuthReady);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Resolve home dir once for the "Open in Finder" action.
  useEffect(() => {
    let cancelled = false;
    void import("@tauri-apps/api/path")
      .then((m) => m.homeDir())
      .then((h) => {
        if (!cancelled) setHome(h);
      })
      .catch(() => {
        if (!cancelled) setHome(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Boot-time probes that do NOT touch keychain-backed secrets.
  useEffect(() => {
    void sidecar
      .hardwareInfo()
      .then(setHw)
      .catch((e) => setBootErrors((errs) => [...errs, `hardware: ${humanError(e)}`]));
    void sidecar
      .checkDeps()
      .then(setDeps)
      .catch((e) => setDepsError(humanError(e)));
    const jwt = getCachedLicenseJwt();
    if (jwt) {
      void syncStatus()
        .then(setSync)
        .catch((e) => setBootErrors((errs) => [...errs, `sync: ${humanError(e)}`]))
        .finally(() => setSyncChecked(true));
    } else {
      setSync(null);
      setSyncChecked(true);
    }
    void onCheckForUpdate();
  }, []);

  // API keys tab: secrets + OpenAI env-var resolution are loaded only here.
  useEffect(() => {
    if (category !== "api-keys") return;
    if (keysLoading || secrets !== null) return;
    setKeysLoading(true);
    setKeysError(null);
    Promise.all([
      sidecar
        .secretsStatus()
        .then((r) => setSecrets(r.secrets))
        .catch((e) => {
          setKeysError(`Couldn't read keychain status: ${humanError(e)}`);
          setBootErrors((errs) => [...errs, `secrets: ${humanError(e)}`]);
        }),
      sidecar
        .openaiKeyStatus()
        .then((r) => setOpenaiAvailable(r.available))
        .catch(() => setOpenaiAvailable(null)),
    ]).finally(() => setKeysLoading(false));
  }, [category, keysLoading, secrets]);

  async function refreshSecrets() {
    try {
      const r = await sidecar.secretsStatus();
      setSecrets(r.secrets);
      try {
        const o = await sidecar.openaiKeyStatus();
        setOpenaiAvailable(o.available);
      } catch {
        setOpenaiAvailable(null);
      }
    } catch (e) {
      setKeysError(`Couldn't refresh keychain status: ${humanError(e)}`);
    }
  }

  async function onCheckForUpdate() {
    setUpdateState({ kind: "checking" });
    const timeout = new Promise<UpdateState>((resolve) =>
      window.setTimeout(
        () =>
          resolve({
            kind: "error",
            message: "Update server didn't respond — try again later.",
          }),
        10_000,
      ),
    );
    const next = await Promise.race([checkForUpdate(), timeout]);
    setUpdateState(next);
    setLastUpdateCheck(readLastUpdateCheck());
  }

  function onApplyUpdate() {
    if (updateState.kind !== "available") return;
    setConfirmApplyUpdateOpen(true);
  }

  async function performApplyUpdate() {
    if (updateState.kind !== "available") return;
    setConfirmApplyUpdateOpen(false);
    await applyUpdate(updateState.update, setUpdateState);
  }

  async function performSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await performAtomicSignOutWipe();

    // Best-effort partial-wipe detection: if LICENSE_JWT presence still
    // reports true, at least one keychain item survived. Use the presence
    // mirror so we don't trigger a Keychain read.
    let partial = false;
    try {
      const presence = await sidecar.licenseJwtPresence();
      partial = presence.present;
    } catch {
      partial = true;
    }

    if (partial) {
      window.dispatchEvent(
        new CustomEvent("lc:toast", {
          detail: {
            kind: "error",
            message:
              "Some items couldn't be cleared from your Keychain. Open Keychain Access to remove them manually.",
          },
        }),
      );
    }

    try {
      await onSignOut?.();
    } finally {
      setConfirmSignOutOpen(false);
      setSigningOut(false);
      onClose();
    }
  }

  async function saveSecret(name: SecretName) {
    if (!draftValue.trim()) return;
    try {
      await sidecar.secretSet(name, draftValue.trim());
      if (name === "OPENAI_API_KEY") {
        const result = await sidecar.validateOpenaiKey();
        if (!result.valid) {
          await sidecar.secretDelete(name).catch(() => undefined);
          const refreshed = await sidecar.secretsStatus();
          setSecrets(refreshed.secrets);
          setSecretErrors((prev) => ({
            ...prev,
            [name]: result.error ?? "invalid OpenAI key",
          }));
          return;
        }
      }
      setDraftValue("");
      setEditingKey(null);
      setSecretErrors((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      await refreshSecrets();
    } catch (e) {
      setSecretErrors((prev) => ({ ...prev, [name]: humanError(e) }));
    }
  }

  function clearSecret(name: SecretName) {
    if (name === "OPENAI_API_KEY" || name === "LICENSE_JWT") {
      setConfirmClearSecret(name);
      return;
    }
    void performClearSecret(name);
  }

  async function performClearSecret(name: SecretName) {
    try {
      await sidecar.secretDelete(name);
      setSecretErrors((prev) => {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      await refreshSecrets();
    } catch (e) {
      setSecretErrors((prev) => ({ ...prev, [name]: humanError(e) }));
    }
  }

  async function copyDiagnostics() {
    const dump = buildDiagnosticsMarkdown({ deps, depsError, hw, sync, me });
    try {
      await writeText(dump);
      setClipboardError(null);
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1800);
    } catch (e) {
      setClipboardError(humanError(e));
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="flex h-full w-full flex-col bg-paper">
        <SettingsCompactHeader me={me} sync={sync} tier={tier} resolved={resolved} onClose={onClose} />

        <div className="flex min-h-0 flex-1 flex-row">
          <SettingsLeftRail active={category} onSelect={setCategory} />

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-7 py-7 pb-24">
            {bootErrors.length > 0 && (
              <div className="error-banner">
                <span>
                  Some Settings data couldn't load — Liquid Clips helper may be restarting.
                  <span className="block text-text-tertiary normal-case">{bootErrors.join(" · ")}</span>
                </span>
              </div>
            )}

            {sessionExpired && (
              <div className="rounded-2xl border border-fuchsia/50 bg-fuchsia-soft/40 px-4 py-3 text-fuchsia-deep">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">session expired</span>
                <p className="mt-1 font-sans text-[13px] leading-snug">
                  Your session expired — re-activate this device to keep publishing, scheduling, and earning.
                </p>
                <button type="button" onClick={() => void activate()} className="btn-primary mt-3">
                  Re-activate this device →
                </button>
              </div>
            )}

            {category === "account" && (
              <AccountTab
                me={me}
                sync={sync}
                syncChecked={syncChecked}
                tier={tier}
                onSignOut={() => setConfirmSignOutOpen(true)}
              />
            )}

            {category === "api-keys" && (
              <ApiKeysTab
                secrets={secrets}
                openaiAvailable={openaiAvailable}
                loading={keysLoading}
                error={keysError}
                editingKey={editingKey}
                draftValue={draftValue}
                secretErrors={secretErrors}
                onEdit={(name) => {
                  setEditingKey(name);
                  setDraftValue("");
                }}
                onDraftChange={setDraftValue}
                onCancel={() => {
                  setEditingKey(null);
                  setDraftValue("");
                }}
                onSave={(name) => void saveSecret(name)}
                onClear={(name) => void clearSecret(name)}
              />
            )}

            {category === "privacy" && <PrivacyTab />}

            {category === "about" && (
              <AboutTab
                hw={hw}
                home={home}
                updateState={updateState}
                lastUpdateCheck={lastUpdateCheck}
                onCheckForUpdate={() => void onCheckForUpdate()}
                onApplyUpdate={() => void onApplyUpdate()}
                deps={deps}
                depsError={depsError}
                diagnosticsCopied={diagnosticsCopied}
                clipboardError={clipboardError}
                onCopyDiagnostics={() => void copyDiagnostics()}
                introReset={introReset}
                onResetIntro={() => {
                  resetIntroSeen();
                  setIntroReset(true);
                }}
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmApplyUpdateOpen}
        tone="neutral"
        title="Install update now?"
        body={<>Liquid Clips will quit and relaunch. Any unsaved Workspace state will be lost.</>}
        confirmLabel="Install and relaunch"
        onCancel={() => setConfirmApplyUpdateOpen(false)}
        onConfirm={() => {
          void performApplyUpdate();
        }}
      />
      <ConfirmDialog
        open={confirmClearSecret !== null}
        tone="destructive"
        title={confirmClearSecret === "OPENAI_API_KEY" ? "Clear OpenAI key?" : "Clear license session?"}
        body={
          confirmClearSecret === "OPENAI_API_KEY" ? (
            <>The clip-selection pipeline needs this key — every Workspace run will fail until you paste it back in.</>
          ) : (
            <>You'll be signed out of Liquid Clips and will need to activate this device again.</>
          )
        }
        confirmLabel="Clear key"
        onCancel={() => setConfirmClearSecret(null)}
        onConfirm={() => {
          const name = confirmClearSecret;
          if (!name) return;
          setConfirmClearSecret(null);
          void performClearSecret(name);
        }}
      />
      <ConfirmDialog
        open={confirmSignOutOpen}
        tone="destructive"
        title="Sign out and forget your API keys on this Mac?"
        body={
          <>
            We'll clear your Liquid Clips session and every API key you stored in the keychain on this machine —
            OpenAI, Anthropic, Whop, Pexels, Pixabay, Giphy. Useful if you're handing the Mac to someone else. You'll
            paste your keys back in next time you sign in.
          </>
        }
        confirmLabel="Sign out + clear keys"
        busy={signingOut}
        onCancel={() => {
          if (!signingOut) setConfirmSignOutOpen(false);
        }}
        onConfirm={() => {
          void performSignOut();
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab primitives
// ─────────────────────────────────────────────────────────────────────────────

function TabHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">{eyebrow}</span>
      <h2 className="font-display text-[22px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
      <p className="font-sans text-[13px] text-text-secondary">{subtitle}</p>
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line/40 bg-paper-elev/40 p-5">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">{eyebrow}</span>
        <h3 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-2 first:border-t-0 first:pt-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className={mono ? "font-mono text-[12px] text-ink" : "font-sans text-[14px] text-ink"}>{value}</span>
    </div>
  );
}

function DebugRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-1 first:border-t-0 first:pt-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className={`truncate ${mono ? "font-mono text-[11px]" : "font-sans text-[12px]"} text-ink`} title={value}>
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account tab
// ─────────────────────────────────────────────────────────────────────────────

function AccountTab({
  me,
  sync,
  syncChecked,
  tier,
  onSignOut,
}: {
  me: MeStatus | null;
  sync: SyncStatus | null;
  syncChecked: boolean;
  tier: Tier;
  onSignOut: () => void;
}) {
  const effectiveTier = (sync?.tier ?? me?.effective_tier ?? tier) as Tier;
  const isPaid = effectiveTier !== "free";
  const isWhop = sync?.billing_provider === "whop";
  const { activate } = useActivation();
  const signedIn = !!me;

  return (
    <div className="flex flex-col gap-6">
      <TabHeader eyebrow="Account" title="Your account" subtitle="Manage your plan, profile, and session." />

      {!isPaid && (
        <div className="relative overflow-hidden rounded-2xl border border-fuchsia-soft bg-gradient-to-br from-fuchsia-soft/30 via-paper to-paper px-5 py-4">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-fuchsia/40 bg-paper shadow-[var(--glow-sm)]">
              <Droplet className="h-5 w-5 text-fuchsia" strokeWidth={2.2} />
            </div>
            <div className="flex-1">
              <div className="font-display text-[15px] font-semibold leading-tight text-ink">
                Your exports include the Liquid Clips wordmark.
              </div>
              <p className="mt-1 font-sans text-[13px] leading-snug text-text-secondary">
                Free tier burns a corner watermark on every clip you publish or save. Upgrade to Solo for clean exports
                plus 1-click publish on connected channels.
              </p>
            </div>
            <button type="button" onClick={() => openUpgradeWhenSignedIn()} className="btn-primary shrink-0">
              Upgrade to Solo
            </button>
          </div>
        </div>
      )}

      <Section eyebrow="Profile" title="Your face on the orbit">
        <ProfileAvatarRow email={me?.email ?? null} />
      </Section>

      <Section eyebrow="Achievements" title="Your earned badges">
        <BadgeShelf />
      </Section>

      <Section eyebrow="Plan" title="Class + subscription">
        <div className="flex flex-col gap-3">
          <Row label="Class" value={!syncChecked ? "Checking…" : capitalise(effectiveTier)} />
          {sync?.paid_until && (
            <Row
              label={sync.subscription_status === "canceled" ? "Access until" : "Renews"}
              value={new Date(sync.paid_until).toLocaleDateString()}
            />
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (isWhop) {
                  void openExternal(WHOP_MANAGE_URL);
                } else if (sync) {
                  openAuthPanel("dashboard");
                } else {
                  openUpgradeWhenSignedIn();
                }
              }}
              disabled={!syncChecked}
              className="btn-secondary"
            >
              {!syncChecked
                ? "Checking…"
                : isWhop
                  ? "Manage subscription on Whop →"
                  : sync
                    ? "Manage subscription →"
                    : "Upgrade →"}
            </button>
            {signedIn && (
              <button type="button" onClick={() => void onSignOut()} className="btn-danger">
                Sign out
              </button>
            )}
          </div>
          <p className="font-mono text-[11px] text-text-tertiary">
            {!syncChecked
              ? "Checking activation…"
              : !sync
                ? "Not activated — click Upgrade to activate this device."
                : isWhop
                  ? "Whop holds your card. Cancel / update card / change plan all happen there."
                  : "Manage plan + payment method on your account page."}
          </p>
        </div>
      </Section>

      {!signedIn && (
        <Section eyebrow="Session" title="Activate this device">
          <p className="font-sans text-[13px] text-text-secondary">
            Sign in to sync your subscription, publish clips, and connect social channels.
          </p>
          <button type="button" onClick={() => void activate({ via: "browser" })} className="btn-primary self-start">
            Sign in to Liquid Clips →
          </button>
        </Section>
      )}

      <AffiliatePayoutsSection />
      <WhoAmISection />
    </div>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// API keys tab
// ─────────────────────────────────────────────────────────────────────────────

function ApiKeysTab({
  secrets,
  openaiAvailable,
  loading,
  error,
  editingKey,
  draftValue,
  secretErrors,
  onEdit,
  onDraftChange,
  onCancel,
  onSave,
  onClear,
}: {
  secrets: Record<SecretName, boolean> | null;
  openaiAvailable: boolean | null;
  loading: boolean;
  error: string | null;
  editingKey: SecretName | null;
  draftValue: string;
  secretErrors: Record<string, string>;
  onEdit: (name: SecretName) => void;
  onDraftChange: (v: string) => void;
  onCancel: () => void;
  onSave: (name: SecretName) => void;
  onClear: (name: SecretName) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        eyebrow="API keys"
        title="Bring your own keys"
        subtitle="Stored encrypted in your OS keychain and decrypted in-memory at call time. Never sent to our servers."
      />

      <div className="rounded-2xl border border-line/40 bg-paper-elev/40 p-5">
        <p className="font-sans text-[13px] text-text-secondary">
          <strong className="text-ink">An OpenAI key is required for clip selection</strong> on every plan today —
          Liquid Clips runs locally and hosted AI (no key needed) is in private beta.
        </p>

        {loading && (
          <div className="mt-4 flex flex-col gap-2">
            {PROVIDER_KEYS.map((name) => (
              <div key={name} className="skeleton h-10 w-full" />
            ))}
          </div>
        )}

        {error && (
          <div className="error-banner mt-4">
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && secrets && (
          <div className="mt-4 flex flex-col gap-2">
            {PROVIDER_KEYS.map((name) => {
              const isOpenai = name === "OPENAI_API_KEY";
              const keychainPresent = secrets[name];
              const effectivePresent = isOpenai && openaiAvailable === true ? true : keychainPresent;
              const sourceSuffix = isOpenai && !keychainPresent && openaiAvailable === true ? "via env var" : null;
              const status: "set" | "env" | "unset" = effectivePresent
                ? sourceSuffix
                  ? "env"
                  : "set"
                : "unset";
              return (
                <SecretRow
                  key={name}
                  name={name}
                  status={status}
                  editing={editingKey === name}
                  draftValue={draftValue}
                  errorMessage={secretErrors[name] ?? null}
                  onEdit={() => onEdit(name)}
                  onDraftChange={onDraftChange}
                  onCancel={onCancel}
                  onSave={() => onSave(name)}
                  onClear={() => onClear(name)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function providerLabel(name: SecretName): string {
  switch (name) {
    case "OPENAI_API_KEY":
      return "OpenAI";
    case "ANTHROPIC_API_KEY":
      return "Anthropic";
    case "GIPHY_API_KEY":
      return "GIPHY";
    case "PEXELS_API_KEY":
      return "Pexels";
    case "PIXABAY_API_KEY":
      return "Pixabay";
    default:
      return name;
  }
}

function SecretRow({
  name,
  status,
  editing,
  draftValue,
  errorMessage,
  onEdit,
  onDraftChange,
  onCancel,
  onSave,
  onClear,
}: {
  name: SecretName;
  status: "set" | "env" | "unset";
  editing: boolean;
  draftValue: string;
  errorMessage: string | null;
  onEdit: () => void;
  onDraftChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  if (editing) {
    return (
      <div className="rounded-xl border border-line/60 bg-paper p-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia">{providerLabel(name)}</div>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={draftValue}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          placeholder={name === "OPENAI_API_KEY" ? "sk-proj-…" : "your key"}
          className="mt-2 w-full border-b border-line bg-transparent px-0 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-text-tertiary focus:border-fuchsia"
        />
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onSave} className="btn-primary">
            Save
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
        {errorMessage && <p className="mt-2 font-mono text-[11px] text-[var(--color-danger)]">{errorMessage}</p>}
      </div>
    );
  }

  const dotClass =
    status === "set"
      ? "bg-emerald-500"
      : status === "env"
        ? "bg-[#f59e0b]"
        : "bg-text-tertiary";

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-paper px-3 py-2.5 transition-colors hover:border-fuchsia hover:bg-fuchsia-soft/20">
      <div className="flex items-center gap-3">
        <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
        <div className="flex flex-col">
          <span className="font-sans text-[13px] font-medium text-ink">{providerLabel(name)}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            {status === "set" ? "Stored in keychain" : status === "env" ? "Set via env var" : "Not set"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onEdit} className="btn-secondary">
          {status === "unset" ? "Add key" : "Edit"}
        </button>
        {status !== "unset" && (
          <button type="button" onClick={onClear} className="btn-danger">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy tab
// ─────────────────────────────────────────────────────────────────────────────

function PrivacyTab() {
  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        eyebrow="Privacy"
        title="Your data stays yours"
        subtitle="Control what Liquid Clips collects and how your clips are handled."
      />

      <Section eyebrow="Telemetry" title="Anonymous usage data">
        <p className="font-sans text-[13px] text-text-secondary">
          Help us improve Liquid Clips by sharing anonymous usage stats. We never collect video content, transcripts,
          or API keys.
        </p>
        <Toggle
          label="Send anonymous telemetry"
          defaultOn={false}
          initial={() => getTelemetryConsent()}
          onChange={(next) => setTelemetryConsent(next)}
        />
      </Section>

      <Section eyebrow="Data & storage" title="Local-first by default">
        <p className="font-sans text-[13px] text-text-secondary">
          Your source videos, clips, thumbnails, and project metadata live in{" "}
          <code className="rounded bg-paper px-1 py-0.5 font-mono text-[11px] text-ink">~/LiquidClips</code>. API keys
          are encrypted in macOS Keychain and only decrypted in memory when needed.
        </p>
      </Section>

      <Section eyebrow="Policies" title="Legal">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void openExternal("https://liquidclips.app/privacy")} className="btn-ghost">
            Privacy policy →
          </button>
          <button type="button" onClick={() => void openExternal("https://liquidclips.app/terms")} className="btn-ghost">
            Terms of service →
          </button>
        </div>
      </Section>
    </div>
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
  initial?: () => boolean;
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
      type="button"
      role="switch"
      aria-checked={on}
      onClick={flip}
      className="flex items-center justify-between gap-3 border-t border-line/60 pt-3 text-left"
    >
      <span className="font-sans text-[13px] text-ink">{label}</span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-[20px] w-[36px] rounded-full transition-colors ${on ? "bg-fuchsia" : "bg-line"}`}
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

// ─────────────────────────────────────────────────────────────────────────────
// About tab
// ─────────────────────────────────────────────────────────────────────────────

function AboutTab({
  hw,
  home,
  updateState,
  lastUpdateCheck,
  onCheckForUpdate,
  onApplyUpdate,
  deps,
  depsError,
  diagnosticsCopied,
  clipboardError,
  onCopyDiagnostics,
  introReset,
  onResetIntro,
}: {
  hw: HardwareInfo | null;
  home: string | null;
  updateState: UpdateState;
  lastUpdateCheck: LastUpdateCheck | null;
  onCheckForUpdate: () => void;
  onApplyUpdate: () => void;
  deps: DepsInfo | null;
  depsError: string | null;
  diagnosticsCopied: boolean;
  clipboardError: string | null;
  onCopyDiagnostics: () => void;
  introReset: boolean;
  onResetIntro: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TabHeader
        eyebrow="About"
        title="Liquid Clips"
        subtitle={`Version ${APP_VERSION} · Build ${BUILD_HASH}`}
      />

      <div className="flex flex-col items-start gap-3 rounded-2xl border border-line/40 bg-paper-elev/40 p-5">
        <MadeWithLiquidClips className="h-12 w-[240px]" />
        <p className="font-sans text-[13px] text-text-secondary">
          Made for creators who want clean, fast clips without the manual grind.
        </p>
      </div>

      <SupportEmailSection />

      <Section eyebrow="Output folder" title="Where Liquid Clips writes everything">
        <Row label="Folder" value={CLIP_STORAGE_PATH} mono />
        <p className="font-sans text-[13px] text-text-secondary">
          Every project gets its own subfolder with source, audio, transcript, clips, thumbnails, and metadata.
        </p>
        <button
          type="button"
          onClick={() => {
            if (!home) return;
            void openExternal(`${home}/LiquidClips`);
          }}
          disabled={!home}
          className="btn-secondary self-start"
        >
          {home ? "Open in Finder →" : "Locating folder…"}
        </button>
      </Section>

      <Section eyebrow="Captions" title="One default style">
        <p className="font-sans text-[13px] text-text-secondary">
          Helvetica, white text, thick black outline, vertical-friendly margin. Burned into every clip in stage 6.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Multi-style presets land in v1.1
        </p>
      </Section>

      <Section eyebrow="Updates" title="Liquid Clips updates itself">
        <p className="font-sans text-[13px] text-text-secondary">
          Liquid Clips checks the signed update manifest every time the app opens. Run the check again here to verify
          the current install.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onCheckForUpdate}
            disabled={updateState.kind === "checking" || updateState.kind === "downloading" || updateState.kind === "installing"}
            className="btn-secondary"
          >
            {updateState.kind === "checking" ? "Checking…" : "Check for updates"}
          </button>
          {updateState.kind === "up-to-date" && (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">● up to date</span>
          )}
          {updateState.kind === "available" && (
            <>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
                ● {updateState.update.version} ready
              </span>
              <button type="button" onClick={onApplyUpdate} className="btn-primary">
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
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-danger)]">
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

      <Section eyebrow="Intro" title="Replay the welcome tour">
        <p className="font-sans text-[13px] text-text-secondary">
          The intro tour will play the next time you launch Liquid Clips.
        </p>
        <button type="button" onClick={onResetIntro} className="btn-secondary self-start">
          {introReset ? "Intro ready to replay" : "Replay on next launch →"}
        </button>
      </Section>

      <DiagnosticsSection
        deps={deps}
        depsError={depsError}
        hw={hw}
        copied={diagnosticsCopied}
        clipboardError={clipboardError}
        onCopy={onCopyDiagnostics}
      />

      {hw && (
        <Section eyebrow="Machine" title="Hardware snapshot">
          <Row label="Machine" value={`${hw.ram_gb}GB RAM · ${hw.cpu_count} CPU · ${hw.free_disk_gb}GB free`} />
        </Section>
      )}
    </div>
  );
}

function SupportEmailSection() {
  const [copied, setCopied] = useState(false);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);

  async function copyEmail() {
    try {
      await writeText(SUPPORT_EMAIL);
      setCopied(true);
      setFallbackMessage("Support email copied to clipboard.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setFallbackMessage(`Couldn't copy email: ${humanError(e)}`);
    }
  }

  async function openMail() {
    const subject = encodeURIComponent("Liquid Clips support");
    const body = encodeURIComponent("Hi Liquid Clips team,\n\n");
    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    try {
      await openExternal(url);
      setFallbackMessage(null);
    } catch {
      try {
        await writeText(SUPPORT_EMAIL);
        setFallbackMessage("Couldn't open your mail app. Support email copied to clipboard.");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch (copyErr) {
        setFallbackMessage(`Couldn't open mail app or copy email (${humanError(copyErr)}).`);
      }
    }
  }

  return (
    <Section eyebrow="Support" title="Stuck on something? We're here.">
      <p className="font-sans text-[13px] text-text-secondary">
        Reach out and we'll get back to you within a working day.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void openMail()} className="btn-primary">
          <Mail className="h-4 w-4" />
          Email support
        </button>
        <button type="button" onClick={() => void copyEmail()} className="btn-secondary">
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy support email"}
        </button>
      </div>
      {fallbackMessage && <p className="font-mono text-[11px] text-text-secondary">{fallbackMessage}</p>}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

function DiagnosticsSection({
  deps,
  depsError,
  hw,
  copied,
  clipboardError,
  onCopy,
}: {
  deps: DepsInfo | null;
  depsError: string | null;
  hw: HardwareInfo | null;
  copied: boolean;
  clipboardError: string | null;
  onCopy: () => void;
}) {
  const [sidecarStarting, setSidecarStarting] = useState(false);
  useEffect(() => {
    if (deps !== null || depsError !== null) {
      setSidecarStarting(false);
      return;
    }
    const t = window.setTimeout(() => setSidecarStarting(true), 10_000);
    return () => window.clearTimeout(t);
  }, [deps, depsError]);

  const sidecarStatus = depsError
    ? "failed"
    : deps
      ? deps.ok
        ? "ready"
        : "failed"
      : sidecarStarting
        ? "unreachable"
        : "starting";
  const missing = deps?.missing ?? [];
  const errors = deps?.errors ? Object.entries(deps.errors) : [];

  return (
    <>
      <Section eyebrow="Diagnostics" title="Sidecar + local machine">
        <p className="font-sans text-[13px] text-text-secondary">
          Copy this when support needs the exact local state behind a failed run.
        </p>
        <div className="rounded-xl border border-line/60 bg-paper p-3">
          <DebugRow label="Sidecar" value={sidecarStatus} />
          <DebugRow label="Python" value={deps?.python ?? (depsError ? "unavailable" : "checking")} mono />
          <DebugRow label="Clip storage" value={CLIP_STORAGE_PATH} mono />
          <DebugRow label="Logs" value={LOG_PATH} mono />
        </div>
        {sidecarStarting && !deps && !depsError && (
          <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3">
            <p className="font-mono text-[11px] text-[var(--color-danger)]">
              Couldn't reach sidecar — try restarting Liquid Clips.
            </p>
            <button type="button" onClick={() => void relaunch()} className="btn-secondary mt-2">
              Restart Liquid Clips →
            </button>
          </div>
        )}
        {(missing.length > 0 || errors.length > 0 || depsError) && (
          <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-danger)]">
              missing python modules
            </p>
            {depsError && <p className="font-mono text-[11px] text-[var(--color-danger)]">{depsError}</p>}
            {missing.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {missing.map((name) => (
                  <li key={name} className="font-mono text-[11px] text-[var(--color-danger)]">
                    {name}
                    {deps?.errors[name] ? `: ${deps.errors[name]}` : ""}
                  </li>
                ))}
              </ul>
            ) : !depsError ? (
              <p className="font-mono text-[11px] text-text-tertiary">No module names returned.</p>
            ) : null}
            {errors
              .filter(([name]) => !missing.includes(name))
              .map(([name, message]) => (
                <p key={name} className="font-mono text-[11px] text-[var(--color-danger)]">
                  {name}: {message}
                </p>
              ))}
          </div>
        )}
        <button type="button" onClick={onCopy} className="btn-secondary self-start">
          {copied ? "Copied diagnostics" : "Copy diagnostics to clipboard"}
        </button>
        {clipboardError && <p className="font-mono text-[11px] text-[var(--color-danger)]">{clipboardError}</p>}
      </Section>

      <Section eyebrow="Hardware" title="Read-only hardware snapshot">
        <div className="rounded-xl border border-line/60 bg-paper p-3">
          <DebugRow label="Platform" value={hw?.platform ?? "checking"} />
          <DebugRow label="RAM" value={hw ? `${hw.ram_gb} GB` : "checking"} />
          <DebugRow label="CPU" value={hw ? `${hw.cpu_count} logical` : "checking"} />
          <DebugRow label="Free disk" value={hw ? `${hw.free_disk_gb} GB` : "checking"} />
          <DebugRow label="Warnings" value={hw?.warnings?.length ? hw.warnings.join(", ") : "none"} />
        </div>
      </Section>
    </>
  );
}

function buildDiagnosticsMarkdown({
  deps,
  depsError,
  hw,
  sync,
  me,
}: {
  deps: DepsInfo | null;
  depsError: string | null;
  hw: HardwareInfo | null;
  sync: SyncStatus | null;
  me: MeStatus | null;
}): string {
  const sidecarStatus = depsError ? "failed" : deps ? (deps.ok ? "ready" : "failed") : "starting";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "n/a";
  const missing = deps?.missing?.length ? deps.missing.join(", ") : "none";
  const errors =
    deps?.errors && Object.keys(deps.errors).length
      ? Object.entries(deps.errors)
          .map(([name, message]) => `- ${name}: ${message}`)
          .join("\n")
      : "- none";

  return [
    "# Liquid Clips diagnostics",
    "",
    `- Version: ${APP_VERSION}`,
    `- Build: ${BUILD_HASH}`,
    `- Time: ${new Date().toISOString()}`,
    `- User agent: ${ua}`,
    "",
    "## Account",
    `- Email: ${me?.email ?? "unknown"}`,
    `- Backend user id: ${me?.backend_user_id ?? "unknown"}`,
    `- Tier: ${sync?.tier ?? me?.effective_tier ?? "unknown"}`,
    "",
    "## Sidecar",
    `- Status: ${sidecarStatus}`,
    `- Python: ${deps?.python ?? "unknown"}`,
    `- Missing modules: ${missing}`,
    `- Error: ${depsError ?? "none"}`,
    "",
    "## Dependency errors",
    errors,
    "",
    "## Hardware",
    `- Platform: ${hw?.platform ?? "unknown"}`,
    `- RAM: ${hw?.ram_gb ?? "?"} GB`,
    `- CPU: ${hw?.cpu_count ?? "?"}`,
    `- Free disk: ${hw?.free_disk_gb ?? "?"} GB`,
    `- Warnings: ${hw?.warnings?.length ? hw.warnings.join(", ") : "none"}`,
    "",
    "## Paths",
    `- Clip storage: ${CLIP_STORAGE_PATH}`,
    `- Logs: ${LOG_PATH}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Affiliate payouts
// ─────────────────────────────────────────────────────────────────────────────

function AffiliatePayoutsSection() {
  type Aff = Awaited<ReturnType<typeof meAffiliate>>;
  const [data, setData] = useState<Aff | null>(null);
  const [loading, setLoading] = useState(true);
  const [affiliateError, setAffiliateError] = useState<string | null>(null);

  function fetchAffiliate() {
    setLoading(true);
    setAffiliateError(null);
    let cancelled = false;
    void meAffiliate()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof UnauthorizedError) {
          setData(null);
        } else {
          setAffiliateError(humanError(e));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => fetchAffiliate(), []);

  if (loading) {
    return (
      <Section eyebrow="Affiliate payouts" title="How you get paid">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      </Section>
    );
  }

  if (affiliateError) {
    return (
      <Section eyebrow="Affiliate payouts" title="How you get paid">
        <p className="font-sans text-[13px] text-text-secondary">Couldn't reach payouts — {affiliateError}</p>
        <button type="button" onClick={() => fetchAffiliate()} className="btn-secondary self-start">
          Retry →
        </button>
      </Section>
    );
  }

  if (!data) {
    return (
      <Section eyebrow="Affiliate payouts" title="How you get paid">
        <p className="font-sans text-[13px] text-text-secondary">
          Liquid Clips pays affiliates two ways. If you signed up via Whop, payouts run through Whop on their schedule.
          If you signed up via Clerk, you connect a bank account through Stripe and payouts arrive on Stripe's schedule.
          Sign in to see your specific setup.
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
      <Section eyebrow="Affiliate payouts · Whop" title="How you get paid through Whop">
        <div className="rounded-xl border border-line/60 bg-paper p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">you're on the whop rail</p>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">
            Whop tracks every paid referral on your link and pays you <strong>50% recurring</strong> on every customer
            you refer to Liquid Clips, for the lifetime of their subscription.
          </p>
          <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
            Lifetime earned: <span className="font-medium text-ink">{earned}</span>. Whop holds your KYC + bank details
            and runs payouts on their schedule.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void openExternal(aff.partner_dashboard_url)} className="btn-secondary">
            Open Whop partner dashboard →
          </button>
          <button
            type="button"
            onClick={() => void openExternal("https://whop.com/dashboard/payouts")}
            className="btn-ghost"
          >
            Manage payout settings →
          </button>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          your referral link · {aff.referral_url ?? "open dashboard to copy"}
        </p>
      </Section>
    );
  }

  if (isStripe) {
    const needsBank = aff.payout_status === "setup_required";
    return (
      <Section eyebrow="Affiliate payouts · Stripe" title="How you get paid through Stripe">
        <div className="rounded-xl border border-line/60 bg-paper p-3">
          <p className={`font-mono text-[10px] uppercase tracking-[0.12em] ${needsBank ? "text-fuchsia" : "text-text-tertiary"}`}>
            you're on the stripe connect rail
          </p>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">
            Liquid Clips pays you <strong>50% recurring</strong> on every customer you refer, the lifetime of their
            subscription. Bank details + KYC run through Stripe Connect Express.
          </p>
          {needsBank ? (
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              <strong className="text-fuchsia-deep">Action needed:</strong> set up your bank account so commissions
              have somewhere to land.
            </p>
          ) : (
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
              Bank setup is complete. Lifetime earned: <span className="font-medium text-ink">{earned}</span>. Stripe
              runs payouts on their standard schedule.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (aff.payout_setup_url) {
              void openExternal(aff.payout_setup_url);
            } else {
              openAuthPanel("payouts");
            }
          }}
          className={needsBank ? "btn-primary self-start" : "btn-secondary self-start"}
        >
          {needsBank ? "Set up Stripe payouts →" : "Manage Stripe payouts →"}
        </button>
        {customer.referrer_affiliate_id && (
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            referred by · {customer.referrer_affiliate_id}
          </p>
        )}
      </Section>
    );
  }

  return (
    <Section eyebrow="Affiliate payouts" title="How you get paid">
      <p className="font-sans text-[13px] text-text-secondary">
        We couldn't determine your payout rail. Try signing out and back in, or open your account dashboard to review
        payouts.
      </p>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Who am I
// ─────────────────────────────────────────────────────────────────────────────

function WhoAmISection() {
  const [me, setMe] = useState<MeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [desktopSession, setDesktopSession] = useState<string>("Checking…");
  const { activate } = useActivation();

  useEffect(() => {
    void (async () => {
      const cached = getCachedLicenseJwt();
      const [m, presence] = await Promise.all([
        meStatus(),
        sidecar.licenseJwtPresence().catch(() => ({ present: false })),
      ]);
      setMe(m.kind === "ok" ? m.data : null);
      setDesktopSession(
        cached
          ? "ready in this app session"
          : presence.present
            ? "saved session found — continue required"
            : "not connected",
      );
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <Section eyebrow="Account" title="Who Liquid Clips thinks you are">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      </Section>
    );
  }

  if (!me) {
    return (
      <Section eyebrow="Account" title="Who Liquid Clips thinks you are">
        <p className="font-sans text-[13px] text-text-secondary">
          Couldn't reach the backend.{" "}
          <button type="button" onClick={() => void activate({ via: "browser" })} className="btn-ghost px-1 py-0">
            Reconnect Liquid Clips →
          </button>{" "}
          then come back.
        </p>
      </Section>
    );
  }

  return (
    <Section eyebrow="Account" title="Who Liquid Clips thinks you are">
      <p className="font-sans text-[12px] text-text-secondary">
        Source of truth: Liquid Clips backend. Use this when something looks off — backend wins over Clerk metadata or
        anything cached locally.
      </p>
      <div className="rounded-xl border border-line/60 bg-paper p-3">
        <DebugRow label="Email" value={me.email ?? "—"} />
        <DebugRow label="Backend user id" value={me.backend_user_id} mono />
        <DebugRow label="Clerk id" value={me.clerk_id ?? "—"} mono />
        <DebugRow label="Whop user id" value={me.whop_user_id ?? "—"} mono />
        <DebugRow label="Affiliate id" value={me.affiliate_id ?? "—"} mono />
        <DebugRow
          label="Effective tier"
          value={`${me.effective_tier}${me.admin_override ? " · admin override" : ""}${
            me.effective_founder ? " · founder" : ""
          }`}
        />
        <DebugRow label="Raw tier (db)" value={`${me.raw_tier}${me.raw_founder ? " · founder" : ""}`} />
        <DebugRow label="Subscription" value={me.subscription_status} />
        <DebugRow label="Billing provider" value={me.billing_provider} />
        <DebugRow
          label="Account limit"
          value={
            me.account_limit >= 9999
              ? "unlimited"
              : `${me.account_limit}${
                  me.extra_accounts_purchased > 0
                    ? ` · +${me.extra_accounts_purchased} extra account${me.extra_accounts_purchased === 1 ? "" : "s"}`
                    : ""
                }`
          }
        />
        <DebugRow label="Clips exported (lifetime)" value={String(me.clips_created)} />
        <DebugRow
          label="Whop Content Rewards auth"
          value={
            me.whop_backend_key_configured
              ? `backend app key · desktop session: ${desktopSession}`
              : `backend key missing · desktop session: ${desktopSession}`
          }
        />
      </div>
      {desktopSession.includes("continue required") && (
        <button type="button" onClick={() => void activate({ via: "browser" })} className="btn-secondary self-start">
          Continue session →
        </button>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header + rail
// ─────────────────────────────────────────────────────────────────────────────

function SettingsCompactHeader({
  me,
  sync,
  tier,
  resolved,
  onClose,
}: {
  me: MeStatus | null;
  sync: SyncStatus | null;
  tier: Tier;
  resolved: boolean;
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
  const tierLabel = !resolved ? "checking…" : effectiveTier === "free" ? "tier · free" : `tier · ${effectiveTier}`;

  const avatarUrl = useAvatar((s) => s.url);
  const avatarBustKey = useAvatar((s) => s.bustKey);
  const renderedAvatar = avatarSrc({ url: avatarUrl, bustKey: avatarBustKey });

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-6 py-4">
      <button
        onClick={onClose}
        aria-label="Back to Workspace"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-paper text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
        title="Back to Workspace"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </button>
      <div
        aria-hidden="true"
        className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia to-fuchsia-deep font-display text-[14px] font-bold text-ink"
      >
        {renderedAvatar ? (
          <img src={renderedAvatar} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          initials
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">{displayName}</span>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="rounded-full border border-fuchsia/60 px-2 py-[1px] text-fuchsia">{tierLabel}</span>
          {email ? <span className="truncate lowercase tracking-[0.04em] text-text-secondary">{email}</span> : null}
        </div>
      </div>
      <button type="button" onClick={onClose} className="btn-secondary">
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
  const items: SettingsCategory[] = ["account", "api-keys", "privacy", "about"];
  return (
    <nav
      className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-line bg-paper px-3 py-5"
      aria-label="Settings categories"
    >
      {items.map((c) => {
        const isActive = c === active;
        const Icon = CATEGORY_ICONS[c];
        return (
          <button
            key={c}
            type="button"
            onClick={() => onSelect(c)}
            className={
              isActive
                ? "flex items-center gap-3 rounded-lg px-3 py-2.5 font-sans text-[13px] font-semibold text-ink"
                : "flex items-center gap-3 rounded-lg px-3 py-2.5 font-sans text-[13px] text-text-secondary transition-colors hover:bg-paper-elev/40 hover:text-ink"
            }
            aria-current={isActive ? "page" : undefined}
          >
            <span
              aria-hidden="true"
              className={
                isActive
                  ? "grid h-[36px] w-[36px] place-items-center rounded-xl bg-fuchsia/10 text-fuchsia"
                  : "grid h-[36px] w-[36px] place-items-center rounded-xl bg-paper-deep text-text-tertiary"
              }
            >
              <Icon className="h-5 w-5" />
            </span>
            {CATEGORY_LABELS[c]}
          </button>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar upload row
// ─────────────────────────────────────────────────────────────────────────────

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
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "heic"] }],
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
          <img
            src={renderedSrc}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-display text-[20px] font-bold text-ink">
            {initials}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Your avatar shows on the cockpit orbit and inside the HUD panel. PNG / JPG / WEBP, resized to 256px.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void pick()} disabled={loading} className="btn-secondary">
            <Camera className="h-3.5 w-3.5" strokeWidth={2} />
            {renderedSrc ? "Replace" : "Upload"}
          </button>
          {renderedSrc && (
            <button type="button" onClick={() => void clearAvatar()} disabled={loading} className="btn-danger">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Remove
            </button>
          )}
        </div>
        {error && <p className="font-mono text-[11px] text-[var(--color-danger)]">{error}</p>}
      </div>
    </div>
  );
}
