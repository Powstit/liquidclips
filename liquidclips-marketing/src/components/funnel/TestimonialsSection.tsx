/**
 * TestimonialsSection · reserved space after Window 4.
 * Inherits LOCKED W1 standard. Placeholder quotes — replace with
 * real creator quotes once collected. Component is intentionally
 * easy to swap: change the `QUOTES` array.
 */

const QUOTES = [
  {
    role: "CREATOR · RESULT",
    handle: "@uncledaniel",
    body: "Generated clips from a 90-minute video before I finished watching it.",
  },
  {
    role: "CLIPPER · EARNINGS",
    handle: "@mr.podshorts",
    body: "Finally knew which moments were worth cutting.",
  },
  {
    role: "AGENCY · VOLUME",
    handle: "studio-row labs",
    body: "Turned one creator session into a full week of content.",
  },
];

export function TestimonialsSection() {
  return (
    <section className="lc-test" aria-label="In the workbench right now">
      <div className="lc-test-head">
        <span className="lc-test-eb">
          <span className="lc-test-eb-dot" /> IN THE WORKBENCH RIGHT NOW
        </span>
        <h2 className="lc-test-h2">
          The room is full. <em>The work is shipping.</em>
        </h2>
      </div>

      <ul className="lc-test-grid">
        {QUOTES.map((q) => (
          <li key={q.handle} className="lc-test-card">
            <span className="lc-test-bracket lc-test-bracket--tl" aria-hidden="true" />
            <span className="lc-test-bracket lc-test-bracket--tr" aria-hidden="true" />
            <span className="lc-test-bracket lc-test-bracket--bl" aria-hidden="true" />
            <span className="lc-test-bracket lc-test-bracket--br" aria-hidden="true" />

            <span className="lc-test-role">{q.role}</span>
            <p className="lc-test-body">“{q.body}”</p>
            <span className="lc-test-handle">— {q.handle}</span>
            <span className="lc-test-placeholder">PLACEHOLDER · REAL QUOTES PENDING</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
