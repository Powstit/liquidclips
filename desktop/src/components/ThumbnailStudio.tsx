// v0.7.31 — Thumbnail Studio. Two-tab surface (Cover Pack + AI Generate).
// AI Generate is Agency-gated; lower tiers see an upsell pane. The AI flow
// is engine-backed by python-sidecar/thumbnail_engine.py (the gennext.js
// formula port) — identity from face crops, brand preset persisted, EMO+PAT
// rotation handled engine-side via item.order.
//
// See docs/thumbnail-journey.md for the 6-beat user journey, lens-clean.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, Palette, Sparkles } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  sidecar,
  humanError,
  type Clip,
  type ThumbnailBrandPreset,
  type ThumbnailItem,
} from "../lib/sidecar";

export type ThumbnailStudioProps = {
  open: boolean;
  onClose: () => void;
  /** Empty string means no project context — wizards still work (Brand +
   *  Identity are per-user); Cover Pack + Generate are gated. */
  slug: string;
  projectName: string;
  /** Auto-bumped to "agency" for admin users at boot — no separate isAdmin
   *  needed (see App.tsx:506-512 admin override). */
  userTier: "free" | "solo" | "pro" | "agency" | null;
  clips: Clip[];
  onOpenSettings?: () => void;
  onCoverChanged?: (coverPath: string) => void;
};

type View = "cover_pack" | "ai_generate";
type WizardStep = null | "brand" | "identity";

const ACCENTS: { key: string; label: string; swatch: string }[] = [
  { key: "orange", label: "Orange", swatch: "#FF8A1F" },
  { key: "blue", label: "Blue", swatch: "#3F8DFF" },
  { key: "red", label: "Red", swatch: "#FF3D4A" },
  { key: "green", label: "Green", swatch: "#3FCB6E" },
  { key: "purple_violet", label: "Purple", swatch: "#9A5BFF" },
  { key: "yellow_gold", label: "Gold", swatch: "#FFD23F" },
  { key: "teal_cyan", label: "Teal", swatch: "#3FE0D6" },
  { key: "pink_magenta", label: "Pink", swatch: "#FF1A8C" },
];

const QUALITIES = [
  { key: "low", label: "Low", cost: "$0.05" },
  { key: "medium", label: "Medium", cost: "$0.07" },
  { key: "high", label: "High", cost: "$0.20" },
] as const;

const STYLE_MOODS = [
  "cinematic",
  "playful",
  "luxury",
  "editorial",
  "brutalist",
] as const;

type GenStatus =
  | { kind: "idle" }
  | { kind: "pending"; startedAt: number }
  | { kind: "error"; message: string }
  | { kind: "billing"; message: string };

export function ThumbnailStudio({
  open,
  onClose,
  slug,
  projectName,
  userTier,
  clips,
  onOpenSettings,
  onCoverChanged,
}: ThumbnailStudioProps) {
  const aiUnlocked = userTier !== "free";

  const [view, setView] = useState<View>("cover_pack");
  const [wizard, setWizard] = useState<WizardStep>(null);

  const [brand, setBrand] = useState<ThumbnailBrandPreset | null>(null);
  const [identityCount, setIdentityCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<
    {
      path: string;
      name: string;
      modified_at: string;
      cost_usd: number | null;
      model: string | null;
    }[]
  >([]);
  const [cover, setCover] = useState<string | null>(null);
  const [ledgerTotal, setLedgerTotal] = useState(0);

  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<GenStatus>({ kind: "idle" });
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const [form, setForm] = useState<ThumbnailItem>({
    text: "",
    metaphor: "",
    accent: "blue",
    quality: "medium",
  });

  // v0.7.31 P0-4 / P1-5 — remember the last Generate payload so the network/
  // timeout error strip can offer a one-click Retry without forcing the user
  // to retype the title + metaphor.
  const [lastGenerateItem, setLastGenerateItem] = useState<ThumbnailItem | null>(null);

  const refreshGallery = useCallback(async () => {
    try {
      const { thumbnails: list } = await sidecar.thumbnailList(slug);
      setThumbnails(list);
    } catch (e) {
      // Empty gallery is a valid state, don't show error
      setThumbnails([]);
    }
  }, [slug]);

  const hasProject = slug.trim().length > 0;

  // Hydrate on open. Brand + identity + ledger are per-user (no slug needed).
  // Cover + gallery only make sense within a project context.
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    let cancelled = false;
    (async () => {
      try {
        const [b, id, led] = await Promise.all([
          sidecar.thumbnailGetBrand(),
          sidecar.thumbnailGetIdentity(),
          sidecar.thumbnailLedger(),
        ]);
        if (cancelled) return;
        setBrand(b.preset || {});
        setIdentityCount(id.count);
        setLedgerTotal(led.total_usd);
        if (hasProject) {
          const cov = await sidecar.thumbnailGetCover(slug);
          if (cancelled) return;
          setCover(cov.cover_path);
          await refreshGallery();
        }
        setLoaded(true);
      } catch (e) {
        if (!cancelled) {
          setStatus({ kind: "error", message: humanError(e) });
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slug, hasProject, refreshGallery]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (zoom) setZoom(null);
        else if (wizard) setWizard(null);
        else if (previewPrompt) setPreviewPrompt(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, wizard, previewPrompt, zoom]);

  // Cover Pack — flatten every per-clip thumbnail into a contact sheet. Each
  // clip's `thumbnails[]` is a ranked list (Fix #2b appends imported-clip cover
  // frames here too). User picks any candidate; the choice writes to the
  // project's cover_choice.json via thumbnail_use_as_cover RPC.
  const coverPackFrames = useMemo(() => {
    const out: { clipIdx: number; clipTitle: string; rank: number; path: string }[] = [];
    clips.forEach((c, i) => {
      const frames = c.thumbnails || [];
      frames.forEach((t) => {
        if (t.path) out.push({
          clipIdx: i,
          clipTitle: c.title || `Clip ${i + 1}`,
          rank: t.rank ?? 0,
          path: t.path,
        });
      });
    });
    return out;
  }, [clips]);

  if (!open) return null;

  // First-run gate for AI tab: identity + brand required.
  const needsSetup = aiUnlocked && view === "ai_generate" && loaded &&
    (identityCount < 3 || !brand?.brand);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        // v0.7.50 — Brand-kit modal pass. border-ink/10 (#000 at 10%)
        // retired for border-line (canonical #fff at 7%) so the modal
        // chrome reads as the same family as ConfirmDialog / AddChannel /
        // every other brand-correct modal.
        className="relative w-full max-w-6xl max-h-[88vh] overflow-hidden rounded-3xl border border-line bg-paper shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Header
          projectName={projectName}
          ledgerTotal={ledgerTotal}
          view={view}
          aiUnlocked={aiUnlocked}
          onView={setView}
          onClose={onClose}
        />

        {/* v0.7.31 P2-16 — Hero (Beat 2). First-run-only marquee + 3-step
            preview before the SetupGate. Collapses to nothing after the user
            has either set up brand or generated at least once. */}
        {view === "ai_generate" &&
          aiUnlocked &&
          loaded &&
          !wizard &&
          identityCount < 3 &&
          !brand?.brand && (
            <ThumbnailHero
              onStart={() => {
                /* SetupGate appears immediately below; the hero is a "prove
                   it works before asking for inputs" surface, not a separate
                   route. We just scroll the user into the gate. */
              }}
              onSkip={() => setView("cover_pack")}
            />
          )}

        {/* Status strip — v0.7.31 P2-15 adds Retry for the network-error
            case. lastGenerateItem is populated whenever a Generate was
            attempted, so Retry just re-issues the same payload (title +
            metaphor + accent + quality preserved). */}
        {status.kind === "error" && (
          <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-900 flex items-center justify-between">
            <span className="font-medium">{status.message}</span>
            <div className="flex items-center gap-2">
              {lastGenerateItem && hasProject && (
                <button
                  onClick={() => {
                    const item = lastGenerateItem;
                    setStatus({ kind: "pending", startedAt: Date.now() });
                    void (async () => {
                      try {
                        const result = await sidecar.thumbnailGenerate(slug, item);
                        setStatus({ kind: "idle" });
                        setLedgerTotal((prev) => prev + (result.cost_usd || 0));
                        await refreshGallery();
                      } catch (e) {
                        await refreshGallery();
                        const code = (e as { code?: string }).code;
                        const msg = humanError(e);
                        if (code === "billing_hard_limit" || /billing[_ ]hard[_ ]limit/i.test(msg)) {
                          setStatus({ kind: "billing", message: msg });
                        } else if (code === "canceled" || /cancell?ed/i.test(msg)) {
                          setStatus({ kind: "idle" });
                        } else {
                          setStatus({ kind: "error", message: msg });
                        }
                      }
                    })();
                  }}
                  className="px-3 py-0.5 rounded text-xs bg-red-900 text-ink hover:bg-red-800"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => setStatus({ kind: "idle" })}
                className="px-2 py-0.5 rounded text-xs hover:bg-red-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {status.kind === "billing" && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 flex items-center justify-between">
            <span className="font-medium">
              OpenAI billing cap reached — {status.message}
            </span>
            <a
              href="https://platform.openai.com/account/billing/limits"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1 rounded bg-amber-900 text-white text-xs"
            >
              Open billing →
            </a>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {view === "cover_pack" && !hasProject && (
            <NoProjectGate
              line="Cover Pack lists frames from your project's clips. Open or create a project first."
              hint="Brand preset and Identity (right tab) can be set up now — they save per-user, ready when you do have a project."
              onSwitchToAI={() => setView("ai_generate")}
            />
          )}
          {view === "cover_pack" && hasProject && (
            <CoverPackView
              frames={coverPackFrames}
              cover={cover}
              onPick={async (path) => {
                try {
                  await sidecar.thumbnailUseAsCover(slug, path);
                  setCover(path);
                  onCoverChanged?.(path);
                } catch (e) {
                  setStatus({ kind: "error", message: humanError(e) });
                }
              }}
            />
          )}
          {view === "ai_generate" && !aiUnlocked && (
            <SoloUpsell tier={userTier} onOpenSettings={onOpenSettings} />
          )}
          {view === "ai_generate" && aiUnlocked && !loaded && (
            <div className="px-10 py-20 text-center text-ink/50">Loading…</div>
          )}
          {view === "ai_generate" && aiUnlocked && loaded && needsSetup && !wizard && (
            <SetupGate
              identityCount={identityCount}
              hasBrand={!!brand?.brand}
              onStartIdentity={() => setWizard("identity")}
              onStartBrand={() => setWizard("brand")}
            />
          )}
          {view === "ai_generate" && aiUnlocked && loaded && !needsSetup && !wizard && !hasProject && (
            <NoProjectGate
              line="Brand and identity are saved — you're ready. Open or create a project to generate thumbnails for it."
              hint={`Setup complete · ${identityCount} face crops · brand "${brand?.brand}"`}
              onClose={onClose}
            />
          )}
          {view === "ai_generate" && aiUnlocked && loaded && !needsSetup && !wizard && hasProject && (
            <AIGenerateView
              form={form}
              setForm={setForm}
              status={status}
              thumbnails={thumbnails}
              brand={brand || {}}
              cover={cover}
              orderHint={thumbnails.length + 1}
              onEditBrand={() => setWizard("brand")}
              onEditIdentity={() => setWizard("identity")}
              identityCount={identityCount}
              onPreview={async (item) => {
                try {
                  const { prompt } = await sidecar.thumbnailPreviewPrompt(item);
                  setPreviewPrompt(prompt);
                } catch (e) {
                  setStatus({ kind: "error", message: humanError(e) });
                }
              }}
              onGenerate={async (item) => {
                setLastGenerateItem(item);
                setStatus({ kind: "pending", startedAt: Date.now() });
                try {
                  const result = await sidecar.thumbnailGenerate(slug, item);
                  setStatus({ kind: "idle" });
                  setLedgerTotal((prev) => prev + (result.cost_usd || 0));
                  if (result.ledger_warning) {
                    setStatus({
                      kind: "error",
                      message: `Saved, but ledger write failed: ${result.ledger_warning}`,
                    });
                  }
                  await refreshGallery();
                } catch (e) {
                  // v0.7.31 P0-4 — call refreshGallery on the failure path
                  // too. If the 180s timeout fires while Python+OpenAI keep
                  // running, the PNG can still land on disk a few seconds
                  // later. Refreshing the gallery surfaces the orphan so the
                  // user can see what they paid for.
                  await refreshGallery();
                  // v0.7.31 P0-5 — sidecar now sets code: "billing_hard_limit"
                  // when BillingLimitError fires. Prefer the code check over
                  // the legacy string-match (kept as fallback for old payloads).
                  const isSidecarError = e instanceof Error && (e as { code?: string }).code !== undefined;
                  const code = isSidecarError ? (e as { code?: string }).code : null;
                  const msg = humanError(e);
                  if (code === "billing_hard_limit" || /billing[_ ]hard[_ ]limit/i.test(msg)) {
                    setStatus({ kind: "billing", message: msg });
                  } else if (code === "canceled" || /cancell?ed/i.test(msg)) {
                    // Cancel is user-initiated — silent close, no red strip.
                    setStatus({ kind: "idle" });
                  } else {
                    setStatus({ kind: "error", message: msg });
                  }
                }
              }}
              onCancel={async () => {
                try {
                  await sidecar.thumbnailCancel(slug);
                } catch {
                  // Best-effort. The marker write is local I/O — failures are
                  // rare and the engine's next cancel-check will still try.
                }
              }}
              onZoom={setZoom}
              onUseAsCover={async (path) => {
                try {
                  await sidecar.thumbnailUseAsCover(slug, path);
                  setCover(path);
                  onCoverChanged?.(path);
                } catch (e) {
                  setStatus({ kind: "error", message: humanError(e) });
                }
              }}
            />
          )}

          {wizard === "brand" && (
            <BrandWizard
              initial={brand || {}}
              onCancel={() => setWizard(null)}
              onSave={async (next) => {
                try {
                  const { preset } = await sidecar.thumbnailSaveBrand(next);
                  setBrand(preset);
                  setWizard(null);
                } catch (e) {
                  setStatus({ kind: "error", message: humanError(e) });
                }
              }}
            />
          )}
          {wizard === "identity" && (
            <IdentityWizard
              currentCount={identityCount}
              onCancel={() => setWizard(null)}
              onSave={async (sources) => {
                try {
                  const { count } = await sidecar.thumbnailSaveIdentity(sources);
                  setIdentityCount(count);
                  setWizard(null);
                } catch (e) {
                  setStatus({ kind: "error", message: humanError(e) });
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Prompt preview lightbox */}
      {previewPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-8 backdrop-blur-sm"
          onClick={() => setPreviewPrompt(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[80vh] overflow-auto rounded-2xl bg-paper p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Prompt preview</h3>
              <button
                onClick={() => setPreviewPrompt(null)}
                className="text-ink/60 hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-ink/50 mb-3">
              This is the exact prompt that goes to OpenAI. Pure preview — no
              money spent.
            </p>
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono bg-ink/5 p-4 rounded-lg">
              {previewPrompt}
            </pre>
          </div>
        </div>
      )}

      {/* Image zoom lightbox — v0.7.31 P2-18 adds the "Use as cover" CTA
          inside the lightbox so users don't have to close the modal, hover,
          and click the tiny grid pill. The journey doc Beat 6 calls out this
          strand explicitly. */}
      {zoom && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 p-8 backdrop-blur-sm"
          onClick={() => setZoom(null)}
        >
          <div
            className="relative flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={convertFileSrc(zoom)}
              alt=""
              className="max-h-[80vh] max-w-full rounded-lg shadow-2xl"
            />
            {hasProject && cover !== zoom && (
              <button
                onClick={async () => {
                  try {
                    await sidecar.thumbnailUseAsCover(slug, zoom);
                    setCover(zoom);
                    onCoverChanged?.(zoom);
                    setZoom(null);
                  } catch (e) {
                    setStatus({ kind: "error", message: humanError(e) });
                  }
                }}
                className="px-5 py-2 rounded-full bg-fuchsia text-paper text-sm font-semibold shadow-lg"
              >
                Use as cover ↗
              </button>
            )}
            {hasProject && cover === zoom && (
              <div className="px-5 py-2 rounded-full bg-paper/10 text-paper/80 text-xs font-medium">
                Current cover
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────
function Header({
  projectName,
  ledgerTotal,
  view,
  aiUnlocked,
  onView,
  onClose,
}: {
  projectName: string;
  ledgerTotal: number;
  view: View;
  aiUnlocked: boolean;
  onView: (v: View) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ink/8">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink/40 mb-0.5">
          Thumbnails
        </div>
        <h2 className="text-lg font-semibold text-ink">{projectName}</h2>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-ink/5 rounded-full p-1">
          <TabButton
            active={view === "cover_pack"}
            onClick={() => onView("cover_pack")}
            label="Cover Pack"
          />
          <TabButton
            active={view === "ai_generate"}
            onClick={() => onView("ai_generate")}
            label="AI Generate"
            badge={aiUnlocked ? "✦" : "Agency"}
          />
        </div>
        {/* v0.7.31 P2-14 — always-on ledger pill so first-runners learn the
            cost-transparency pattern before they spend. $0.00 is a valid,
            informative state, not a UI dead-zone. Only hidden when AI is
            entirely off-limits to the user (free/solo/pro on the Cover Pack
            tab, where spend isn't a concept). */}
        {aiUnlocked && (
          <div
            className="text-xs text-ink/50 px-3 py-1.5 bg-ink/5 rounded-full font-mono"
            title="Lifetime spend on AI thumbnails"
          >
            ${ledgerTotal.toFixed(2)}
          </div>
        )}
        <button
          onClick={onClose}
          className="ml-2 w-9 h-9 rounded-full bg-ink/5 hover:bg-ink/10 text-ink/60"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
        active ? "bg-paper text-ink shadow" : "text-ink/60 hover:text-ink"
      }`}
    >
      {label}
      {badge && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            active ? "bg-fuchsia text-paper" : "bg-ink/10 text-ink/60"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Cover Pack tab ───────────────────────────────────────────────────────
function CoverPackView({
  frames,
  cover,
  onPick,
}: {
  frames: { clipIdx: number; clipTitle: string; path: string }[];
  cover: string | null;
  onPick: (path: string) => void;
}) {
  if (frames.length === 0) {
    return (
      <div className="px-10 py-20 text-center">
        <p className="text-ink/60 text-sm">
          No cover frames yet. Once a clip finishes its reframe stage, the
          first viable frame appears here as a pickable cover.
        </p>
      </div>
    );
  }
  return (
    <div className="p-6">
      <p className="text-xs text-ink/50 mb-4">
        Auto-extracted cover frames from each clip. Hover and pick to promote
        one as the project's cover.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {frames.map((f) => {
          const isCover = cover === f.path;
          return (
            <button
              key={f.path}
              onClick={() => onPick(f.path)}
              className={`relative aspect-video rounded-xl overflow-hidden border-2 transition-all group ${
                isCover ? "border-fuchsia ring-2 ring-fuchsia/30" : "border-transparent hover:border-ink/20"
              }`}
            >
              <img
                src={convertFileSrc(f.path)}
                alt={f.clipTitle}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-2 text-left">
                <div className="text-[10px] text-paper/70 uppercase tracking-wide">
                  Clip {f.clipIdx + 1}
                </div>
                <div className="text-xs text-paper font-medium truncate">
                  {f.clipTitle}
                </div>
              </div>
              {isCover && (
                <div className="absolute top-2 right-2 bg-fuchsia text-paper text-[10px] font-bold px-2 py-0.5 rounded-full">
                  COVER
                </div>
              )}
              {!isCover && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-paper/90 text-ink text-[10px] font-medium px-2 py-0.5 rounded-full">
                  Use as cover ↗
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── No-project gate (visible when slug is empty) ─────────────────────────
function NoProjectGate({
  line,
  hint,
  onSwitchToAI,
  onClose,
}: {
  line: string;
  hint?: string;
  onSwitchToAI?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="px-10 py-16 text-center max-w-xl mx-auto">
      {/* v0.7.31 P2-17 — removed emoji. CLAUDE.md bans emoji in UI copy. */}
      <div className="mx-auto mb-4 w-12 h-12 rounded-2xl border-2 border-ink/15 flex items-center justify-center">
        <div className="w-6 h-4 rounded-sm border-t-2 border-l-2 border-r-2 border-ink/30" />
      </div>
      <p className="text-ink text-base font-medium mb-2">{line}</p>
      {hint && <p className="text-xs text-ink/50 mb-6">{hint}</p>}
      <div className="flex items-center justify-center gap-2">
        {onSwitchToAI && (
          <button
            onClick={onSwitchToAI}
            className="px-4 py-2 rounded-full bg-ink text-paper text-sm"
          >
            Set up Brand & Identity →
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10"
          >
            Open Library →
          </button>
        )}
      </div>
    </div>
  );
}

// ── First-run hero (Beat 2) ──────────────────────────────────────────────
// v0.7.31 P2-16 — proves the destination BEFORE the SetupGate asks for
// identity uploads. Per journey doc Beat 2: "If we show 18 real thumbnails
// first AND then say 'this is yours in 3 steps,' the upload feels earned."
// Marquee uses CSS `animate-[marquee]` with samples from the docs/factory/
// pack baked into the build (Vite-imported below).
function ThumbnailHero({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  void onStart;
  // v0.7.50 — Page consistency pass. Visual language now matches the
  // workstation cockpit: hud-frame chrome, library-card-corner brackets on
  // each step card, fuchsia halo + lifted digit on the number badge, Geist
  // Mono eyebrows + tight Inter display heading. The marquee carries real
  // YouTube reference thumbnails (yt-references/*) instead of the bounty-
  // themed factory placeholders. Kimi keeps wiring; this is the visual
  // refresh that brings Thumbnail Setup into the same world as the cockpit.
  return (
    <div className="relative px-6 py-7 border-b border-line">
      {/* Atmosphere plate behind the hero — same fuchsia aurora vocabulary
          the cockpit panel uses. Falls behind content via z-0. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.10]"
        style={{
          background:
            "radial-gradient(120% 80% at 80% 0%, rgba(255,26,140,0.35) 0%, transparent 55%), radial-gradient(80% 50% at 10% 100%, rgba(0,229,255,0.18) 0%, transparent 60%)",
        }}
      />

      <div className="relative max-w-3xl mx-auto text-center mb-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia-deep mb-2" style={{ color: "#ff66b8" }}>
          Make this in 3 steps
        </div>
        <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink leading-tight">
          Character-locked YouTube thumbnails — your face, every time.
        </h3>
      </div>

      {/* Marquee of REAL YouTube reference thumbnails — 16:9 cards with
          hud-frame chrome so the row reads as one editorial strip rather
          than a row of standalone tiles. */}
      <div className="relative hud-frame rounded-2xl overflow-hidden mb-6 h-32">
        <div
          className="flex gap-3 absolute inset-y-0 animate-[marquee_55s_linear_infinite] will-change-transform py-3 pl-3"
          style={{ width: "max-content" }}
        >
          {HERO_FACTORY_SAMPLES.concat(HERO_FACTORY_SAMPLES).map((src, i) => (
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              className="h-full w-auto rounded-lg object-cover flex-shrink-0 shadow-[0_4px_16px_rgba(0,0,0,0.55)]"
              draggable={false}
            />
          ))}
        </div>
        <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-paper to-transparent pointer-events-none z-[1]" />
        <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-paper to-transparent pointer-events-none z-[1]" />
      </div>

      <div className="relative grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-5">
        <HeroStep icon={<Camera className="w-5 h-5" strokeWidth={1.75} />} label="Upload identity" hint="3 face crops · once" />
        <HeroStep icon={<Palette className="w-5 h-5" strokeWidth={1.75} />} label="Pick your style" hint="brand name + mood" />
        <HeroStep icon={<Sparkles className="w-5 h-5" strokeWidth={1.75} />} label="Generate" hint="$0.07 per image" />
      </div>

      <div className="relative flex items-center justify-center gap-3">
        <button
          onClick={onSkip}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-ink transition-colors"
        >
          Skip and pick a cover frame instead
        </button>
      </div>
    </div>
  );
}

// v0.7.50 — Cockpit-vocabulary step card. No solid border (the chrome is the
// four dashed fuchsia bracket corners + a faint fuchsia halo behind the
// glyph, both inherited from the cockpit-tile brand system at src/index.css).
// The container uses .library-card so its hover state lights the corners +
// halo per the brand kit. The glyph slot accepts a Lucide icon node so each
// step gets a semantic glyph (Camera / Palette / Sparkles) instead of a
// generic numbered digit — same halo language either way.
function HeroStep({ icon, label, hint }: { icon: React.ReactNode; label: string; hint: string }) {
  return (
    <div className="library-card relative flex items-center gap-3 px-3.5 py-3 rounded-xl">
      <span className="library-card-corner library-card-corner-tl" />
      <span className="library-card-corner library-card-corner-tr" />
      <span className="library-card-corner library-card-corner-bl" />
      <span className="library-card-corner library-card-corner-br" />
      <div className="relative w-9 h-9 grid place-items-center flex-shrink-0">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,26,140,0.45), rgba(255,26,140,0) 70%)",
            filter: "blur(6px)",
          }}
        />
        <span
          className="relative text-fuchsia"
          style={{
            filter: "drop-shadow(0 2px 6px rgba(255,26,140,0.65))",
          }}
        >
          {icon}
        </span>
      </div>
      <div className="text-left min-w-0">
        <div className="text-[13px] font-semibold text-ink leading-tight">{label}</div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary mt-1">{hint}</div>
      </div>
    </div>
  );
}

// v0.7.50 — Marquee thumbnails. The hero now ships Daniel's actual
// confirmed-reference YouTube thumbnails (1672×941 PNG, ~2MB each).
// Previously imported `factory/sample-01..06.png` which were bounty-card
// mockups (GO VIRAL / CLIP TO EARN) that read as the wrong product on a
// thumbnails page. Six is enough for the marquee — we double the array
// at render time so the loop is seamless. The factory samples are kept
// on disk but no longer referenced by this hero.
import ytRef01 from "../assets/yt-references/yt-01.png";
import ytRef02 from "../assets/yt-references/yt-02.png";
import ytRef03 from "../assets/yt-references/yt-03.png";
import ytRef04 from "../assets/yt-references/yt-04.png";
import ytRef05 from "../assets/yt-references/yt-05.png";
import ytRef06 from "../assets/yt-references/yt-06.png";

const HERO_FACTORY_SAMPLES = [
  ytRef01,
  ytRef02,
  ytRef03,
  ytRef04,
  ytRef05,
  ytRef06,
];

// ── Solo upsell ──────────────────────────────────────────────────────────
function SoloUpsell({
  tier,
  onOpenSettings,
}: {
  tier: string | null;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="px-10 py-16 text-center max-w-xl mx-auto">
      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-fuchsia bg-fuchsia/10 px-3 py-1 rounded-full mb-4">
        ✦ Solo tier
      </div>
      <h3 className="text-2xl font-semibold mb-3">AI thumbnails — your face, on autopilot</h3>
      <p className="text-ink/60 text-sm mb-6 leading-relaxed">
        Generate character-locked YouTube thumbnails using your own face and a proven click-formula
        (8 expressions × 5 stop-power layouts, rotated for variety). One $0.07 image per run.
      </p>
      <p className="text-xs text-ink/40 mb-4">
        Currently on <span className="font-mono">{tier ?? "free"}</span>.
      </p>
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="px-5 py-2 rounded-full bg-fuchsia text-paper text-sm font-medium"
        >
          Upgrade in Settings →
        </button>
      )}
    </div>
  );
}

// ── Setup gate (first-run for AI tab) ────────────────────────────────────
function SetupGate({
  identityCount,
  hasBrand,
  onStartIdentity,
  onStartBrand,
}: {
  identityCount: number;
  hasBrand: boolean;
  onStartIdentity: () => void;
  onStartBrand: () => void;
}) {
  return (
    <div className="px-10 py-12 max-w-xl mx-auto">
      <h3 className="text-xl font-semibold mb-2">Quick setup — about 2 minutes</h3>
      <p className="text-ink/60 text-sm mb-8">
        Lock in your face and brand once. Every thumbnail after this is just a
        title + a metaphor.
      </p>
      <div className="space-y-3">
        <SetupRow
          done={identityCount >= 3}
          title="Identity — 3 face crops"
          subtitle={identityCount >= 3 ? `${identityCount} crops locked in` : "Front, three-quarter, profile"}
          cta={identityCount >= 3 ? "Re-upload" : "Start →"}
          onClick={onStartIdentity}
        />
        <SetupRow
          done={hasBrand}
          title="Brand preset"
          subtitle={hasBrand ? "Saved" : "Name, identity description, wardrobe"}
          cta={hasBrand ? "Edit" : "Start →"}
          onClick={onStartBrand}
        />
      </div>
    </div>
  );
}

function SetupRow({
  done,
  title,
  subtitle,
  cta,
  onClick,
}: {
  done: boolean;
  title: string;
  subtitle: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 rounded-xl border border-ink/10 hover:border-ink/30 transition-colors text-left bg-paper"
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
            done ? "bg-fuchsia text-paper" : "bg-ink/10 text-ink/40"
          }`}
        >
          {done ? "✓" : "1"}
        </div>
        <div>
          <div className="font-medium text-ink">{title}</div>
          <div className="text-xs text-ink/50">{subtitle}</div>
        </div>
      </div>
      <span className="text-sm text-ink/70 font-medium">{cta}</span>
    </button>
  );
}

// ── Identity wizard ─────────────────────────────────────────────────────
function IdentityWizard({
  currentCount,
  onCancel,
  onSave,
}: {
  currentCount: number;
  onCancel: () => void;
  onSave: (sources: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    // v0.7.31 P1-9 — drop "heic" from the dialog filter to match the sidecar
    // validator (which accepts PNG/JPG/JPEG only). Previous behavior let the
    // user pick a HEIC, then bounced them at the save step.
    const result = await openFileDialog({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    setPicked(paths.map((p) => (typeof p === "string" ? p : (p as { path: string }).path)));
  };

  const submit = async () => {
    if (picked.length < 3) {
      setError("Pick at least 3 face crops.");
      return;
    }
    setSaving(true);
    try {
      await onSave(picked);
    } catch (e) {
      setError(humanError(e));
      setSaving(false);
    }
  };

  return (
    <div className="px-10 py-8 max-w-2xl mx-auto">
      <button onClick={onCancel} className="text-sm text-ink/50 mb-4 hover:text-ink">
        ← Back
      </button>
      <h3 className="text-xl font-semibold mb-1">Identity — face crops</h3>
      <p className="text-sm text-ink/60 mb-6">
        Pick 3 (or more) clear face crops. Engine attaches them as references on
        every generation so your face stays locked.
        {currentCount >= 3 && ` (Currently ${currentCount} on file — re-uploading clears the old set.)`}
      </p>

      <div
        className="border-2 border-dashed border-ink/20 rounded-2xl p-10 text-center mb-4"
      >
        {picked.length === 0 ? (
          <>
            <div className="text-ink/40 text-sm mb-4">
              Drop crops here, or browse files. PNG / JPG / JPEG.
            </div>
            <button
              onClick={pick}
              className="px-5 py-2 rounded-full bg-ink text-paper text-sm font-medium hover:bg-ink/90"
            >
              Browse files
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
              {picked.map((p, i) => (
                <div
                  key={p}
                  className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-fuchsia/40"
                >
                  <img
                    src={convertFileSrc(p)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-0 left-0 right-0 text-center bg-ink/80 text-[10px] text-paper py-0.5">
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-sm text-ink/60 mb-3">
              {picked.length} selected{picked.length < 3 && " — need at least 3"}
            </div>
            <button onClick={pick} className="text-xs text-fuchsia underline">
              Choose different files
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-ink/60">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={picked.length < 3 || saving}
          className="px-5 py-2 rounded-full bg-fuchsia text-paper text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Lock identity"}
        </button>
      </div>
    </div>
  );
}

// ── Brand wizard ────────────────────────────────────────────────────────
function BrandWizard({
  initial,
  onCancel,
  onSave,
}: {
  initial: ThumbnailBrandPreset;
  onCancel: () => void;
  onSave: (preset: ThumbnailBrandPreset) => Promise<void>;
}) {
  const [preset, setPreset] = useState<ThumbnailBrandPreset>({
    brand: initial.brand || "",
    identity: initial.identity || "",
    wardrobe: initial.wardrobe || "",
    style_mood: initial.style_mood || "cinematic",
    quality: initial.quality || "medium",
    ...initial,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!preset.brand?.trim()) {
      setError("Brand name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(preset);
    } catch (e) {
      setError(humanError(e));
      setSaving(false);
    }
  };

  return (
    <div className="px-10 py-8 max-w-2xl mx-auto">
      <button onClick={onCancel} className="text-sm text-ink/50 mb-4 hover:text-ink">
        ← Back
      </button>
      <h3 className="text-xl font-semibold mb-1">Brand preset</h3>
      <p className="text-sm text-ink/60 mb-6">
        Saved once, applied to every generation. You can edit later via the AI tab.
      </p>

      <div className="space-y-4">
        <Field label="Brand / character name" required>
          <input
            value={preset.brand || ""}
            onChange={(e) => setPreset({ ...preset, brand: e.target.value })}
            placeholder="Uncle Daniel"
            className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-fuchsia focus:outline-none"
          />
        </Field>

        <Field
          label="Identity — physical description"
          hint="ONE line. Only physical-identity words (build, hair, beard). Never expression."
        >
          <input
            value={preset.identity || ""}
            onChange={(e) => setPreset({ ...preset, identity: e.target.value })}
            placeholder="bald head, full beard, broad muscular build"
            className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-fuchsia focus:outline-none"
          />
        </Field>

        <Field label="Wardrobe" hint="Optional — what they wear across all thumbnails.">
          <input
            value={preset.wardrobe || ""}
            onChange={(e) => setPreset({ ...preset, wardrobe: e.target.value })}
            placeholder="a black t-shirt"
            className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-fuchsia focus:outline-none"
          />
        </Field>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-ink/50 hover:text-ink"
        >
          {showAdvanced ? "▾" : "▸"} Advanced
        </button>

        {showAdvanced && (
          <div className="space-y-4 p-4 rounded-xl bg-ink/3 border border-ink/10">
            <Field label="Style mood">
              <select
                value={preset.style_mood || "cinematic"}
                onChange={(e) =>
                  setPreset({ ...preset, style_mood: e.target.value as ThumbnailBrandPreset["style_mood"] })
                }
                className="w-full px-3 py-2 rounded-lg border border-ink/15 bg-paper"
              >
                {STYLE_MOODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default quality">
              <select
                value={preset.quality || "medium"}
                onChange={(e) =>
                  setPreset({ ...preset, quality: e.target.value as "low" | "medium" | "high" })
                }
                className="w-full px-3 py-2 rounded-lg border border-ink/15 bg-paper"
              >
                {QUALITIES.map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.label} ({q.cost})
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Font directive"
              hint="Override the engine's bold-condensed rule. Leave blank to keep the default."
            >
              <input
                value={preset.font_directive || ""}
                onChange={(e) => setPreset({ ...preset, font_directive: e.target.value || null })}
                placeholder=""
                className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-fuchsia focus:outline-none"
              />
            </Field>
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 px-4 py-2 rounded-lg mt-4">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-6">
        <button onClick={onCancel} className="px-4 py-2 text-sm text-ink/60">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="px-5 py-2 rounded-full bg-fuchsia text-paper text-sm font-medium disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save brand"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-ink/70 mb-1 block">
        {label}
        {required && <span className="text-fuchsia ml-1">*</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] text-ink/40 mt-1">{hint}</div>}
    </div>
  );
}

// ── AI Generate view (form + gallery) ───────────────────────────────────
function AIGenerateView({
  form,
  setForm,
  status,
  thumbnails,
  brand,
  cover,
  orderHint,
  identityCount,
  onEditBrand,
  onEditIdentity,
  onPreview,
  onGenerate,
  onCancel,
  onZoom,
  onUseAsCover,
}: {
  form: ThumbnailItem;
  setForm: (f: ThumbnailItem) => void;
  status: GenStatus;
  thumbnails: {
    path: string;
    name: string;
    modified_at: string;
    cost_usd: number | null;
    model: string | null;
  }[];
  brand: ThumbnailBrandPreset;
  cover: string | null;
  orderHint: number;
  identityCount: number;
  onEditBrand: () => void;
  onEditIdentity: () => void;
  onPreview: (item: ThumbnailItem) => void;
  onGenerate: (item: ThumbnailItem) => void;
  onCancel?: () => void;
  onZoom: (path: string) => void;
  onUseAsCover: (path: string) => void;
}) {
  const isPending = status.kind === "pending";
  const isBilling = status.kind === "billing";
  const titleLen = (form.text || "").length;
  const titleTooLong = titleLen > 30;
  // v0.7.31 P2-19 — amber warning between 27-30, red past 30. Matches the
  // journey doc Beat 5 spec: "27/30 counter going amber, then red".
  const titleColor = titleLen >= 30 ? "text-red-600" : titleLen >= 27 ? "text-amber-600" : "text-ink/40";
  const formValid = form.text.trim().length > 0 && form.metaphor && form.metaphor.trim().length > 0;

  const itemForCall: ThumbnailItem = {
    ...form,
    order: orderHint,
  };

  return (
    <div className="grid lg:grid-cols-5 gap-0">
      {/* Form column */}
      <div className="lg:col-span-2 p-6 border-r border-ink/8 bg-ink/2">
        <div className="flex items-center justify-between mb-4 text-xs">
          <button onClick={onEditBrand} className="text-ink/50 hover:text-ink">
            <span className="font-mono">{brand.brand || "—"}</span> · {brand.style_mood || "cinematic"} ✎
          </button>
          <button onClick={onEditIdentity} className="text-ink/50 hover:text-ink">
            Identity · {identityCount} crops ✎
          </button>
        </div>

        <Field label="Title (on-image text)" hint="2-4 words, max 30 chars.">
          <input
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            placeholder="DOOR > DEGREE"
            maxLength={35}
            className={`w-full px-3 py-2 rounded-lg border focus:outline-none ${
              titleTooLong ? "border-red-400" : "border-ink/15 focus:border-fuchsia"
            }`}
          />
          <div className={`text-[10px] mt-0.5 ${titleColor}`}>
            {titleLen}/30
          </div>
        </Field>

        <div className="h-4" />

        <Field
          label="Metaphor (scene description)"
          hint="Describe the SCENE, never the face. Engine has identity locked."
        >
          <textarea
            value={form.metaphor || ""}
            onChange={(e) => setForm({ ...form, metaphor: e.target.value })}
            placeholder="a hidden door behind a graduation cap"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-ink/15 focus:border-fuchsia focus:outline-none resize-none"
          />
        </Field>

        <div className="h-4" />

        <Field label="Accent">
          <div className="grid grid-cols-4 gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                onClick={() => setForm({ ...form, accent: a.key })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-all ${
                  form.accent === a.key
                    ? "border-fuchsia bg-fuchsia/5"
                    : "border-ink/10 hover:border-ink/30"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: a.swatch }}
                />
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="h-4" />

        <Field label="Quality">
          <div className="grid grid-cols-3 gap-2">
            {QUALITIES.map((q) => (
              <button
                key={q.key}
                onClick={() => setForm({ ...form, quality: q.key })}
                className={`flex flex-col px-3 py-2 rounded-lg text-xs border transition-all ${
                  form.quality === q.key
                    ? "border-fuchsia bg-fuchsia/5"
                    : "border-ink/10 hover:border-ink/30"
                }`}
              >
                <span className="font-medium">{q.label}</span>
                <span className="text-ink/40 font-mono mt-0.5">{q.cost}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="h-6" />

        <div className="flex flex-col gap-2">
          <button
            onClick={() => onPreview(itemForCall)}
            disabled={!formValid || isPending}
            className="w-full py-2 rounded-full text-sm text-ink/70 bg-ink/5 hover:bg-ink/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ✦ Preview prompt (free)
          </button>
          <button
            onClick={() => onGenerate(itemForCall)}
            disabled={!formValid || isPending || titleTooLong || isBilling}
            className="w-full py-3 rounded-full text-sm font-semibold text-paper bg-fuchsia hover:bg-fuchsia/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <GenerateButtonLabel startedAt={status.startedAt} />
            ) : (
              `Generate · ${QUALITIES.find((q) => q.key === form.quality)?.cost}`
            )}
          </button>
          {isPending && (
            <>
              <PendingBar startedAt={status.startedAt} />
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="w-full py-1.5 rounded-full text-xs text-ink/60 hover:text-ink hover:bg-ink/5"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Gallery column */}
      <div className="lg:col-span-3 p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold">
            Your thumbnails <span className="text-ink/40 font-normal">· {thumbnails.length}</span>
          </h4>
        </div>
        {thumbnails.length === 0 && !isPending && (
          <div className="aspect-video rounded-xl border border-dashed border-ink/15 flex items-center justify-center text-sm text-ink/40">
            Generated thumbnails land here. Hit Generate ↖
          </div>
        )}
        {(thumbnails.length > 0 || isPending) && (
          <div className="grid grid-cols-2 gap-3">
            {isPending && <PendingTile startedAt={status.startedAt} />}
            {thumbnails.map((t) => {
              const isCover = cover === t.path;
              return (
                <div
                  key={t.path}
                  className={`relative aspect-video rounded-xl overflow-hidden group border-2 transition-colors ${
                    isCover ? "border-fuchsia ring-2 ring-fuchsia/30" : "border-transparent hover:border-ink/20"
                  }`}
                >
                  <button onClick={() => onZoom(t.path)} className="block w-full h-full">
                    <img
                      src={convertFileSrc(t.path)}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </button>
                  {isCover && (
                    <div className="absolute top-2 right-2 bg-fuchsia text-paper text-[10px] font-bold px-2 py-0.5 rounded-full">
                      COVER
                    </div>
                  )}
                  {!isCover && (
                    <button
                      onClick={() => onUseAsCover(t.path)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-paper/90 text-ink text-[10px] font-medium px-2 py-0.5 rounded-full"
                    >
                      Use as cover ↗
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// v0.7.31 P1-11 — single source of truth for the elapsed counter. Drives
// rerenders for every surface that displays "Xs" while a generate is pending
// (Generate button, PendingBar, PendingTile). Before this, only PendingBar /
// PendingTile had their own intervals — the Generate button label rendered
// "0s" once and never updated, so the form column looked frozen.
function useElapsedSeconds(startedAt: number | null): number {
  const [, force] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.floor((Date.now() - startedAt) / 1000);
}

// Generate button label — reads useElapsedSeconds so the "Xs" updates live.
// Before v0.7.31 P1-11 fix, this was a static Date.now() read at parent render
// time → counter stuck at 0 while the OpenAI call ran.
function GenerateButtonLabel({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedSeconds(startedAt);
  return <>Generating… {elapsed}s</>;
}

function PendingTile({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedSeconds(startedAt);
  return (
    <div className="relative aspect-video rounded-xl overflow-hidden bg-ink/5 flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-teal-300/30 to-transparent animate-pulse" />
      <div className="relative text-xs text-ink/60 font-mono">
        Generating… {elapsed}s
      </div>
    </div>
  );
}

function PendingBar({ startedAt }: { startedAt: number }) {
  const elapsed = useElapsedSeconds(startedAt);
  const hint = elapsed > 15 ? "OpenAI's queue can be slow at peak — still working." : "Composing prompt → posting to OpenAI → decoding PNG.";
  return (
    <div className="text-[11px] text-ink/50 text-center px-2">
      {hint}
    </div>
  );
}
