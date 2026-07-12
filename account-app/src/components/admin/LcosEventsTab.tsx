/**
 * LcosEventsTab · RC1 Train B3 (2026-07-12).
 *
 * Read-only HQ view of the persisted `lcos_event` table. Powered by:
 *   GET /api/hq/lcos-events/topics  → dropdown with topic + count
 *   GET /api/hq/lcos-events         → paginated event list
 *
 * The backend endpoints are `require_admin`-gated. This tab is
 * behavioural-only — no mutations, no destructive controls. It is the
 * HQ face of the BC-005 class-elimination: instead of grep-scraping
 * Railway stdout, HQ can filter by topic + session + time range.
 *
 * Empty-state honest: if the persisted store has zero rows (because
 * the Cohort-0 desktop bundle has not yet flushed to `/lcos/events/
 * ingest`), the tab surfaces that state rather than fabricating data.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface LcosEvent {
  id: number;
  topic: string;
  payload: Record<string, unknown>;
  ts_ms: number;
  source_sha: string | null;
  session_id: string | null;
  created_at: string;
}

interface EventsListResponse {
  events: LcosEvent[];
  total: number;
  limit: number;
  offset: number;
}

interface TopicSummary {
  topic: string;
  count: number;
  last_seen_ts_ms: number;
  last_seen_at: string;
}

interface TopicsResponse {
  topics: TopicSummary[];
  total_events: number;
}

const PAGE_SIZE = 100;

export function LcosEventsTab(): React.ReactElement {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [sessionFilter, setSessionFilter] = useState<string>("");
  const [events, setEvents] = useState<LcosEvent[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadTopics = useCallback(async () => {
    try {
      const r = await fetch("/api/hq/lcos-events/topics", { cache: "no-store" });
      if (!r.ok) throw new Error(`topics ${r.status}`);
      const data = (await r.json()) as TopicsResponse;
      setTopics(data.topics ?? []);
      setTotalEvents(data.total_events ?? 0);
    } catch (e) {
      // Topics failure isn't fatal — the event list can still render
      // with a free-text topic filter. Surface a subtle warning only.
      // Keep the events list load path independent so the tab
      // degrades gracefully on partial backend outages.
      // eslint-disable-next-line no-console
      console.warn("LcosEventsTab · topics load failed", e);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", "0");
      if (topicFilter) params.set("topic", topicFilter);
      if (sessionFilter) params.set("session_id", sessionFilter);
      const r = await fetch(`/api/hq/lcos-events?${params.toString()}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`events ${r.status}`);
      const data = (await r.json()) as EventsListResponse;
      setEvents(data.events ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [topicFilter, sessionFilter]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const topicOptions = useMemo(() => {
    const opts = topics.map((t) => ({
      value: t.topic,
      label: `${t.topic} · ${t.count.toLocaleString()}`,
    }));
    opts.unshift({ value: "", label: `(all topics · ${totalEvents.toLocaleString()})` });
    return opts;
  }, [topics, totalEvents]);

  return (
    <section style={{ padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>LCOS Events</h2>
        <p style={{ margin: "4px 0 0", color: "#a0a0a0", fontSize: 13 }}>
          Persisted golden-path telemetry from <code>lcDiag</code>. Read-only ·
          dedup by (topic, ts_ms, payload_hash) at ingest.
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", color: "#8a8a8a" }}>
            Topic
          </span>
          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            style={{
              padding: "8px 10px",
              background: "#0a0a10",
              color: "#fff",
              border: "1px solid #24242e",
              borderRadius: 8,
              minWidth: 260,
            }}
          >
            {topicOptions.map((o) => (
              <option key={o.value || "_all_"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", color: "#8a8a8a" }}>
            Session ID
          </span>
          <input
            type="text"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value.slice(0, 80))}
            placeholder="s_1720000000000_ab12cd"
            style={{
              padding: "8px 10px",
              background: "#0a0a10",
              color: "#fff",
              border: "1px solid #24242e",
              borderRadius: 8,
              minWidth: 260,
            }}
          />
        </label>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              void loadEvents();
              void loadTopics();
            }}
            disabled={loading}
            style={{
              padding: "8px 16px",
              background: loading ? "#333" : "#ff1a8c",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <p
          style={{
            color: "#ff6b6b",
            padding: 10,
            background: "#331111",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          Load failed · {error}
        </p>
      )}

      <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>
        Showing {events.length.toLocaleString()} of {total.toLocaleString()} matched
        events {topicFilter ? `· topic="${topicFilter}"` : ""}
        {sessionFilter ? ` · session="${sessionFilter}"` : ""}
      </div>

      {!loading && !error && events.length === 0 && (
        <div
          style={{
            padding: 20,
            background: "#161620",
            border: "1px dashed #24242e",
            borderRadius: 12,
            color: "#a0a0a0",
            fontSize: 13,
          }}
        >
          No LCOS events persisted yet for these filters. Once the Cohort-0
          desktop bundle flushes to <code>/lcos/events/ingest</code>, rows
          will appear here grouped by topic.
        </div>
      )}

      {events.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "80px 200px 160px 160px 1fr",
            gap: 0,
            border: "1px solid #24242e",
            borderRadius: 12,
            overflow: "hidden",
            fontSize: 12,
          }}
        >
          <HeaderCell>ID</HeaderCell>
          <HeaderCell>Topic</HeaderCell>
          <HeaderCell>Session</HeaderCell>
          <HeaderCell>Timestamp</HeaderCell>
          <HeaderCell>Payload</HeaderCell>
          {events.map((ev) => (
            <EventRow key={ev.id} ev={ev} />
          ))}
        </div>
      )}
    </section>
  );
}

function HeaderCell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "#161620",
        borderBottom: "1px solid #24242e",
        fontWeight: 700,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "#8a8a8a",
      }}
    >
      {children}
    </div>
  );
}

function EventRow({ ev }: { ev: LcosEvent }): React.ReactElement {
  const iso = ev.created_at || new Date(ev.ts_ms).toISOString();
  const pretty = JSON.stringify(ev.payload, null, 2);
  return (
    <>
      <RowCell mono>{ev.id}</RowCell>
      <RowCell>{ev.topic}</RowCell>
      <RowCell mono truncate>
        {ev.session_id || "—"}
      </RowCell>
      <RowCell mono>{iso}</RowCell>
      <RowCell>
        <pre
          style={{
            margin: 0,
            padding: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "#cfcfd6",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {pretty}
        </pre>
      </RowCell>
    </>
  );
}

function RowCell({
  children,
  mono,
  truncate,
}: {
  children: React.ReactNode;
  mono?: boolean;
  truncate?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid #1a1a24",
        background: "#0d0d14",
        fontFamily: mono
          ? "ui-monospace, SFMono-Regular, Menlo, monospace"
          : undefined,
        fontSize: 12,
        color: "#e0e0e6",
        overflow: truncate ? "hidden" : "visible",
        textOverflow: truncate ? "ellipsis" : "clip",
        whiteSpace: truncate ? "nowrap" : "normal",
      }}
    >
      {children}
    </div>
  );
}
