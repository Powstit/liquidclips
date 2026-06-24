/**
 * ThumbnailIdentityUpload · Phase 6F
 *
 * Identity lock workflow — reference image upload only. NO face-description
 * field. Per the audit (§5.1) and Daniel's brief: identity must come from
 * reference images, never from words.
 *
 * Mounted inside the Design OS <Drawer>. Drag-drop + file picker. Validates
 * ≥3 references before allowing save. Atomic-replace pattern: a new save
 * fully replaces the existing identity set.
 */

import { useEffect, useRef, useState } from "react";
import { Drawer, GlassCard } from "../components";
import { bus } from "../bridge";
import { sidecar } from "../engine/sidecar-stub";
import { thumbnail } from "../engine/sidecar-stub";
import type { IdentityImage } from "./types";
import "./ThumbnailIdentityUpload.css";

const MIN_REFERENCES = 3;

export interface ThumbnailIdentityUploadProps {
  open: boolean;
  onClose: () => void;
  /** Identity images already saved — display alongside new selections. */
  initialImages?: ReadonlyArray<IdentityImage>;
}

export function ThumbnailIdentityUpload({
  open, onClose, initialImages = [],
}: ThumbnailIdentityUploadProps) {
  const [pending, setPending] = useState<IdentityImage[]>([...initialImages]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset when reopened
  useEffect(() => {
    if (!open) return;
    setPending([...initialImages]);
    setError(null);
    setDirty(false);
    setSaving(false);
  }, [open, initialImages]);

  const onAddFiles = (files: FileList | File[]) => {
    const list = Array.from(files);
    const accepted: IdentityImage[] = list
      .filter((f) => /\.(png|jpe?g)$/i.test(f.name))
      .map((f) => ({
        path: URL.createObjectURL(f),
        name: f.name,
        size: f.size,
      }));
    if (accepted.length === 0) {
      setError("Only PNG and JPG references are accepted.");
      return;
    }
    setPending((cur) => [...cur, ...accepted]);
    setDirty(true);
    setError(null);
  };

  const onRemove = (idx: number) => {
    setPending((cur) => cur.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const onSave = async () => {
    if (pending.length < MIN_REFERENCES) {
      setError(`Need at least ${MIN_REFERENCES} references — you have ${pending.length}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await thumbnail.saveIdentity(pending.map((p) => p.path));
      bus.emit("toast", {
        kind: "success",
        title: "Identity locked",
        body: `${pending.length} reference images saved.`,
      });
      void sidecar; // keep engine import alive — used elsewhere
      setDirty(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={dirty}
      onDirtyClose={onClose}
      eyebrow="Studio · identity"
      title="Lock your identity"
      width={460}
      id="thumb-identity"
    >
      <div className="lc-tiu">
        <p className="lc-tiu-intro">
          Upload at least <strong>{MIN_REFERENCES}</strong> reference photos of your face.
          gpt-image-1 uses these as the exact identity for every generated thumbnail —
          we never describe your face in words.
        </p>

        {/* Drop zone */}
        <button
          type="button"
          className={`lc-tiu-drop ${dragOver ? "is-drag" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("Files")) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) onAddFiles(e.dataTransfer.files);
          }}
        >
          <span className="lc-tiu-drop-plus" aria-hidden="true">+</span>
          <span className="lc-tiu-drop-eb">Reference upload</span>
          <span className="lc-tiu-drop-body">
            Drop PNG/JPG files here · or click to browse
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Pending strip */}
        <GlassCard density="quiet" className="lc-tiu-strip">
          <header className="lc-tiu-strip-head">
            <span className="lc-tiu-strip-eb">References · {pending.length}</span>
            {pending.length < MIN_REFERENCES && (
              <span className="lc-tiu-strip-warn">
                Need {MIN_REFERENCES - pending.length} more
              </span>
            )}
          </header>
          {pending.length === 0 ? (
            <p className="lc-tiu-strip-empty">No references yet.</p>
          ) : (
            <ul className="lc-tiu-strip-list">
              {pending.map((img, i) => (
                <li key={`${img.path}-${i}`} className="lc-tiu-thumb">
                  <img src={img.path} alt="" draggable={false} />
                  <button
                    type="button"
                    className="lc-tiu-thumb-x"
                    onClick={() => onRemove(i)}
                    aria-label={`Remove reference ${i + 1}`}
                  >
                    ×
                  </button>
                  <span className="lc-tiu-thumb-eb">#{i + 1}</span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {error && <p className="lc-tiu-error">{error}</p>}

        {/* Footer */}
        <footer className="lc-tiu-foot">
          <button type="button" className="lc-tiu-btn lc-tiu-btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lc-tiu-btn"
            onClick={onSave}
            disabled={saving || pending.length < MIN_REFERENCES}
          >
            {saving ? "Saving…" : `Save · lock identity (${pending.length})`}
          </button>
        </footer>
      </div>
    </Drawer>
  );
}
