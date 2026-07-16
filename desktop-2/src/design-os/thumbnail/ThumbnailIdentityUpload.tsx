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

import { humanError } from "../../lib/humanError";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Drawer, GlassCard } from "../components";
import { bus } from "../bridge";
import { sidecar } from "../engine/sidecar-stub";
import { thumbnail } from "../engine/sidecar-stub";
import type { IdentityImage } from "./types";
import "./ThumbnailIdentityUpload.css";

const MIN_REFERENCES = 3;

/**
 * IdentityImage augmented with a purely-visual preview URL. The real
 * `path` field is what the sidecar reads (a stashed disk file); the
 * `previewUrl` is a `blob:` URI kept so the <img> tag can render
 * instantly while the stash write is in-flight. Preview is revoked
 * on unmount so we don't leak.
 */
interface PendingIdentityImage extends IdentityImage {
  /** blob: URI purely for the <img> preview. */
  previewUrl: string;
}

export interface ThumbnailIdentityUploadProps {
  open: boolean;
  onClose: () => void;
  /** Identity images already saved — display alongside new selections. */
  initialImages?: ReadonlyArray<IdentityImage>;
}

export function ThumbnailIdentityUpload({
  open, onClose, initialImages = [],
}: ThumbnailIdentityUploadProps) {
  const [pending, setPending] = useState<PendingIdentityImage[]>(() =>
    initialImages.map((img) => ({ ...img, previewUrl: img.path })),
  );
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Track blob: preview URLs we've minted so we can revoke on unmount
  // and on drawer-close (prevents leaking blobs when the user opens/
  // closes the drawer repeatedly).
  const previewUrlsRef = useRef<Set<string>>(new Set());

  // Reset when reopened. When the drawer closes we also revoke any blob:
  // URLs minted this session so re-opens don't accumulate leaks (P2-A).
  useEffect(() => {
    if (!open) {
      previewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      previewUrlsRef.current.clear();
      return;
    }
    setPending(initialImages.map((img) => ({ ...img, previewUrl: img.path })));
    setError(null);
    setDirty(false);
    setSaving(false);
  }, [open, initialImages]);

  // Revoke minted blob: URLs on unmount so we don't leak memory when
  // the drawer is torn down (unmount) mid-flow.
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const onAddFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(png|jpe?g)$/i.test(f.name));
    if (list.length === 0) {
      setError("Only PNG and JPG references are accepted.");
      return;
    }

    // Step 1 — mint blob: preview URLs immediately so the UI paints
    // the thumbnails without waiting on the Rust round-trip.
    const previews = list.map((f) => {
      const previewUrl = URL.createObjectURL(f);
      previewUrlsRef.current.add(previewUrl);
      return { file: f, previewUrl };
    });

    setError(null);
    setDirty(true);

    // Step 2 — stash each file to disk via the Rust `stash_upload`
    // command. Real filesystem paths are what the Python sidecar
    // needs (blob: URIs are unreadable to it). Sequential to keep
    // ordering stable in the UI strip; images are small so total
    // wall-time is negligible.
    for (const { file, previewUrl } of previews) {
      try {
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        const path = await invoke<string>("stash_upload", {
          name: file.name,
          bytes,
        });
        setPending((cur) => [
          ...cur,
          { path, name: file.name, size: file.size, previewUrl },
        ]);
      } catch (e) {
        // Revoke the orphaned preview so we don't leak, then surface
        // the error to the user.
        URL.revokeObjectURL(previewUrl);
        previewUrlsRef.current.delete(previewUrl);
        setError(humanError(e));
      }
    }
  };

  const onRemove = (idx: number) => {
    setPending((cur) => {
      const removed = cur[idx];
      if (removed && previewUrlsRef.current.has(removed.previewUrl)) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrlsRef.current.delete(removed.previewUrl);
      }
      return cur.filter((_, i) => i !== idx);
    });
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
      setError(humanError(e));
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
          data-testid="thumbnail-identity-open"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("Files")) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void onAddFiles(e.dataTransfer.files);
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
          data-testid="thumbnail-identity-file"
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) void onAddFiles(e.target.files);
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
                  <img src={img.previewUrl} alt="" draggable={false} />
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
