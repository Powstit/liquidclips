import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { bus } from "../../design-os/bridge";

// Ship-lens Batch 2 · C1-BATCH2-T3 (Demo-data purge · 2026-07-06).
// This legacy hidden surface used to render fixture project tiles
// via `fakeProjects` — dead controls pretending to be interactive.
// Now honest: a single centered empty-state block that hands the
// user off to Design-OS Workstation, which is where real projects
// live.
//
// Header "+ New project" button removed rather than re-wired: the
// centered empty-state CTA is the single primary action, so a
// duplicate header button was double-affordance noise. The whole
// section is a handoff surface — no local create/edit story.
//
// Gate 5 hash-first-then-emit workaround (see P1-BATCH2-002)
// applied on the CTA so nav:click actually lands even when the
// SimulatorRouter listener is scoped to #/home.

function openWorkstation() {
  if (window.location.hash !== "#/home") {
    window.location.hash = "#/home";
  }
  window.setTimeout(() => {
    bus.emit("nav:click", { route: "workstation" });
  }, 30);
}

export function ProjectsSection() {
  return (
    <>
      <div className="lc-section-header">
        <div>
          <span className="lc-section-eyebrow">
            <span className="lc-section-eyebrow-dot" /> library wall · bracket cards
          </span>
          <h1 className="lc-section-title">Projects</h1>
          <p className="lc-section-subtitle">
            Group clips for a series or campaign. Drag clips between projects in the Library.
          </p>
          <div className="lc-section-pills">
            <span className="lc-id-pill">{SECTION_IDS.SECTION_PROJECTS}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_006_PROJECTS_CREATE_ADD_MOVE}</span>
          </div>
        </div>
      </div>

      <div
        className="lc-empty-state lc-mt-24"
        data-testid="projects-empty-state"
      >
        <span
          className="lc-empty-state-eb"
          data-testid="projects-empty-eyebrow"
        >
          no projects yet
        </span>
        <p
          className="lc-hud-body lc-empty-state-body"
          data-testid="projects-empty-body"
        >
          Projects live in the Design-OS Workstation. Open it to create a
          new project, add clips, or move clips between projects.
        </p>
        <button
          type="button"
          className="lc-btn lc-empty-state-cta"
          data-variant="primary"
          data-testid="projects-empty-cta"
          onClick={openWorkstation}
        >
          Open Workstation →
        </button>
      </div>
    </>
  );
}
