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
        webPort: 3200,
      }),
    ).toEqual({
      portalHost: "scout.local",
      nodeHost: "m1.scout.local",
      wildcardHost: "*.scout.local",
      scheme: "both",
      routes: [
        { host: "scout.local", upstream: "127.0.0.1:3200" },
        { host: "*.scout.local", upstream: "127.0.0.1:3200" },
      ],
    });
  });

  test("renders a Caddyfile for the local portal", () => {
    expect(
      renderOpenScoutCaddyfile(
        resolveOpenScoutLocalEdgeConfig({
          nodeHost: "m1.scout.local",
          webPort: 3200,
        }),
      ),
    ).toContain("http://*.scout.local {\n  reverse_proxy 127.0.0.1:3200\n}");
    expect(
      renderOpenScoutCaddyfile(
        resolveOpenScoutLocalEdgeConfig({
          nodeHost: "m1.scout.local",
          webPort: 3200,
        }),
      ),
    ).toContain("*.scout.local {\n  tls internal\n  reverse_proxy 127.0.0.1:3200\n}");
  });

  test("renders an HTTP Caddyfile for browser stores that do not trust local TLS yet", () => {
    expect(
      renderOpenScoutCaddyfile(
        resolveOpenScoutLocalEdgeConfig({
          nodeHost: "m1.scout.local",
          scheme: "http",
          webPort: 4311,
        }),
      ),
    ).toContain("http://*.scout.local {\n  reverse_proxy 127.0.0.1:4311\n}");
  });
});
