import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { api, clearApiGetCache } from "./api.ts";

describe("api GET dedupe", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearApiGetCache();
  });

  afterEach(() => {
    clearApiGetCache();
    globalThis.fetch = originalFetch;
  });

  test("dedupes concurrent GET requests", async () => {
    let calls = 0;
    let release!: () => void;

    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response(JSON.stringify({ value: 7 }), { status: 200 });
    }) as unknown as typeof fetch;

    const first = api<{ value: number }>("/api/fleet");
    const second = api<{ value: number }>("/api/fleet");

    expect(calls).toBe(1);
    release();

    await expect(first).resolves.toEqual({ value: 7 });
    await expect(second).resolves.toEqual({ value: 7 });
  });

  test("does not reuse completed GET responses", async () => {
    let calls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls++;
      return new Response(JSON.stringify({ value: calls }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(api<{ value: number }>("/api/fleet")).resolves.toEqual({ value: 1 });
    await expect(api<{ value: number }>("/api/fleet")).resolves.toEqual({ value: 2 });
    expect(calls).toBe(2);
  });

  test("does not dedupe non-GET requests", async () => {
    let calls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls++;
      return new Response(JSON.stringify({ ok: true, calls }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(api("/api/mesh/announce", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true, calls: 1 });
    await expect(api("/api/mesh/announce", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true, calls: 2 });
    expect(calls).toBe(2);
  });
});
