import { describe, expect, test } from "bun:test";

import { resolveRelayEndpointForTailscaleStatus } from "./relay-runtime";

describe("resolveRelayEndpointForTailscaleStatus", () => {
  test("uses tailscale hostname when tailscale is running", () => {
    const endpoint = resolveRelayEndpointForTailscaleStatus(7889, {
      backendState: "Running",
      dnsName: "relay.example.ts.net",
      online: true,
      health: [],
    });

    expect(endpoint.relayUrl).toBe("wss://relay.example.ts.net:7889");
  });

  test("falls back to loopback when tailscale is stopped", () => {
    const endpoint = resolveRelayEndpointForTailscaleStatus(7889, {
      backendState: "Stopped",
      dnsName: "relay.example.ts.net",
      online: false,
      health: ["Tailscale is stopped."],
    });

    expect(endpoint.relayUrl).toBe("ws://127.0.0.1:7889");
  });
});
