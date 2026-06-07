// ship-lens v0.7.8: S1 — performSignOut now atomic-wipes every sensitive secret via performAtomicSignOutWipe (centralised in App.tsx) so handing the Mac to someone else doesn't leak OpenAI / Anthropic / Whop / Pexels / Pixabay / Giphy / onboarded keys; the Log-out confirm copy names the API-key clear explicitly. S2 — 5th left-rail tab "Connections" mounts AyrshareConnectionPanel + a per-channel status list (linked / pending_link / unlinked / error) sourced from listChannels() + whopSessionStatus(); Whop session source and Ayrshare profile-key presence both surface in the same pane. S3 — API-keys pane reads sidecar.openaiKeyStatus() on mount so the OPENAI_API_KEY green dot ALSO lights when the key is resolved via env-var (keychain empty was a silent UI lie). v0.7.7 carry-over: fix #9 meStatus discriminated union for expired sessions.
import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { relaunch } from "@tauri-apps/plugin-process";
import { Camera, Trash2 } from "lucide-react";
import { sidecar, humanError, type HardwareInfo, type SecretName } from "../lib/sidecar";
import { useAvatar, avatarSrc, initialsOf } from "../lib/avatar";
// v0.7.8 S1 — single source of truth for sign-out side-effects. Settings'
// own performSignOut used to call sidecar.secretDelete("LICENSE_JWT") in
// isolation; without this import, BYO API keys + onboarded flag remained on
// the keychain when a user signed out from Settings (same leak the AvatarPanel
// path had). One helper, both call sites.
import { performAtomicSignOutWipe } from "../App";
import { Channel } from "../lib/backend";
import AyrshareConnectionPanel from "./AyrshareConnectionPanel";

// Single source of truth — pulled from package.json so a stale constant can't
// land in the Settings → About row again after a ship.
import pkg from "../../package.json";
// v0.6.4 — painted cover retired (Whop-pattern Settings is strict utility).
// import settingsCover from "../assets/decks/settings.png";
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
// v0.7.7 ship-lens fix #9 — Settings owns the surface where the meStatus
// discriminated union actually matters. The "expired" case fires the
// fuchsia re-activate banner; "signed-out" keeps the existing Sign-in copy.
// WhoAmISection also reads the union so its empty-state copy is honest.
import { syncStatus, meStatus, meAffiliate, UnauthorizedError, type SyncStatus, type MeStatus, type MeStatusResult } from "../lib/backend";
import { openAuthPanel } from "./auth/useAuthPanel";
import { applyUpdate, checkForUpdate, readLastUpdateCheck, type LastUpdateCheck, type UpdateState } from "../lib/updater";
import { getTelemetryConsent, setTelemetryConsent } from "../lib/telemetry";
import { resetIntroSeen } from "../lib/intro";
import { BadgeShelf } from "./BadgeShelf";
import { HudChip } from "./cockpit/HudChip";
import { ConfirmDialog } from "./ConfirmDialog";

// Settings panel per spec §3.8 screen 8 — one scrollable page.
// Opens as a modal sheet from the gear icon in the header.

type Tier = "free" | "solo" | "growth" | "autopilot";

const WHOP_MANAGE_URL = "https://whop.com/jnremployee";

// v0.6.4 — Strict-utility (Whop-pattern) Settings.
// Categories drive what the right pane shows; left rail switches between
// them. No painted decoration inside chrome (the v0.6.3 cover hero retired).
// v0.7.8 S2 — "connections" tab added. Mounts AyrshareConnectionPanel +
// a per-channel link-state list + the Whop session source so the user
// has ONE pane that answers "what's connected to publish from here?" — was
// previously fragmented between Settings (Ayrshare hidden / unmounted),
// Schedule → Channels (link state only), and WhoAmI (Whop session source).
type SettingsCategory = "account" | "keys" | "connections" | "about" | "diagnostics";
type DepsInfo = {
  ok: boolean;
  missing: string[];
  errors: Record<string, string>;
  python: string;
};

const CATEGORY_LABELS: Record<SettingsCategory, string> = {
  account: "Account",
  keys: "API keys",
  connections: "Connections",
  about: "About",
  diagnostics: "Diagnostics",
};

export function Settings({ onClose, onSignOut, onOpenSchedule, tier = "free" }: { onClose: () => void; onSignOut?: () => void; onOpenSchedule?: (subtab?: "queue" | "channels" | "analytics") => void; tier?: Tier }) {
  // v0.7.8 S2 — `onOpenSchedule` is now actively consumed by the Connections
  // tab: the AyrshareConnectionPanel's "view analytics →" chip + the per-
  // channel link list's "manage channels →" chip both jump into Schedule's
  // sub-tabs without leaving Settings' left-rail context. Pre-fix the
  // callback was accepted but unused; the chip silently no-op'd.
  const [secrets, setSecrets] = useState<Record<SecretName, boolean> | null>(null);
  // v0.7.8 S3 — openaiKeyStatus reports "is there ANY resolvable OpenAI key"
  // (env var → keychain → dev file). Pre-fix Settings only checked the
  // keychain via secretsStatus(); a user with OPENAI_API_KEY exported in
  // their shell / .env saw a RED dot for OPENAI_API_KEY despite every
  // pipeline call working — silent UI lie. Tracked independently so the
  // truth-source of "available" can light the green dot, and a "via env
  // var" suffix surfaces when the keychain leg is empty.
  const [openaiAvailable, setOpenaiAvailable] = useState<boolean | null>(null);
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
  // v0.6.3 — /me load for the compact header + WhoAmI section.
  const [me, setMe] = useState<MeStatus | null>(null);
  // v0.7.7 ship-lens fix #9 — Track whether the most recent /me failed because
  // the JWT was rejected (expired) vs. there was never a token. The fuchsia
  // re-activate banner mounts when this flips true. "signed-out" stays
  // identical to the prior `me === null` behaviour.
  const [sessionExpired, setSessionExpired] = useState(false);
  // v0.6.4 — Whop-pattern left-rail / right-pane layout.
  const [category, setCategory] = useState<SettingsCategory>("account");
  // Lens-pass additions —
  // (1) home dir resolved via Tauri path API rather than the broken
  //     hardcoded "/Users" string used by the "Open in Finder" button.
  const [home, setHome] = useState<string | null>(null);
  // (5) row-level secret errors so a failed keychain write isn't silent.
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({});
  // (6) clipboard copy failures.
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  // (8) boot errors surfaced as a top-of-pane banner instead of swallowed.
  const [bootErrors, setBootErrors] = useState<string[]>([]);
  // Branded confirm primitives — kill the three native `confirm()` calls
  // that block the Tauri webview thread + break the cockpit voice. Each one
  // is a tiny dedicated state slot rather than a shared "pending action"
  // string so the JSX stays explicit and TS knows the shape per dialog.
  const [confirmApplyUpdateOpen, setConfirmApplyUpdateOpen] = useState(false);
  const [confirmClearSecret, setConfirmClearSecret] = useState<SecretName | null>(null);
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    // v0.7.7 ship-lens fix #9 — Consume the discriminated union. "ok" populates
    // the user header + WhoAmI; "expired" raises the re-activate banner;
    // "signed-out" preserves the original null-render (caller already shows
    // a Sign-in prompt). Failures from the awaited Promise itself are
    // treated as signed-out; the meStatus() implementation already collapses
    // its own thrown transports into kind: "signed-out".
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
  }, []);

  // Resolve the user's real home directory once. The "Open in Finder" chip
  // depended on a hardcoded "/Users" path which targets the wrong folder on
  // every Mac — read Tauri's homeDir() and cache it.
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

  async function onCheckForUpdate() {
    setUpdateState({ kind: "checking" });
    // (11) Race the updater against a 10s timeout so a hung manifest server
    // doesn't leave the chip stuck on "Checking…" forever.
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
    // (3) Branded confirm before the one-click app restart. During a demo a
    // stray misclick on this chip would otherwise quit + relaunch
    // mid-recording. ConfirmDialog handles Esc + click-outside to cancel.
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
    // v0.7.8 S1 — single atomic wipe call. Pre-fix this only deleted
    // LICENSE_JWT, leaving every BYO API key (OpenAI / Anthropic / Whop /
    // Pexels / Pixabay / Giphy) and the LIQUIDCLIPS_ONBOARDED flag on the
    // keychain — the next user on the Mac would inherit the prior user's
    // billing surface. performAtomicSignOutWipe also resets telemetry
    // consent + clears the avatar Zustand store so the orbit doesn't bleed
    // the prior face into the next session.
    await performAtomicSignOutWipe();
    // (17) Run onSignOut BEFORE onClose. Closing first unmounts the drawer
    // and would race with the app-level sign-out handler that may want to
    // re-open it (e.g. to show a sign-in prompt).
    try {
      await onSignOut?.();
    } finally {
      setConfirmSignOutOpen(false);
      setSigningOut(false);
      onClose();
    }
  }

  useEffect(() => {
    // (8) Catch each boot probe independently. Previously a failure on any
    // one of these would silently swallow the rest in the same .then chain
    // and leave the right pane half-populated with no signal.
    void sidecar
      .secretsStatus()
      .then((r) => setSecrets(r.secrets))
      .catch((e) => setBootErrors((errs) => [...errs, `secrets: ${humanError(e)}`]));
    // v0.7.8 S3 — separate "is any OpenAI key resolvable" probe. Result
    // flows into the SecretRow's `presentOverride` for OPENAI_API_KEY so
    // env-var-only users see the green dot. Failure leaves it null — the
    // keychain check still drives the dot, matching pre-v0.7.8 behaviour.
    void sidecar
      .openaiKeyStatus()
      .then((r) => setOpenaiAvailable(r.available))
      .catch(() => setOpenaiAvailable(null));
    void sidecar
      .hardwareInfo()
      .then(setHw)
      .catch((e) => setBootErrors((errs) => [...errs, `hardware: ${humanError(e)}`]));
    void sidecar
      .checkDeps()
      .then(setDeps)
      .catch((e) => setDepsError(humanError(e)));
    void syncStatus()
      .then(setSync)
      .catch((e) => setBootErrors((errs) => [...errs, `sync: ${humanError(e)}`]))
      .finally(() => setSyncChecked(true));
    void onCheckForUpdate();
  }, []);

  async function saveSecret(name: SecretName) {
    if (!draftValue.trim()) return;
    // ship-lens v0.7.7 fix #6: validate OPENAI_API_KEY against the live API
    // BEFORE persisting to keychain. The pre-v0.7.7 behaviour was to write
    // any string and light the green dot — a paste-typo or revoked key
    // produced a "saved" UI lie that only revealed itself mid-pipeline run.
    // For other secret types (LICENSE_JWT, BYO Anthropic, source-image
    // creds), no validation exists so we keep the write-first behaviour.
    try {
      await sidecar.secretSet(name, draftValue.trim());
      if (name === "OPENAI_API_KEY") {
        const result = await sidecar.validateOpenaiKey();
        if (!result.valid) {
          // Surface the rejection inline, clear the key from keychain so the
          // green dot doesn't lie about an invalid value being "stored", and
          // leave the editor open with the original draft so the user can
          // correct it.
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
      const refreshed = await sidecar.secretsStatus();
      setSecrets(refreshed.secrets);
    } catch (e) {
      setSecretErrors((prev) => ({ ...prev, [name]: humanError(e) }));
    }
  }

  function clearSecret(name: SecretName) {
    // (5) Destructive confirm for keys whose absence breaks the whole clip
    // pipeline or the activation gate. Without this a single misclick on
    // OPENAI_API_KEY's "Clear" button silently nukes selection runs. For
    // non-critical keys we skip the modal entirely.
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
      const refreshed = await sidecar.secretsStatus();
      setSecrets(refreshed.secrets);
    } catch (e) {
      setSecretErrors((prev) => ({ ...prev, [name]: humanError(e) }));
    }
  }

  async function copyDiagnostics() {
    // (6) Don't swallow clipboard errors — surface "couldn't copy" inline so
    // the user knows to select the dump manually.
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

  // (4) Esc closes the drawer for keyboard-only users. Previously the drawer
  // had no Esc handler, no role="dialog" and no aria-modal — a keyboard user
  // could open Settings and get trapped with no obvious exit.
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
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      {/* v0.5.1 — Loadout Deck. Cool slate top-edge band signals "inventory
          cockpit" — neutral, private, no signal colour bleed. See
          docs/RPO_VISUAL_LANGUAGE.md. */}
      <div
        className="flex h-full w-full max-w-[760px] flex-col bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
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
          {/* (12) `key={category}` removed — it was forcing a full remount on
              every tab switch which made AffiliatePayoutsSection re-fetch and
              flash its loading state. React reconciles children correctly per
              tab without the key. (19) `pb-24` keeps the last item clear of
              the sticky footer on short windows. */}
          <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-7 py-7 pb-24">
          {bootErrors.length > 0 && (
            <div className="rounded-lg border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#DC2626]">
              Some Settings data couldn't load — Liquid Clips helper may be restarting.
              <span className="block text-text-tertiary normal-case">
                {bootErrors.join(" · ")}
              </span>
            </div>
          )}
          {/* v0.7.7 ship-lens fix #9 — the JWT was present but rejected by
              /me. Before this fix Settings rendered the same "Sign in to
              your Liquid Clips account" copy whether the user was a fresh
              install OR a paying user whose token had aged out — they
              looked identical because meStatus() collapsed both into null.
              Banner only mounts when meStatus() returned kind: "expired",
              so the signed-out case keeps the original prompt path. */}
          {sessionExpired && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-fuchsia/50 bg-fuchsia-soft/40 px-4 py-3 text-fuchsia-deep"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
                session expired
              </span>
              <p className="font-sans text-[13px] leading-snug">
                Your session expired — re-activate this device to keep
                publishing, scheduling, and earning.
              </p>
              <button
                type="button"
                onClick={() => openAuthPanel("sign-in")}
                className="self-start rounded-full bg-fuchsia px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-fuchsia-bright"
              >
                Re-activate this device →
              </button>
            </div>
          )}
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
                {(Object.keys(secrets) as SecretName[]).map((name) => {
                  // v0.7.8 S3 — env-var resolution flows into the green dot
                  // for OPENAI_API_KEY only. Other secrets (BYO Anthropic,
                  // license JWT, etc.) keep the keychain-only signal. The
                  // suffix renders when keychain is empty but env-var
                  // resolution says present, so the user knows the dot is
                  // lit by something they can't manage from this pane.
                  const isOpenai = name === "OPENAI_API_KEY";
                  const keychainPresent = secrets[name];
                  const effectivePresent =
                    isOpenai && openaiAvailable === true
                      ? true
                      : keychainPresent;
                  const sourceSuffix =
                    isOpenai && !keychainPresent && openaiAvailable === true
                      ? "via env var"
                      : null;
                  return (
                    <SecretRow
                      key={name}
                      name={name}
                      present={effectivePresent}
                      sourceSuffix={sourceSuffix}
                      editing={editingKey === name}
                      draftValue={draftValue}
                      errorMessage={secretErrors[name] ?? null}
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
                  );
                })}
              </div>
            )}
          </Section>
          )}

          {category === "account" && <AffiliatePayoutsSection />}

          {category === "account" && (
            <Section eyebrow="notifications" title="Coming soon.">
              <p className="font-sans text-[13px] text-text-secondary">
                Push + email notifications for payouts, new campaigns, and rank-ups land in v0.7. For now, everything surfaces on the Workspace dashboard.
              </p>
            </Section>
          )}

          {category === "diagnostics" && (
            <DiagnosticsSection
              deps={deps}
              depsError={depsError}
              hw={hw}
              copied={diagnosticsCopied}
              clipboardError={clipboardError}
              onCopy={() => void copyDiagnostics()}
            />
          )}

          {/* v0.7.8 S2 — Connections pane. Three stacked surfaces that all
              answer the same user question — "what's wired up to publish /
              earn from this Mac?". Pre-fix this data lived in three places:
              AyrshareConnectionPanel existed as a component but was never
              mounted, WhoAmISection buried whopSessionStatus in the
              Account tab, and ChannelsManager surfaced per-channel link
              state on the Schedule page. Now one pane shows all three.
              Forwarding onOpenSchedule lets the Ayrshare "view analytics →"
              chip jump into Schedule → Analytics without leaving Settings'
              left-rail context. */}
          {category === "connections" && (
            <ConnectionsSection onOpenSchedule={onOpenSchedule} />
          )}

          {category === "about" && (
          <Section eyebrow="output folder" title="Where Liquid Clips writes everything.">
            <Row label="Folder" value={CLIP_STORAGE_PATH} mono />
            <p className="font-sans text-[13px] text-text-secondary">
              Every project gets its own subfolder with source, audio, transcript, clips, thumbnails,
              and metadata. Open it any time and find every asset the app made.
            </p>
            {/* (1) Use the real home dir resolved at mount instead of the
                hardcoded "/Users" string that opened the wrong folder. */}
            <HudChip
              active={false}
              onClick={() => {
                if (!home) return;
                void openExternal(`${home}/LiquidClips`);
              }}
              disabled={!home}
            >
              {home ? "Open in Finder →" : "Locating folder…"}
            </HudChip>
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
              <HudChip
                active={updateState.kind === "available"}
                onClick={() => void onCheckForUpdate()}
                disabled={updateState.kind === "checking" || updateState.kind === "downloading" || updateState.kind === "installing"}
              >
                {updateState.kind === "checking" ? "Checking…" : "Check for updates"}
              </HudChip>
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
                  <HudChip active onClick={() => void onApplyUpdate()}>
                    Install + relaunch →
                  </HudChip>
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
            {/* (2) Watermark toggle was dead UI — `defaultOn={false}` with no
                onChange persisted nothing. Until the burn-in pipeline wires
                up, render it as a static "Coming soon" row so the user
                doesn't think flipping it does anything. */}
            <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-2">
              <span className="font-sans text-[13px] text-ink">
                Show 'Made with Liquid Clips' watermark on clips
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                coming soon
              </span>
            </div>
            <Toggle
              label="Send anonymous telemetry (no video content, no transcripts)"
              defaultOn={false}
              initial={() => getTelemetryConsent()}
              onChange={(next) => setTelemetryConsent(next)}
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
              <span className="inline-flex items-center rounded-full border border-fuchsia/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
                v{APP_VERSION}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                build · {BUILD_HASH}
              </span>
              <HudChip
                active={introReset}
                onClick={() => {
                  resetIntroSeen();
                  setIntroReset(true);
                }}
              >
                {/* (13) Old copy "Watch intro again →" implied immediate
                    playback. The intro only fires on next launch — say so. */}
                {introReset ? "Intro ready to replay" : "Plays on next launch →"}
              </HudChip>
              <button
                type="button"
                onClick={() => void openExternal(`mailto:${SUPPORT_EMAIL}`)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
              >
                {SUPPORT_EMAIL}
              </button>
            </div>
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
          onSignOut={() => setConfirmSignOutOpen(true)}
        />
      </div>
      <ConfirmDialog
        open={confirmApplyUpdateOpen}
        tone="neutral"
        title="Install update now?"
        body={
          <>
            Liquid Clips will quit and relaunch. Any unsaved Workspace state
            will be lost.
          </>
        }
        confirmLabel="Install and relaunch"
        onCancel={() => setConfirmApplyUpdateOpen(false)}
        onConfirm={() => { void performApplyUpdate(); }}
      />
      <ConfirmDialog
        open={confirmClearSecret !== null}
        tone="destructive"
        title={
          confirmClearSecret === "OPENAI_API_KEY"
            ? "Clear OPENAI_API_KEY?"
            : "Clear LICENSE_JWT?"
        }
        body={
          confirmClearSecret === "OPENAI_API_KEY" ? (
            <>
              The clip-selection pipeline needs this key — every Workspace run
              will fail until you paste it back in.
            </>
          ) : (
            <>
              You&apos;ll be signed out of Liquid Clips and will need to
              activate this device again.
            </>
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
            We&apos;ll clear your Liquid Clips session AND every API key you
            stored in the keychain on this machine — OpenAI, Anthropic, Whop,
            Pexels, Pixabay, Giphy. Useful if you&apos;re handing the Mac to
            someone else. You&apos;ll paste your keys back in next time you
            sign in.
          </>
        }
        confirmLabel="Sign out + clear keys"
        busy={signingOut}
        onCancel={() => { if (!signingOut) setConfirmSignOutOpen(false); }}
        onConfirm={() => { void performSignOut(); }}
      />
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

function BracketFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-col gap-2 p-3">
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      {children}
    </div>
  );
}

function SecretRow({
  name,
  present,
  sourceSuffix,
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
  present: boolean;
  /** v0.7.8 S3 — muted "via env var" suffix shown next to "stored" when the
   *  key is resolvable but the keychain leg is empty. Renders only when
   *  callers explicitly pass it, so non-OpenAI rows are unaffected. */
  sourceSuffix?: string | null;
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
      <div className="border-t border-line/60 pt-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia">{name}</div>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={draftValue}
          onChange={(e) => onDraftChange(e.target.value)}
          // (9) Enter submits, Esc cancels — match every other password
          // field's keyboard contract so power users aren't forced to mouse
          // over to the Save chip.
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
          placeholder={name === "OPENAI_API_KEY" ? "sk-proj-..." : "your key"}
          className="mt-2 w-full border-b border-line bg-transparent px-0 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-text-tertiary focus:border-fuchsia"
        />
        <div className="mt-3 flex gap-2">
          <HudChip active onClick={onSave}>
            Save
          </HudChip>
          <HudChip active={false} onClick={onCancel}>
            Cancel
          </HudChip>
        </div>
        {/* (5) Surface keychain write errors inline so the user sees them. */}
        {errorMessage && (
          <p className="mt-2 font-mono text-[11px] text-[#DC2626]">{errorMessage}</p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[12px]">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${present ? "bg-fuchsia" : "bg-text-tertiary"}`}
          />
          <span className="text-ink">{name}</span>
          <span className="text-text-tertiary">{present ? "stored" : "not set"}</span>
          {sourceSuffix && (
            <span className="text-text-tertiary/70 italic">· {sourceSuffix}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <HudChip active={false} onClick={onEdit}>
            {present ? "Replace" : "Add"}
          </HudChip>
          {present && (
            <HudChip active={false} onClick={onClear}>
              Clear
            </HudChip>
          )}
        </div>
      </div>
      {errorMessage && (
        <p className="font-mono text-[11px] text-[#DC2626]">{errorMessage}</p>
      )}
    </div>
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
  // (7) Distinguish "signed out" (UnauthorizedError → null data, generic
  // copy) from "backend errored" (5xx → show retry button). Previously every
  // failure rendered the generic "sign in to see your setup" copy, which
  // hid real outages behind a misleading prompt.
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
      <Section eyebrow="affiliate payouts" title="How you get paid.">
        <p className="font-mono text-[11px] text-text-tertiary">Reading your account<span className="blink">_</span></p>
      </Section>
    );
  }

  if (affiliateError) {
    return (
      <Section eyebrow="affiliate payouts" title="How you get paid.">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Couldn't reach payouts — {affiliateError}
        </p>
        <div className="mt-2">
          <HudChip active onClick={() => fetchAffiliate()}>
            Retry →
          </HudChip>
        </div>
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
        <BracketFrame>
          <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia">
            you're on the whop rail
          </p>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">
            Whop tracks every paid referral on your link and pays you <strong>50% recurring</strong> on every customer you refer to Liquid Clips, for the lifetime of their subscription.
          </p>
          <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
            Lifetime earned: <span className="font-medium text-ink">{earned}</span>. Whop holds your KYC + bank details and runs payouts on their schedule (typically monthly, after a hold period for chargebacks). You don't enter bank details with Liquid Clips — Whop owns that surface.
          </p>
        </BracketFrame>
        <div className="mt-3 flex flex-wrap gap-2">
          <HudChip active onClick={() => void openExternal(aff.partner_dashboard_url)}>
            Open Whop partner dashboard →
          </HudChip>
          <HudChip active={false} onClick={() => void openExternal("https://whop.com/dashboard/payouts")}>
            Manage card + payout settings →
          </HudChip>
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
        <BracketFrame>
          <p className={`font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] ${needsBank ? "text-fuchsia" : "text-text-tertiary"}`}>
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
        </BracketFrame>
        <div className="mt-3 flex flex-wrap gap-2">
          <HudChip
            active={needsBank}
            onClick={() => {
              // Two-track: Stripe Connect Express links (aff.payout_setup_url)
              // are single-use Stripe-hosted URLs; they need a real browser to
              // hold the auth state across the Connect dance, so we open them
              // externally. The dashboard hash anchor lives on account-app
              // (same Clerk session as the rest of the app), so it's fine to
              // host in the in-app auth panel.
              if (aff.payout_setup_url) {
                void openExternal(aff.payout_setup_url);
              } else {
                openAuthPanel("payouts");
              }
            }}
          >
            {needsBank ? "Set up Stripe payouts →" : "Manage Stripe payouts →"}
          </HudChip>
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
        We couldn't determine your payout rail. Try signing out and back in, or open your account dashboard to review payouts.
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
      type="button"
      role="switch"
      aria-checked={on}
      onClick={flip}
      className="flex items-center justify-between gap-3 border-t border-line/60 pt-2 text-left"
    >
      <span className="font-sans text-[13px] text-ink">{label}</span>
      <span
        aria-hidden="true"
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
  //   1. activation unknown / no JWT yet → in-app upgrade panel (Clerk sign-up +
  //      checkout). Opens the Clerk-routed /upgrade page in the desktop's
  //      auth_panel webview so the user never leaves Liquid Clips.
  //   2. Whop-signup user → Whop's hosted manage page (PCI + retention live there);
  //      Whop's cookie domain isn't ours so we still external-open this one.
  //   3. Clerk direct-signup user → in-app /dashboard panel (Clerk session
  //      persists in the auth_panel webview).
  const isWhop = sync?.billing_provider === "whop";
  const label = !syncChecked
    ? "Checking…"
    : isWhop
    ? "Manage subscription on Whop →"
    : sync
    ? "Manage subscription →"
    : "Upgrade →";

  return (
    <button
      onClick={() => {
        if (isWhop) {
          void openExternal(WHOP_MANAGE_URL);
        } else if (sync) {
          openAuthPanel("dashboard");
        } else {
          openAuthPanel("upgrade");
        }
      }}
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
      // v0.7.7 ship-lens fix #9 — WhoAmI also reads the discriminated union;
      // an expired token shows the same "Couldn't reach the backend" state
      // here because the section's job is to print the backend's row, and
      // there's no row to print. The top-of-Settings re-activate banner
      // already nudges the user toward sign-in for both outcomes.
      const [m, sess] = await Promise.all([
        meStatus(),
        sidecar.whopSessionStatus().catch(() => null),
      ]);
      setMe(m.kind === "ok" ? m.data : null);
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
          Couldn't reach the backend. Sign in to{" "}
          <a
            onClick={() => openAuthPanel("sign-in")}
            className="cursor-pointer text-fuchsia hover:text-fuchsia-deep"
          >
            your Liquid Clips account →
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
      <BracketFrame>
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
      </BracketFrame>
    </Section>
  );
}


// v0.7.8 S2 — One-stop "what's connected to publish from this Mac?" pane.
//
// Three sources of truth, three surfaces, one user question:
//   1. AyrshareConnectionPanel — Ayrshare profile-key presence + linked
//      platforms (the publish backend). Pre-fix: existed as a component but
//      was never mounted; users connected accounts on Schedule but had no
//      way to verify the key/platform state from a Settings pane.
//   2. ConnectionsChannelsList — per-channel link state (active / pending_link
//      / paused / error) — same primitives ChannelsManager renders, but
//      read-only. Click-through jumps to the Schedule → Channels sub-tab
//      where the full rename / refresh / pause / delete chrome lives.
//   3. WhopSessionRow — desktop's Whop OAuth token source (iframe / env_user
//      / keychain / seller_key / none). Same row WhoAmI shows, lifted up
//      so the user doesn't have to switch tabs to debug Earn-tab access.
function ConnectionsSection({
  onOpenSchedule,
}: {
  onOpenSchedule?: (subtab?: "queue" | "channels" | "analytics") => void;
}) {
  return (
    <>
      <Section eyebrow="publish backend" title="What can post on your behalf.">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Liquid Clips publishes through Ayrshare. Each social account OAuths directly with the platform; your credentials never sit on our servers. Link or rename channels from Schedule → Channels.
        </p>
        <AyrshareConnectionPanel onOpenSchedule={onOpenSchedule} />
      </Section>
      <ConnectionsChannelsList onOpenSchedule={onOpenSchedule} />
      <WhopSessionRow />
    </>
  );
}

function ConnectionsChannelsList({
  onOpenSchedule,
}: {
  onOpenSchedule?: (subtab?: "queue" | "channels" | "analytics") => void;
}) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("../lib/backend")
      .then((m) => m.listChannels())
      .then((list) => {
        if (!cancelled) setChannels(list);
      })
      .catch((e) => {
        if (!cancelled) setError(humanError(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section eyebrow="channels" title="Per-channel link state.">
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Read-only snapshot of every channel Schedule knows about. Rename,
        refresh, pause, or delete from Schedule → Channels.
      </p>
      {channels === null && !error && (
        <p className="font-mono text-[11px] text-text-tertiary">
          Reading channels<span className="blink">_</span>
        </p>
      )}
      {error && (
        <p className="font-mono text-[11px] text-[#DC2626]">
          Couldn&apos;t reach the channels endpoint — {error}
        </p>
      )}
      {channels && channels.length === 0 && !error && (
        <p className="font-sans text-[13px] text-text-secondary">
          No channels linked yet. Schedule → Channels → Add channel.
        </p>
      )}
      {channels && channels.length > 0 && (
        <BracketFrame>
          {channels.map((c) => (
            <ChannelStatusRow key={c.id} channel={c} />
          ))}
        </BracketFrame>
      )}
      {onOpenSchedule && (
        <div>
          <HudChip active={false} onClick={() => onOpenSchedule("channels")}>
            Manage channels →
          </HudChip>
        </div>
      )}
    </Section>
  );
}

function ChannelStatusRow({ channel }: { channel: Channel }) {
  // Status palette mirrors ChannelCard.tsx so a user comparing the two
  // surfaces reads the same colour language. Unknown statuses fall back to
  // text-tertiary instead of throwing or rendering blank — exhaustive types
  // can drift if the backend adds a new ChannelStatus before the desktop
  // does, and a silent render would lie about the connection's real state.
  const statusInfo: { label: string; tone: string } = (() => {
    switch (channel.status) {
      case "active":
        return { label: "linked", tone: "text-fuchsia" };
      case "pending_link":
        return { label: "pending link", tone: "text-[#F59E0B]" };
      case "paused":
        return { label: "paused", tone: "text-text-secondary" };
      case "error":
        return { label: "error", tone: "text-[#DC2626]" };
      default:
        return { label: String(channel.status), tone: "text-text-tertiary" };
    }
  })();
  const handle = channel.handle ? `@${channel.handle}` : channel.platform;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-1 first:border-t-0 first:pt-0">
      <span className="truncate font-sans text-[12px] text-ink" title={`${channel.label} · ${handle}`}>
        {channel.label} · <span className="text-text-tertiary">{handle}</span>
      </span>
      <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${statusInfo.tone}`}>
        {statusInfo.label}
      </span>
    </div>
  );
}

function WhopSessionRow() {
  const [source, setSource] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void sidecar
      .whopSessionStatus()
      .then((s) => {
        if (!cancelled) setSource(s.source ?? "none");
      })
      .catch((e) => {
        if (!cancelled) setError(humanError(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Section eyebrow="whop session" title="Where the Earn tab reads from.">
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Liquid Clips needs a Whop session to load bounties and pay you out.
        This row reports the source of the current desktop token.
      </p>
      <BracketFrame>
        <DebugRow label="Source" value={error ?? source} />
      </BracketFrame>
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
  // (15) Sidecar "starting" should not stick forever. If deps + depsError are
  // both still null 10s after mount, surface a recoverable "couldn't reach
  // sidecar" with a Restart button that relaunches the app.
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
      <Section eyebrow="diagnostics" title="Sidecar + local machine.">
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          Copy this when support needs the exact local state behind a failed run.
        </p>
        <BracketFrame>
          <DebugRow label="Sidecar" value={sidecarStatus} />
          <DebugRow label="Python" value={deps?.python ?? (depsError ? "unavailable" : "checking")} mono />
          <DebugRow label="Clip storage" value={CLIP_STORAGE_PATH} mono />
          <DebugRow label="Logs" value={LOG_PATH} mono />
        </BracketFrame>
        {sidecarStarting && !deps && !depsError && (
          <BracketFrame>
            <p className="font-mono text-[11px] text-[#DC2626]">
              Couldn't reach sidecar — try restarting Liquid Clips.
            </p>
            <div className="mt-2">
              <HudChip
                active
                onClick={() => {
                  void relaunch();
                }}
              >
                Restart Liquid Clips →
              </HudChip>
            </div>
          </BracketFrame>
        )}
        {(missing.length > 0 || errors.length > 0 || depsError) && (
          <BracketFrame>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#DC2626]">
              missing python modules
            </p>
            {depsError && <p className="font-mono text-[11px] text-[#DC2626]">{depsError}</p>}
            {missing.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {missing.map((name) => (
                  <li key={name} className="font-mono text-[11px] text-[#DC2626]">
                    {name}{deps?.errors[name] ? `: ${deps.errors[name]}` : ""}
                  </li>
                ))}
              </ul>
            ) : !depsError ? (
              <p className="font-mono text-[11px] text-text-tertiary">No module names returned.</p>
            ) : null}
            {errors
              .filter(([name]) => !missing.includes(name))
              .map(([name, message]) => (
                <p key={name} className="font-mono text-[11px] text-[#DC2626]">
                  {name}: {message}
                </p>
              ))}
          </BracketFrame>
        )}
        <HudChip active={copied} onClick={onCopy}>
          {copied ? "Copied diagnostics" : "Copy diagnostics to clipboard"}
        </HudChip>
        {/* (6) Clipboard write failures surface here instead of being eaten. */}
        {clipboardError && (
          <p className="font-mono text-[11px] text-[#DC2626]">
            Couldn't copy — try selecting the dump manually. ({clipboardError})
          </p>
        )}
      </Section>

      <Section eyebrow="hardware" title="Read-only hardware snapshot.">
        <BracketFrame>
          <DebugRow label="Platform" value={hw?.platform ?? "checking"} />
          <DebugRow label="RAM" value={hw ? `${hw.ram_gb} GB` : "checking"} />
          <DebugRow label="CPU" value={hw ? `${hw.cpu_count} logical` : "checking"} />
          <DebugRow label="Free disk" value={hw ? `${hw.free_disk_gb} GB` : "checking"} />
          <DebugRow label="Warnings" value={hw?.warnings?.length ? hw.warnings.join(", ") : "none"} />
        </BracketFrame>
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
  const sidecarStatus = depsError ? "failed" : deps ? deps.ok ? "ready" : "failed" : "starting";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "n/a";
  const missing = deps?.missing?.length ? deps.missing.join(", ") : "none";
  const errors = deps?.errors && Object.keys(deps.errors).length
    ? Object.entries(deps.errors).map(([name, message]) => `- ${name}: ${message}`).join("\n")
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


// Beta dignity: a place to email support and copy diagnostic info into the
// clipboard so a user can paste it back into the email. Logs live in
// ~/LiquidClips/ — the project folder + .progress.json per run — so we point
// users there for full traces rather than shipping log files to the
// clipboard (privacy + size).
function SupportSection() {
  const [copied, setCopied] = useState(false);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  // (6) Surface clipboard write failures inline instead of silent fail.
  const [copyError, setCopyError] = useState<string | null>(null);
  // (14) When `mailto:` has no registered handler `openExternal` rejects
  // silently — fall back to copying the dump to clipboard + telling the user
  // to paste it into a support email.
  const [reportFallback, setReportFallback] = useState<string | null>(null);

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
      setCopyError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setCopyError(humanError(e));
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
    try {
      await openExternal(url);
      setReportFallback(null);
    } catch {
      // No mail client registered. Copy the dump to clipboard instead so
      // the user has something to paste into a support email manually.
      try {
        await writeText(dump);
        setReportFallback(
          `No default mail client — diagnostic copied to clipboard instead, paste into ${SUPPORT_EMAIL}`,
        );
      } catch (copyErr) {
        setReportFallback(
          `Couldn't open mail client or copy diagnostic (${humanError(copyErr)}) — email ${SUPPORT_EMAIL} manually.`,
        );
      }
    }
  }

  return (
    <Section eyebrow="support" title="Stuck on something? We're here.">
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Report an issue and we'll get back to you within a working day.
        Diagnostic info auto-fills so we can debug without a 20-question thread.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <HudChip active onClick={() => void onReportIssue()}>
          Report an issue →
        </HudChip>
        <HudChip active={copied} onClick={() => void onCopyDiagnostic()}>
          {copied ? "Copied" : "Copy diagnostic"}
        </HudChip>
        <a
          onClick={() => void openExternal(`mailto:${SUPPORT_EMAIL}`)}
          className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary hover:text-fuchsia-deep"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
      {copyError && (
        <p className="font-mono text-[11px] text-[#DC2626]">
          Couldn't copy — try selecting the dump manually. ({copyError})
        </p>
      )}
      {reportFallback && (
        <p className="font-mono text-[11px] text-text-secondary">{reportFallback}</p>
      )}
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

  // (16) Read the uploaded avatar from the shared store so the header thumb
  // matches what shows in the cockpit orbit. Falls back to initials when no
  // upload exists yet.
  const avatarUrl = useAvatar((s) => s.url);
  const avatarBustKey = useAvatar((s) => s.bustKey);
  const renderedAvatar = avatarSrc({ url: avatarUrl, bustKey: avatarBustKey });

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-6 py-4">
      <div
        aria-hidden="true"
        className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia to-fuchsia-deep font-display text-[14px] font-bold text-white"
      >
        {renderedAvatar ? (
          <img
            src={renderedAvatar}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          initials
        )}
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
  const items: SettingsCategory[] = ["account", "keys", "connections", "about", "diagnostics"];
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
                ? "flex items-center gap-2 px-3 py-2 font-sans text-[13px] font-medium text-ink"
                : "flex items-center gap-2 px-3 py-2 font-sans text-[13px] text-text-secondary transition-colors hover:text-ink"
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
      // (10) Include HEIC — iPhone screenshots default to HEIC and were
      // silently filtered out of the picker.
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
