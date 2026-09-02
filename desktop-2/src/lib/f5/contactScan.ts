/**
 * F5 · Layer 2 · Google People API + Gmail sent-box contact fetch.
 *
 * Two data sources per the F5 spec:
 *   1. `people.connections.list` · top 200 contacts sorted by
 *      LAST_MODIFIED_DESCENDING
 *   2. Gmail sent mail → recipient extraction (see below)
 *
 * Both are merged (dedupe by email) and augmented with a per-contact
 * `sentCount` used by the fallback roster builder — the more you email
 * someone, the higher they rank when we can't find YouTube matches.
 *
 * Uses an injected `httpFetch` so tests can drive the module without
 * ever hitting Google servers. Rate limiting via exponential backoff
 * with jitter is implemented here — 3 retries then a typed error
 * surfaces to the state machine.
 *
 * 2026-09-02 · Bucket 2.7 fix — Gmail scope minimization + correctness.
 *
 * PRIOR BUG: this module requested `gmail.readonly` but only ever
 * called `messages.list`, then parsed the response as if it already
 * contained `To:` recipient data. Gmail's real `messages.list` returns
 * only `{id, threadId}` per message — no headers, no body, ever,
 * regardless of scope. In production `sentItems` was always empty; the
 * Gmail half of the roster silently contributed nothing. Only the test
 * mocks (hand-shaped as `{sent: [{to}]}`) made it look like it worked.
 *
 * FIX: two real Gmail API calls, matching what the feature actually
 * needs (recipients of sent mail) and nothing more:
 *   1. `messages.list?labelIds=SENT` → message IDs only (cheap, 1 call).
 *      Uses the SENT label filter rather than `q=in:sent` full-text
 *      search — a structural filter, not a content search, which is
 *      the safer choice under the narrower `gmail.metadata` scope (see
 *      SCOPE below). Needs live confirmation that `q=` search works
 *      under `gmail.metadata` before ever relying on it; `labelIds`
 *      sidesteps the question entirely.
 *   2. `messages.get?format=metadata&metadataHeaders=To` per message —
 *      returns ONLY the `To` header, never the body, never other
 *      headers. This is the documented minimal Gmail read for "who did
 *      I email" — nothing narrower exists for this purpose.
 * Capped at `GMAIL_METADATA_HYDRATE_LIMIT` messages (most-recent-first,
 * Gmail's default list order) run in small concurrent batches
 * (`HYDRATE_CONCURRENCY`) — bounded, not one request per of the full
 * `SENT_LIST_MAX_RESULTS` list, and not one giant unbounded burst.
 *
 * SCOPE: `gmail.readonly` → `gmail.metadata`. The metadata scope grants
 * exactly this shape of access (headers, no body) and nothing more —
 * matches actual usage exactly, unlike `gmail.readonly` which also
 * permits full message body reads this code never performs.
 */

export interface RawContact {
  email: string;
  displayName: string | null;
  sentCount: number;
}

export type ScanError = 'RATE_LIMITED' | 'AUTH_INVALID' | 'NETWORK' | 'MALFORMED';

/** Which of the two Google endpoints produced the failure. Bucket 2.6
 *  incident (2026-09-02) · the real "status 403" report gave no way to
 *  tell whether People or Gmail rejected the call — this closes that
 *  gap without touching contact/email content. */
export type ScanSource = 'people' | 'gmail';

/** Non-secret subset of Google's error JSON body — never the token,
 *  never contact/email content. Google error responses for these two
 *  endpoints only ever carry error metadata (status/reason/message),
 *  no user PII, so this is safe to forward to telemetry in full. */
export interface GoogleErrorDetail {
  status?: string;
  reason?: string;
  message?: string;
  errors_reasons?: string[];
}

export type ScanResult =
  | { ok: true; contacts: RawContact[] }
  | {
      ok: false;
      error: ScanError;
      note?: string;
      attempts: number;
      source?: ScanSource;
      googleError?: GoogleErrorDetail;
    };

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type HttpFetch = (args: {
  url: string;
  headers: Record<string, string>;
}) => Promise<HttpResponse>;

export interface ScanDeps {
  fetch: HttpFetch;
  accessToken: string;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  maxRetries?: number;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cheap list call · IDs only, no content. Newest-first (Gmail default). */
const SENT_LIST_MAX_RESULTS = 100;
/** How many of those IDs actually get a real `messages.get` metadata
 *  fetch. Explicit, bounded limit — not "as many as the list returned."
 *  50 keeps call volume sane while preserving the "recent sent mail"
 *  signal (list is newest-first, so this is always the 50 most recent). */
const GMAIL_METADATA_HYDRATE_LIMIT = 50;
/** Small concurrent batch size for the hydration fetches — faster than
 *  fully sequential, far short of firing all 50 at once. */
const HYDRATE_CONCURRENCY = 5;

export async function scanContacts(deps: ScanDeps): Promise<ScanResult> {
  const sleep = deps.sleep ?? DEFAULT_SLEEP;
  const rand = deps.rand ?? Math.random;
  const maxRetries = deps.maxRetries ?? 3;
  const authHeader = { authorization: `Bearer ${deps.accessToken}` };

  const [connectionsRes, sentListRes] = await Promise.all([
    fetchWithRetry({
      url: 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&sortOrder=LAST_MODIFIED_DESCENDING&pageSize=200',
      headers: authHeader,
      fetch: deps.fetch,
      sleep,
      rand,
      maxRetries,
      source: 'people',
    }),
    fetchWithRetry({
      // Structural label filter, not a `q=` text search — see module
      // docstring for why this is the safer choice under gmail.metadata.
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=${SENT_LIST_MAX_RESULTS}`,
      headers: authHeader,
      fetch: deps.fetch,
      sleep,
      rand,
      maxRetries,
      source: 'gmail',
    }),
  ]);

  if (connectionsRes.error) return connectionsRes.error;
  if (sentListRes.error) return sentListRes.error;

  const contactMap = new Map<string, RawContact>();

  // People API connections
  const connections = (connectionsRes.body as { connections?: Array<unknown> } | undefined)?.connections ?? [];
  for (const conn of connections) {
    const cc = conn as { names?: Array<{ displayName?: string }>; emailAddresses?: Array<{ value?: string }> };
    const email = normalizeEmail(cc.emailAddresses?.[0]?.value);
    if (!email) continue;
    const displayName = cc.names?.[0]?.displayName ?? null;
    contactMap.set(email, { email, displayName, sentCount: 0 });
  }

  // Gmail sent-mail recipients — hydrate metadata (To header only) for
  // the most recent GMAIL_METADATA_HYDRATE_LIMIT message IDs.
  const listBody = sentListRes.body as { messages?: Array<{ id?: string }> } | undefined;
  const messageIds = (listBody?.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(0, GMAIL_METADATA_HYDRATE_LIMIT);

  const hydration = await hydrateSentRecipients({
    messageIds,
    fetch: deps.fetch,
    headers: authHeader,
    sleep,
    rand,
    maxRetries,
  });
  if (hydration.error) return hydration.error;

  for (const [email, count] of hydration.sentByEmail.entries()) {
    const existing = contactMap.get(email);
    if (existing) {
      existing.sentCount = count;
    } else {
      contactMap.set(email, { email, displayName: null, sentCount: count });
    }
  }

  return { ok: true, contacts: Array.from(contactMap.values()) };
}

/** Extracts every email address out of a raw `To:` header value.
 *  Deliberately regex-scans the whole string for email-shaped
 *  substrings rather than splitting on commas first — a quoted display
 *  name can itself contain a comma (`"Smith, John" <john@x.com>`),
 *  which would break naive comma-splitting. Email addresses never
 *  contain a literal comma, so this is safe and simpler than a full
 *  RFC 5322 parser for this use case. */
const EMAIL_PATTERN = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g;

export function parseRecipientsFromToHeader(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const matches = raw.match(EMAIL_PATTERN) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const email = normalizeEmail(m);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

interface HydrationOutcome {
  sentByEmail: Map<string, number>;
  error?: ScanResult & { ok: false };
}

/** Fetches `format=metadata&metadataHeaders=To` for each message id, in
 *  small concurrent batches. A hard auth failure (401/403) on any
 *  individual fetch aborts the whole hydration immediately — hammering
 *  Google with more requests that will keep failing the same way is
 *  wasteful, and AUTH_INVALID is the correct scanner-level signal.
 *  Any OTHER per-message failure (network blip, malformed response, a
 *  since-deleted message) is skipped — best-effort, matches "malformed
 *  data must not crash the scanner." People API contacts still surface
 *  even if Gmail hydration is partially degraded. */
async function hydrateSentRecipients(args: {
  messageIds: readonly string[];
  fetch: HttpFetch;
  headers: Record<string, string>;
  sleep: (ms: number) => Promise<void>;
  rand: () => number;
  maxRetries: number;
}): Promise<HydrationOutcome> {
  const sentByEmail = new Map<string, number>();
  const { messageIds } = args;

  for (let i = 0; i < messageIds.length; i += HYDRATE_CONCURRENCY) {
    const batch = messageIds.slice(i, i + HYDRATE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((id) =>
        fetchWithRetry({
          url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=To`,
          headers: args.headers,
          fetch: args.fetch,
          sleep: args.sleep,
          rand: args.rand,
          maxRetries: args.maxRetries,
          source: 'gmail',
        }),
      ),
    );
    for (const r of results) {
      if (r.error) {
        if (r.error.error === 'AUTH_INVALID') {
          return { sentByEmail, error: r.error };
        }
        // Skip this one message; keep going. Never crash the scan over
        // a single message's transient/malformed response.
        continue;
      }
      const payload = r.body as { payload?: { headers?: Array<{ name?: string; value?: string }> } } | undefined;
      const headers = payload?.payload?.headers ?? [];
      const toHeader = headers.find((h) => typeof h.name === 'string' && h.name.toLowerCase() === 'to');
      const recipients = parseRecipientsFromToHeader(toHeader?.value);
      for (const email of recipients) {
        sentByEmail.set(email, (sentByEmail.get(email) ?? 0) + 1);
      }
    }
  }

  return { sentByEmail };
}

interface FetchAttempt {
  body?: unknown;
  error?: ScanResult & { ok: false };
}

/** Pulls only the non-secret diagnostic fields out of a Google error
 *  body — `{"error": {"code", "message", "status", "errors": [{"reason"}]}}`
 *  is the standard shape for both People and Gmail API error responses.
 *  Never touches the token, and these endpoints' error bodies never
 *  carry contact/email content — only metadata about the failure. */
function extractGoogleErrorDetail(body: unknown): GoogleErrorDetail | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const err = (body as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; message?: unknown; errors?: unknown };
  const detail: GoogleErrorDetail = {};
  if (typeof e.status === 'string') detail.status = e.status;
  if (typeof e.message === 'string') detail.message = e.message.slice(0, 300);
  if (Array.isArray(e.errors)) {
    const reasons = e.errors
      .map((x) => (typeof x === 'object' && x !== null ? (x as { reason?: unknown }).reason : undefined))
      .filter((r): r is string => typeof r === 'string');
    if (reasons.length > 0) detail.errors_reasons = reasons;
    const firstReason = e.errors[0];
    if (typeof firstReason === 'object' && firstReason !== null) {
      const r = (firstReason as { reason?: unknown }).reason;
      if (typeof r === 'string') detail.reason = r;
    }
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

async function fetchWithRetry(args: {
  url: string;
  headers: Record<string, string>;
  fetch: HttpFetch;
  sleep: (ms: number) => Promise<void>;
  rand: () => number;
  maxRetries: number;
  source: ScanSource;
}): Promise<FetchAttempt> {
  let attempt = 0;
  while (attempt <= args.maxRetries) {
    let res: HttpResponse;
    try {
      res = await args.fetch({ url: args.url, headers: args.headers });
    } catch (e) {
      if (attempt === args.maxRetries) {
        return { error: { ok: false, error: 'NETWORK', note: String(e).slice(0, 400), attempts: attempt + 1, source: args.source } };
      }
      await args.sleep(backoffMs(attempt, args.rand));
      attempt++;
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      return {
        error: {
          ok: false,
          error: 'AUTH_INVALID',
          note: `status ${res.status}`,
          attempts: attempt + 1,
          source: args.source,
          googleError: extractGoogleErrorDetail(res.body),
        },
      };
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === args.maxRetries) {
        return {
          error: {
            ok: false,
            error: 'RATE_LIMITED',
            note: `status ${res.status}`,
            attempts: attempt + 1,
            source: args.source,
            googleError: extractGoogleErrorDetail(res.body),
          },
        };
      }
      await args.sleep(backoffMs(attempt, args.rand));
      attempt++;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      return {
        error: {
          ok: false,
          error: 'MALFORMED',
          note: `status ${res.status}`,
          attempts: attempt + 1,
          source: args.source,
          googleError: extractGoogleErrorDetail(res.body),
        },
      };
    }
    return { body: res.body };
  }
  return { error: { ok: false, error: 'NETWORK', note: 'retry loop exhausted', attempts: attempt, source: args.source } };
}

function backoffMs(attempt: number, rand: () => number): number {
  // Exponential base 500ms · 500, 1000, 2000 · with ±25% jitter
  const base = 500 * 2 ** attempt;
  const jitter = base * 0.25 * (rand() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned.includes('@')) return null;
  return cleaned;
}

export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1);
}
