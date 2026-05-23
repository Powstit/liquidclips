import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sidecar, type HardwareInfo, type SecretName } from "../lib/sidecar";

const APP_VERSION = "0.4.7";
const SUPPORT_EMAIL = "support@jnremployee.com";
import { syncStatus, backend, type SyncStatus, type PlatformConnection, type ConnectionPlatform } from "../lib/backend";
import { applyUpdate, checkForUpdate, type UpdateState } from "../lib/updater";
import { PlatformIcon } from "./PlatformIcon";

// Settings panel per spec §3.8 screen 8 — one scrollable page.
// Opens as a modal sheet from the gear icon in the header.

type Tier = "free" | "solo" | "growth" | "autopilot";

const ACCOUNT_URL = "https://jnremployee.com/dashboard";
const WHOP_MANAGE_URL = "https://whop.com/jnremployee";

export function Settings({ onClose, onSignOut, tier = "free" }: { onClose: () => void; onSignOut?: () => void; tier?: Tier }) {
  const [secrets, setSecrets] = useState<Record<SecretName, boolean> | null>(null);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [editingKey, setEditingKey] = useState<SecretName | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncChecked, setSyncChecked] = useState(false);

  async function onCheckForUpdate() {
    setUpdateState({ kind: "checking" });
    setUpdateState(await checkForUpdate());
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
      <div
        className="flex h-full w-full max-w-[640px] flex-col overflow-y-auto bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/85 px-6 py-4 backdrop-blur-[20px]">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            settings
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-8 px-6 py-8">
          <Section eyebrow="account" title="Plan + subscription">
            <Row
              label="Tier"
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
                ? "Not activated — paste your license JWT in the section below."
                : sync.billing_provider === "whop"
                ? "Whop holds your card. Cancel / update card / change plan all happen there."
                : "Manage plan + payment method on your account page."}
            </p>
          </Section>

          <Section eyebrow="api keys" title="Bring your own.">
            <p className="font-sans text-[13px] text-text-secondary">
              Stored encrypted in your OS keychain. Decryption is in-memory at call time.
              Never sent to Junior's servers, never logged.
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

          <ConnectionsSection />


          <Section eyebrow="output folder" title="Where Junior writes everything.">
            <Row label="Folder" value="~/Junior" mono />
            <p className="font-sans text-[13px] text-text-secondary">
              Every project gets its own subfolder with source, audio, transcript, clips, thumbnails,
              and metadata. Open it any time and find every asset Junior made.
            </p>
            <button
              onClick={() => void openExternal(`${homeDir()}/Junior`)}
              className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia"
            >
              Open in Finder →
            </button>
          </Section>

          <Section eyebrow="captions" title="One default style.">
            <p className="font-sans text-[13px] text-text-secondary">
              Helvetica, white text, thick black outline, vertical-friendly margin. Burned into
              every clip in stage 6.
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              Multi-style presets land in v1.1
            </p>
          </Section>

          <Section eyebrow="updates" title="Junior updates itself.">
            <p className="font-sans text-[13px] text-text-secondary">
              We push new builds in the background. Check now, or wait for the next launch ping.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={onCheckForUpdate}
                disabled={updateState.kind === "checking" || updateState.kind === "downloading" || updateState.kind === "installing"}
                className="rounded-full bg-ink px-4 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia disabled:opacity-50"
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
                    className="rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-paper hover:bg-ink hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
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
                  installing — junior will relaunch
                </span>
              )}
              {updateState.kind === "error" && (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#DC2626]">
                  {updateState.message}
                </span>
              )}
            </div>
          </Section>

          <Section eyebrow="about" title='"Made with Junior" + privacy.'>
            <Toggle label="Show 'Made with Junior' watermark on clips" defaultOn={false} />
            <Toggle label="Send anonymous telemetry (no video content, no transcripts)" defaultOn={false} />
            <Row label="Version" value="0.1.0" mono />
            {hw && <Row label="Machine" value={`${hw.ram_gb}GB RAM · ${hw.cpu_count} CPU · ${hw.free_disk_gb}GB free`} />}
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                onClick={() => void openExternal("https://jnremployee.com/privacy")}
                className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
              >
                Privacy policy →
              </a>
              <a
                onClick={() => void openExternal("https://jnremployee.com/terms")}
                className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
              >
                Terms →
              </a>
            </div>
          </Section>

          <SupportSection />

          <Section eyebrow="sign out" title="Step away cleanly.">
            <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
              Signs you out of Junior, clears the license JWT from your keychain,
              and returns to the first-run screen. Your projects on disk stay
              put — sign back in any time to keep working.
            </p>
            <button
              onClick={async () => {
                if (!confirm("Sign out of Junior? You'll need to paste your license JWT to come back in.")) return;
                // Clear license JWT + close. App.tsx watches for sign-out and re-routes.
                try {
                  await sidecar.secretDelete("JUNIOR_LICENSE_JWT");
                } catch {
                  // Best-effort — the JWT might already be gone.
                }
                onClose();
                onSignOut?.();
              }}
              className="self-start rounded-full border border-line bg-paper px-5 py-2 font-sans text-[13px] font-medium text-ink transition-colors hover:border-[#DC2626] hover:text-[#DC2626]"
            >
              Sign out of Junior
            </button>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">{eyebrow}</div>
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
          className="mt-2 w-full rounded-full border border-line bg-paper-warm/40 px-4 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={onSave}
            className="rounded-full bg-ink px-4 py-1.5 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia"
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

function ConnectionsSection() {
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [maxConnections, setMaxConnections] = useState<number | null>(null);
  const [canConnectMore, setCanConnectMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<ConnectionPlatform | null>(null);
  const [error, setError] = useState<string | null>(null);

  const PLATFORMS: ConnectionPlatform[] = ["youtube", "tiktok", "instagram", "x"];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setError("Sign in first to manage connections.");
        return;
      }
      const list = await backend.connections.list(jwt);
      setConnections(list.connections);
      setMaxConnections(list.max_connections);
      setCanConnectMore(list.can_connect_more);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function connect(platform: ConnectionPlatform) {
    setConnecting(platform);
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) return;
      const { redirect_url } = await backend.connections.startConnect(jwt, platform);
      if (redirect_url.startsWith("http")) {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(redirect_url).catch(() => undefined);
      }
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect(integration_id: string) {
    if (!confirm("Disconnect this account?")) return;
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    await backend.connections.disconnect(jwt, integration_id);
    await load();
  }

  const byPlatform = new Map<ConnectionPlatform, PlatformConnection[]>();
  for (const c of connections) {
    const arr = byPlatform.get(c.platform) ?? [];
    arr.push(c);
    byPlatform.set(c.platform, arr);
  }

  return (
    <Section eyebrow="connected accounts" title="Where Junior posts on your behalf.">
      <p className="font-sans text-[13px] text-text-secondary">
        Each account stays under your control — Junior reads the handle back from your platform; your password never touches us.
      </p>

      {loading ? (
        <p className="font-mono text-[12px] text-text-tertiary">
          Reading your connections<span className="blink">_</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {PLATFORMS.map((p) => {
            const accounts = byPlatform.get(p) ?? [];
            const label = ({ youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", x: "X" })[p];
            return (
              <div key={p} className="rounded-xl border border-line bg-paper p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-paper">
                      <PlatformIcon id={p} className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="font-sans text-[14px] font-medium text-ink">{label}</div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                        {accounts.length === 0
                          ? "not connected"
                          : `${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => void connect(p)}
                    disabled={connecting === p || (!canConnectMore && accounts.length === 0)}
                    className="rounded-full border border-line bg-paper px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-40"
                  >
                    {connecting === p ? "connecting…" : accounts.length === 0 ? "connect" : "add another"}
                  </button>
                </div>
                {accounts.length > 0 && (
                  <ul className="mt-2 space-y-1 pl-11">
                    {accounts.map((a) => (
                      <li key={a.integration_id} className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="font-mono text-text-secondary">{a.account_handle}</span>
                        <button
                          onClick={() => void disconnect(a.integration_id)}
                          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-[#DC2626]"
                        >
                          disconnect
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="font-mono text-[11px] text-[#DC2626]">{error}</p>}

      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {maxConnections === null
          ? `${connections.length} connected · unlimited on your tier`
          : `${connections.length}/${maxConnections} connected on your tier`}
      </p>
    </Section>
  );
}


function Toggle({ label, defaultOn }: { label: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  // v1.0: persistence wires up in Sprint 4.5 alongside the settings table on the backend.
  return (
    <button
      onClick={() => setOn((v) => !v)}
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
  // "Open in Finder" button — we always read/write ~/Junior on macOS.
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
  //   3. Clerk direct-signup user → in-app account portal at jnremployee.com/dashboard
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


// Beta dignity: a place to email support and copy diagnostic info into the
// clipboard so a user can paste it back into the email. Logs live in
// ~/Junior/ — the project folder + .progress.json per run — so we point
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
      `Junior version: ${APP_VERSION}`,
      `Platform: ${hw?.platform ?? "unknown"}`,
      `RAM: ${hw?.ram_gb ?? "?"} GB · CPUs: ${hw?.cpu_count ?? "?"} · Free disk: ${hw?.free_disk_gb ?? "?"} GB`,
      hw?.warnings?.length ? `Warnings: ${hw.warnings.join(", ")}` : "",
      `Logs folder: ~/Junior/projects/<slug>/.progress.json (per run)`,
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
    const subject = encodeURIComponent(`Junior ${APP_VERSION} — issue report`);
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
          className="rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia"
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
