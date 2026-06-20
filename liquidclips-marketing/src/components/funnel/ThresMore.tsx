"use client";

/**
 * ThresMore · transition between Workbench and InformationConsole.
 * Tells the user the page continues — and offers a click-to-scroll.
 * Inherits LOCKED W1 standard.
 */

export function ThresMore() {
  function jump() {
    const target = document.getElementById("information-console");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="lc-more">
      <button type="button" className="lc-more-card" onClick={jump} aria-label="Scroll to the information console">
        <span className="lc-more-eb">
          <span className="lc-more-eb-dot" /> ENTER CONSOLE
        </span>
        <h2 className="lc-more-h">There&apos;s more inside the console.</h2>
        <p className="lc-more-sub">
          Features. Rewards. Agencies. Billing. Affiliates. Testimonials.
        </p>
        <span className="lc-more-arrow" aria-hidden="true">
          ↓
          <span className="lc-more-arrow-glow" />
        </span>
      </button>
    </section>
  );
}
