import { renderQRCode } from "./bridge/qr";
import { dispatchPaths, resolvedDispatchConfig } from "./config";
import { bytesToHex, loadOrCreateIdentity, trustedPeerCount, type DispatchQrPayload } from "./security";
import { startDispatchRuntime } from "./runtime";

type PairingEvent =
  | {
    type: "pairing_ready";
    payload: DispatchQrPayload;
    qrArt: string;
    relay: string;
    identityFingerprint: string;
    trustedPeerCount: number;
    config: {
      relay: string;
      workspaceRoot: string | null;
      secure: boolean;
      sessionCount: number;
      port: number;
    };
    paths: ReturnType<typeof dispatchPaths>;
  }
  | {
    type: "status";
    status: "connecting" | "connected" | "paired" | "closed" | "error";
    detail: string | null;
  };

function emit(event: PairingEvent) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export async function runPairMode(options?: {
  relayUrl?: string | null;
  onShutdown?: () => void | Promise<void>;
}) {
  const config = resolvedDispatchConfig();
  const paths = dispatchPaths();
  const relayUrl = options?.relayUrl?.trim() || config.relay;

  if (!relayUrl) {
    emit({
      type: "status",
      status: "error",
      detail: `Dispatch relay URL is not configured in ${paths.configPath}.`,
    });
    process.exit(1);
  }

  const identity = loadOrCreateIdentity();
  const identityFingerprint = bytesToHex(identity.publicKey).slice(0, 16);
  const pendingEvents: PairingEvent[] = [];
  let pairingReady = false;

  const emitOrQueue = (event: PairingEvent) => {
    if (pairingReady) {
      emit(event);
      return;
    }
    pendingEvents.push(event);
  };

  let runtime;
  try {
    runtime = await startDispatchRuntime({
      relayUrl,
      relayEvents: {
        onConnecting() {
          emitOrQueue({
            type: "status",
            status: "connecting",
            detail: `Connecting to ${relayUrl}`,
          });
        },
        onConnected({ room }) {
          emitOrQueue({
            type: "status",
            status: "connected",
            detail: `Relay room ${room} is ready`,
          });
        },
        onPaired({ remotePublicKey }) {
          const fingerprint = bytesToHex(remotePublicKey).slice(0, 16);
          emitOrQueue({
            type: "status",
            status: "paired",
            detail: `Secure peer connected (${fingerprint}...)`,
          });
        },
        onReconnectScheduled({ delayMs }) {
          emitOrQueue({
            type: "status",
            status: "connecting",
            detail: `Connection lost. Retrying in ${Math.max(1, Math.round(delayMs / 1000))}s.`,
          });
        },
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emit({
      type: "status",
      status: "error",
      detail,
    });
    process.exit(1);
  }

  const payload = runtime.qrPayload;
  if (!payload) {
    emit({
      type: "status",
      status: "error",
      detail: "Dispatch did not produce a pairing QR payload.",
    });
    await runtime.stop();
    process.exit(1);
  }

  emit({
    type: "pairing_ready",
    payload,
    qrArt: renderQRCode(payload),
    relay: relayUrl,
    identityFingerprint,
    trustedPeerCount: trustedPeerCount(),
    config: {
      relay: relayUrl,
      workspaceRoot: config.workspaceRoot,
      secure: config.secure,
      sessionCount: config.sessions.length,
      port: config.port,
    },
    paths,
  });
  pairingReady = true;

  for (const event of pendingEvents) {
    emit(event);
  }

  const shutdown = async () => {
    emit({
      type: "status",
      status: "closed",
      detail: "Dispatch pair mode stopped.",
    });
    await runtime.stop();
    await options?.onShutdown?.();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
