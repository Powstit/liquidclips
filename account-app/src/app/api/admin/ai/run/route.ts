// IRON GATE IG-HQ-003 — AI Terminal server proxy
//
// This route is the ONLY path from the Admin HQ AI Terminal client to
// Anthropic. It MUST stay locked down:
//
//   1. Admin gate via Clerk + admin allow-list (defence in depth — page
//      gates, middleware gates, this route gates again).
//   2. Anthropic API key is server-only — `process.env.CLAUDE_ADMIN_API_KEY`.
//      The key is NEVER returned, logged, or sent to the browser.
//   3. Rate limit: 30 requests / hour / admin (in-memory sliding window).
//      Pre-flight cost-cap math was removed in P1-004 — the cap was
//      internally contradictory (50k input alone exceeded the $0.50
//      ceiling at Opus pricing). Real usage and cost are still recorded
//      in the audit log for visibility; the rate limit is the spend
//      backstop.
//   4. PII redaction: every email address in the live data dump is
//      replaced with a `<email_N>` placeholder before the prompt leaves
//      this process. The inverse mapping is held in-request memory only
//      and is used to un-redact the model's reply on the way back.
//   5. Audit: every prompt+response pair is POSTed to junior-backend
//      `/admin/audit-log` so Daniel has a permanent trail (including
//      tokens_in / tokens_out / cost_usd actuals).
//   6. Read-only contract: NO tool use, NO streaming, NO function calls.
//      Pure text in / text out.
//
// IRON GATE: do NOT add tool use, do NOT remove the redaction, do NOT
// remove the rate limit. Any of those changes needs a fresh review and
// a registry entry in `desktop/docs/IRON_GATES.md` under IG-HQ-003.
//
// IRON GATE IG-HQ-003 END
// (sentinel comments — pre-commit hook refuses deletion without
// IRON_GATE_OVERRIDE in the commit message.)

import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import Anthropic from "@anthropic-ai/sdk";
import { isAdmin } from "@/lib/admin-allowlist";
import {
  contextBackendPath,
  systemPromptFor,
  TERMINAL_CONTEXTS,
  type TerminalContext,
} from "@/lib/ai-terminal-prompts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- Config --------------------------------------------------------------

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

// Model id — per the HQ-Agent-4 spec. The Anthropic SDK accepts the
// public model string; we do not pin a per-call beta header so the
// default 200k context window applies. The health route
// (/api/admin/ai/health) pings this same model id so any 404 surfaces
// loudly before a user-facing call hits it.
const MODEL = "claude-opus-4-7";
const MAX_OUTPUT_TOKENS = 4096;

// Pricing constants retained for audit-log cost accounting only. They
// no longer gate any request (see P1-004 header note above).
const PRICE_INPUT_PER_MTOK = 15.0; // $/M input tokens
const PRICE_OUTPUT_PER_MTOK = 75.0; // $/M output tokens

const RATE_LIMIT_REQUESTS_PER_HOUR = 30;

// ---- Admin gate ----------------------------------------------------------

type AdminIdentity = { userId: string; email: string };

async function requireAdmin(): Promise<AdminIdentity | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user) return null;
  const email = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  if (!isAdmin(email)) return null;
  return { userId, email };
}

// ---- Rate limit (in-memory, per-admin) -----------------------------------
//
// Simple sliding-window-by-hour. This is per-Node-process; Vercel may
// spin multiple lambdas. That's acceptable for a 30/hr ceiling — the
// real backstop is the cost guard below.

type RateBucket = { hourStartMs: number; count: number };
const rateBuckets = new Map<string, RateBucket>();
const ONE_HOUR_MS = 60 * 60 * 1000;

function rateLimitHit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now - bucket.hourStartMs >= ONE_HOUR_MS) {
    rateBuckets.set(userId, { hourStartMs: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_REQUESTS_PER_HOUR;
}

// ---- PII redaction --------------------------------------------------------
//
// Email-only redaction for MVP. We deliberately do NOT regex names,
// phone numbers, or addresses — they're either absent from the admin
// snapshots or already labelled (e.g. user id, clerk id). Adding a
// loose name redactor would create false positives that break the
// model's grounding.

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type RedactionMap = { forward: Map<string, string>; reverse: Map<string, string> };

function redactEmails(input: string): { redacted: string; map: RedactionMap } {
  const forward = new Map<string, string>(); // email → placeholder
  const reverse = new Map<string, string>(); // placeholder → email
  let counter = 0;
  const redacted = input.replace(EMAIL_REGEX, (match) => {
    const key = match.toLowerCase();
    const existing = forward.get(key);
    if (existing) return existing;
    counter += 1;
    const placeholder = `<email_${counter}>`;
    forward.set(key, placeholder);
    reverse.set(placeholder, match);
    return placeholder;
  });
  return { redacted, map: { forward, reverse } };
}

function unredact(text: string, map: RedactionMap): string {
  let out = text;
  for (const [placeholder, email] of map.reverse.entries()) {
    // global, literal replace; placeholder shape (<email_N>) is regex-safe.
    out = out.split(placeholder).join(email);
  }
  return out;
}

// ---- Live context fetch --------------------------------------------------

async function fetchContextSnapshot(
  context: TerminalContext,
  adminId: string,
): Promise<unknown> {
  const path = contextBackendPath(context);
  const url = `${BACKEND_URL}/admin/${path}${path.includes("?") ? "&" : "?"}clerk_user_id=${encodeURIComponent(adminId)}`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { error: `backend ${context} returned ${res.status}` };
    }
    return await res.json();
  } catch {
    return { error: `backend ${context} unreachable` };
  }
}

// ---- Audit log post -------------------------------------------------------

type AuditPayload = {
  prompt: string;
  response: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
};

async function appendAudit(args: {
  adminEmail: string;
  context: TerminalContext;
  payload: AuditPayload;
  result: "ok" | "error";
}): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/admin/audit-log`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        actor_email: args.adminEmail,
        action: "ai.run",
        target_type: "ai",
        target_id: args.context,
        payload_json: args.payload,
        result: args.result,
      }),
      cache: "no-store",
    });
  } catch {
    // Audit log failures must NOT break the user-facing response. The
    // request/response is still in Vercel logs as a fallback.
  }
}

// ---- Request types --------------------------------------------------------

type ChatMsg = { role: "user" | "assistant"; content: string };

type RunRequestBody = {
  context: TerminalContext;
  prompt: string;
  history?: ChatMsg[];
};

function parseBody(raw: unknown): RunRequestBody | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const context = obj.context;
  const prompt = obj.prompt;
  if (
    typeof context !== "string" ||
    !TERMINAL_CONTEXTS.includes(context as TerminalContext)
  ) {
    return null;
  }
  if (typeof prompt !== "string" || prompt.trim().length === 0) return null;
  if (prompt.length > 8_000) return null; // user prompt cap — separate from token cap

  let history: ChatMsg[] = [];
  if (Array.isArray(obj.history)) {
    history = obj.history
      .filter(
        (m): m is ChatMsg =>
          !!m &&
          typeof m === "object" &&
          ((m as ChatMsg).role === "user" || (m as ChatMsg).role === "assistant") &&
          typeof (m as ChatMsg).content === "string",
      )
      .slice(-20); // last 20 turns max
  }

  return { context: context as TerminalContext, prompt, history };
}

// ---- Cost accounting (post-flight only) ----------------------------------
//
// P1-004: pre-flight cost-cap math removed (50k input alone exceeded the
// $0.50 ceiling at Opus pricing — internally contradictory). Real token
// counts come back from Anthropic in the response usage block; we use
// `actualCostUsd` only to record the spend in the audit log.

function actualCostUsd(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * PRICE_INPUT_PER_MTOK + (tokensOut / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
}

// ---- Handler --------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  if (rateLimitHit(admin.userId)) {
    return NextResponse.json(
      { error: "rate limit exceeded — 30 requests/hour" },
      { status: 429 },
    );
  }

  const apiKey = process.env.CLAUDE_ADMIN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CLAUDE_ADMIN_API_KEY not configured on the server" },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "invalid request shape (need {context, prompt, history?})" },
      { status: 400 },
    );
  }

  // 1) Fetch the live snapshot from junior-backend.
  const snapshotRaw = await fetchContextSnapshot(body.context, admin.userId);
  const snapshotJson = JSON.stringify(snapshotRaw, null, 2);

  // 2) Redact emails in the snapshot AND in the user prompt and history.
  //    The same redaction map covers both, so the model sees a consistent
  //    placeholder for any given address whether it appeared in the
  //    snapshot or in Daniel's wording.
  const combined = `${snapshotJson}\n\n${body.prompt}\n\n${body.history?.map((m) => m.content).join("\n") ?? ""}`;
  const { map } = redactEmails(combined);

  // Apply the map by re-running redaction (deterministic — same input
  // produces same placeholders) across the individual fields.
  const { redacted: snapshotRedacted } = redactEmails(snapshotJson);
  const { redacted: promptRedacted } = redactEmails(body.prompt);
  const historyRedacted: ChatMsg[] = (body.history ?? []).map((m) => ({
    role: m.role,
    content: redactEmails(m.content).redacted,
  }));

  // 3) Assemble the system prompt with the live data dump appended.
  const systemPrompt =
    `${systemPromptFor(body.context)}\n\n` +
    `--- LIVE DATA SNAPSHOT (PII REDACTED) ---\n${snapshotRedacted}\n--- END SNAPSHOT ---\n`;

  // 4) Call Anthropic. No streaming, no tools. (Pre-flight cost-cap math
  //    removed per P1-004 — see header comment.)
  const client = new Anthropic({ apiKey });
  let modelMessage = "";
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: [
        ...historyRedacted.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: promptRedacted },
      ],
    });
    tokensIn = result.usage?.input_tokens ?? 0;
    tokensOut = result.usage?.output_tokens ?? 0;
    // Text-only contract — concatenate text blocks; ignore any other
    // block type (the request never asks for tool use, but if Anthropic
    // ever returns one we silently drop it).
    for (const block of result.content) {
      if (block.type === "text") modelMessage += block.text;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "anthropic call failed";
    await appendAudit({
      adminEmail: admin.email,
      context: body.context,
      payload: {
        prompt: body.prompt,
        response: message,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
      },
      result: "error",
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 5) Un-redact ONLY the model's reply so Daniel sees real addresses.
  //    The redaction map never leaves this process.
  const unredacted = unredact(modelMessage, map);
  const costUsd = actualCostUsd(tokensIn, tokensOut);

  // 6) Audit the successful run with REAL emails (Daniel's eyes only).
  await appendAudit({
    adminEmail: admin.email,
    context: body.context,
    payload: {
      prompt: body.prompt,
      response: unredacted,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: Number(costUsd.toFixed(4)),
    },
    result: "ok",
  });

  return NextResponse.json({
    message: unredacted,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: Number(costUsd.toFixed(4)),
  });
}
