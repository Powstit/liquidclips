"use client";

import { useState } from "react";

// Auth-code recovery setup — 8 char alphanumeric.
// Posts to junior-backend POST /admin/recovery/auth-code (Agent 5 owns the
// endpoint). Assumed contract:
//   request body: { code: "AB12CD34", clerk_user_id: "user_..." }
//   response 200: { ok: true }
//
// Same minimal-Tailwind treatment as PinSetup — Agent 2 will brand-pass.

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

export function AuthCodeSetup({ alreadySet, backendBase, clerkUserId }: Props) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<PostState>({ kind: "idle" });

  const valid = /^[A-Za-z0-9]{8}$/.test(code);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) return;
    setState({ kind: "saving" });
    try {
      const res = await fetch(`${backendBase}/admin/recovery/auth-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, clerk_user_id: clerkUserId }),
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
      setCode("");
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
      className="rounded-md border border-neutral-200 bg-white p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">
          Recovery auth code
        </h3>
        {alreadySet && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            set
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-600">
        8-character alphanumeric. Used as the long-form unlock alongside the PIN.
      </p>
      <input
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={8}
        value={code}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
          setCode(cleaned);
        }}
        placeholder="XXXXXXXX"
        className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-base uppercase tracking-widest focus:border-neutral-900 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!valid || state.kind === "saving"}
        className="w-full rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        {state.kind === "saving"
          ? "Saving…"
          : alreadySet
            ? "Replace code"
            : "Save code"}
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
