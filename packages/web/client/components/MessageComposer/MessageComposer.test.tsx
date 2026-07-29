import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

const { MessageComposer } = await import("./MessageComposer.tsx");

describe("MessageComposer overlays", () => {
  test("renders suggestions outside the clipped composer shell", () => {
    const html = renderToStaticMarkup(createElement(MessageComposer, {
      value: "/",
      onChange: () => undefined,
      onSend: () => undefined,
      showDictation: false,
      overlay: createElement("div", { role: "listbox" }, "Slash commands"),
    }));

    const frameStart = html.indexOf('class="s-msg-compose-frame"');
    const overlayStart = html.indexOf('role="listbox"');
    const shellStart = html.indexOf('class="s-msg-compose-shell"');
    expect(frameStart).toBeGreaterThanOrEqual(0);
    expect(overlayStart).toBeGreaterThan(frameStart);
    expect(shellStart).toBeGreaterThan(overlayStart);
    expect(html).toContain(
      'role="listbox">Slash commands</div><div class="s-msg-compose-shell"',
    );
  });
});
