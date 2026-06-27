import { describe, expect, test } from "bun:test";

import {
  renderOpenScoutCaddyfile,
  resolveOpenScoutLocalEdgeConfig,
} from "./local-edge.ts";

describe("OpenScout local edge", () => {
  test("registers scout.local and the node host", () => {
    expect(
      resolveOpenScoutLocalEdgeConfig({
        nodeHost: "m1.scout.local",
        brokerPort: 43110,
        webPort: 43120,
      }),
    ).toEqual({
      portalHost: "scout.local",
      nodeHost: "m1.scout.local",
      wildcardHost: "*.scout.local",
      scheme: "http",
      brokerUpstream: "127.0.0.1:43110",
      routes: [
        { host: "scout.local", upstream: "127.0.0.1:43120" },
        { host: "*.scout.local", upstream: "127.0.0.1:43120" },
      ],
    });
  });

  test("renders a Caddyfile for the local portal", () => {
    const caddyfile = renderOpenScoutCaddyfile(
      resolveOpenScoutLocalEdgeConfig({
        nodeHost: "m1.scout.local",
        brokerPort: 43110,
        webPort: 43120,
      }),
    );

    expect(caddyfile).toContain("http://*.scout.local {");
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:43120 {");
    expect(caddyfile).not.toContain("tls internal");
    expect(caddyfile).toContain("Start Scout");
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:43110");
    expect(caddyfile).toContain("new URL(config.startPath, window.location.origin)");
  });

  test("registers additional tailnet hosts as edge routes", () => {
    const config = resolveOpenScoutLocalEdgeConfig({
      nodeHost: "m1.scout.local",
      brokerPort: 43110,
      webPort: 43120,
      extraHosts: ["m1.tailnet.ts.net.", "100.64.0.10", "m1.tailnet.ts.net"],
    });

    expect(config.routes).toEqual([
      { host: "scout.local", upstream: "127.0.0.1:43120" },
      { host: "*.scout.local", upstream: "127.0.0.1:43120" },
      { host: "m1.tailnet.ts.net", upstream: "127.0.0.1:43120" },
      { host: "100.64.0.10", upstream: "127.0.0.1:43120" },
    ]);

    const caddyfile = renderOpenScoutCaddyfile(config);
    expect(caddyfile).toContain("http://m1.tailnet.ts.net {");
    expect(caddyfile).toContain("http://100.64.0.10 {");
  });

  test("renders HTTPS blocks only when requested", () => {
    const caddyfile = renderOpenScoutCaddyfile(
      resolveOpenScoutLocalEdgeConfig({
        nodeHost: "m1.scout.local",
        brokerPort: 43110,
        scheme: "both",
        webPort: 43120,
      }),
    );

    expect(caddyfile).toContain("http://*.scout.local {");
    expect(caddyfile).toContain("*.scout.local {\n  tls internal");
  });

  test("renders a Vite HMR route when a vite upstream is configured", () => {
    const caddyfile = renderOpenScoutCaddyfile(
      resolveOpenScoutLocalEdgeConfig({
        nodeHost: "m1.scout.local",
        brokerPort: 43110,
        webPort: 43120,
        vitePort: 43122,
        viteHmrPath: "/ws/hmr",
      }),
    );

    expect(caddyfile).toContain("handle /ws/hmr* {");
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:43122");
    expect(caddyfile).toContain("reverse_proxy 127.0.0.1:43120 {");
    expect(caddyfile).toContain("http://dev.scout.local {");
    expect(caddyfile).toContain("http://dev.scout.local {\n  handle {\n    reverse_proxy 127.0.0.1:43122");
  });

  test("omits the Vite HMR route in production edge mode", () => {
    const caddyfile = renderOpenScoutCaddyfile(
      resolveOpenScoutLocalEdgeConfig({
        nodeHost: "m1.scout.local",
        brokerPort: 43110,
        webPort: 43120,
      }),
    );

    expect(caddyfile).not.toContain("handle /ws/hmr*");
    expect(caddyfile).not.toContain("reverse_proxy 127.0.0.1:43122");
  });

  test("renders an HTTP Caddyfile for browser stores that do not trust local TLS yet", () => {
    expect(
      renderOpenScoutCaddyfile(
        resolveOpenScoutLocalEdgeConfig({
          nodeHost: "m1.scout.local",
          brokerPort: 43110,
          scheme: "http",
          webPort: 4311,
        }),
      ),
    ).toContain("http://*.scout.local {");
    expect(
      renderOpenScoutCaddyfile(
        resolveOpenScoutLocalEdgeConfig({
          nodeHost: "m1.scout.local",
          brokerPort: 43110,
          scheme: "http",
          webPort: 4311,
        }),
      ),
    ).toContain("reverse_proxy 127.0.0.1:4311 {");
  });
});
