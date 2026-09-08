import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// The panel escapes every outside string before it reaches a template. That
// makes escapeHtml the single point where an attacker-controlled layer name,
// commit message or branch name is neutralised, so it is tested on its own
// rather than only through the views that call it.
async function escapeHtml(): Promise<(value: unknown) => string> {
  const source = await readFile(resolve("apps/photoshop-plugin/index.js"), "utf8");
  // The panel declares it on one line; taking the whole line avoids guessing
  // where the body ends, which a brace-counting regex gets wrong on the object
  // literal inside it.
  const declaration = source.split("\n").find((line) => line.startsWith("function escapeHtml(value)"));
  expect(declaration, "escapeHtml is no longer declared on one line in the panel script").toBeTruthy();
  return runInNewContext(`${declaration}; escapeHtml`);
}

describe("Panel HTML escaping", () => {
  it("escapes every character that can break out of markup or an attribute", async () => {
    const escape = await escapeHtml();
    expect(escape("&")).toBe("&amp;");
    expect(escape("<")).toBe("&lt;");
    expect(escape(">")).toBe("&gt;");
    expect(escape('"')).toBe("&quot;");
    expect(escape("'")).toBe("&#39;");
  });

  it("neutralises a script tag hidden in a layer name", async () => {
    const escape = await escapeHtml();
    const escaped = escape('<script>alert(1)</script>');
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
  });

  it("neutralises an attribute break-out in a commit message", async () => {
    const escape = await escapeHtml();
    // The history row interpolates the message into title="…" as well as text.
    const escaped = escape('" onmouseover="steal()');
    expect(escaped).not.toContain('"');
    expect(escaped).toContain("&quot;");
  });

  it("escapes the ampersand so an escaped value cannot be double-decoded", async () => {
    const escape = await escapeHtml();
    expect(escape("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("escapes every occurrence, not only the first", async () => {
    const escape = await escapeHtml();
    expect(escape("<<<")).toBe("&lt;&lt;&lt;");
    expect(escape("a<b<c")).toBe("a&lt;b&lt;c");
  });

  it("renders null and undefined as an empty string rather than as text", async () => {
    const escape = await escapeHtml();
    expect(escape(null)).toBe("");
    expect(escape(undefined)).toBe("");
  });

  it("coerces a non-string without losing the escape", async () => {
    const escape = await escapeHtml();
    expect(escape({ toString: () => "<b>" })).toBe("&lt;b&gt;");
    expect(escape(42)).toBe("42");
  });

  it("leaves ordinary text exactly as it was", async () => {
    const escape = await escapeHtml();
    expect(escape("Hero typography — v2 (final)")).toBe("Hero typography — v2 (final)");
  });
});
