/**
 * customerSafeErrors · 2026-07-09
 *
 * Central mapping from any thrown error / status code / sidecar payload
 * into a short, human sentence a 19-year-old clipper can read.
 *
 * Rules:
 *   - Never surface `RuntimeError:`, `Traceback`, `Exception`, raw stack
 *     traces, or `[object Object]` in the returned `body`.
 *   - Never lecture; never apologise with "Unfortunately".
 *   - Direct, money-aware. Banned word: "bounty" (use "skill" / "clip
 *     job" / "paid post" instead).
 *   - Always keep the technical detail on `technical` so the diagnostics
 *     drawer and Railway logs still get the raw truth.
 *
 * Scenarios covered (Daniel's list, 2026-07-09):
 *   1. Video too short          → SHORT_VIDEO
 *   2. Video too long           → LONG_VIDEO
 *   3. Provider unavailable     → PROVIDER_UPSTREAM
 *   4. Sidecar unavailable      → SIDECAR_UNAVAILABLE
 *   5. Zero clips returned      → ZERO_CLIPS
 *   6. Whop submit failed       → WHOP_SUBMIT
 *   7. File missing             → FILE_MISSING
 *   8. Upload unavailable       → UPLOAD_DISABLED
 *   9. Auth expired             → AUTH_EXPIRED
 */

export type CustomerSafeCode =
  | "SHORT_VIDEO"
  | "LONG_VIDEO"
  | "PROVIDER_UPSTREAM"
  | "SIDECAR_UNAVAILABLE"
  | "ZERO_CLIPS"
  | "WHOP_SUBMIT"
  | "FILE_MISSING"
  | "UPLOAD_DISABLED"
  | "AUTH_EXPIRED"
  | "NETWORK_TIMEOUT"
  | "RATE_LIMIT"
  | "SOURCE_UNAVAILABLE"
  | "PRIVATE_SOURCE"
  | "UNKNOWN";

export interface CustomerSafeError {
  /** Toast title. 1–4 words. */
  title: string;
  /** Toast body. One clean sentence, optional short next step. */
  body: string;
  /** Stable code · safe to log + diagnostic-copy. */
  code: CustomerSafeCode;
  /** Raw technical string. Sent to logs + diagnostics drawer, never
   *  surfaced by default. Undefined when the caller only had a code. */
  technical?: string;
  /** Optional call-to-action next step the caller can offer inline
   *  (button / link). Consumers can ignore. */
  action?: {
    label: string;
    /** "diagnostics" opens Settings → Beta diagnostics; "signin" restarts
     *  the login flow; "retry" is generic; "browse-supported" opens the
     *  supported-sources list. */
    kind: "diagnostics" | "signin" | "retry" | "browse-supported" | "settings";
  };
}

/**
 * Coerce anything into a human-safe error. Never returns a raw stack.
 *
 * Preference order:
 *   1. Known SidecarError instance with a `.code` we recognise.
 *   2. `opts.hintCode` (caller already knows the scenario).
 *   3. Pattern-match on the message string.
 *   4. UNKNOWN fallback with a clean generic sentence.
 */
export function describeError(
  err: unknown,
  opts?: { hintCode?: CustomerSafeCode; scenario?: "clip" | "whop" | "auth" | "upload" | "reveal" | "provider" },
): CustomerSafeError {
  const raw = _rawString(err);
  const code = opts?.hintCode ?? _matchCode(raw, opts?.scenario);
  return _copyFor(code, raw);
}

/**
 * Convenience wrapper for callers that fire `bus.emit("toast", …)`.
 * Returns the fields the toast host reads, and stashes the technical
 * detail on a global diagnostic ring the "Copy diagnostics" flow reads.
 */
export function humanErrorToast(
  err: unknown,
  opts?: Parameters<typeof describeError>[1],
): { kind: "error" | "warning" | "info"; title: string; body: string; code: CustomerSafeCode } {
  const safe = describeError(err, opts);
  // Route the technical detail through the diagnostic ring so the
  // support drawer can read it later. Non-blocking, best-effort.
  try {
    _pushDiag(safe);
  } catch {
    /* no-op — never let diagnostic capture break a user toast. */
  }
  return {
    kind: safe.code === "AUTH_EXPIRED" || safe.code === "WHOP_SUBMIT" || safe.code === "FILE_MISSING" || safe.code === "UPLOAD_DISABLED"
      ? "warning"
      : "error",
    title: safe.title,
    body: safe.body,
    code: safe.code,
  };
}

/* ─── internals ──────────────────────────────────────────────────────── */

function _rawString(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "";
  try {
    const anyErr = err as { human?: string; message?: string; error?: string; detail?: string; code?: string };
    return anyErr.human || anyErr.message || anyErr.error || anyErr.detail || anyErr.code || "";
  } catch {
    return "";
  }
}

function _matchCode(raw: string, scenario?: string): CustomerSafeCode {
  const s = raw.toLowerCase();

  // Auth first · a 401 during Whop submit is still an auth issue.
  if (/401|unauthori[sz]|session expired|jwt (expired|invalid|rejected)|token expired|auth_?fail/i.test(raw)) {
    return "AUTH_EXPIRED";
  }

  // Sidecar lifecycle
  if (/sidecar[_ ]?(crashed|died|exhausted|restarted|unavailable|not managed|state of type)/i.test(raw) ||
      /sidecarstate|__tauri|tauri_internals|command sidecar_call not found/i.test(raw)) {
    return "SIDECAR_UNAVAILABLE";
  }

  // Zero-clip specific keys emitted by useEngineSession + backend.
  if (/clip_plan_empty|zero clips|no clips produced|produced zero/i.test(raw)) {
    return "ZERO_CLIPS";
  }

  // Video length gates — sidecar / backend / ffprobe messages.
  if (/(video|source|clip).{0,20}(too short|shorter than|below minimum|min[_ ]duration)/i.test(raw) ||
      /duration_too_short|source_too_short/i.test(raw)) {
    return "SHORT_VIDEO";
  }
  if (/(video|source|clip).{0,20}(too long|longer than|exceeds|max[_ ]duration)/i.test(raw) ||
      /duration_too_long|source_too_long/i.test(raw)) {
    return "LONG_VIDEO";
  }

  // Provider (Anthropic / OpenAI upstream) — HTTP 5xx from proxy_anthropic.
  if (/anthropic|openai|proxy.?llm|hosted[_ ]?(llm|anthropic)/i.test(raw) &&
      /(50\d|upstream|unavailable|bad gateway|timeout|failed)/i.test(raw)) {
    return "PROVIDER_UPSTREAM";
  }
  if (scenario === "provider" && /(50\d|upstream|timeout|unavailable)/i.test(raw)) {
    return "PROVIDER_UPSTREAM";
  }

  // File missing (reveal-in-finder / save-copy-as / stat failures).
  if (/no such file|file not found|does not exist|path_not_found|enoent|not_found/i.test(raw)) {
    return "FILE_MISSING";
  }

  // Upload disabled (file picker not wired · shell path).
  if (/file picker not yet wired|picker not (yet )?wired|upload disabled|native (file )?picker (not )?wired/i.test(raw)) {
    return "UPLOAD_DISABLED";
  }

  // Source · geo / private / removed / rate-limited.
  if (/private video|members[- ]only|login required|sign in to confirm/i.test(raw)) {
    return "PRIVATE_SOURCE";
  }
  if (/video unavailable|removed by|geo[- ]blocked|age[- ]restricted/i.test(raw)) {
    return "SOURCE_UNAVAILABLE";
  }
  if (/rate[- ]?limit|http 429|too many requests/i.test(raw)) {
    return "RATE_LIMIT";
  }

  // Network
  if (/timed out|timeout|econnrefused|econnreset|network is unreachable|failed to fetch|network error/i.test(raw)) {
    return "NETWORK_TIMEOUT";
  }

  // Scenario hints when patterns didn't match.
  if (scenario === "whop") return "WHOP_SUBMIT";
  if (scenario === "auth") return "AUTH_EXPIRED";
  if (scenario === "reveal") return "FILE_MISSING";
  if (scenario === "upload") return "UPLOAD_DISABLED";

  // 5xx unsubtle catch — surface as provider upstream when the scenario
  // is provider-adjacent.
  if (/http 50\d|bad gateway|service unavailable/i.test(raw)) {
    if (scenario === "clip") return "PROVIDER_UPSTREAM";
  }

  if (s === "" || s === "null" || s === "undefined" || s === "[object object]") {
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

function _copyFor(code: CustomerSafeCode, technical: string): CustomerSafeError {
  switch (code) {
    case "SHORT_VIDEO":
      return {
        title: "Source is too short",
        body: "Give it a video at least 60 seconds long · nothing landed on disk.",
        code,
        technical,
      };
    case "LONG_VIDEO":
      return {
        title: "Source is too long",
        body: "Trim it under 3 hours or split it into parts · nothing landed on disk.",
        code,
        technical,
      };
    case "PROVIDER_UPSTREAM":
      return {
        title: "Clip engine is busy",
        body: "Our AI provider is overloaded. Give it 30 seconds and try again — we'll re-use the same source.",
        code,
        technical,
        action: { label: "Copy diagnostics", kind: "diagnostics" },
      };
    case "SIDECAR_UNAVAILABLE":
      return {
        title: "Engine not ready",
        body: "The clip engine isn't running yet. Quit Liquid Clips and reopen — takes 5 seconds.",
        code,
        technical,
        action: { label: "Copy diagnostics", kind: "diagnostics" },
      };
    case "ZERO_CLIPS":
      return {
        title: "No clips came out",
        body: "The transcript was too short or off-topic. Try a longer source with more talking · nothing landed on disk.",
        code,
        technical,
      };
    case "WHOP_SUBMIT":
      return {
        title: "Submission didn't send",
        body: "Whop didn't take the submission. Check the post URL and try again — your clip is still saved.",
        code,
        technical,
        action: { label: "Copy diagnostics", kind: "diagnostics" },
      };
    case "FILE_MISSING":
      return {
        title: "Clip file missing",
        body: "The clip file was moved or deleted after export. Re-run the source to rebuild it.",
        code,
        technical,
      };
    case "UPLOAD_DISABLED":
      return {
        title: "Upload lands in the next build",
        body: "The file picker ships in the next update. Paste a YouTube / TikTok / IG / X link for now.",
        code,
        technical,
      };
    case "AUTH_EXPIRED":
      return {
        title: "Sign in again",
        body: "Your session ran out. Sign in and pick up where you left off — nothing's lost.",
        code,
        technical,
        action: { label: "Sign in", kind: "signin" },
      };
    case "NETWORK_TIMEOUT":
      return {
        title: "Network hiccup",
        body: "Couldn't reach the server. Check your Wi-Fi and try again.",
        code,
        technical,
        action: { label: "Copy diagnostics", kind: "diagnostics" },
      };
    case "RATE_LIMIT":
      return {
        title: "Slow down a bit",
        body: "The source is throttling us. Wait a minute and try again — same link works.",
        code,
        technical,
      };
    case "SOURCE_UNAVAILABLE":
      return {
        title: "Source unavailable",
        body: "That video was removed, geo-blocked, or age-restricted. Try a different link.",
        code,
        technical,
      };
    case "PRIVATE_SOURCE":
      return {
        title: "Private link",
        body: "That source needs a login. Public links work · try a different one.",
        code,
        technical,
      };
    case "UNKNOWN":
    default:
      return {
        title: "Something went sideways",
        body: "We saved your progress. Try again — if it keeps failing, open Settings → Beta diagnostics.",
        code: "UNKNOWN",
        technical,
        action: { label: "Copy diagnostics", kind: "diagnostics" },
      };
  }
}

/* ─── Diagnostic ring · powers the "Copy diagnostics" affordance ────── */

interface DiagEntry {
  ts: number;
  code: CustomerSafeCode;
  title: string;
  body: string;
  technical?: string;
}

const DIAG_MAX = 32;
const _diagRing: DiagEntry[] = [];

function _pushDiag(safe: CustomerSafeError): void {
  _diagRing.push({
    ts: Date.now(),
    code: safe.code,
    title: safe.title,
    body: safe.body,
    technical: safe.technical,
  });
  if (_diagRing.length > DIAG_MAX) _diagRing.splice(0, _diagRing.length - DIAG_MAX);
}

/** Snapshot of the last ≤32 customer-safe errors surfaced this session.
 *  Used by the diagnostics drawer and the "Copy diagnostics" button. */
export function readRecentSafeErrors(): ReadonlyArray<DiagEntry> {
  return _diagRing.slice();
}

/** One-shot: build a plain-text block a support agent can read.
 *  Never leaks raw stacks — only the classified code + short technical
 *  string. */
export function buildSafeErrorReport(): string {
  if (_diagRing.length === 0) return "No customer-safe errors recorded this session.";
  const lines = [
    "Liquid Clips · recent errors (customer-safe view)",
    "----------------------------------------------------",
  ];
  for (const e of _diagRing) {
    const iso = new Date(e.ts).toISOString();
    lines.push(`[${iso}] ${e.code}  ${e.title}`);
    lines.push(`  ${e.body}`);
    if (e.technical) lines.push(`  technical: ${e.technical.slice(0, 240)}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Best-effort clipboard write. Returns true on success. */
export async function copySafeErrorReport(): Promise<boolean> {
  const report = buildSafeErrorReport();
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}
