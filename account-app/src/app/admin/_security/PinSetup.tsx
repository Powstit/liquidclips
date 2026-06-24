"use client";

import { useState } from "react";

// PIN recovery setup — 6 digit numeric.
// Posts to junior-backend POST /admin/recovery/pin (Agent 5 owns the
// endpoint). Assumed contract:
//   request body: { pin: "123456", clerk_user_id: "user_..." }
//   response 200: { ok: true }
//
// The form is intentionally minimal — Agent 2 will brand-pass it later.

type Props = {
  alreadySet: boolean;
  backendBase: string;
  clerkUserId: string;
};

type PostState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function PinSetup({ alreadySet, backendBase, clerkUserId }: Props) {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<PostState>({ kind: "idle" });

  const valid = /^\d{6}$/.test(pin);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) return;
    setState({ kind: "saving" });
    try {
      const res = await fetch(`${backendBase}/admin/recovery/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, clerk_user_id: clerkUserId }),
        credentials: "include",
      });
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Backend returned ${res.status}`,
        });
        return;
      }
      setState({ kind: "ok" });
      setPin("");
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-neutral-200 bg-ink p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">Recovery PIN</h3>
        {alreadySet && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            set
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-600">
        6-digit numeric. Used to unlock the recovery flow.
      </p>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
          setPin(digits);
        }}
        placeholder="••••••"
        className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-base tracking-widest focus:border-neutral-900 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!valid || state.kind === "saving"}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {state.kind === "saving" ? "Saving…" : alreadySet ? "Replace PIN" : "Save PIN"}
      </button>
      {state.kind === "ok" && (
        <p className="mt-2 text-xs text-green-700">Saved.</p>
      )}
      {state.kind === "error" && (
        <p className="mt-2 text-xs text-red-700">Failed: {state.message}</p>
      )}
    </form>
  );
}
