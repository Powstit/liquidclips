"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SAMPLE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

type Status = "standby" | "boot" | "error";

type Props = {
  /** Optional · only the hero pipes Kade's wake state. Re-uses (final-CTA) omit. */
  onWake?: (awake: boolean) => void;
  /** Optional accessibility label override · default "Long video URL". */
  ariaLabel?: string;
};

/**
 * LOCKED · Window 1 · the URL input as hardware. Not a form, not a "search bar".
 * Reused verbatim by the final CTA at the bottom of the page.
 *
 *   ┌─ KADE // SCOUT UNIT ONLINE ──────────────────────────────────────┐
 *   │  paste a long video · YouTube / file / stream    [Find My Clips →] │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Solid reticle corners, fuchsia focus glow, cyan rim behind, scout
 * onWake() flips Kade from idle → wake on focus.
 */
export function HeroPaste({ onWake, ariaLabel }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("standby");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  async function submit(value: string) {
    if (!value.trim()) {
      setStatus("error");
      setErrorMsg("Paste a long video to start the scan.");
      return;
    }
    setStatus("boot");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Boot failed.");
      router.push(`/generate/${data.id}`);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Boot failed.");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(url);
      }}
      className={`lc-w1-pill lc-w1-pill--${status} ${focused ? "is-focused" : ""}`}
    >
      {/* solid reticle corners · 4 brackets */}
      <span className="lc-w1-bracket lc-w1-bracket--tl" aria-hidden="true" />
      <span className="lc-w1-bracket lc-w1-bracket--tr" aria-hidden="true" />
      <span className="lc-w1-bracket lc-w1-bracket--bl" aria-hidden="true" />
      <span className="lc-w1-bracket lc-w1-bracket--br" aria-hidden="true" />

      <div className="lc-w1-pill-row">
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="paste a long video · YouTube link / file / stream"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (status === "error") {
              setStatus("standby");
              setErrorMsg(null);
            }
          }}
          onFocus={() => {
            setFocused(true);
            onWake?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onWake?.(false);
          }}
          disabled={status === "boot"}
          className="lc-w1-input"
          aria-label={ariaLabel ?? "Long video URL"}
        />

        <button
          type="submit"
          disabled={status === "boot"}
          className="lc-w1-cta lc-btn lc-btn--primary"
        >
          <span className="lc-w1-cta-label">
            {status === "boot" ? "Scanning…" : "Find My Clips"}
          </span>
          <span className="lc-w1-cta-glyph" aria-hidden="true">→</span>
        </button>
      </div>

      {status === "error" && errorMsg && (
        <p role="alert" className="lc-w1-error">{errorMsg}</p>
      )}
      <button
        type="button"
        onClick={() => {
          setUrl(SAMPLE_URL);
          void submit(SAMPLE_URL);
        }}
        className="lc-w1-sample"
        disabled={status === "boot"}
      >
        no video? load a sample →
      </button>
    </form>
  );
}
