"use client";

// HQ admin tab · Login-screen carousel clip roster.
//
// Curates the clips shown on the desktop LoginScreen carousel for
// cold-traffic users. Backed by `login_carousel_clips` table.
// Read + write both go through the /api/admin proxy (which re-checks
// admin server-side + forwards the internal secret). The browser
// never sees the secret.
//
// Backend routes (junior-backend/app/routes/admin.py):
//   GET    /admin/carousel-clips
//   POST   /admin/carousel-clips           { url, handle, earnings_cents, platform, campaign_id?, priority?, active? }
//   DELETE /admin/carousel-clips/{id}
//
// Public read side lives at GET /hq/carousel/clips (routes/carousel.py)
// — public + unauthenticated because the content is curated + safe.

import { useCallback, useEffect, useState } from "react";
import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";
import { InfoIcon } from "./_lib/InfoIcon";

const PLATFORMS = ["TikTok", "YT Shorts", "Reels"] as const;
type Platform = (typeof PLATFORMS)[number];

type CarouselClip = {
  id: string;
  url: string;
  handle: string;
  earnings_cents: number;
  platform: string;
  campaign_id: string | null;
  priority: number;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type CarouselListResponse = {
  rows: CarouselClip[];
  generated_at: string | null;
  note: string;
};

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function isMp4Url(u: string): boolean {
  const path = u.split("?", 1)[0].toLowerCase();
  return path.endsWith(".mp4");
}

export function CarouselClipsTab(): React.JSX.Element {
  const src = useDataSource();
  const [rows, setRows] = useState<CarouselClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/carousel-clips", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const j = (await res.json()) as CarouselListResponse;
      setRows(j.rows);
      src.report("carousel-clips", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      src.report("carousel-clips", "fail");
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: CarouselClip) {
    if (!window.confirm(`Delete carousel clip ${row.handle}?`)) return;
    try {
      const res = await fetch(`/api/admin/carousel-clips/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      }
      await load();
    } catch (e) {
      window.alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section
      className="rounded-3xl border p-5 sm:p-6"
      style={{ borderColor: "var(--lc-stroke)", background: "color-mix(in srgb, var(--lc-bg-warm) 60%, transparent)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--lc-fg-faint)" }}>
            login-screen carousel clips
            <InfoIcon hint="Curated clip roster shown on the desktop LoginScreen carousel to cold-traffic users. Backed by login_carousel_clips table. Empty is a valid state — bundled /public/demos/*.mp4 fallbacks render client-side." />
          </div>
          <p className="lc-body mt-1 text-[12px]" style={{ color: "var(--lc-fg-muted)" }}>
            Ordered by created_at desc. Public read side lives at GET /hq/carousel/clips (routes/carousel.py).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition"
            style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg)", color: "var(--lc-fg)" }}
          >
            {showForm ? "Close form" : "New clip"}
          </button>
        </div>
      </div>

      {showForm && (
        <NewClipForm
          onSaved={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {error && (
        <p
          className="mt-3 rounded-md border px-3 py-2 font-mono text-[11px]"
          style={{ borderColor: "rgba(255,102,184,0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" }}
        >
          {error}
        </p>
      )}

      {!rows ? (
        <p className="mt-4 font-mono text-[11px]" style={{ color: "var(--lc-fg-faint)" }}>
          loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-mono text-[11px]" style={{ color: "var(--lc-fg-faint)" }}>
          no carousel clips yet · LoginScreen shows bundled fallbacks
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b" style={{ borderColor: "var(--lc-stroke)", color: "var(--lc-fg-faint)" }}>
              <tr className="text-left">
                <th className="px-2 py-2">preview</th>
                <th className="px-2 py-2">handle</th>
                <th className="px-2 py-2">platform</th>
                <th className="px-2 py-2 text-right">earnings</th>
                <th className="px-2 py-2 text-right">priority</th>
                <th className="px-2 py-2">active</th>
                <th className="px-2 py-2">campaign</th>
                <th className="px-2 py-2">created</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b" style={{ borderColor: "color-mix(in srgb, var(--lc-stroke) 50%, transparent)" }}>
                  <td className="px-2 py-2">
                    <video
                      src={row.url}
                      muted
                      autoPlay
                      loop
                      playsInline
                      preload="metadata"
                      style={{
                        width: 120,
                        height: 213,
                        objectFit: "cover",
                        borderRadius: 8,
                        border: "1px solid var(--lc-stroke)",
                        background: "#000",
                      }}
                    />
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg)" }}>
                    <span className="lc-display">{row.handle}</span>
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-muted)" }}>
                    {row.platform}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--lc-fg)" }}>
                    {fmtCents(row.earnings_cents)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--lc-fg-muted)" }}>
                    {row.priority}
                  </td>
                  <td className="px-2 py-2" style={{ color: row.active ? "var(--lc-ok)" : "var(--lc-fg-faint)" }}>
                    {row.active ? "yes" : "no"}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-faint)" }}>
                    {row.campaign_id ?? "—"}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-faint)" }}>
                    {row.created_at ? new Date(row.created_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => void remove(row)}
                      className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
                      style={{
                        borderColor: "rgba(255,102,184,0.40)",
                        background: "var(--lc-bg)",
                        color: "var(--lc-accent-mid)",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NewClipForm({ onSaved }: { onSaved: () => Promise<void> | void }): React.JSX.Element {
  const [draft, setDraft] = useState({
    url: "",
    handle: "",
    earnings_cents: "0",
    platform: "TikTok" as Platform,
    campaign_id: "",
    priority: "0",
    active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    // Field validation matches backend rules:
    //   url required + must be .mp4
    //   handle required
    //   earnings_cents integer ≥ 0
    if (!draft.url.trim()) {
      setError("url required");
      return;
    }
    if (!isMp4Url(draft.url.trim())) {
      setError("url must be an .mp4");
      return;
    }
    if (!draft.handle.trim()) {
      setError("handle required");
      return;
    }
    const earnings = parseInt(draft.earnings_cents || "0", 10);
    if (!Number.isFinite(earnings) || earnings < 0) {
      setError("earnings_cents must be a non-negative integer");
      return;
    }
    const priority = parseInt(draft.priority || "0", 10);
    if (!Number.isFinite(priority) || priority < 0) {
      setError("priority must be a non-negative integer");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/carousel-clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: draft.url.trim(),
          handle: draft.handle.trim(),
          earnings_cents: earnings,
          platform: draft.platform,
          campaign_id: draft.campaign_id.trim() || null,
          priority,
          active: draft.active,
        }),
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      await onSaved();
      setDraft({
        url: "",
        handle: "",
        earnings_cents: "0",
        platform: "TikTok",
        campaign_id: "",
        priority: "0",
        active: true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mb-4 mt-4 rounded-2xl border p-4"
      style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg)" }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FormField
          label="url *"
          value={draft.url}
          onChange={(v) => setDraft({ ...draft, url: v })}
          placeholder="https://…clip.mp4"
          hint="Absolute MP4 URL. Path must end with .mp4 (matches backend + client-side check)."
        />
        <FormField
          label="handle *"
          value={draft.handle}
          onChange={(v) => setDraft({ ...draft, handle: v })}
          placeholder="@user"
          hint="Display handle overlaid on the carousel preview."
        />
        <FormField
          label="earnings_cents *"
          value={draft.earnings_cents}
          onChange={(v) => setDraft({ ...draft, earnings_cents: v })}
          type="number"
          hint="Integer USD cents ≥ 0. Rendered as $x.xx overlay."
        />
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--lc-fg-faint)" }}>
          <span>
            platform *
            <InfoIcon hint="Locked enum: TikTok · YT Shorts · Reels." />
          </span>
          <select
            value={draft.platform}
            onChange={(e) => setDraft({ ...draft, platform: e.target.value as Platform })}
            className="rounded-md border px-2 py-1 font-sans text-[12px] normal-case tracking-normal"
            style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg-warm)", color: "var(--lc-fg)" }}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <FormField
          label="campaign_id"
          value={draft.campaign_id}
          onChange={(v) => setDraft({ ...draft, campaign_id: v })}
          placeholder="camp_xxx"
          hint="Optional. Sponsored-campaign association. Empty = generic curated clip."
        />
        <FormField
          label="priority"
          value={draft.priority}
          onChange={(v) => setDraft({ ...draft, priority: v })}
          type="number"
          hint="Integer 0-1000. Higher priority = shown first when multiple active clips compete."
        />
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--lc-fg-faint)" }}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          <span>active</span>
          <InfoIcon hint="Inactive clips are hidden from the public /hq/carousel/clips response but preserved in the DB." />
        </label>
      </div>
      {error && (
        <p
          className="mt-3 rounded-md border px-3 py-2 font-mono text-[11px]"
          style={{ borderColor: "rgba(255,102,184,0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" }}
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="ml-auto rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition disabled:opacity-60"
          style={{ background: "var(--lc-accent)", color: "var(--lc-fg)" }}
        >
          {busy ? "Saving…" : "Create clip"}
        </button>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--lc-fg-faint)" }}>
      <span>
        {label}
        {hint && <InfoIcon hint={hint} />}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border px-2 py-1 font-sans text-[12px] normal-case tracking-normal"
        style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg-warm)", color: "var(--lc-fg)" }}
      />
    </label>
  );
}
