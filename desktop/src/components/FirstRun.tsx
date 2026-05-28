import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { sidecar, type HardwareInfo } from "../lib/sidecar";
import { useActivation } from "../lib/activation";
import { Logo } from "./Logo";

// First-run flow per spec §3.8 screen 1.
// Single screen: brand mark → one optional key paste → done.
// Hardware probe runs silently in the background and surfaces a one-line
// warning only if something fails (spec §1.8 Sprint 3).

export function FirstRun({ onComplete }: { onComplete: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const { status: act, activate } = useActivation();
  // Only react to an activation WE started from this screen, so a stale "done"
  // from a prior flow can't auto-advance an unrelated mount.
  const startedActivation = useRef(false);

  useEffect(() => {
    sidecar.hardwareInfo().then(setHw).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (startedActivation.current && act.kind === "done") {
      startedActivation.current = false;
      onComplete();
    }
  }, [act.kind, onComplete]);

  async function save() {
    if (!key.trim()) {
      setError("Paste a key first. Or click 'Sign in with Liquid Clips account' to use embedded keys.");
      return;
    }
    if (!key.startsWith("sk-")) {
      setError("That doesn't look like an OpenAI key. Keys start with 'sk-'. Try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sidecar.secretSet("OPENAI_API_KEY", key.trim());
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <Logo size={28} />
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          first run
        </div>
      </div>

      <div className="mt-12 flex flex-1 flex-col">
        <h1 className="font-display text-[44px] font-semibold leading-[1.03] tracking-[-0.03em] text-ink">
          Drop a video to start.
        </h1>
        <p className="mt-3 max-w-[520px] font-sans text-[17px] leading-relaxed text-text-secondary">
          Your videos never leave your machine. Liquid Clips transcribes locally, picks the best moments,
          cuts them vertical with captions, and writes everything your video needs to publish.
        </p>

        <div className="mt-10 rounded-3xl border border-line bg-paper-warm/60 p-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            01 — add your OpenAI key · required
          </div>
          <h2 className="mt-2 font-display text-[22px] font-semibold tracking-[-0.015em] text-ink">
            Add your OpenAI key to power clip selection.
          </h2>
          <p className="mt-1 font-sans text-[13px] text-text-secondary">
            Liquid Clips runs locally — every plan uses your own OpenAI key for clip selection today.
            Stored encrypted in your OS keychain, sent only to OpenAI when Liquid Clips calls it.
            Hosted AI (no key needed) is in private beta.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
              }}
              placeholder="sk-proj-..."
              className="flex-1 rounded-full border border-line bg-paper px-5 py-2.5 font-mono text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            />
            <button
              onClick={save}
              disabled={busy}
              className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save & start →"}
            </button>
          </div>
          {error && (
            <p className="mt-3 font-mono text-[12px] text-[#DC2626]">{error}</p>
          )}
          <button
            onClick={() => void openExternal("https://platform.openai.com/api-keys")}
            className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia hover:text-fuchsia-deep"
          >
            Where do I get a key? →
          </button>
        </div>

        <div className="mt-4 rounded-3xl border border-line bg-paper p-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            02 — sign in to Liquid Clips
          </div>
          <h2 className="mt-2 font-display text-[22px] font-semibold tracking-[-0.015em] text-ink">
            Sign in with your Liquid Clips account.
          </h2>
          <p className="mt-1 max-w-[440px] font-sans text-[13px] text-text-secondary">
            Sign in to activate your plan and unlock the Earn tab. Until hosted AI leaves private
            beta, every plan uses the OpenAI key above for clip selection.
          </p>
          <button
            onClick={() => {
              startedActivation.current = true;
              void activate();
            }}
            disabled={act.kind === "opening" || act.kind === "waiting" || act.kind === "activating"}
            className="mt-4 rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink transition-colors hover:border-fuchsia disabled:opacity-60"
          >
            {act.kind === "opening"
              ? "Opening browser…"
              : act.kind === "waiting"
              ? "Waiting for activation…"
              : act.kind === "activating"
              ? "Activating…"
              : act.kind === "error"
              ? "Try again →"
              : "Sign in with browser →"}
          </button>
          {act.kind === "waiting" && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              complete sign-in in your browser — Liquid Clips activates automatically
            </p>
          )}
          {act.kind === "activating" && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
              activated — syncing your account…
            </p>
          )}
          {act.kind === "error" && (
            <p className="mt-2 font-mono text-[12px] text-[#DC2626]">{act.message}</p>
          )}
        </div>

        {hw && hw.warnings.length > 0 && (
          <div className="mt-6 rounded-xl border border-[#EAB308]/40 bg-[#EAB308]/10 px-4 py-3 font-mono text-[12px] text-[#7A5400]">
            {hw.warnings.join(" · ")}
          </div>
        )}
      </div>

      <footer className="mt-10 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {hw
          ? `${hw.ram_gb} gb ram · ${hw.cpu_count} cpu · ${hw.free_disk_gb} gb free`
          : "probing hardware…"}
      </footer>
    </div>
  );
}
