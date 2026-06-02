import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDom = await import("../../node_modules/react-dom/index.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ReactDom);

const openFilePreviewCalls: Array<[string, unknown]> = [];
mock.module(new URL("../scout/Provider.tsx", import.meta.url).pathname, () => ({
  useScout: () => ({
    openFilePreview: (path: string, range?: unknown) => {
      openFilePreviewCalls.push([path, range]);
    },
  }),
}));

const { findPathMatches, PathToken, formatPathRange } = await import("./path-token.tsx");

describe("findPathMatches", () => {
  test("matches a plain workspace-relative path with no range", () => {
    const text = "see packages/web/client/lib/path-token.tsx for the regex";
    const matches = findPathMatches(text);
    expect(matches.length).toBe(1);
    expect(matches[0]!.path).toBe("packages/web/client/lib/path-token.tsx");
    expect(matches[0]!.range).toBeUndefined();
    expect(matches[0]!.raw).toBe("packages/web/client/lib/path-token.tsx");
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(matches[0]!.raw);
  });

  test("parses a `:N-M` line range as the operator's spec describes", () => {
    const text = "see docs/eng/sco-046-cross-machine-agent-ui-spec.md:43-59 for product thesis";
    const matches = findPathMatches(text);
    expect(matches.length).toBe(1);
    expect(matches[0]!.path).toBe("docs/eng/sco-046-cross-machine-agent-ui-spec.md");
    expect(matches[0]!.range).toEqual({ start: 43, end: 59 });
    expect(matches[0]!.raw).toBe("docs/eng/sco-046-cross-machine-agent-ui-spec.md:43-59");
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(matches[0]!.raw);
  });

  test("parses a `:N` single-line range", () => {
    const matches = findPathMatches("see app/main.ts:123 for the bug");
    expect(matches.length).toBe(1);
    expect(matches[0]!.path).toBe("app/main.ts");
    expect(matches[0]!.range).toEqual({ start: 123 });
    expect(matches[0]!.raw).toBe("app/main.ts:123");
  });

  test("keeps the whole token (path + range) as one match in inline-code context", () => {
    const text = "ref `docs/foo.md:43-59`";
    const matches = findPathMatches(text);
    expect(matches.length).toBe(1);
    expect(matches[0]!.raw).toBe("docs/foo.md:43-59");
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(matches[0]!.raw);
  });

  test("strips trailing prose punctuation but preserves the range", () => {
    const text = "in docs/foo.md:43-59, there's a thesis.";
    const matches = findPathMatches(text);
    expect(matches.length).toBe(1);
    expect(matches[0]!.path).toBe("docs/foo.md");
    expect(matches[0]!.range).toEqual({ start: 43, end: 59 });
    expect(matches[0]!.raw).toBe("docs/foo.md:43-59");
  });

  test("drops invalid ranges (start=0, end<start)", () => {
    const matches = findPathMatches("weird docs/foo.md:0 and docs/bar.md:50-10");
    expect(matches.length).toBe(2);
    expect(matches[0]!.path).toBe("docs/foo.md");
    expect(matches[0]!.range).toBeUndefined();
    expect(matches[1]!.path).toBe("docs/bar.md");
    expect(matches[1]!.range).toBeUndefined();
  });

  test("does not invent a range on prose paths without a `:N` suffix", () => {
    const matches = findPathMatches("touch packages/foo.ts and packages/bar.ts now");
    expect(matches.length).toBe(2);
    expect(matches[0]!.range).toBeUndefined();
    expect(matches[1]!.range).toBeUndefined();
  });

  test("handles an absolute path with a range", () => {
    const raw = "/Users/arach/dev/openscout/packages/web/server/file-preview.ts:229-325";
    const matches = findPathMatches(`see ${raw} for read logic`);
    expect(matches.length).toBe(1);
    expect(matches[0]!.path).toBe("/Users/arach/dev/openscout/packages/web/server/file-preview.ts");
    expect(matches[0]!.range).toEqual({ start: 229, end: 325 });
    expect(matches[0]!.raw).toBe(raw);
  });

  test("does not confuse a URL fragment for a range", () => {
    const matches = findPathMatches("read packages/web/path-token.tsx#L43 for context");
    expect(matches.length).toBe(1);
    expect(matches[0]!.path).toBe("packages/web/path-token.tsx");
    expect(matches[0]!.range).toBeUndefined();
  });
});

describe("formatPathRange", () => {
  test("renders single-line and multi-line ranges", () => {
    expect(formatPathRange(undefined)).toBe("");
    expect(formatPathRange({ start: 7 })).toBe("7");
    expect(formatPathRange({ start: 43, end: 59 })).toBe("43-59");
  });
});

describe("PathToken rendering", () => {
  test("shows the path:start-end token text and a range data attribute", () => {
    const html = renderToStaticMarkup(
      createElement(PathToken, { path: "docs/foo.md", range: { start: 43, end: 59 } }),
    );
    expect(html).toContain(">docs/foo.md:43-59<");
    expect(html).toContain('data-range="43-59"');
    expect(html).toContain('data-path="docs/foo.md"');
    expect(html).toContain('title="Open docs/foo.md (lines 43-59)"');
  });

  test("falls back to plain path text when no range is supplied", () => {
    const html = renderToStaticMarkup(createElement(PathToken, { path: "docs/foo.md" }));
    expect(html).toContain(">docs/foo.md<");
    expect(html).not.toContain("data-range=");
    expect(html).toContain('title="Open docs/foo.md"');
  });
});
