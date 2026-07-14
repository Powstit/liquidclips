"use client";

import { useEffect, useRef, useState } from "react";

// HQ Agent 3 · typed-confirmation gate.
//
// Every mutation action opens this modal. The admin must type the exact
// `requiredText` string (e.g. "REFUND user_abc") before the Confirm button
// becomes clickable. This is the human-side iron gate that pairs with the
// backend's idempotence-key check.

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  requiredText: string;
  confirmLabel?: string;
  destructive?: boolean;
  fields?: Array<{
    name: string;
    label: string;
    placeholder?: string;
    type?: "text" | "number" | "textarea" | "select" | "date";
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    defaultValue?: string | number;
    helper?: string;
  }>;
  onConfirm: (values: Record<string, string>) => Promise<void> | void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  requiredText,
  confirmLabel = "Confirm",
  destructive = true,
  fields,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes React state with an external system — legitimate useEffect
      setTyped("");
      setErr(null);
      setBusy(false);
      const initial: Record<string, string> = {};
      for (const f of fields ?? []) {
        initial[f.name] = f.defaultValue != null ? String(f.defaultValue) : "";
      }
      setValues(initial);
      // Autofocus the first input after the modal renders.
      requestAnimationFrame(() => firstInputRef.current?.focus());
    }
  }, [open, fields]);

  if (!open) return null;

  const canConfirm = typed.trim() === requiredText && !busy;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(values);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-ink p-6 shadow-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="confirm-modal-title"
            className={`font-display text-[20px] font-semibold tracking-[-0.02em] ${destructive ? "text-pink-700" : "text-neutral-900"}`}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-neutral-300 bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-600 hover:border-pink-500 disabled:opacity-40"
          >
            close
          </button>
        </div>

        <p className="mt-3 font-sans text-[13px] leading-relaxed text-neutral-700">{description}</p>

        {fields && fields.length > 0 && (
          <div className="mt-4 space-y-3">
            {fields.map((f, idx) => {
              const id = `cm-field-${f.name}`;
              const common = {
                id,
                value: values[f.name] ?? "",
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value })),
                placeholder: f.placeholder,
                disabled: busy,
                className:
                  "w-full rounded-xl border border-neutral-300 bg-ink px-3 py-2 font-mono text-[12px] text-neutral-900 placeholder:text-neutral-400 focus:border-pink-500 focus:outline-none disabled:opacity-50",
              };
              return (
                <div key={f.name}>
                  <label htmlFor={id} className="block font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-500">
                    {f.label}
                    {f.required && <span className="ml-1 text-pink-600">*</span>}
                  </label>
                  <div className="mt-1.5">
                    {f.type === "textarea" ? (
                      <textarea rows={3} {...common} />
                    ) : f.type === "select" ? (
                      <select {...common}>
                        <option value="">—</option>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        ref={idx === 0 ? firstInputRef : undefined}
                        type={f.type ?? "text"}
                        {...common}
                      />
                    )}
                  </div>
                  {f.helper && (
                    <p className="mt-1 font-mono text-[10px] text-neutral-500">{f.helper}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-500">
            Type to confirm:
          </div>
          <code className="mt-1 block break-all rounded-lg bg-ink px-2 py-1.5 font-mono text-[11px] text-pink-700 ring-1 ring-pink-200">
            {requiredText}
          </code>
          <input
            ref={!fields || fields.length === 0 ? firstInputRef : undefined}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) confirm();
            }}
            placeholder="Type the exact confirmation string above"
            disabled={busy}
            className="mt-3 w-full rounded-xl border border-neutral-300 bg-ink px-3 py-2 font-mono text-[12px] text-neutral-900 placeholder:text-neutral-400 focus:border-pink-500 focus:outline-none disabled:opacity-50"
          />
        </div>

        {err && (
          <div className="mt-3 rounded-xl border border-pink-300 bg-pink-50 px-3 py-2 font-mono text-[11px] text-pink-700">
            {err}
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-neutral-300 bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-neutral-700 hover:border-pink-500 disabled:opacity-40"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className={`rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink transition disabled:opacity-30 ${
              destructive
                ? "bg-pink-600 hover:bg-pink-700"
                : "bg-neutral-900 hover:bg-pink-700"
            }`}
          >
            {busy ? "running…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
