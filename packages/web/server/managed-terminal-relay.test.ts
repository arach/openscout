import { afterEach, describe, expect, mock, test } from "bun:test";

import { isTerminalRelayHealthy } from "./managed-terminal-relay.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("isTerminalRelayHealthy", () => {
  test("accepts the terminal relay health payload", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ ok: true, surface: "openscout-terminal-relay" })
    ) as typeof fetch;

    await expect(isTerminalRelayHealthy("http://127.0.0.1:3201")).resolves.toBe(true);
  });

  test("rejects a generic 200 response from another service", async () => {
    globalThis.fetch = mock(async () =>
      new Response("<!doctype html><title>Vite</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    ) as typeof fetch;

    await expect(isTerminalRelayHealthy("http://127.0.0.1:3201")).resolves.toBe(false);
  });

  test("rejects JSON that does not identify the terminal relay", async () => {
    globalThis.fetch = mock(async () => Response.json({ ok: true })) as typeof fetch;

    await expect(isTerminalRelayHealthy("http://127.0.0.1:3201")).resolves.toBe(false);
  });
});
