/**
 * ThumbnailBrandPresetPanel · Phase 6F
 *
 * Brand preset editor for the 9-field whitelist. Uncle Daniel preset ships
 * as the default; future creator slots are listed in a sub-section.
 *
 * NOTE: Phase 6F writes `gpt-image-1` as the default model (per audit §5.1
 * + Daniel's brief). Legacy still defaults to `gpt-image-2` server-side,
 * but the new Design OS UI surfaces gpt-image-1.
 *
 * Mounted in <Drawer>. Save fires `thumbnail.saveBrand(preset)`.
 */

import { useEffect, useState } from "react";
import { Drawer, GlassCard } from "../components";
import { bus } from "../bridge";
import { thumbnail } from "../engine/sidecar-stub";
import {
  type BrandPreset, type StyleMood, type ThumbnailModel,
  type ThumbnailQuality, UNCLE_DANIEL_PRESET, DEFAULT_ACCENTS,
} from "./types";
import "./ThumbnailBrandPresetPanel.css";

const STYLE_MOODS: StyleMood[] = ["cinematic", "playful", "luxury", "editorial", "brutalist"];
const MODELS: ThumbnailModel[] = ["gpt-image-1", "gpt-image-2"];
const QUALITIES: ThumbnailQuality[] = ["low", "medium", "high"];

const FUTURE_CREATORS: ReadonlyArray<{ id: string; label: string; locked: true }> = [
  { id: "lucy",   label: "Lucy",   locked: true },
  { id: "miracle", label: "Miracle", locked: true },
  { id: "femi",   label: "Femi",   locked: true },
];

export interface ThumbnailBrandPresetPanelProps {
  open: boolean;
  onClose: () => void;
  initialPreset?: BrandPreset;
}

export function ThumbnailBrandPresetPanel({
  open, onClose, initialPreset = UNCLE_DANIEL_PRESET,
}: ThumbnailBrandPresetPanelProps) {
  const [preset, setPreset] = useState<BrandPreset>(initialPreset);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreset(initialPreset);
    setDirty(false);
    setSaving(false);
    setShowAdvanced(false);
  }, [open, initialPreset]);

  const set = <K extends keyof BrandPreset>(k: K, v: BrandPreset[K]) => {
    setPreset((cur) => ({ ...cur, [k]: v }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await thumbnail.saveBrand(preset);
      bus.emit("toast", {
        kind: "success",
        title: "Brand preset saved",
        body: `${preset.brand} · ${preset.model} · ${preset.quality} quality.`,
      });
      setDirty(false);
      onClose();
    } catch (e) {
      bus.emit("toast", {
        kind: "error",
        title: "Save failed",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const accents = preset.accents ?? DEFAULT_ACCENTS;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={dirty}
      onDirtyClose={onClose}
      eyebrow="Studio · brand preset"
      title="Brand preset"
      width={480}
      id="thumb-brand"
    >
      <div className="lc-tbp">
        {/* Creator chooser */}
        <section className="lc-tbp-section">
          <span className="lc-tbp-eb">Creator</span>
          <div className="lc-tbp-creators">
            <button
              type="button"
              className="lc-tbp-creator is-active"
              aria-pressed
              onClick={() => { setPreset(UNCLE_DANIEL_PRESET); setDirty(true); }}
            >
              <span className="lc-tbp-creator-eb">Active</span>
              <span className="lc-tbp-creator-name">Your brand</span>
            </button>
            {FUTURE_CREATORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="lc-tbp-creator is-locked"
                disabled
                title={`${c.label} preset locked — coming soon`}
              >
                <span className="lc-tbp-creator-eb">Locked</span>
                <span className="lc-tbp-creator-name">{c.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Required fields */}
        <section className="lc-tbp-section">
          <span className="lc-tbp-eb">Identity</span>
          <Field label="Brand name" required>
            <input
              className="lc-tbp-input"
              value={preset.brand}
              onChange={(e) => set("brand", e.target.value)}
              placeholder="Your brand"
            />
          </Field>
          <Field label="Physical descriptor" required>
            <textarea
              className="lc-tbp-textarea"
              rows={3}
              value={preset.identity}
              onChange={(e) => set("identity", e.target.value)}
              placeholder="British-Nigerian, bald head, full beard…"
            />
          </Field>
          <Field label="Wardrobe">
            <input
              className="lc-tbp-input"
              value={preset.wardrobe}
              onChange={(e) => set("wardrobe", e.target.value)}
              placeholder="black crew-neck t-shirt with brand wordmark"
            />
          </Field>
        </section>

        {/* Model + quality */}
        <section className="lc-tbp-section">
          <span className="lc-tbp-eb">Model + quality</span>
          <div className="lc-tbp-pickers">
            <div className="lc-tbp-pill-group" role="radiogroup" aria-label="Model">
              {MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={preset.model === m}
                  className={`lc-tbp-pill ${preset.model === m ? "is-active" : ""}`}
                  onClick={() => set("model", m)}
                  title={m === "gpt-image-2" ? "Legacy default · only on owner's account" : "Recommended · public OpenAI image model"}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="lc-tbp-pill-group" role="radiogroup" aria-label="Quality">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="radio"
                  aria-checked={preset.quality === q}
                  className={`lc-tbp-pill ${preset.quality === q ? "is-active" : ""}`}
                  onClick={() => set("quality", q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <p className="lc-tbp-hint">
            gpt-image-1 is the recommended public model. Legacy gpt-image-2
            auto-falls-back to gpt-image-1 if your account lacks access.
          </p>
        </section>

        {/* Accent palette */}
        <section className="lc-tbp-section">
          <span className="lc-tbp-eb">Accent palette · {Object.keys(accents).length}</span>
          <div className="lc-tbp-accents">
            {Object.entries(accents).map(([key, label]) => (
              <span key={key} className={`lc-tbp-accent lc-tbp-accent-${key}`} title={label}>
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* Advanced disclosure */}
        <GlassCard density="quiet" className="lc-tbp-adv">
          <button
            type="button"
            className="lc-tbp-adv-toggle"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            <span>{showAdvanced ? "Hide" : "Show"} advanced</span>
            <span className="lc-tbp-adv-caret">{showAdvanced ? "▾" : "▸"}</span>
          </button>
          {showAdvanced && (
            <div className="lc-tbp-adv-body">
              <p className="lc-tbp-hint">
                These fields are saved to the brand preset but not yet consumed
                by the prompt builder. They land when the runtime supports them.
              </p>
              <Field label="Style mood">
                <div className="lc-tbp-pill-group">
                  {STYLE_MOODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`lc-tbp-pill ${preset.style_mood === m ? "is-active" : ""}`}
                      onClick={() => set("style_mood", m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Props">
                <input
                  className="lc-tbp-input"
                  value={preset.props ?? ""}
                  onChange={(e) => set("props", e.target.value)}
                  placeholder="microphone · ring light · phone in hand"
                />
              </Field>
              <Field label="Font directive">
                <input
                  className="lc-tbp-input"
                  value={preset.font_directive ?? ""}
                  onChange={(e) => set("font_directive", e.target.value)}
                  placeholder="Bold Inter Display · headline ≤ 6 words"
                />
              </Field>
            </div>
          )}
        </GlassCard>

        <footer className="lc-tbp-foot">
          <button type="button" className="lc-tbp-btn lc-tbp-btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lc-tbp-btn"
            onClick={onSave}
            disabled={saving || !dirty || !preset.brand.trim() || !preset.identity.trim()}
          >
            {saving ? "Saving…" : "Save preset"}
          </button>
        </footer>
      </div>
    </Drawer>
  );
}

function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="lc-tbp-field">
      <span className="lc-tbp-label">
        {label}
        {required && <span className="lc-tbp-req"> · required</span>}
      </span>
      {children}
    </label>
  );
}
