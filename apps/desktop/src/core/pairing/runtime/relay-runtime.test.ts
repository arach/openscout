import { describe, expect, test } from "bun:test";

import { resolveRelayEndpointForTailscaleStatus } from "./relay-runtime";

describe("resolveRelayEndpointForTailscaleStatus", () => {
  const tls = { cert: "/tmp/scout-test.crt", key: "/tmp/scout-test.key" };

  test("prefers the local network address when tailscale is running", () => {
    const endpoint = resolveRelayEndpointForTailscaleStatus(7889, {
      backendState: "Running",
      dnsName: "relay.example.ts.net",
      online: true,
      health: [],
    }, {
      localAddress: "192.168.1.25",
      tls,
    });

    expect(endpoint.relayUrl).toBe("wss://192.168.1.25:7889");
    expect(endpoint.connectUrl).toBe("wss://127.0.0.1:7889");
    expect(endpoint.fallbackRelayUrls).toEqual(["wss://relay.example.ts.net:7889"]);
  });

  test("uses tailscale hostname when no local address is available", () => {
    const endpoint = resolveRelayEndpointForTailscaleStatus(7889, {
      backendState: "Running",
      dnsName: "relay.example.ts.net",
      online: true,
      health: [],
    }, {
      localAddress: null,
      tls,
    });

    expect(endpoint.relayUrl).toBe("wss://relay.example.ts.net:7889");
    expect(endpoint.connectUrl).toBe("wss://127.0.0.1:7889");
    expect(endpoint.fallbackRelayUrls).toEqual([]);
  });

  test("uses local network address when tailscale is stopped", () => {
    const endpoint = resolveRelayEndpointForTailscaleStatus(7889, {
      backendState: "Stopped",
      dnsName: "relay.example.ts.net",
      online: false,
      health: ["Tailscale is stopped."],
    }, {
      localAddress: "10.0.0.42",
    });

    expect(endpoint.relayUrl).toBe("ws://10.0.0.42:7889");
    expect(endpoint.connectUrl).toBe("ws://127.0.0.1:7889");
    expect(endpoint.fallbackRelayUrls).toEqual([]);
  });

  test("falls back to loopback when no reachable network address is available", () => {
    const endpoint = resolveRelayEndpointForTailscaleStatus(7889, null, {
      localAddress: null,
    });

    expect(endpoint.relayUrl).toBe("ws://127.0.0.1:7889");
    expect(endpoint.connectUrl).toBe("ws://127.0.0.1:7889");
    expect(endpoint.fallbackRelayUrls).toEqual([]);
  });
});
