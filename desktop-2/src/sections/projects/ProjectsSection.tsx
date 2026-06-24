import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { fakeProjects } from "../../fixtures/fakeProjects";

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
        <button type="button" className="lc-btn" data-variant="primary">+ New project</button>
      </div>

      <div className="lc-grid lc-grid-3 lc-mt-16">
        {fakeProjects.map((p) => (
          <div key={p.id} className="cockpit-tile" role="button" tabIndex={0}>
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
