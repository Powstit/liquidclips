import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";

const VERB_TABLE: Array<{ verb: string; effect: string }> = [
  { verb: "liquidclips://open?section=home", effect: "Routes to Home." },
  { verb: "liquidclips://open?section=create&url=<url>", effect: "Pre-fills Create URL field. Does NOT auto-submit." },
  { verb: "liquidclips://open?section=create&file=<absPath>", effect: "Pre-fills Create file path. Does NOT auto-submit." },
  { verb: "liquidclips://open?section=browse&source=youtube|drive|url", effect: "Highlights the matching source tab." },
  { verb: "liquidclips://open?section=editor&project=<id>&clip=<id>", effect: "Opens clip in Editor." },
  { verb: "liquidclips://open?section=projects&project=<id>", effect: "Selects project." },
  { verb: "liquidclips://open?section=schedule&tab=lane|channels", effect: "Switches Schedule sub-tab." },
  { verb: "liquidclips://open?section=channels&highlight=<platform>", effect: "Highlights a channel tile." },
  { verb: "liquidclips://open?section=community", effect: "Routes to Community." },
  { verb: "liquidclips://open?section=earn&mission=<id>", effect: "Highlights a mission." },
  { verb: "liquidclips://open?section=settings&tab=account|billing|integrations|advanced", effect: "Switches Settings sub-tab." },
  { verb: "liquidclips://open?section=campaign&id=<id>", effect: "Routes to Campaigns detail." },
  { verb: "liquidclips://open?section=clipper&campaign=<id>", effect: "Opens Clipper join view for a campaign." },
  { verb: "liquidclips://rewards/return?campaign=<id>&clip=<id>", effect: "Confirms Whop submission and routes to Earn/Engine." },
];

export function HQBridgeSection() {
  return (
    <div>
      <div className="lc-hud-card">
        <span className="lc-section-eyebrow">
          <span className="lc-section-eyebrow-dot" /> router · stateless
        </span>
        <h1 className="lc-section-title">HQ Bridge</h1>
        <p className="lc-section-subtitle">
          The HQ marketing site at liquidclips.app opens app sections via the liquidclips:// deep-link scheme.
        </p>
        <div className="lc-section-pills">
          <span className="lc-id-pill">{SECTION_IDS.SECTION_HQ_BRIDGE}</span>
          <span className="lc-id-pill">{FLOW_IDS.FLOW_013_HQ_WEBSITE_DEEP_LINK_HANDOFF}</span>
        </div>
      </div>

      <div className="lc-hud-card lc-mt-16">
        <span className="lc-hud-eyebrow">contract rules</span>
        <ul className="lc-hud-body" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Rule 1 — bridge never mutates section state; it navigates only.</li>
          <li>Rule 2 — sections treat URL params as untrusted input.</li>
          <li>Rule 3 — unknown verbs route to /home with a soft toast.</li>
          <li>Rule 4 — no verb destroys data (no <code>?delete</code>, <code>?logout</code>, <code>?reset</code>).</li>
          <li>Rule 5 — section contract changes update the bridge verb test matrix in the same PR.</li>
        </ul>
      </div>

      <h2 className="lc-hud-title lc-mt-24">Verbs</h2>
      <div className="lc-hud-card lc-mt-16">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              <th style={{ padding: "8px 6px" }}>Verb</th>
              <th style={{ padding: "8px 6px" }}>Effect</th>
            </tr>
          </thead>
          <tbody>
            {VERB_TABLE.map((row) => (
              <tr key={row.verb} style={{ borderTop: "1px solid var(--color-line)" }}>
                <td style={{ padding: "10px 6px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fuchsia-deep)" }}>{row.verb}</td>
                <td style={{ padding: "10px 6px" }}>{row.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
