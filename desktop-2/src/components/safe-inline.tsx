/**
 * safe-inline · Phase 4 hardening (2026-07-04)
 *
 * Every Section-B port used to shove a config string straight into
 * `dangerouslySetInnerHTML` so hero copy could include inline emphasis
 * markup (`<b class="ci-life">for LIFE</b>` etc). The strings are all
 * currently hard-coded in the module they render from — no user input
 * flows in — but the audit called the pattern out as P0 because a
 * future edit could accept a server-provided copy string and inherit
 * XSS overnight.
 *
 * `renderInline` walks the string, matches only the small tag
 * vocabulary the mockups approved, and hands back a React node array.
 * Anything outside the vocabulary renders as literal text so an
 * `<img onerror>` or `<script>` payload can never execute — no
 * dangerouslySetInnerHTML, no DOMPurify dep required.
 *
 * Supported vocabulary (matches the approved HTML mockups only):
 *   <b>…</b>            → <strong>…</strong>
 *   <strong>…</strong>  → <strong>…</strong>
 *   <br/> · <br>         → <br />
 *   <span class="X">…</span>  → <span className="X">…</span>
 *
 * Nested tags are supported (`<b class="ci-life">for <b>LIFE</b></b>`).
 * Unknown tags / attributes / self-close variants render as plain text.
 */

import type { ReactNode } from "react";

// Allowlist of `class` values that are safe to project into `className`.
// If a config string ever wants a NEW class, add it here explicitly.
// Anything not in the set falls back to no className so a copy edit
// can't smuggle in an arbitrary class name.
const ALLOWED_CLASSES = new Set<string>([
  "ci-money",
  "ci-life",
  "smmd-hook-h1-em",
  "smmd-money",
  "smmd-life",
  "wd-money",
  "wd-life",
  "cat-money",
  "cat-life",
]);

interface Token {
  kind: "text" | "open" | "close" | "self";
  raw: string;
  tag?: string;
  className?: string;
}

// Only match <b>, <strong>, <br>, <span class="…"> (with double or
// single quotes). Anything else is treated as literal text.
const TOKEN_RE =
  /<\/?(?:b|strong|span|br)(?:\s+class=["']([a-z0-9_ -]+)["'])?\s*\/?>/gi;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(source)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: "text", raw: source.slice(cursor, match.index) });
    }
    const raw = match[0];
    // Extract the tag name by matching a-z run right after the opening
    // "<" (with optional "/"). Prior string-replace chain only stripped
    // one trailing character, so `<br/>` ended up as tag="br/" and fell
    // out of the self-close branch — <br> silently regressed to text.
    const tagMatch = raw.match(/^<\/?([a-z]+)/i);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : "";
    const className = match[1];
    if (tag === "br") {
      tokens.push({ kind: "self", raw, tag });
    } else if (raw.startsWith("</")) {
      tokens.push({ kind: "close", raw, tag });
    } else {
      tokens.push({ kind: "open", raw, tag, className });
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) {
    tokens.push({ kind: "text", raw: source.slice(cursor) });
  }
  return tokens;
}

interface Frame {
  tag?: string;
  className?: string;
  children: ReactNode[];
}

export function renderInline(input: string): ReactNode {
  if (!input) return null;
  const tokens = tokenize(input);
  const stack: Frame[] = [{ children: [] }];
  let keyCounter = 0;

  const push = (node: ReactNode) => {
    stack[stack.length - 1].children.push(node);
  };

  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        push(token.raw);
        break;
      case "self":
        // <br>
        push(<br key={`br-${keyCounter++}`} />);
        break;
      case "open":
        stack.push({ tag: token.tag, className: token.className, children: [] });
        break;
      case "close": {
        const frame = stack.pop();
        if (!frame || frame.tag !== token.tag) {
          // Mismatched close — render everything as literal text so
          // the reader sees a hint that copy is broken rather than
          // getting a silent partial render.
          if (frame) {
            push(`<${frame.tag}>`);
            frame.children.forEach(push);
          }
          push(token.raw);
          break;
        }
        const key = `t-${keyCounter++}`;
        const safeClass =
          frame.className && ALLOWED_CLASSES.has(frame.className)
            ? frame.className
            : undefined;
        if (frame.tag === "b" || frame.tag === "strong") {
          push(
            <strong key={key} className={safeClass}>
              {frame.children}
            </strong>,
          );
        } else if (frame.tag === "span") {
          push(
            <span key={key} className={safeClass}>
              {frame.children}
            </span>,
          );
        } else {
          // Unknown tag — render children unwrapped.
          frame.children.forEach(push);
        }
        break;
      }
    }
  }

  // Any unclosed frames render as literal so nothing silently disappears.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack[stack.length - 1].children.push(`<${frame.tag}>`);
    frame.children.forEach((c) => stack[stack.length - 1].children.push(c));
  }

  return stack[0].children;
}
