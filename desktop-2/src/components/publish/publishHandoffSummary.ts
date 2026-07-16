/**
 * publishHandoffSummary · honest "now" publish reporting.
 *
 * When the user hits Publish with cadence="now", PublishModal fires an
 * assisted handoff per platform. Each can fail (the composer webview won't
 * open). The original code swallowed every failure and always reported
 * "Opened composers" — a success message on total failure. This pure helper
 * owns the summary decision so it can be unit-tested without mounting the
 * modal: given how many legs succeeded vs failed, what does the user hear?
 *
 * Rule: never claim "opened" when nothing opened; be specific on a partial.
 */

export interface HandoffSummary {
  /** onQueued() status line (always present). */
  queuedMessage: string;
  /** Error toast to emit — present ONLY when every leg failed, since the
   *  handoff itself stays silent on the unrecoverable composer-open throw. */
  errorToast?: { title: string; body: string };
}

export function summarizeHandoff(
  succeeded: number,
  failed: number,
  firstPlatformLabel: string,
): HandoffSummary {
  const total = succeeded + failed;

  if (succeeded === 0) {
    return {
      errorToast: {
        title: "Couldn't open the composer",
        body:
          failed === 1
            ? "The composer window didn't open · check your connection and try again."
            : `None of the ${failed} composers opened · check your connection and try again.`,
      },
      queuedMessage:
        failed === 1
          ? "Couldn't open the composer · try again."
          : `Couldn't open any of the ${failed} composers · try again.`,
    };
  }

  if (failed === 0) {
    return {
      queuedMessage:
        succeeded === 1
          ? `Opened ${firstPlatformLabel} composer · Finder shows the clip.`
          : `Opened ${succeeded} composers · queue holds the rest.`,
    };
  }

  return {
    queuedMessage: `Opened ${succeeded} of ${total} composers · ${failed} didn't open, retry from the Schedule queue.`,
  };
}
