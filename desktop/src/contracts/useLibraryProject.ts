// ship-lens v0.7.13 C2 — Contract hook for Kimi K-α (LibraryQuickPreview).
// Kimi's K-α component consumes this. The type shape is the CONTRACT.

import { useCallback, useEffect, useState } from "react";
import { sidecar, humanError, type ProjectLibrarySummary } from "../lib/sidecar";

export type UseLibraryProjectResult = {
  project: ProjectLibrarySummary | null;
  loading: boolean;
  error: string | null;
  open: (slug: string) => Promise<void>;
  close: () => void;
  remove: (slug: string) => Promise<void>;
  undoRemove: (slug: string) => Promise<void>;
  toggleArchive: (slug: string) => Promise<void>;
};

export function useLibraryProject(): UseLibraryProjectResult {
  const [project, setProject] = useState<ProjectLibrarySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await sidecar.listProjects(50, true);
      const found = list.projects.find((p) => p.slug === slug) ?? null;
      setProject(found);
      if (!found) setError("Project not found in library.");
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setProject(null);
    setError(null);
  }, []);

  const remove = useCallback(async (slug: string) => {
    try {
      await sidecar.requestDeleteProject(slug);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const undoRemove = useCallback(async (slug: string) => {
    try {
      await sidecar.undoDeleteProject(slug);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const toggleArchive = useCallback(async (slug: string) => {
    try {
      // Flip based on current state. We re-fetch the summary first so the
      // toggle is always honest about the latest archived flag.
      const list = await sidecar.listProjects(50, true);
      const current = list.projects.find((p) => p.slug === slug);
      if (!current) return;
      await sidecar.setProjectArchived(slug, !current.archived);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  useEffect(() => () => setLoading(false), []);
  return { project, loading, error, open, close, remove, undoRemove, toggleArchive };
}
