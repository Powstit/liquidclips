import type { Clip, Project } from "../../lib/sidecar";
import { InfoHint } from "../InfoHint";

// Heuristic "does this clip fit the bounty brief?" check. Deliberately cheap —
// no AI call. It reads the brief text the bounty shipped with and the clip's
// own metadata. Real scoring can come later; this is honest guidance now.

export type FitItem = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  hint: string;
  weight: number;
};

export type BountyFit = { items: FitItem[]; score: number };

function parseLengthRule(brief: string): { min?: number; max?: number } {
  const b = brief.toLowerCase();
  const rule: { min?: number; max?: number } = {};
  // Minutes → treat "2 min" as 120s for the max/min comparisons.
  const toSec = (n: number, unit: string) => (/m/.test(unit) ? n * 60 : n);
  const range = b.match(/(\d{1,3})\s*(?:-|to|–|—)\s*(\d{1,3})\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/);
  if (range) {
    rule.min = toSec(+range[1], range[3]);
    rule.max = toSec(+range[2], range[3]);
    return rule;
  }
  const re = /(under|below|less than|up to|max(?:imum)?|at most|no more than|over|above|at least|min(?:imum)?|more than)?\s*(\d{1,3})\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(b))) {
    const q = (m[1] || "").trim();
    const n = toSec(+m[2], m[3]);
    if (/under|below|less than|up to|max|at most|no more than/.test(q)) {
      rule.max = rule.max != null ? Math.min(rule.max, n) : n;
    } else if (/over|above|at least|min|more than/.test(q)) {
      rule.min = rule.min != null ? Math.max(rule.min, n) : n;
    }
  }
  return rule;
}

function requiredTokens(brief: string): string[] {
  const tokens = new Set<string>();
  for (const m of brief.matchAll(/[#@][a-z0-9_.]+/gi)) tokens.add(m[0].toLowerCase());
  if (/link in bio/i.test(brief)) tokens.add("link in bio");
  return [...tokens];
}

export function computeBountyFit(clip: Clip, project: Project): BountyFit | null {
  if (!project.whop_bounty_id) return null;
  const brief = project.whop_bounty_description || "";
  const platforms = project.whop_bounty_platforms || [];
  const items: FitItem[] = [];

  // 1) Length vs brief
  const dur = Math.max(0, (clip.end ?? 0) - (clip.start ?? 0));
  const rule = parseLengthRule(brief);
  let lengthOk = true;
  let lengthDetail = `${Math.round(dur)}s clip`;
  if (rule.min != null || rule.max != null) {
    lengthOk = (rule.min == null || dur >= rule.min) && (rule.max == null || dur <= rule.max);
    const range =
      rule.min != null && rule.max != null
        ? `${rule.min}–${rule.max}s`
        : rule.max != null
        ? `≤${rule.max}s`
        : `≥${rule.min}s`;
    lengthDetail = `${Math.round(dur)}s · brief wants ${range}`;
  } else {
    lengthDetail = `${Math.round(dur)}s · no length rule in brief`;
  }
  items.push({
    key: "length",
    label: "Length matches brief",
    ok: lengthOk,
    detail: lengthDetail,
    hint: "Junior read a duration rule out of the brief and compared this clip's length. No rule found = nothing to fail.",
    weight: 30,
  });

  // 2) Allowed platform
  items.push({
    key: "platform",
    label: "Allowed platform",
    ok: platforms.length > 0,
    detail: platforms.length > 0 ? platforms.join(" · ") : "no platform restriction",
    hint: "Only clips posted to the reward's allowed platforms count. Post elsewhere and the submission won't be eligible.",
    weight: 20,
  });

  // 3) Subtitles present
  const hasSubs = !!(clip.srt_path || clip.vtt_path || clip.captions_burned);
  items.push({
    key: "subtitles",
    label: "Subtitles present",
    ok: hasSubs,
    detail: hasSubs ? "captions ready" : "no captions yet",
    hint: "Most Content Rewards clips perform far better — and some briefs require — burned-in or attached captions.",
    weight: 25,
  });

  // 4) CTA / rule keywords
  const tokens = requiredTokens(brief);
  const clipText = [clip.title, clip.description, clip.hook_text, clip.pinned_comment]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let kwOk = true;
  let kwDetail = "no required keywords in brief";
  if (tokens.length > 0) {
    const hit = tokens.filter((t) => clipText.includes(t));
    kwOk = hit.length > 0;
    kwDetail = kwOk ? `found ${hit.join(", ")}` : `brief asks for ${tokens.join(", ")}`;
  }
  items.push({
    key: "keywords",
    label: "CTA / rule keywords",
    ok: kwOk,
    detail: kwDetail,
    hint: "Junior scans the brief for required hashtags, @mentions or 'link in bio' and checks your clip's caption uses them.",
    weight: 25,
  });

  const score = Math.round(items.reduce((sum, it) => sum + (it.ok ? it.weight : 0), 0));
  return { items, score };
}

function scoreTone(score: number): string {
  if (score >= 80) return "text-fuchsia-deep border-fuchsia-soft bg-fuchsia-soft/40";
  if (score >= 55) return "text-[#7A5400] border-[#EAB308]/40 bg-[#EAB308]/10";
  return "text-[#9B1C1C] border-[#DC2626]/30 bg-[#DC2626]/5";
}

// Compact pill for the clip grid.
export function BountyFitPill({ clip, project }: { clip: Clip; project: Project }) {
  const fit = computeBountyFit(clip, project);
  if (!fit) return null;
  return (
    <span
      title={`Reward fit ${fit.score}/100`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] backdrop-blur-sm ${scoreTone(fit.score)}`}
    >
      fit {fit.score}
    </span>
  );
}

// Full checklist for the clip editor / preview.
export function BountyFitChecklist({ clip, project }: { clip: Clip; project: Project }) {
  const fit = computeBountyFit(clip, project);
  if (!fit) return null;
  return (
    <div className="rounded-2xl border border-line bg-paper-warm/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          reward fit
          <InfoHint text="A quick heuristic check against the reward's brief. Guidance, not a guarantee — the brand makes the final call on Whop." />
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] ${scoreTone(fit.score)}`}>
          {fit.score}/100
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {fit.items.map((it) => (
          <li key={it.key} className="flex items-start gap-2">
            <span
              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                it.ok ? "bg-fuchsia text-paper" : "border border-[#DC2626]/50 text-[#DC2626]"
              }`}
              aria-hidden
            >
              {it.ok ? "✓" : "!"}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-sans text-[13px] text-ink">
                {it.label}
                <InfoHint text={it.hint} />
              </div>
              <div className="font-mono text-[11px] text-text-tertiary">{it.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
