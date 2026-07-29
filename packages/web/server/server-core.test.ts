import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installScoutApiMiddleware, registerScoutWebAssets } from "./server-core.ts";

const testDirectories = new Set<string>();

afterEach(() => {
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

function createApp(options?: Parameters<typeof installScoutApiMiddleware>[2]) {
  const app = new Hono();
  installScoutApiMiddleware(app, "test", options);
  app.get("/api/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("installScoutApiMiddleware", () => {
  test("allows same-origin loopback API requests", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/api/ping", {
      headers: {
        origin: "http://localhost",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("allows same-origin API requests through the unspecified bind address", async () => {
    const app = createApp();
    const response = await app.request("http://0.0.0.0:43122/api/ping", {
      headers: {
        origin: "http://0.0.0.0:43122",
      },
    });

    expect(response.status).toBe(200);
  });

  test("rejects cross-origin API requests", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/api/ping", {
      headers: {
        origin: "https://example.com",
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("rejects non-loopback API hosts", async () => {
    const app = createApp();
    const response = await app.request("http://evil.test/api/ping");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("allows configured Scout mDNS API hosts", async () => {
    const app = createApp({
      trustedHosts: ["scout.hudson-mini.local"],
    });
    const response = await app.request("http://scout.hudson-mini.local/api/ping", {
      headers: {
        origin: "http://scout.hudson-mini.local",
      },
    });

    expect(response.status).toBe(200);
  });

  test("rejects a spoofed loopback Host from a non-loopback peer", async () => {
    const app = createApp({ resolvePeerAddress: () => "192.168.1.50" });
    const response = await app.request("http://localhost/api/ping");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("allows a loopback Host from a loopback peer", async () => {
    const app = createApp({ resolvePeerAddress: () => "::ffff:127.0.0.1" });
    const response = await app.request("http://localhost/api/ping", {
      headers: { origin: "http://localhost" },
    });

    expect(response.status).toBe(200);
  });

  test("trusts configured mDNS hosts regardless of peer address", async () => {
    const app = createApp({
      trustedHosts: ["scout.hudson-mini.local"],
      resolvePeerAddress: () => "192.168.1.50",
    });
    const response = await app.request("http://scout.hudson-mini.local/api/ping", {
      headers: { origin: "http://scout.hudson-mini.local" },
    });

    expect(response.status).toBe(200);
  });

  test("allows configured public origins through a loopback proxy", async () => {
    const app = createApp({
      trustedHosts: ["scout.hudson-mini.local"],
      trustedOrigins: ["https://scout.hudson-mini.local"],
    });
    const response = await app.request("http://127.0.0.1:43120/api/ping", {
      headers: {
        origin: "https://scout.hudson-mini.local",
      },
    });

    expect(response.status).toBe(200);
  });
});

describe("registerScoutWebAssets", () => {
  function createStaticRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "openscout-web-assets-"));
    testDirectories.add(root);
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<!doctype html><body>Scout</body>", "utf8");
    writeFileSync(join(root, "assets", "index-AbCd1234.js"), "export {};", "utf8");
    writeFileSync(join(root, "assets", "index.js"), "export {};", "utf8");
    return root;
  }

  test("caches fingerprinted assets immutably while keeping HTML uncached", async () => {
    const app = new Hono();
    await registerScoutWebAssets(app, {
      assetMode: "static",
      staticRoot: createStaticRoot(),
      defaultViteUrl: "http://127.0.0.1:43122",
    });

    const assetResponse = await app.request("http://localhost/assets/index-AbCd1234.js");
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );

    const unhashedAssetResponse = await app.request("http://localhost/assets/index.js");
    expect(unhashedAssetResponse.status).toBe(200);
    expect(unhashedAssetResponse.headers.get("cache-control")).toBeNull();

    for (const path of ["/index.html", "/projects"]) {
      const htmlResponse = await app.request(`http://localhost${path}`);
      expect(htmlResponse.status).toBe(200);
      expect(htmlResponse.headers.get("cache-control")).toBe("no-store");
    }
  });
});
