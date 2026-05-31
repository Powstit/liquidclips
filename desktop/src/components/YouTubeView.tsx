import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sidecar, type Project, type ScoredTitle, type YouTubeExtras } from "../lib/sidecar";
import { InfoTip } from "./InfoTip";
import { PlatformIcon } from "./PlatformIcon";
import { humanError } from "../lib/sidecar";

// YouTube long-form upload prep. Built to beat TubeBuddy / VidIQ / 1of10 on
// the things that actually move CTR: scored title variants with reasoning,
// hashtags + tags as chips, character counters against YouTube's hard caps,
// pinned-comment text, end-screen CTAs, and a single "Copy in Studio order"
// button that bundles everything in the order YT Studio asks for it.

// YouTube hard limits (2026):
const YT_TITLE_MAX = 100;
const YT_DESC_MAX = 5000;
const YT_TAGS_MAX_TOTAL = 500; // total chars of all tags combined
const YT_HASHTAGS_MAX = 15;

export function YouTubeView({ project }: { project: Project }) {
  const [data, setData] = useState<YouTubeExtras | null>(null);
  const [savedData, setSavedData] = useState<YouTubeExtras | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [copyState, setCopyState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sidecar
      .getYoutubeExtras(project.slug)
      .then((res) => {
        if (cancelled) return;
        setData(res.youtube);
        setSavedData(res.youtube);
      })
      .catch((e) => !cancelled && setError(humanError(e)));
    return () => {
      cancelled = true;
    };
  }, [project.slug]);

  const isDirty = useMemo(
    () => !!data && !!savedData && JSON.stringify(data) !== JSON.stringify(savedData),
    [data, savedData],
  );

  async function save() {
    if (!data) return;
    setSaveState("saving");
    try {
      const r = await sidecar.updateYoutubeExtras(project.slug, data);
      setData(r.youtube);
      setSavedData(r.youtube);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setError(humanError(e));
      setSaveState("idle");
    }
  }

  async function copyBundle() {
    if (!data) return;
    const title = data.scored_titles[data.selected_title_idx]?.text ?? "";
    const desc = composeDescription(data);
    const tags = data.tags.join(", ");
    const pinned = data.pinned_video_comment || "";
    const bundle =
      `─── TITLE (paste into YouTube Studio → Title) ───\n${title}\n\n` +
      `─── DESCRIPTION (paste into Description) ───\n${desc}\n\n` +
      `─── TAGS (Studio → Show more → Tags) ───\n${tags}\n\n` +
      (pinned ? `─── PINNED COMMENT (paste under your video after publish) ───\n${pinned}\n\n` : "") +
      `─── END SCREEN IDEAS ───\n${data.end_screen_ctas.map((c) => `· ${c.cue} → ${c.payoff}`).join("\n")}\n`;
    try {
      await writeText(bundle);
      setCopyState("bundle");
      window.setTimeout(() => setCopyState((c) => (c === "bundle" ? null : c)), 1800);
    } catch (e) {
      console.warn("copy failed", e);
    }
  }

  async function copyField(kind: string, text: string) {
    try {
      await writeText(text);
      setCopyState(kind);
      window.setTimeout(() => setCopyState((c) => (c === kind ? null : c)), 1800);
    } catch (e) {
      console.warn("copy failed", e);
    }
  }

  if (error) return <p className="font-mono text-[12px] text-[#DC2626]">{error}</p>;
  if (!data) {
    return (
      <p className="font-mono text-[12px] text-text-tertiary">
        Loading<span className="blink">_</span>
      </p>
    );
  }

  const selectedTitle = data.scored_titles[data.selected_title_idx]?.text ?? "";
  const posterPath = (project.stages.ingest?.output as { poster_path?: string } | undefined)?.poster_path;
  const posterSrc = posterPath ? convertFileSrc(posterPath) : null;
  const descLength = composeDescription(data).length;
  const tagsLength = data.tags.join(", ").length;

  return (
    <div className="space-y-5">
      {/* Header: poster + intent eyebrow + "Copy in Studio order" + Save */}
      <div className="flex flex-wrap items-stretch gap-4 rounded-2xl border border-line bg-gradient-to-r from-paper-warm/60 via-paper to-paper-warm/40 p-4 shadow-[0_2px_12px_rgba(15,15,18,0.04)]">
        {posterSrc && (
          <div className="aspect-video h-[88px] shrink-0 overflow-hidden rounded-xl border border-line bg-paper-warm">
            <img src={posterSrc} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="flex flex-1 flex-col justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-paper">
              <PlatformIcon id="youtube" className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              for YouTube long-form
            </span>
          </div>
          <h3 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.015em] text-ink line-clamp-2">
            {selectedTitle || "Pick a title below"}
          </h3>
        </div>
        <div className="flex flex-col items-end justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            {saveState === "saving"
              ? "saving…"
              : saveState === "saved"
              ? "saved"
              : isDirty
              ? "unsaved changes"
              : "saved"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void copyBundle()}
              className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[12px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia"
            >
              {copyState === "bundle" ? "Copied ✓" : "Copy in Studio order"}
            </button>
            <button
              onClick={() => void save()}
              disabled={!isDirty || saveState === "saving"}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_8px_24px_rgba(255,26,140,0.25)] disabled:opacity-40"
            >
              {saveState === "saved" ? "Saved ✓" : saveState === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <ScoredTitlesCard
        titles={data.scored_titles}
        selectedIdx={data.selected_title_idx}
        onPick={(idx) =>
          setData((d) => (d ? { ...d, selected_title_idx: idx } : d))
        }
        onEdit={(idx, next) =>
          setData((d) => {
            if (!d) return d;
            const titles = [...d.scored_titles];
            titles[idx] = { ...titles[idx], text: next.slice(0, YT_TITLE_MAX) };
            return { ...d, scored_titles: titles };
          })
        }
      />

      <DescriptionCard
        value={data.description}
        composedLength={descLength}
        onChange={(next) =>
          setData((d) => (d ? { ...d, description: next.slice(0, YT_DESC_MAX) } : d))
        }
        onCopy={() => void copyField("desc", composeDescription(data))}
        copied={copyState === "desc"}
      />

      <ChaptersCard
        chapters={data.chapters}
        onChange={(next) => setData((d) => (d ? { ...d, chapters: next } : d))}
      />

      <TwoUp>
        <ChipsCard
          label="Hashtags"
          hint="3-5 single words. They go at the end of the description (NOT the title). YouTube ignores all hashtags if you use more than 15."
          values={data.hashtags}
          renderValue={(v) => `#${v}`}
          max={YT_HASHTAGS_MAX}
          placeholder="add a hashtag"
          onAdd={(v) =>
            setData((d) => {
              if (!d) return d;
              const clean = v.replace(/[^a-zA-Z0-9]/g, "").slice(0, 30);
              if (!clean || d.hashtags.includes(clean)) return d;
              return { ...d, hashtags: [...d.hashtags, clean].slice(0, YT_HASHTAGS_MAX) };
            })
          }
          onRemove={(i) =>
            setData((d) => (d ? { ...d, hashtags: d.hashtags.filter((_, idx) => idx !== i) } : d))
          }
        />
        <ChipsCard
          label="Tags"
          hint="SEO tags — Studio → Show more → Tags. Total length across all tags must stay under 500 chars."
          values={data.tags}
          max={30}
          counter={`${tagsLength}/${YT_TAGS_MAX_TOTAL}`}
          placeholder="add a tag"
          onAdd={(v) =>
            setData((d) => {
              if (!d) return d;
              const clean = v.trim().toLowerCase();
              if (!clean || d.tags.includes(clean)) return d;
              if ([...d.tags, clean].join(", ").length > YT_TAGS_MAX_TOTAL) return d;
              return { ...d, tags: [...d.tags, clean] };
            })
          }
          onRemove={(i) =>
            setData((d) => (d ? { ...d, tags: d.tags.filter((_, idx) => idx !== i) } : d))
          }
        />
      </TwoUp>

      <TwoUp>
        <PinnedCommentCard
          value={data.pinned_video_comment}
          onChange={(next) =>
            setData((d) => (d ? { ...d, pinned_video_comment: next.slice(0, 400) } : d))
          }
        />
        <EndScreenCard
          ctas={data.end_screen_ctas}
          onChange={(next) => setData((d) => (d ? { ...d, end_screen_ctas: next } : d))}
        />
      </TwoUp>
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────

function ScoredTitlesCard({
  titles,
  selectedIdx,
  onPick,
  onEdit,
}: {
  titles: ScoredTitle[];
  selectedIdx: number;
  onPick: (idx: number) => void;
  onEdit: (idx: number, next: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 transition-colors hover:border-fuchsia/40">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          Title variants · ranked
        </span>
        <InfoTip text="Each title is scored 0–100 for click-through potential. Tap one to make it the selected title; tap the text to edit. YouTube's hard cap is 100 characters." />
      </div>

      <ul className="mt-3 space-y-2">
        {titles.map((t, i) => {
          const selected = i === selectedIdx;
          return (
            <li
              key={i}
              className={`group rounded-xl border p-3 transition-all ${
                selected
                  ? "border-fuchsia bg-fuchsia-soft/20 shadow-[0_6px_20px_rgba(255,26,140,0.12)]"
                  : "border-line bg-paper hover:border-fuchsia/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => onPick(i)}
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold transition-colors ${
                    selected
                      ? "bg-fuchsia text-white"
                      : "bg-paper-warm/60 text-ink hover:bg-fuchsia/20 hover:text-fuchsia-deep"
                  }`}
                  title={`CTR score ${t.score}/100`}
                  aria-label={`Select title ${i + 1}`}
                >
                  {t.score}
                </button>
                <div className="flex-1">
                  <input
                    type="text"
                    value={t.text}
                    onChange={(e) => onEdit(i, e.target.value)}
                    className={`w-full bg-transparent font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] focus:outline-none ${
                      selected ? "text-ink" : "text-text-secondary group-hover:text-ink"
                    }`}
                    maxLength={YT_TITLE_MAX}
                  />
                  <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                    <span className="truncate normal-case tracking-normal">{t.reason}</span>
                    <span className={t.text.length > YT_TITLE_MAX - 10 ? "text-fuchsia-deep" : ""}>
                      {t.text.length}/{YT_TITLE_MAX}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DescriptionCard({
  value,
  composedLength,
  onChange,
  onCopy,
  copied,
}: {
  value: string;
  composedLength: number;
  onChange: (next: string) => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const near = composedLength > YT_DESC_MAX - 200;
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 transition-colors focus-within:border-fuchsia hover:border-fuchsia/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            Description
          </span>
          <InfoTip text="Open with the hook in the first sentence — that's what shows above the 'Show more' fold. 200-500 words is the sweet spot for SEO. Chapters and hashtags get appended automatically when you copy." />
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] tracking-[0.08em] ${near ? "text-fuchsia-deep" : "text-text-tertiary"}`}>
            {composedLength}/{YT_DESC_MAX}
          </span>
          <button
            onClick={onCopy}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            {copied ? "copied" : "copy assembled"}
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(6, Math.min(14, value.split("\n").length + 2))}
        className="mt-3 w-full resize-y rounded-lg border border-transparent bg-transparent font-sans text-[14px] leading-relaxed text-ink focus:outline-none"
        placeholder="Open with the hook. Add 2-4 paragraphs of context. End with a CTA."
      />
    </section>
  );
}

function ChaptersCard({
  chapters,
  onChange,
}: {
  chapters: { start: number; title: string }[];
  onChange: (next: { start: number; title: string }[]) => void;
}) {
  function update(i: number, field: "start" | "title", v: number | string) {
    const next = [...chapters];
    next[i] = { ...next[i], [field]: v };
    onChange(next);
  }
  function remove(i: number) {
    onChange(chapters.filter((_, idx) => idx !== i));
  }
  function add() {
    const last = chapters[chapters.length - 1];
    onChange([...chapters, { start: last ? last.start + 60 : 0, title: "New chapter" }]);
  }

  return (
    <section className="rounded-2xl border border-line bg-paper p-5 transition-colors hover:border-fuchsia/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            Chapters
          </span>
          <InfoTip text="At least 3 chapters of 10+ seconds each, first one at 00:00, in ascending order — YouTube enforces all four or the chapter player doesn't appear." />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {chapters.map((c, i) => (
          <li
            key={i}
            className="grid grid-cols-[80px_1fr_auto] gap-2 rounded-lg border border-transparent bg-paper-warm/30 px-3 py-2 transition-colors hover:border-line"
          >
            <input
              type="text"
              value={formatHms(c.start)}
              onChange={(e) => update(i, "start", parseHms(e.target.value))}
              className="bg-transparent font-mono text-[12px] text-text-secondary focus:outline-none"
            />
            <input
              type="text"
              value={c.title}
              onChange={(e) => update(i, "title", e.target.value.slice(0, 80))}
              className="bg-transparent font-sans text-[14px] text-ink focus:outline-none"
            />
            <button
              onClick={() => remove(i)}
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-[#DC2626]"
            >
              remove
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={add}
        className="mt-3 rounded-full border border-dashed border-line bg-paper-warm/30 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
      >
        + Add chapter
      </button>
    </section>
  );
}

function ChipsCard({
  label,
  hint,
  values,
  renderValue,
  max,
  counter,
  placeholder,
  onAdd,
  onRemove,
}: {
  label: string;
  hint: string;
  values: string[];
  renderValue?: (v: string) => string;
  max: number;
  counter?: string;
  placeholder: string;
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-paper p-5 transition-colors hover:border-fuchsia/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">{label}</span>
          <InfoTip text={hint} />
        </div>
        <span className="font-mono text-[10px] tracking-[0.08em] text-text-tertiary">
          {counter ?? `${values.length}/${max}`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <button
            key={`${v}-${i}`}
            onClick={() => onRemove(i)}
            className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-sans text-[12px] text-ink hover:border-fuchsia hover:bg-fuchsia-soft/40"
            title="Remove"
          >
            <span>{renderValue ? renderValue(v) : v}</span>
            <span className="font-mono text-[11px] text-text-tertiary group-hover:text-fuchsia-deep">×</span>
          </button>
        ))}
        {values.length < max && (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (draft.trim()) {
                  onAdd(draft.trim());
                  setDraft("");
                }
              } else if (e.key === "Backspace" && !draft && values.length > 0) {
                onRemove(values.length - 1);
              }
            }}
            placeholder={placeholder}
            className="min-w-[120px] flex-1 bg-transparent font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:outline-none"
          />
        )}
      </div>
    </section>
  );
}

function PinnedCommentCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 transition-colors focus-within:border-fuchsia hover:border-fuchsia/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            Pinned comment
          </span>
          <InfoTip text="After you publish, drop this as the first comment and pin it. YouTube ranks pinned comments and they're a top engagement signal in the first 60 minutes." />
        </div>
        <span className="font-mono text-[10px] tracking-[0.08em] text-text-tertiary">
          {value.length}/400
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-3 w-full resize-y bg-transparent font-sans text-[14px] leading-relaxed text-ink focus:outline-none"
        placeholder="One specific question. The whole comment section answers it."
      />
    </section>
  );
}

function EndScreenCard({
  ctas,
  onChange,
}: {
  ctas: { cue: string; payoff: string }[];
  onChange: (next: { cue: string; payoff: string }[]) => void;
}) {
  function update(i: number, field: "cue" | "payoff", v: string) {
    const next = [...ctas];
    next[i] = { ...next[i], [field]: v.slice(0, field === "cue" ? 80 : 120) };
    onChange(next);
  }
  function add() {
    onChange([...ctas, { cue: "", payoff: "" }]);
  }
  function remove(i: number) {
    onChange(ctas.filter((_, idx) => idx !== i));
  }
  return (
    <section className="rounded-2xl border border-line bg-paper p-5 transition-colors hover:border-fuchsia/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            End screen
          </span>
          <InfoTip text="Last 15–20 seconds. Tell viewers what to do next — subscribe, watch a specific video, click a card. Each cue is what you say; payoff is what the viewer gets." />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          {ctas.length}/3
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {ctas.map((c, i) => (
          <li key={i} className="rounded-lg border border-line bg-paper-warm/30 p-3">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              <span>cue · payoff</span>
              <button
                onClick={() => remove(i)}
                className="hover:text-[#DC2626]"
              >
                remove
              </button>
            </div>
            <input
              type="text"
              value={c.cue}
              onChange={(e) => update(i, "cue", e.target.value)}
              placeholder="What to say"
              className="mt-2 w-full bg-transparent font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:outline-none"
            />
            <input
              type="text"
              value={c.payoff}
              onChange={(e) => update(i, "payoff", e.target.value)}
              placeholder="What the viewer gets if they follow it"
              className="mt-1 w-full bg-transparent font-sans text-[12px] text-text-secondary placeholder:text-text-tertiary focus:outline-none"
            />
          </li>
        ))}
      </ul>
      {ctas.length < 3 && (
        <button
          onClick={add}
          className="mt-3 rounded-full border border-dashed border-line bg-paper-warm/30 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
        >
          + Add CTA
        </button>
      )}
    </section>
  );
}

function TwoUp({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{children}</div>;
}

// ── helpers ─────────────────────────────────────────────────────────────

function composeDescription(d: YouTubeExtras): string {
  const parts: string[] = [d.description.trim()];
  if (d.chapters.length > 0) {
    parts.push("Chapters");
    parts.push(d.chapters.map((c) => `${formatHms(c.start)} ${c.title}`).join("\n"));
  }
  if (d.hashtags.length > 0) {
    parts.push(d.hashtags.map((h) => `#${h}`).join(" "));
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

function formatHms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = m.toString().padStart(2, "0");
  const sss = ss.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${sss}` : `${m}:${sss}`;
}

function parseHms(input: string): number {
  const s = input.trim();
  if (!s) return 0;
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
