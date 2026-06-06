import { useState } from "react";
import type { BountyContext } from "../../lib/sidecar";
import { isSupportedSourceUrl } from "../../lib/sourceHosts";

// Beta fallback: when Whop's API rejects us (scope issue, API key missing
// on the backend, network down), the clipper can still earn by typing the
// bounty's details in by hand. Same downstream BountyContext shape, so the
// pinned banner + submission capture in ResultsGrid behave identically.
//
// Required fields are deliberately minimal — bounty title + source URL.
// Everything else is optional. Reward + currency feed the banner's payout
// label; the submission capture step still asks for the Whop submission URL
// when the user posts it back.

export type ManualBountyForm = {
  bounty: BountyContext;
  source_url: string;
};

function bountyIdFromUrl(raw: string): string | null {
  // Whop bounty URLs look like:
  //   https://whop.com/bounties/<slug>/
  //   https://whop.com/<community>/bounties/<id>
  //   https://whop.com/experiences/<expId>
  // Accept any of those — the ID we pull out is what the submission tracker
  // needs to dedupe pinned banners. If we can't extract one, mint a local
  // synthetic ID so the project still threads through.
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    const expIdx = parts.indexOf("experiences");
    if (expIdx >= 0 && parts[expIdx + 1]) return parts[expIdx + 1];
    const bIdx = parts.indexOf("bounties");
    if (bIdx >= 0 && parts[bIdx + 1]) return parts[bIdx + 1];
  } catch {
    /* fall through to synthetic */
  }
  return `manual_${Date.now().toString(36)}`;
}

export function ManualBountyPrompt({
  onSubmit,
  onCancel,
}: {
  onSubmit: (form: ManualBountyForm) => void;
  onCancel: () => void;
}) {
  const [bountyUrl, setBountyUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [reward, setReward] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    if (!title.trim()) {
      setError("Add the reward title so the pinned banner makes sense.");
      return;
    }
    if (!sourceUrl.trim()) {
      setError("Source URL is required — that's the video Liquid Clips actually cuts.");
      return;
    }
    if (!isSupportedSourceUrl(sourceUrl)) {
      setError(
        "Source must be YouTube, TikTok, Instagram Reels, Vimeo, or X.",
      );
      return;
    }
    const id = bountyUrl.trim() ? bountyIdFromUrl(bountyUrl.trim()) : `manual_${Date.now().toString(36)}`;
    const rewardNum = reward.trim() ? Number.parseFloat(reward.trim()) : 0;
    onSubmit({
      bounty: {
        id: id ?? `manual_${Date.now().toString(36)}`,
        title: title.trim(),
        rewardPerUnitAmount: Number.isFinite(rewardNum) ? rewardNum : 0,
        currency: currency || "USD",
      },
      source_url: sourceUrl.trim(),
    });
  }

  return (
    <div className="relative bg-transparent p-4">
      {/* Fuchsia HUD bracket corners — same cockpit language as the other
          Round 4 modal frames. No solid plate behind. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        manual reward · beta fallback
      </div>
      <p className="mt-1 font-sans text-[12px] leading-relaxed text-text-secondary">
        Paste the reward's details by hand and start clipping. Same pipeline,
        same submission-capture flow — only the Content Rewards list is bypassed.
      </p>

      <div className="mt-3 grid gap-2">
        <Field label="reward title" required>
          <input
            value={title}
            autoFocus
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
            placeholder="e.g. Clip the Bryson Tiller podcast for $$"
            className="w-full rounded-lg border border-line/60 bg-transparent px-3 py-2 font-sans text-[13px] text-ink focus:border-fuchsia focus:outline-none"
          />
        </Field>

        <Field label="source video url" required>
          <input
            value={sourceUrl}
            spellCheck={false}
            onChange={(e) => { setSourceUrl(e.target.value); setError(null); }}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full rounded-lg border border-line/60 bg-transparent px-3 py-2 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none"
          />
        </Field>

        <Field label="whop reward url (optional)">
          <input
            value={bountyUrl}
            spellCheck={false}
            onChange={(e) => setBountyUrl(e.target.value)}
            placeholder="https://whop.com/bounties/…"
            className="w-full rounded-lg border border-line/60 bg-transparent px-3 py-2 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="reward / 1k (optional)">
            <input
              value={reward}
              inputMode="decimal"
              onChange={(e) => setReward(e.target.value)}
              placeholder="20"
              className="w-full rounded-lg border border-line/60 bg-transparent px-3 py-2 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none"
            />
          </Field>
          <Field label="currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-line/60 bg-transparent px-3 py-2 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none"
            >
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
        </div>
      </div>

      {error && <p className="mt-2 font-mono text-[11px] text-[#DC2626]">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={go}
          className="rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright"
        >
          Start clipping →
        </button>
        <button
          onClick={onCancel}
          className="rounded-full bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-text-secondary transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        {label}
        {required && <span className="ml-1 text-fuchsia">*</span>}
      </span>
      {children}
    </label>
  );
}
