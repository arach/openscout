// Relay client — connects the bridge OUTBOUND to a relay server.
//
// This lets a phone reach the bridge when they're not on the same LAN.
// The bridge connects to the relay as the "bridge" role, and the phone
// connects as the "client" role.  The relay forwards opaque bytes between
// them.  SecureTransport encrypts everything end-to-end.
//
// The bridge is the Noise "responder" — the phone initiates the handshake
// because it scanned the QR code containing the bridge's public key.

import type { Bridge } from "./bridge.ts";
import { handleRPC } from "./server.ts";
import { log } from "./log.ts";
import {
  SecureTransport,
  type SocketLike,
  type KeyPair,
  type QRPayload,
  createQRPayload,
  bytesToHex,
} from "../security/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelayClientOptions {
  /** Enable Noise encryption on the relay connection. Default: true. */
  secure?: boolean;
  /** Optional lifecycle callbacks for status surfaces. */
  events?: RelayEventHandlers;
}

export interface RelayConnection {
  /** QR payload for the phone to scan — contains relay URL, room ID, bridge public key. */
  qrPayload: QRPayload;
  /** Disconnect from the relay and stop reconnecting. */
  disconnect: () => void;
}

export interface RelayEventHandlers {
  onConnecting?: (detail: { relayUrl: string; room: string }) => void;
  onConnected?: (detail: { relayUrl: string; room: string }) => void;
  onPaired?: (detail: { relayUrl: string; room: string; remotePublicKey: Uint8Array }) => void;
  onError?: (detail: { relayUrl: string; room: string; error: Error }) => void;
  onClosed?: (detail: { relayUrl: string; room: string; code: number; reason: string }) => void;
  onReconnectScheduled?: (detail: { relayUrl: string; room: string; delayMs: number }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect the bridge to a relay server for remote phone access.
 *
 * Returns a QR payload (to display / encode for the phone) and a disconnect
 * function.  The connection auto-reconnects with exponential backoff.
 */
export function connectToRelay(
  relayUrl: string,
  identity: KeyPair,
  bridge: Bridge,
  options: RelayClientOptions = {},
): RelayConnection {
  const { secure = true, events } = options;

  // Create the QR payload — this generates a room ID and packages everything
  // the phone needs to connect.
  const qrPayload = createQRPayload(identity.publicKey, relayUrl);

  let ws: WebSocket | null = null;
  let transport: SecureTransport | null = null;
  let eventUnsub: (() => void) | null = null;
  let stopped = false;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (stopped) return;

    // Build the relay URL with room ID, role, and bridge public key.
    const bridgeKeyHex = bytesToHex(identity.publicKey);
    const url = buildRelayUrl(relayUrl, qrPayload.room, bridgeKeyHex);
    console.log(`[relay-client] connecting to relay (room: ${qrPayload.room})`);
    events?.onConnecting?.({ relayUrl, room: qrPayload.room });

    ws = new WebSocket(url, relayWebSocketOptions(relayUrl));

    ws.addEventListener("open", () => {
      console.log(`[relay-client] connected to relay (room: ${qrPayload.room})`);
      backoff = INITIAL_BACKOFF_MS; // Reset backoff on successful connection.
      events?.onConnected?.({ relayUrl, room: qrPayload.room });

      if (secure) {
        setupSecureChannel();
      } else {
        setupPlaintextChannel();
      }
    });

    ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : event.data;

      if (!secure) {
        handlePlaintextMessage(data as string);
        return;
      }

      // Detect if this is a handshake from a (re)connecting phone.
      // This triggers when:
      //   1. Transport is ready but phone is reconnecting (new handshake over existing session)
      //   2. Transport is null after a decrypt failure reset (phone catching up)
      const needsHandshake = transport?.isReady() || !transport;
      if (needsHandshake) {
        try {
          const wire = JSON.parse(data as string);
          if (wire.phase === "handshake") {
            console.log("[relay-client] handshake detected — setting up fresh transport");
            eventUnsub?.();
            eventUnsub = null;
            transport = null;

            // Detect pattern from payload length:
            // XX msg1 (→ e) = 32 bytes (ephemeral key only)
            // IK msg1 (→ e, es, s, ss) = 80+ bytes (ephemeral + encrypted static + tag)
            const payload = Uint8Array.from(atob(wire.payload), c => c.charCodeAt(0));
            const pattern = payload.length > 32 ? "IK" : "XX";
            console.log(`[relay-client] detected pattern: ${pattern} (payload: ${payload.length} bytes)`);

            setupSecureChannel(pattern);
          }
        } catch { /* not JSON or binary, feed to transport */ }
      }

      if (transport) {
        transport.receive(data as string | Uint8Array);
      }
    });

    ws.addEventListener("close", (event) => {
      console.log(`[relay-client] disconnected (code: ${event.code}, reason: ${event.reason})`);
      events?.onClosed?.({
        relayUrl,
        room: qrPayload.room,
        code: event.code,
        reason: event.reason,
      });
      cleanup();
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      const error = new Error("Relay websocket error");
      console.error("[relay-client] connection error");
      events?.onError?.({ relayUrl, room: qrPayload.room, error });
      // The close event will fire after this, triggering reconnect.
    });
  }

  function setupSecureChannel(pattern?: "XX" | "IK"): void {
    if (!ws) return;

    const socketAdapter: SocketLike = {
      send: (data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      },
    };

    transport = new SecureTransport(
      socketAdapter,
      "responder", // Bridge is always the responder.
      identity,
      {
        onReady: (remotePublicKey) => {
          const pubHex = bytesToHex(remotePublicKey);
          console.log(`[relay-client] secure handshake complete (peer: ${pubHex.slice(0, 12)}...)`);
          events?.onPaired?.({ relayUrl, room: qrPayload.room, remotePublicKey });

          // Push existing sessions to the newly connected phone (with seq wrapper).
          for (const session of bridge.listSessions()) {
            transport!.send(JSON.stringify({
              seq: 0,
              event: { event: "session:update", session },
            }));
          }

          // Subscribe to bridge events and forward them encrypted through the relay.
          eventUnsub = bridge.onEvent((sequenced) => {
            if (transport?.isReady()) {
              transport.send(JSON.stringify({
                seq: sequenced.seq,
                event: sequenced.event,
              }));
            }
          });
        },

        onMessage: (message) => {
          // Decrypted JSON-RPC from the phone.
          handleIncomingRPC(message);
        },

        onError: (err) => {
          console.error("[relay-client] secure transport error:", err.message);
          log.error("transport", "decrypt/transport error — resetting for fresh handshake", err.message);
          events?.onError?.({ relayUrl, room: qrPayload.room, error: err });
          eventUnsub?.();
          eventUnsub = null;
          transport = null;
        },

        onClose: () => {
          eventUnsub?.();
          eventUnsub = null;
        },
      },
      pattern ? { pattern } : undefined,
    );
  }

  function setupPlaintextChannel(): void {
    // Subscribe to bridge events and forward them plaintext through the relay.
    eventUnsub = bridge.onEvent((sequenced) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          seq: sequenced.seq,
          event: sequenced.event,
        }));
      }
    });

    // Push existing sessions.
    for (const session of bridge.listSessions()) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          seq: 0,
          event: { event: "session:update", session },
        }));
      }
    }
  }

  function handlePlaintextMessage(raw: string): void {
    let req;
    try {
      req = JSON.parse(raw);
    } catch {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }));
      }
      return;
    }

    handleRPC(bridge, req).then((res) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(res));
      }
    });
  }

  function handleIncomingRPC(message: string): void {
    let req;
    try {
      req = JSON.parse(message);
    } catch {
      if (transport?.isReady()) {
        transport.send(
          JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }),
        );
      }
      return;
    }

    handleRPC(bridge, req).then((res) => {
      if (transport?.isReady()) {
        transport.send(JSON.stringify(res));
      }
    });
  }

  function cleanup(): void {
    eventUnsub?.();
    eventUnsub = null;
    transport = null;
    ws = null;
  }

  function scheduleReconnect(): void {
    if (stopped) return;

    console.log(`[relay-client] reconnecting in ${backoff}ms...`);
    events?.onReconnectScheduled?.({ relayUrl, room: qrPayload.room, delayMs: backoff });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);

    // Exponential backoff with cap.
    backoff = Math.min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
  }

  function disconnect(): void {
    stopped = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    cleanup();

    if (ws) {
      ws.close(1000, "Bridge disconnecting");
      ws = null;
    }

    console.log("[relay-client] disconnected from relay");
  }

  // Start the first connection attempt.
  connect();

  return { qrPayload, disconnect };
}

function relayWebSocketOptions(
  relayUrl: string,
): Bun.WebSocketOptions | undefined {
  if (!relayUrl.startsWith("wss://")) {
    return undefined;
  }

  // Scope self-signed acceptance to the relay socket instead of globally
  // disabling TLS verification for every outbound HTTPS/TLS connection.
  return {
    tls: {
      rejectUnauthorized: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRelayUrl(baseUrl: string, roomId: string, bridgePublicKey?: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("room", roomId);
  url.searchParams.set("role", "bridge");
  if (bridgePublicKey) {
    url.searchParams.set("key", bridgePublicKey);
  }
  return url.toString();
}
