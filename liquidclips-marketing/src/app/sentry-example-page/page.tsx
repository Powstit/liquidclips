// Sentry verification page. Hit /sentry-example-page in a browser, click the
// button, and watch for the error to land in the Sentry dashboard within ~30s.
// Delete this file once Sentry is confirmed working.

"use client";

import * as Sentry from "@sentry/nextjs";

declare global {
  function myUndefinedFunction(): void;
}

export default function SentryExamplePage() {
  return (
    <main style={{ padding: 40, fontFamily: "system-ui", color: "#0B0B10" }}>
      <h1 style={{ marginBottom: 16 }}>Sentry verification</h1>
      <p style={{ marginBottom: 24, opacity: 0.7 }}>
        Click the button to throw a deliberate error. It should appear in the
        Sentry dashboard within ~30 seconds. Delete this page once verified.
      </p>
      <button
        type="button"
        onClick={() => {
          Sentry.captureException(
            new Error("Sentry test from /sentry-example-page (client)"),
          );
          // And also throw a real error so the page-level boundary fires.
          myUndefinedFunction();
        }}
        style={{
          padding: "12px 20px",
          background: "#FF1A8C",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Throw test error
      </button>
    </main>
  );
}
