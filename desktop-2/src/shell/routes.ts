// Liquid Clips 2.0 — hash-based router.
// No external router dependency. Hash strings map 1:1 to section routes
// declared in sectionRegistry.SECTION_REGISTRY. This keeps deep-link
// hand-off identical between browser-style routes (`#/create`) and the
// HQ bridge verb (`liquidclips://open?section=create` → `#/create`).

import { useEffect, useState } from "react";
import { SECTION_IDS, type SectionId } from "./sectionIds";
import { SECTION_REGISTRY, getSectionByRoute } from "./sectionRegistry";

const DEFAULT_SECTION: SectionId = SECTION_IDS.SECTION_HOME;

function parseHash(hash: string): SectionId {
  // Strip leading "#/" or "#"
  const clean = hash.replace(/^#\/?/, "").split("?")[0];
  const entry = getSectionByRoute(clean);
  return entry ? entry.id : DEFAULT_SECTION;
}

export function useHashRoute(): SectionId {
  const [section, setSection] = useState<SectionId>(() =>
    parseHash(window.location.hash)
  );

  useEffect(() => {
    function onHashChange() {
      setSection(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) {
      window.location.hash = "#/home";
    }
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return section;
}

export function navigateTo(sectionId: SectionId, params?: Record<string, string>): void {
  const entry = SECTION_REGISTRY.find((s) => s.id === sectionId);
  if (!entry) return;
  const search = params
    ? "?" + new URLSearchParams(params).toString()
    : "";
  window.location.hash = `#/${entry.route}${search}`;
}

export function getCurrentParams(): URLSearchParams {
  const raw = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(raw);
}
