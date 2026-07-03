import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { fakeProjects } from "../../fixtures/fakeProjects.preview";

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
        {/* Gate 6 (2026-06-26) — this legacy hidden surface has no project
         *  create flow wired. Disabled with a visible reason so the button
         *  audit doesn't flag it as a dead control. The customer-facing
         *  Projects surface lives in Design-OS at /workstation. */}
        <button
          type="button"
          className="lc-btn"
          data-variant="primary"
          disabled
          title="Projects live in the Design-OS workspace · use the My Clips tab."
          aria-disabled="true"
        >
          + New project
        </button>
      </div>

      <div className="lc-grid lc-grid-3 lc-mt-16">
        {fakeProjects.map((p) => (
          /* Gate 6 · dropped role="button" + tabIndex from these tiles ·
           * they had no click/key handler, so they were dead controls
           * pretending to be interactive. Now plain divs. */
          <div key={p.id} className="cockpit-tile">
            <div className="cockpit-tile-clipno">{p.id}</div>
            <div className="cockpit-tile-title">{p.name}</div>
            <div className="cockpit-tile-meta">{p.clipCount} clips · {p.exportCount} exports</div>
            <div className="cockpit-tile-thumb">
              <div className="cockpit-tile-thumb-label">{p.exportCount > 0 ? "HOT" : "RECENT"}</div>
            </div>
            <span className="cockpit-tile-corner-bl" />
            <span className="cockpit-tile-corner-br" />
          </div>
        ))}
      </div>
    </>
  );
}
