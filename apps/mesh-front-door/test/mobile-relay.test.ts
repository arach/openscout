import { expect, test } from "bun:test";

import {
  MobilePairingRelayHub,
  isMobilePairingRelayPath,
  resolveMobilePairingRelayOwnerName,
  type MobileRelaySocket,
} from "../src/mobile-relay.js";

interface RelayEnvelope {
  phase: "relay";
  event: "message" | "close";
  clientId: string;
  payload?: string;
  code?: number;
  reason?: string;
}

class FakeSocket implements MobileRelaySocket {
  readonly sent: string[] = [];
  readonly closed: Array<{ code?: number; reason?: string }> = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }
}

test("mobile relay route matcher only claims the hosted relay surface", () => {
  expect(isMobilePairingRelayPath("/v1/relay")).toBe(true);
  expect(isMobilePairingRelayPath("/v1/relay/resolve")).toBe(true);
  expect(isMobilePairingRelayPath("/v1/presence")).toBe(false);
});

test("mobile relay owner defaults to the mesh directory owner", () => {
  expect(resolveMobilePairingRelayOwnerName({})).toBe("default");
  expect(resolveMobilePairingRelayOwnerName({ OPENSCOUT_MESH_DIRECTORY_OWNER: "default" })).toBe("default");
  expect(resolveMobilePairingRelayOwnerName({
    OPENSCOUT_MESH_DIRECTORY_OWNER: "default",
    OPENSCOUT_MOBILE_RELAY_OWNER: "mobile",
  })).toBe("mobile");
});

test("mobile relay routes distinct clients through the bridge", () => {
  const hub = new MobilePairingRelayHub();
  const bridge = new FakeSocket();
  const clientA = new FakeSocket();
  const clientB = new FakeSocket();

  hub.registerBridge(bridge, "room-a", "bridge-key");
  hub.registerClient(clientA, "room-a", "client-a");
  hub.registerClient(clientB, "room-a", "client-b");

  expect(hub.resolveRoom("bridge-key")).toBe("room-a");

  hub.receive(clientA, "from-a");
  hub.receive(clientB, "from-b");

  expect(bridge.sent.map((payload) => JSON.parse(payload) as RelayEnvelope)).toEqual([
    {
      phase: "relay",
      event: "message",
      clientId: "client-a",
      payload: "from-a",
    },
    {
      phase: "relay",
      event: "message",
      clientId: "client-b",
      payload: "from-b",
    },
  ]);

  hub.receive(bridge, JSON.stringify({
    phase: "relay",
    event: "message",
    clientId: "client-a",
    payload: "to-a",
  } satisfies RelayEnvelope));

  expect(clientA.sent).toEqual(["to-a"]);
  expect(clientB.sent).toEqual([]);
});

test("mobile relay reports client close events to the bridge", () => {
  const hub = new MobilePairingRelayHub();
  const bridge = new FakeSocket();
  const client = new FakeSocket();

  hub.registerBridge(bridge, "room-a", "bridge-key");
  hub.registerClient(client, "room-a", "client-a");
  hub.disconnect(client);

  expect(bridge.sent.map((payload) => JSON.parse(payload) as RelayEnvelope)).toEqual([
    {
      phase: "relay",
      event: "close",
      clientId: "client-a",
    },
  ]);
});

test("mobile relay does not resolve a bridge key after its bridge disconnects", () => {
  const hub = new MobilePairingRelayHub();
  const bridge = new FakeSocket();

  hub.registerBridge(bridge, "room-a", "bridge-key");
  expect(hub.resolveRoom("bridge-key")).toBe("room-a");

  hub.disconnect(bridge);
  expect(hub.resolveRoom("bridge-key")).toBeNull();
  hub.closeAll();
});
