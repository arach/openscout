import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RENDERER_PORT,
  SCOUT_RENDERER_ENTRY_MARKER,
  SCOUT_RENDERER_ENTRY_PATH_MARKER,
  buildRendererUrl,
  isScoutRendererEntrySource,
  resolveRendererPort,
  waitForScoutRenderer,
} from "./dev-electron-lib.mjs";

test("isScoutRendererEntrySource accepts Scout entry aliases and transformed paths", () => {
  assert.equal(isScoutRendererEntrySource(`import "${SCOUT_RENDERER_ENTRY_MARKER}";`), true);
  assert.equal(isScoutRendererEntrySource(`import "/@fs/Users/arach/dev/openscout/apps/desktop/src${SCOUT_RENDERER_ENTRY_PATH_MARKER}";`), true);
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

test("waitForScoutRenderer bounds slow probe requests", async () => {
  const url = buildRendererUrl("127.0.0.1", DEFAULT_RENDERER_PORT);
  const startedAt = Date.now();

  await assert.rejects(
    waitForScoutRenderer(url, {
      timeoutMs: 100,
      requestTimeoutMs: 20,
      sleep: async () => {},
      fetchImpl: async (_input, init = {}) => {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 250);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return new Response("<html></html>", { status: 200 });
      },
    }),
    /Timed out waiting for renderer/,
  );

  assert.ok(Date.now() - startedAt < 500);
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
