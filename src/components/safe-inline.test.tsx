/**
 * safe-inline · tests
 *
 * Verifies that the small approved vocabulary renders, and that any
 * out-of-vocabulary input (script tag, onerror handler, arbitrary
 * class name) is neutralised. Uses ReactDOMServer.renderToStaticMarkup
 * so we don't need a DOM testing library dependency — asserting on
 * the raw HTML string is enough to catch every hardening regression.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInline } from "./safe-inline";

function html(input: string): string {
  return renderToStaticMarkup(<>{renderInline(input)}</>);
}

describe("renderInline", () => {
  it("renders plain text", () => {
    expect(html("Just plain text.")).toBe("Just plain text.");
  });

  it("renders <b> as <strong>", () => {
    expect(html("Have <b>15 clippers</b>.")).toContain(
      "<strong>15 clippers</strong>",
    );
  });

  it("preserves allowlisted class names", () => {
    const out = html('lose <span class="ci-money">$742.50/mo</span>');
    expect(out).toContain('<span class="ci-money">$742.50/mo</span>');
  });

  it("drops class names outside the allowlist", () => {
    const out = html('<span class="attacker-class">hi</span>');
    expect(out).not.toContain("attacker-class");
    expect(out).toContain("hi");
  });

  it("renders <br> tags", () => {
    expect(html("line 1<br/>line 2")).toContain("<br/>");
  });

  it("neutralises <script> injection", () => {
    const out = html('safe<script>alert("xss")</script>afterwards');
    // Angle-brackets from the injected <script> tag get HTML-escaped
    // by React's default text rendering — no live <script> element
    // can ever land in the DOM tree.
    expect(out).not.toContain("<script>");
    expect(out).toContain("safe");
    expect(out).toContain("afterwards");
  });

  it("neutralises onerror handler injection via <img>", () => {
    const out = html("a<img src=x onerror=alert(1)/>b");
    expect(out).not.toContain("<img");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("supports nested strong-in-strong", () => {
    const out = html("<b>outer <b>inner</b> tail</b>");
    // Match at least 2 <strong> opens; escaping / self-closing may vary.
    const matches = out.match(/<strong/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("returns null for empty input", () => {
    expect(renderInline("")).toBeNull();
  });
});
