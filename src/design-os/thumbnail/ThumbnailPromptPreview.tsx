/**
 * ThumbnailPromptPreview · Phase 6F
 *
 * Live prompt builder + preview. Shows:
 *   - title input (≤30 chars)
 *   - metaphor textarea
 *   - accent picker
 *   - quality picker
 *   - active EMO rotation (which expression at this order)
 *   - active PAT rotation (which layout pattern at this order)
 *   - live prompt string (calls `thumbnail.previewPrompt` stub)
 *
 * Mounted inside <ModalPortal>. Lightbox-style — full-screen takeover with
 * backdrop blur. "Generate" CTA fires `thumbnail.generate(slug, item)` stub.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion as fm, AnimatePresence } from "framer-motion";
import { useModalPortal, useRegisterModal, GlassCard } from "../components";
import { thumbnail } from "../engine/sidecar-stub";
import { bus } from "../bridge";
import {
  type ThumbnailItem,
  type ThumbnailQuality,
  COST_USD,
  EMO_ROTATION,
  PAT_ROTATION,
  DEFAULT_ACCENTS,
} from "./types";
import "./ThumbnailPromptPreview.css";

const TITLE_LIMIT = 30;
const QUALITIES: ThumbnailQuality[] = ["low", "medium", "high"];

export interface ThumbnailPromptPreviewProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  /** Initial title — usually the active clip's title. */
  initialTitle?: string;
}

export function ThumbnailPromptPreview({
  open, onClose, slug, initialTitle = "",
}: ThumbnailPromptPreviewProps) {
  const host = useModalPortal();
  useRegisterModal({ id: "thumb-prompt", open, onEscape: onClose });

  const [text, setText] = useState(initialTitle);
  const [metaphor, setMetaphor] = useState("");
  const [accent, setAccent] = useState<string>("fuchsia");
  const [quality, setQuality] = useState<ThumbnailQuality>("medium");
  const [order, setOrder] = useState(1);
  const [prompt, setPrompt] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setText(initialTitle);
    setMetaphor("");
    setAccent("fuchsia");
    setQuality("medium");
    setOrder(1);
  }, [open, initialTitle]);

  // Re-build prompt whenever any field changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const item: ThumbnailItem = { text, metaphor, accent, quality, order };
    void thumbnail.previewPrompt(item).then((r) => {
      if (!cancelled) setPrompt(r.prompt);
    });
    return () => { cancelled = true; };
  }, [open, text, metaphor, accent, quality, order]);

  const emoIdx = (order - 1) % EMO_ROTATION.length;
  const patIdx = (order - 1) % PAT_ROTATION.length;

  const tooLong = text.length > TITLE_LIMIT;
  const cost = COST_USD[quality];

  const onGenerate = async () => {
    if (!text.trim() || tooLong) return;
    setBusy(true);
    try {
      await thumbnail.generate(slug, { text, metaphor, accent, quality, order });
      bus.emit("toast", {
        kind: "info",
        title: "Variant queued",
        body: `Generating · ${quality} · $${cost.toFixed(2)} · Studio preview only.`,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  const accentEntries = Object.entries(DEFAULT_ACCENTS);

  return createPortal(
    <AnimatePresence>
      {open && (
        <fm.div
          className="lc-tpp-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label="Thumbnail prompt preview"
        >
          <fm.div
            className="lc-tpp-card"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 18, scale: 0.985, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 18, scale: 0.985, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <header className="lc-tpp-head">
              <span className="lc-tpp-eb">Prompt preview · gpt-image-1</span>
              <button type="button" className="lc-tpp-close" onClick={onClose} aria-label="Close">×</button>
            </header>

            <div className="lc-tpp-body">
              {/* Form */}
              <section className="lc-tpp-form">
                <label className="lc-tpp-field">
                  <span className="lc-tpp-label">
                    Headline
                    <span className={`lc-tpp-counter ${tooLong ? "is-over" : ""}`}>
                      {text.length}/{TITLE_LIMIT}
                    </span>
                  </span>
                  <input
                    className="lc-tpp-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Why every clipper hits a wall at 4 minutes"
                  />
                </label>

                <label className="lc-tpp-field">
                  <span className="lc-tpp-label">Metaphor · free-text concept</span>
                  <textarea
                    className="lc-tpp-textarea"
                    rows={3}
                    value={metaphor}
                    onChange={(e) => setMetaphor(e.target.value)}
                    placeholder="bricks falling off a wall · climber halfway up · etc."
                  />
                </label>

                {/* Accent + quality */}
                <div className="lc-tpp-row">
                  <div className="lc-tpp-col">
                    <span className="lc-tpp-label">Accent</span>
                    <div className="lc-tpp-accents">
                      {accentEntries.map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={accent === key}
                          className={`lc-tpp-accent lc-tpp-accent-${key} ${accent === key ? "is-active" : ""}`}
                          onClick={() => setAccent(key)}
                          title={label}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="lc-tpp-col">
                    <span className="lc-tpp-label">Quality</span>
                    <div className="lc-tpp-quality">
                      {QUALITIES.map((q) => (
                        <button
                          key={q}
                          type="button"
                          aria-pressed={quality === q}
                          className={`lc-tpp-q ${quality === q ? "is-active" : ""}`}
                          onClick={() => setQuality(q)}
                        >
                          <span className="lc-tpp-q-label">{q}</span>
                          <span className="lc-tpp-q-cost">${COST_USD[q].toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Order / rotation control */}
                <div className="lc-tpp-row">
                  <div className="lc-tpp-col">
                    <span className="lc-tpp-label">Order · rotation index</span>
                    <div className="lc-tpp-order">
                      <button type="button" onClick={() => setOrder((o) => Math.max(1, o - 1))} aria-label="Previous order">−</button>
                      <span className="lc-tpp-order-val">{order}</span>
                      <button type="button" onClick={() => setOrder((o) => o + 1)} aria-label="Next order">+</button>
                    </div>
                  </div>
                  <div className="lc-tpp-col">
                    <span className="lc-tpp-label">Active rotations</span>
                    <ul className="lc-tpp-rot">
                      <li>
                        <span className="lc-tpp-rot-k">EMO #{emoIdx + 1}</span>
                        <span className="lc-tpp-rot-v">{EMO_ROTATION[emoIdx]}</span>
                      </li>
                      <li>
                        <span className="lc-tpp-rot-k">PAT #{patIdx + 1}</span>
                        <span className="lc-tpp-rot-v">{PAT_ROTATION[patIdx]}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* Live prompt */}
              <section className="lc-tpp-preview">
                <span className="lc-tpp-label">Live prompt · what gpt-image-1 sees</span>
                <GlassCard density="quiet" className="lc-tpp-prompt">
                  <pre>{prompt || "Building prompt…"}</pre>
                </GlassCard>
                <PromptStats prompt={prompt} />
              </section>
            </div>

            <footer className="lc-tpp-foot">
              <span className="lc-tpp-cost">Cost · ${cost.toFixed(2)} · Studio preview</span>
              <div className="lc-tpp-cta-row">
                <button type="button" className="lc-tpp-btn lc-tpp-btn-quiet" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="lc-tpp-btn"
                  onClick={onGenerate}
                  disabled={busy || !text.trim() || tooLong}
                >
                  {busy ? "Generating…" : `Generate · $${cost.toFixed(2)}`}
                </button>
              </div>
            </footer>
          </fm.div>
        </fm.div>
      )}
    </AnimatePresence>,
    host,
  );
}

function PromptStats({ prompt }: { prompt: string }) {
  const stats = useMemo(() => {
    const words = prompt.trim().split(/\s+/).filter(Boolean).length;
    const chars = prompt.length;
    const lines = prompt.split("\n").length;
    return { words, chars, lines };
  }, [prompt]);
  return (
    <div className="lc-tpp-stats">
      <span><strong>{stats.words}</strong> words</span>
      <span><strong>{stats.chars}</strong> chars</span>
      <span><strong>{stats.lines}</strong> lines</span>
    </div>
  );
}
