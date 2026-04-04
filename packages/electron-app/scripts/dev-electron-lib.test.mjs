import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RENDERER_PORT,
  SCOUT_RENDERER_ENTRY_MARKER,
  buildRendererUrl,
  isScoutRendererEntrySource,
  resolveRendererPort,
  waitForScoutRenderer,
} from "./dev-electron-lib.mjs";

test("isScoutRendererEntrySource only accepts the Scout renderer entry", () => {
  assert.equal(isScoutRendererEntrySource(`import "${SCOUT_RENDERER_ENTRY_MARKER}";`), true);
  assert.equal(isScoutRendererEntrySource('import "/Users/arach/dev/spectator/src/entry-client.tsx";'), false);
});

test("waitForScoutRenderer accepts the Scout renderer", async () => {
  const calls = [];
  const url = buildRendererUrl("127.0.0.1", DEFAULT_RENDERER_PORT);

  await waitForScoutRenderer(url, {
    timeoutMs: 100,
    sleep: async () => {},
    fetchImpl: async (input) => {
      const href = String(input);
      calls.push(href);
      if (href.endsWith("/src/entry-client.tsx")) {
        return new Response(`import "${SCOUT_RENDERER_ENTRY_MARKER}";`, { status: 200 });
      }
      return new Response("<html></html>", { status: 200 });
    },
  });

  assert.deepEqual(calls, [
    `http://127.0.0.1:${DEFAULT_RENDERER_PORT}`,
    `http://127.0.0.1:${DEFAULT_RENDERER_PORT}/src/entry-client.tsx`,
  ]);
});

test("resolveRendererPort skips busy default ports", async () => {
  const checked = [];
  const port = await resolveRendererPort({
    host: "127.0.0.1",
    requestedPort: DEFAULT_RENDERER_PORT,
    isPortAvailable: async (_host, candidate) => {
      checked.push(candidate);
      return candidate === DEFAULT_RENDERER_PORT + 2;
    },
  });

  assert.equal(port, DEFAULT_RENDERER_PORT + 2);
  assert.deepEqual(checked, [
    DEFAULT_RENDERER_PORT,
    DEFAULT_RENDERER_PORT + 1,
    DEFAULT_RENDERER_PORT + 2,
  ]);
});
