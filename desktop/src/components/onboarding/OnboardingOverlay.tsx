import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, KeyRound, Play, Sparkles, UserRound, X } from "lucide-react";
import { useActivation } from "../../lib/activation";
import { track as trackEvent } from "../../lib/analytics";

type OnboardingOverlayProps = {
  onComplete: () => Promise<void> | void;
  onOpenSettings: () => void;
  onTrySample: () => void;
};

const cards = [
  {
    eyebrow: "Card 1 of 4",
    title: "Welcome to Liquid Clips",
    body: "Turn long videos into ready-to-post short clips with local transcription, vertical cuts, captions, and publish-ready copy.",
    Icon: Sparkles,
    cta: "Start setup",
  },
  {
    eyebrow: "Card 2 of 4",
    title: "Sign in to unlock 100 free clips",
    body: "Your account activates the starter pass, keeps exports counted fairly, and unlocks the Earn tab when you are ready to promote brands.",
    Icon: UserRound,
    cta: "Sign in with browser",
  },
  {
    eyebrow: "Card 3 of 4",
    title: "Add an OpenAI key or upgrade for hosted AI",
    body: "Free and early plans can paste a key once in Settings. Pro hosted AI is wired through Liquid Clips when your plan includes it.",
    Icon: KeyRound,
    cta: "Open Settings",
  },
  {
    eyebrow: "Card 4 of 4",
    title: "Try your first clip",
    body: "Load a public YouTube sample, choose Clips, and watch Liquid Clips pull the strongest moments into a workspace.",
    Icon: Play,
    cta: "Load sample",
  },
] as const;

export function OnboardingOverlay({ onComplete, onOpenSettings, onTrySample }: OnboardingOverlayProps) {
  const [index, setIndex] = useState(0);
  const { status: activation, activate } = useActivation();
  const card = cards[index];
  const Icon = card.Icon;

  useEffect(() => {
    trackEvent("onboarding_card_1_shown", { card: 1 });
  }, []);

  useEffect(() => {
    if (activation.kind === "done" && index === 1) setIndex(2);
  }, [activation.kind, index]);

  const dots = useMemo(
    () => cards.map((_, i) => (
      <span
        key={i}
        className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-fuchsia" : "w-1.5 bg-line"}`}
      />
    )),
    [index],
  );

  async function finish() {
    await onComplete();
  }

  async function skip() {
    trackEvent("onboarding_skipped_at_card_N", { card: index + 1 });
    await finish();
  }

  async function primary() {
    if (index === 0) {
      setIndex(1);
      return;
    }
    if (index === 1) {
      // v0.7.59 — the CTA literally says "Sign in with browser", so the
      // handler must open the system browser. Without { via: "browser" }
      // activate() defaults to via: "panel" (embedded Tauri webview), which
      // is the FirstRun "Sign in →" path — different surface, different UX.
      await activate({ via: "browser" });
      return;
    }
    if (index === 2) {
      await finish();
      onOpenSettings();
      return;
    }
    trackEvent("onboarding_card_4_completed", { card: 4 });
    await finish();
    onTrySample();
  }

  const busy = activation.kind === "opening" || activation.kind === "waiting" || activation.kind === "activating";
  const cta =
    index === 1
      ? activation.kind === "opening"
        ? "Opening browser"
        : activation.kind === "waiting"
        ? "Waiting for sign-in"
        : activation.kind === "activating"
        ? "Activating"
        : activation.kind === "error"
        ? "Try again"
        : card.cta
      : card.cta;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-paper/40 p-5 backdrop-blur-md">
      <section className="w-[540px] max-w-full overflow-hidden rounded-3xl border border-line bg-paper shadow-[0_28px_90px_rgba(11,11,16,0.18)]">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">{dots}</div>
          <button
            type="button"
            onClick={() => void skip()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-fuchsia-soft/40 hover:text-ink"
            aria-label="Skip onboarding"
            title="Skip onboarding"
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-7 py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-soft text-fuchsia-deep">
            <Icon size={22} />
          </div>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            {card.eyebrow}
          </p>
          <h2 className="mt-2 font-display text-[34px] font-semibold leading-tight text-ink">
            {card.title}
          </h2>
          <p className="mt-3 max-w-[440px] font-sans text-[15px] leading-6 text-text-secondary">
            {card.body}
          </p>

          {activation.kind === "error" && index === 1 && (
            <p className="mt-4 rounded-2xl border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5 px-4 py-3 font-mono text-[12px] text-[#B91C1C]">
              {activation.message}
            </p>
          )}

          {activation.kind === "done" && index === 2 && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary">
              <Check size={14} className="text-fuchsia" /> account connected
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={() => void skip()}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary transition-colors hover:text-ink"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => void primary()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-60"
          >
            {cta}
            <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
