// v0.7.73 — New Project modal.
//
// Mounted by ProjectsTab when the header "New Project" button is clicked.
// Creates a blank Project via `sidecar.createBlankProject` and routes the
// caller into ProjectDetail on success.
//
// Fields: name (required), type (Manual / Content / Client / Import), goal
// (optional one-line outcome). Earn projects are not creatable here on
// purpose — those are minted by the Earn → Start bounty flow so the
// whop_bounty_* metadata lands on the project correctly.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { humanError, sidecar } from "../../lib/sidecar";

export type NewProjectType = "Manual" | "Content" | "Client" | "Import";

const TYPES: { key: NewProjectType; label: string; hint: string }[] = [
  { key: "Manual", label: "Manual", hint: "Free-form workspace." },
  { key: "Content", label: "Content", hint: "Recurring publishing goal." },
  { key: "Client", label: "Client", hint: "Work organised per client." },
  { key: "Import", label: "Import", hint: "Container for imported clips." },
];

export function NewProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<NewProjectType>("Manual");
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setType("Manual");
      setGoal("");
      setError(null);
      setSubmitting(false);
    } else {
      // Focus the name field on open so the user can type immediately.
      setTimeout(() => nameRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  const onSubmit = useCallback(async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Give your project a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { slug } = await sidecar.createBlankProject({
        name: cleanName,
        project_type: type,
        goal: goal.trim() || null,
      });
      // Broadcast so any mounted Projects / Library tabs refresh.
      try {
        window.dispatchEvent(new CustomEvent("lc:library-refresh"));
      } catch {
        /* best-effort */
      }
      onCreated(slug);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setSubmitting(false);
    }
  }, [name, type, goal, onCreated]);

  return (
    <AnimatePresence>
      {open && (
        <ModalShell
          onClose={() => {
            if (!submitting) onClose();
          }}
        >
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
              new project
            </span>
            <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
              Create a workspace.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            project name
          </span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) void onSubmit();
            }}
            placeholder="e.g. Sunday reel batch"
            disabled={submitting}
            className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none focus:shadow-[var(--glow-sm)]"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            type
          </span>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => {
              const active = type === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  disabled={submitting}
                  className={`flex flex-col items-start gap-0.5 rounded-2xl border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-fuchsia bg-fuchsia-soft/40 text-fuchsia-deep"
                      : "border-line bg-transparent text-ink hover:border-fuchsia hover:text-fuchsia-deep"
                  }`}
                >
                  <span className="font-sans text-[13px] font-medium">{t.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                    {t.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            <span>goal · optional</span>
            <span className="normal-case tracking-normal text-text-tertiary/80">
              Skip if you&apos;re just exploring
            </span>
          </span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) void onSubmit();
            }}
            placeholder="e.g. 3 TikToks/week for the brand"
            disabled={submitting}
            className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none focus:shadow-[var(--glow-sm)]"
          />
        </label>

        {error && (
          <div role="alert" className="error-banner">
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        )}

        <footer className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-paper px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting || !name.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-fuchsia px-6 font-sans text-sm font-semibold text-ink shadow-[var(--glow-md)] transition-all hover:bg-fuchsia-bright disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            {submitting ? "Creating…" : "Create project →"}
          </button>
        </footer>
        </ModalShell>
      )}
    </AnimatePresence>
  );
}

/** v0.7.77 — Shared backdrop + content motion entry for the New Project
 *  modal. AnimatePresence drives exit on close so the modal fades + lifts
 *  out instead of snapping. Respects reduced-motion. */
function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.1 : 0.18, ease: "easeOut" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
    >
      <motion.div
        className="flex w-full max-w-[440px] flex-col gap-4 rounded-2xl border border-line bg-paper-warm p-5 shadow-e2"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
        transition={{
          duration: reduced ? 0.12 : 0.24,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
