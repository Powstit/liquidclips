"use client";

// HQ admin tab · Cold-lead pre-registration inspector.
//
// Backed by the `cold_leads` table (routes/cold_leads.py). Rows are
// upserted by the Instantly webhook (open/click) via POST
// /cold-leads/prep — this tab surfaces them for HQ oversight plus a
// CSV upload widget for bulk staging.
//
// CSV shape: header row expected — columns `email,handle,campaign`.
// Extra columns (preview_clip_url, platform) are honoured if present.
// Every row is POSTed individually to /admin/cold-leads (which the
// backend upserts on the (email, campaign_id) composite key exactly
// like /cold-leads/prep does).
//
// Backend routes (junior-backend/app/routes/admin.py):
//   GET    /admin/cold-leads?campaign_id=&limit=
//   POST   /admin/cold-leads      { email, handle, campaign_id, ... }
//   DELETE /admin/cold-leads?email=&campaign_id=

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";
import { InfoIcon } from "./_lib/InfoIcon";

type ColdLead = {
  email: string;
  handle: string;
  campaign_id: string;
  preview_clip_url: string | null;
  platform: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type ColdLeadsResponse = {
  rows: ColdLead[];
  campaigns: string[];
  total: number;
  note: string;
};

type CsvRow = {
  email: string;
  handle: string;
  campaign: string;
  preview_clip_url?: string;
  platform?: string;
};

type UploadOutcome = {
  ok: number;
  failed: number;
  errors: Array<{ row: number; email: string; error: string }>;
};

// Minimal RFC-4180-ish CSV parser (handles double-quoted fields with
// embedded commas + escaped quotes). Good enough for HQ CSV drops —
// intentionally not a full csv-lib to keep the tab dep-free.
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // swallow — \n handles the row break
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return { header, rows };
}

function rowsToObjects(header: string[], rows: string[][]): CsvRow[] {
  const idxOf = (name: string) => header.indexOf(name);
  const iEmail = idxOf("email");
  const iHandle = idxOf("handle");
  const iCampaign =
    idxOf("campaign") >= 0 ? idxOf("campaign") : idxOf("campaign_id");
  const iPreview = idxOf("preview_clip_url");
  const iPlatform = idxOf("platform");
  const out: CsvRow[] = [];
  for (const r of rows) {
    if (r.every((c) => c.trim() === "")) continue;
    if (iEmail < 0 || iHandle < 0 || iCampaign < 0) continue;
    const email = (r[iEmail] ?? "").trim();
    const handle = (r[iHandle] ?? "").trim();
    const campaign = (r[iCampaign] ?? "").trim();
    if (!email || !handle || !campaign) continue;
    const obj: CsvRow = { email, handle, campaign };
    if (iPreview >= 0) obj.preview_clip_url = (r[iPreview] ?? "").trim() || undefined;
    if (iPlatform >= 0) obj.platform = (r[iPlatform] ?? "").trim() || undefined;
    out.push(obj);
  }
  return out;
}

export function ColdLeadsTab(): React.JSX.Element {
  const src = useDataSource();
  const [data, setData] = useState<ColdLeadsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [uploading, setUploading] = useState(false);
  const [uploadOutcome, setUploadOutcome] = useState<UploadOutcome | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = filter === "all" ? "" : `?campaign_id=${encodeURIComponent(filter)}`;
      const res = await fetch(`/api/admin/cold-leads${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      const j = (await res.json()) as ColdLeadsResponse;
      setData(j);
      src.report("cold-leads", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      src.report("cold-leads", "fail");
    }
  }, [filter, src]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
  }, [load]);

  async function remove(row: ColdLead) {
    if (!window.confirm(`Delete cold lead ${row.email} · ${row.campaign_id}?`)) return;
    const qs = new URLSearchParams({ email: row.email, campaign_id: row.campaign_id });
    try {
      const res = await fetch(`/api/admin/cold-leads?${qs.toString()}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      }
      await load();
    } catch (e) {
      window.alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleCsv(file: File) {
    setUploading(true);
    setUploadOutcome(null);
    try {
      const raw = await file.text();
      const { header, rows } = parseCsv(raw);
      const parsed = rowsToObjects(header, rows);
      const outcome: UploadOutcome = { ok: 0, failed: 0, errors: [] };
      // POST each row sequentially so a broken row doesn't abort the rest
      // and the server never sees a bulk endpoint that could bypass the
      // idempotent-upsert path.
      for (let i = 0; i < parsed.length; i++) {
        const r = parsed[i];
        try {
          const res = await fetch("/api/admin/cold-leads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: r.email,
              handle: r.handle,
              campaign_id: r.campaign,
              preview_clip_url: r.preview_clip_url ?? null,
              platform: r.platform ?? null,
            }),
          });
          if (!res.ok) {
            outcome.failed += 1;
            outcome.errors.push({
              row: i + 2, // +2 = 1 for header + 1 for 1-indexed spreadsheets
              email: r.email,
              error: `${res.status} ${(await res.text()).slice(0, 100)}`,
            });
          } else {
            outcome.ok += 1;
          }
        } catch (e) {
          outcome.failed += 1;
          outcome.errors.push({
            row: i + 2,
            email: r.email,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      setUploadOutcome(outcome);
      await load();
    } finally {
      setUploading(false);
    }
  }

  const campaignOptions = useMemo(() => {
    const list = data?.campaigns ?? [];
    return ["all", ...list];
  }, [data]);

  const rows = data?.rows ?? null;
  const total = data?.total ?? 0;

  return (
    <section
      className="rounded-3xl border p-5 sm:p-6"
      style={{ borderColor: "var(--lc-stroke)", background: "color-mix(in srgb, var(--lc-bg-warm) 60%, transparent)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--lc-fg-faint)" }}>
            cold leads
            <InfoIcon hint="Rows staged by the Instantly webhook when a cold email is opened/clicked. Powers LoginScreen State B (personalized carousel + welcome-by-handle). See routes/cold_leads.py + routes/carousel.py." />
          </div>
          <p className="lc-body mt-1 text-[12px]" style={{ color: "var(--lc-fg-muted)" }}>
            {total.toLocaleString()} staged lead{total === 1 ? "" : "s"} · CSV bulk-upload uses the same idempotent upsert as POST /cold-leads/prep (composite key: email + campaign_id).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
        </div>
      </div>

      <div
        className="mt-4 flex flex-wrap items-end gap-4 rounded-2xl border p-4"
        style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg)" }}
      >
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--lc-fg-faint)" }}>
          <span>
            csv upload
            <InfoIcon hint='Expected header: "email,handle,campaign" (optional: preview_clip_url, platform). Each row is POSTed individually so broken rows do not abort the batch.' />
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleCsv(f);
              e.target.value = "";
            }}
            className="font-sans text-[12px] normal-case"
            style={{ color: "var(--lc-fg)" }}
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--lc-fg-faint)" }}>
          <span>
            filter by campaign
            <InfoIcon hint="Narrows rows to the selected campaign_id. 'all' shows every campaign." />
          </span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border px-2 py-1 font-sans text-[12px] normal-case tracking-normal"
            style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg-warm)", color: "var(--lc-fg)" }}
          >
            {campaignOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {uploading && (
          <span className="font-mono text-[11px]" style={{ color: "var(--lc-fg-muted)" }}>
            uploading…
          </span>
        )}
      </div>

      {uploadOutcome && (
        <div
          className="mt-3 rounded-2xl border p-3 font-mono text-[11px]"
          style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg)", color: "var(--lc-fg-muted)" }}
        >
          <div>
            csv upload: <span style={{ color: "var(--lc-ok)" }}>{uploadOutcome.ok} ok</span> ·{" "}
            <span style={{ color: uploadOutcome.failed > 0 ? "var(--lc-accent-mid)" : "var(--lc-fg-faint)" }}>
              {uploadOutcome.failed} failed
            </span>
          </div>
          {uploadOutcome.errors.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-y-auto">
              {uploadOutcome.errors.slice(0, 20).map((err, i) => (
                <li key={i} style={{ color: "var(--lc-accent-mid)" }}>
                  row {err.row} · {err.email} · {err.error}
                </li>
              ))}
              {uploadOutcome.errors.length > 20 && (
                <li style={{ color: "var(--lc-fg-faint)" }}>
                  …{uploadOutcome.errors.length - 20} more
                </li>
              )}
            </ul>
          )}
        </div>
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
          no cold leads staged{filter !== "all" ? ` for campaign ${filter}` : ""} yet
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b" style={{ borderColor: "var(--lc-stroke)", color: "var(--lc-fg-faint)" }}>
              <tr className="text-left">
                <th className="px-2 py-2">email</th>
                <th className="px-2 py-2">handle</th>
                <th className="px-2 py-2">campaign</th>
                <th className="px-2 py-2">platform</th>
                <th className="px-2 py-2">preview</th>
                <th className="px-2 py-2">last seen</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.email}::${row.campaign_id}`} className="border-b" style={{ borderColor: "color-mix(in srgb, var(--lc-stroke) 50%, transparent)" }}>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg)" }}>
                    {row.email}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg)" }}>
                    {row.handle}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-muted)" }}>
                    {row.campaign_id}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-muted)" }}>
                    {row.platform ?? "—"}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-faint)" }}>
                    {row.preview_clip_url ? (
                      <a href={row.preview_clip_url} target="_blank" rel="noreferrer" style={{ color: "var(--lc-accent-mid)" }}>
                        link
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2" style={{ color: "var(--lc-fg-faint)" }}>
                    {row.last_seen_at ? new Date(row.last_seen_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
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
