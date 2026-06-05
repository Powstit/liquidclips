// v0.6.35 — Cockpit avatar store.
//
// The cockpit AvatarOrbit (top-right) and any other surface that paints the
// user's face all read from this one Zustand store. When the user uploads in
// Settings → Profile, we bump `bustKey` so every <img src={url}?v=...> in the
// app re-fetches immediately — no stale-cache flicker on the orbital ring or
// the dashboard rank strip.

import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { sidecar } from "./sidecar";

type AvatarState = {
  /** Tauri file URL for ~/LiquidClips/avatar.png, or null if no upload yet
   *  (cockpit then falls back to the initials gradient). */
  url: string | null;
  /** Append `?v=${bustKey}` to the rendered <img src=...> so re-uploads land
   *  instantly. Monotonic; we never decrement. */
  bustKey: number;
  /** Async lifecycle so loading skeletons can dim the orbit ring without
   *  the cockpit having to know about RPC plumbing. */
  loading: boolean;
  /** Last error string from a failed save/clear. UI surfaces it inline; we
   *  clear it on the next successful op. */
  error: string | null;

  /** Read sidecar's avatar_status; call once at app boot. Idempotent. */
  refresh: () => Promise<void>;
  /** Pipe a Tauri-picked file path through the sidecar resize, then refresh. */
  upload: (sourcePath: string) => Promise<void>;
  /** Delete the saved PNG and fall back to initials. */
  clear: () => Promise<void>;
};

export const useAvatar = create<AvatarState>((set) => ({
  url: null,
  bustKey: 0,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await sidecar.avatarStatus();
      if (status.present && status.path) {
        set({
          url: convertFileSrc(status.path),
          // Seed bust with mtime so refresh after an external file change
          // (rare but possible — Daniel could swap the PNG manually) still
          // forces a re-paint instead of serving the cached old image.
          bustKey: Math.floor(status.mtime ?? 0),
          loading: false,
        });
      } else {
        set({ url: null, loading: false });
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  upload: async (sourcePath: string) => {
    set({ loading: true, error: null });
    try {
      const { path } = await sidecar.saveAvatar(sourcePath);
      set({
        url: convertFileSrc(path),
        // Bump by Date.now() — guarantees a fresh value even if the user
        // re-uploads the same PNG twice in a row (mtime granularity is sec).
        bustKey: Date.now(),
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  clear: async () => {
    set({ loading: true, error: null });
    try {
      await sidecar.clearAvatar();
      set({ url: null, bustKey: Date.now(), loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },
}));

/** Convenience: build the cache-busted src for an <img>. Returns null if no
 *  upload yet, so callers can render the initials fallback. */
export function avatarSrc(state: Pick<AvatarState, "url" | "bustKey">): string | null {
  if (!state.url) return null;
  return `${state.url}?v=${state.bustKey}`;
}

/** Build a 2-letter initials string from an email/display name. Mirrors the
 *  formula used by WorkspaceDashboard.RankStrip pre-cockpit, so the fallback
 *  glyph stays consistent with what the user saw before they uploaded. */
export function initialsOf(emailOrName: string | null | undefined): string {
  if (!emailOrName) return "—";
  const handle = emailOrName.includes("@") ? emailOrName.split("@")[0] : emailOrName;
  const parts = handle.split(/[._\-\s]+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return letters || "—";
}
