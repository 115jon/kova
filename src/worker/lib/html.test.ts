import { describe, expect, it } from "vitest";
import { escapeHtml, jsonForHtmlScript } from "./html";

describe("escapeHtml", () => {
  it("escapes markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;",
    );
  });

  it("treats nullish as empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("jsonForHtmlScript", () => {
  it("escapes script breakout payloads", () => {
    const encoded = jsonForHtmlScript({
      state: `</script><script>alert(1)</script>`,
    });
    expect(encoded).not.toContain("</script>");
    expect(encoded).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(encoded)).toEqual({
      state: `</script><script>alert(1)</script>`,
    });
  });
});
