/**
 * PanelStub · holds the slot for panels that haven't been built yet.
 * Renders an honest "queued for next pass" card so the menu stays
 * fully clickable. Each pass replaces one stub with a real panel.
 */

export function PanelStub({
  panelId,
  title,
  oneLine,
}: {
  panelId: string;
  title: string;
  oneLine: string;
}) {
  return (
    <div className="lc-stub">
      <span className="lc-stub-eb">
        <span className="lc-stub-eb-dot" /> {panelId}
      </span>
      <h2 className="lc-stub-h">{title}</h2>
      <p className="lc-stub-sub">{oneLine}</p>
      <div className="lc-stub-card">
        <span className="lc-stub-card-bracket lc-stub-card-bracket--tl" aria-hidden="true" />
        <span className="lc-stub-card-bracket lc-stub-card-bracket--tr" aria-hidden="true" />
        <span className="lc-stub-card-bracket lc-stub-card-bracket--bl" aria-hidden="true" />
        <span className="lc-stub-card-bracket lc-stub-card-bracket--br" aria-hidden="true" />
        <span className="lc-stub-state">QUEUED · NEXT PASS</span>
        <p>This panel is wired into the console but the content lands in
        the next pass. Pick another tab from the rail.</p>
      </div>
    </div>
  );
}
