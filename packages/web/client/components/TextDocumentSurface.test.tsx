import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

const { createTextDocument, TextDocumentSurface } = await import("./TextDocumentSurface.tsx");

describe("TextDocumentSurface", () => {
  test("highlights TypeScript code previews", () => {
    const document = createTextDocument({
      id: "preview",
      filename: "page.tsx",
      mediaType: "text/typescript",
      value: "const url = \"http://localhost:3500/talkie-marks\";\nreturn url;",
      kind: "code",
      readOnly: true,
    });

    const html = renderToStaticMarkup(createElement(TextDocumentSurface, { document, mode: "read" }));

    expect(html).toContain("s-syntax-keyword");
    expect(html).toContain("s-syntax-string");
    expect(html).toContain("http://localhost:3500/talkie-marks");
  });
});
