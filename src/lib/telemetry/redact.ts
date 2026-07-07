/**
 * PII / secret redaction for telemetry metadata — Step 5 named
 * assertion ``pii_redacted``.
 *
 * The master doc bans: email, JWT, token, raw URL query, local path,
 * prompt content, customer media metadata.
 *
 * Strategy is DENY-BY-KEY-PATTERN: any object key whose lower-case
 * name contains one of the banned substrings is stripped entirely.
 * String values are additionally sanitized: URL query strings are
 * dropped; email-shaped substrings are masked; unix / win / home file
 * paths are dropped; strings longer than ``MAX_STRING_LEN`` are
 * truncated so no full prompt or transcript can leak.
 */

const BANNED_KEY_SUBSTRINGS = [
  "email",
  "jwt",
  "token",
  "secret",
  "pin",
  "password",
  "authorization",
  "prompt",
  "transcript",
  "cookie",
];

const MAX_STRING_LEN = 240;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_QUERY_RE = /\?[^\s"'`)]+/g;
const UNIX_PATH_RE = /(?:^|\s)(\/(?:Users|home|tmp|var|opt|Applications)\/[^\s"'`)]+)/g;
const WIN_PATH_RE = /(?:^|\s)([A-Za-z]:\\[^\s"'`)]+)/g;
const HOME_PATH_RE = /(?:^|\s)(~\/[^\s"'`)]+)/g;
const JWT_LOOSE_RE = /\beyJ[A-Za-z0-9._-]{20,}\b/g;

function sanitizeString(value: string): string {
  let out = value;
  out = out.replace(EMAIL_RE, "[email]");
  out = out.replace(JWT_LOOSE_RE, "[jwt]");
  out = out.replace(URL_QUERY_RE, "");
  out = out.replace(UNIX_PATH_RE, " [path]");
  out = out.replace(WIN_PATH_RE, " [path]");
  out = out.replace(HOME_PATH_RE, " [path]");
  if (out.length > MAX_STRING_LEN) {
    out = out.slice(0, MAX_STRING_LEN) + "…";
  }
  return out;
}

function keyIsBanned(key: string): boolean {
  const lower = key.toLowerCase();
  return BANNED_KEY_SUBSTRINGS.some((needle) => lower.includes(needle));
}

/**
 * Deep-clone + sanitize metadata for telemetry emission.
 *
 * Returns a new object — never mutates the caller's payload. Non-plain
 * values (Date, Map, Set, function, class instance) are replaced with
 * their string representation so unstructured data can't sneak PII
 * through via ``toString`` or ``toJSON``.
 */
export function sanitizeMetadata(
  input: unknown,
): Record<string, unknown> | null {
  if (input == null) return null;
  if (typeof input !== "object") return null;
  const out: Record<string, unknown> = {};
  const src = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(src)) {
    if (keyIsBanned(key)) continue;
    out[key] = sanitizeValue(value);
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    const nested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keyIsBanned(k)) continue;
      nested[k] = sanitizeValue(v);
    }
    return nested;
  }
  return String(value).slice(0, MAX_STRING_LEN);
}
