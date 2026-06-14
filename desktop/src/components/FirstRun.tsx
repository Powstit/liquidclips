import { useEffect, useRef, useState } from "react";
import { sidecar, type HardwareInfo } from "../lib/sidecar";
import {
  useActivation,
  resetLoginSession,
  activationDiagnostics,
} from "../lib/activation";
import { Logo } from "./Logo";
import pkg from "../../package.json";

const APP_VERSION: string = pkg.version;

// v0.7.77 — Lane 1 onboarding polish.
// Single-screen first-run: brand mark → one clear headline → one primary
// browser sign-in CTA → one secondary in-app sign-in link. The OpenAI key
// panel was moved to Settings → API keys; guardQuota() routes Free users
// there when they first run a pipeline without a key.

export function FirstRun({ onComplete }: { onComplete: () => void }) {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const { status: act, activate } = useActivation();
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

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col px-6 py-10">
      <div className="flex items-center justify-between">
        <Logo size="md" />
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          first run
        </div>
      </div>

      <div className="mt-16 flex flex-1 flex-col items-start">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
          Liquid Clips
        </span>
        <h1 className="mt-3 font-display text-[36px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          Sign in to start clipping.
        </h1>
        <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
          Your videos stay on your machine. Sign in to activate your plan,
          unlock Earn, and turn any link or file into vertical clips.
        </p>

        <div className="mt-8 flex flex-col items-start gap-3">
          <button
            onClick={() => {
              startedActivation.current = true;
              void activate({ via: "browser" });
            }}
            disabled={
              act.kind === "opening" ||
              act.kind === "waiting" ||
              act.kind === "activating"
            }
            className="btn-primary min-w-[220px]"
          >
            {act.kind === "opening"
              ? "Opening browser…"
              : act.kind === "waiting"
              ? "Waiting for sign-in…"
              : act.kind === "activating"
              ? "Activating…"
              : act.kind === "error"
              ? "Try again with browser →"
              : "Continue with browser →"}
          </button>

          <button
            onClick={() => {
              startedActivation.current = true;
              void activate({ via: "panel" });
            }}
            disabled={
              act.kind === "opening" ||
              act.kind === "waiting" ||
              act.kind === "activating"
            }
            className="btn-ghost px-0 py-0 text-[12px] text-text-tertiary hover:text-fuchsia"
          >
            Sign in via the app
          </button>
        </div>

        {act.kind === "waiting" && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Finish sign-in in your browser — Liquid Clips activates
            automatically.
          </p>
        )}
        {act.kind === "activating" && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            Activated — syncing your account…
          </p>
        )}
        {act.kind === "error" && (
          <FailedLoginRescue
            message={act.message}
            onTryPanel={() => {
              startedActivation.current = true;
              void activate({ via: "panel" });
            }}
          />
        )}

        {hw && hw.warnings.length > 0 && (
          <div className="mt-6 rounded-xl border border-fuchsia-deep/30 bg-fuchsia-soft px-4 py-3 font-mono text-[12px] text-fuchsia-deep">
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

/* ── Failed-login rescue panel ───────────────────────────────────────── */

function FailedLoginRescue({
  message,
  onTryPanel,
}: {
  message: string;
  onTryPanel: () => void;
}) {
  const [resetState, setResetState] = useState<
    "idle" | "resetting" | "done" | "partial"
  >("idle");
  const [resetReason, setResetReason] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  async function doReset() {
    if (resetState === "resetting") return;
    setResetState("resetting");
    setResetReason(null);
    try {
      const result = await resetLoginSession();
      if (result.ok) {
        setResetState("done");
      } else {
        setResetState("partial");
        setResetReason(result.reason);
      }
    } finally {
      window.setTimeout(() => {
        setResetState("idle");
        setResetReason(null);
      }, 2400);
    }
  }

  async function doCopy() {
    const blob = activationDiagnostics(APP_VERSION);
    try {
      await navigator.clipboard.writeText(blob);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      /* clipboard blocked — diagnostics still visible inline below */
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-danger)]">
        sign-in failed
      </p>
      <p className="mt-1 font-sans text-[12px] leading-relaxed text-ink">
        {message}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onTryPanel}
          className="btn-secondary px-3 py-1.5 text-[11px]"
        >
          Sign in via the app
        </button>
        <button
          onClick={() => void doReset()}
          disabled={resetState === "resetting"}
          className="btn-secondary px-3 py-1.5 text-[11px]"
        >
          {resetState === "resetting"
            ? "Resetting…"
            : resetState === "done"
            ? "Session reset"
            : resetState === "partial"
            ? "Reset partial — keychain unreachable"
            : "Reset login session"}
        </button>
        <button
          onClick={() => void doCopy()}
          className="btn-secondary px-3 py-1.5 text-[11px]"
        >
          {copyState === "copied" ? "Copied" : "Copy diagnostics"}
        </button>
      </div>
      {resetState === "partial" && resetReason && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {resetReason}
        </p>
      )}
    </div>
  );
}
