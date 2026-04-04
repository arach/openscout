import {
  pairingPaths,
  isProcessRunning,
  readPairingRuntimeSnapshot,
  renderQRCode,
  resolvedPairingConfig,
  startPairingRuntime,
  startManagedRelay,
  trustedPeerCount,
  loadOrCreateIdentity,
  bytesToHex,
  type PairingPaths,
  type PairingQrPayload,
  type PairingRuntimeSnapshot,
} from "./runtime/index.ts";

export type ScoutPairingReadyEvent = {
  type: "pairing_ready";
  payload: PairingQrPayload;
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
  paths: PairingPaths;
};

export type ScoutPairingStatusEvent = {
  type: "status";
  status: "connecting" | "connected" | "paired" | "closed" | "error";
  detail: string | null;
};

export type ScoutPairingEvent = ScoutPairingReadyEvent | ScoutPairingStatusEvent;

export type StartedScoutPairingSession = {
  relayUrl: string;
  managedRelay: boolean;
  stop: () => Promise<void>;
};

type ActivePairingRuntimeSnapshot = PairingRuntimeSnapshot & {
  relay: string;
  pairing: NonNullable<PairingRuntimeSnapshot["pairing"]>;
};

function isActivePairingRuntimeSnapshot(snapshot: PairingRuntimeSnapshot | null): snapshot is ActivePairingRuntimeSnapshot {
  return Boolean(snapshot?.relay && snapshot.pairing);
}

function createStatusEvent(
  status: ScoutPairingStatusEvent["status"],
  detail: string | null,
): ScoutPairingStatusEvent {
  return {
    type: "status",
    status,
    detail,
  };
}

export async function startScoutPairingSession(input: {
  relayUrl?: string | null;
  forceManagedRelay?: boolean;
  onEvent: (event: ScoutPairingEvent) => void;
}): Promise<StartedScoutPairingSession> {
  const config = resolvedPairingConfig();
  const paths = pairingPaths();
  const existingSnapshot = readPairingRuntimeSnapshot();
  const existingRuntimeRunning = isActivePairingRuntimeSnapshot(existingSnapshot)
    && isProcessRunning(existingSnapshot.childPid ?? existingSnapshot.pid)
    && existingSnapshot.relay;

  if (existingRuntimeRunning) {
    const pairing = existingSnapshot.pairing;
    const currentStatus: ScoutPairingStatusEvent["status"] = existingSnapshot.status === "paired"
      ? "paired"
      : existingSnapshot.status === "connected"
        ? "connected"
        : existingSnapshot.status === "closed"
          ? "closed"
          : existingSnapshot.status === "error"
            ? "error"
            : "connecting";
    input.onEvent({
      type: "pairing_ready",
      payload: {
        v: 1,
        relay: pairing.relay,
        room: pairing.room,
        publicKey: pairing.publicKey,
        expiresAt: pairing.expiresAt,
      },
      qrArt: pairing.qrArt,
      relay: pairing.relay,
      identityFingerprint: existingSnapshot.identityFingerprint ?? pairing.publicKey.slice(0, 16),
      trustedPeerCount: existingSnapshot.trustedPeerCount,
      config: {
        relay: existingSnapshot.relay,
        workspaceRoot: existingSnapshot.workspaceRoot,
        secure: existingSnapshot.secure,
        sessionCount: existingSnapshot.sessionCount,
        port: config.port,
      },
      paths,
    });

    if (existingSnapshot.statusDetail) {
      input.onEvent(createStatusEvent(currentStatus, existingSnapshot.statusDetail));
    }

    return {
      relayUrl: pairing.relay,
      managedRelay: false,
      async stop() {
        input.onEvent(createStatusEvent("closed", "Scout pair view closed."));
      },
    };
  }

  const identity = loadOrCreateIdentity();
  const identityFingerprint = bytesToHex(identity.publicKey).slice(0, 16);
  const pendingEvents: ScoutPairingStatusEvent[] = [];
  let ready = false;
  let runtime: Awaited<ReturnType<typeof startPairingRuntime>> | null = null;
  let relay: ReturnType<typeof startManagedRelay> | null = null;

  const emit = (event: ScoutPairingEvent) => input.onEvent(event);
  const emitOrQueue = (event: ScoutPairingStatusEvent) => {
    if (ready) {
      emit(event);
      return;
    }
    pendingEvents.push(event);
  };

  const resolvedRelayUrl = input.forceManagedRelay
    ? null
    : input.relayUrl?.trim() || config.relay;

  try {
    const activeRelayUrl = resolvedRelayUrl ?? (() => {
      relay = startManagedRelay(config.port + 1);
      return relay.relayUrl;
    })();

    runtime = await startPairingRuntime({
      relayUrl: activeRelayUrl,
      relayEvents: {
        onConnecting() {
          emitOrQueue(createStatusEvent("connecting", `Connecting to ${activeRelayUrl}`));
        },
        onConnected({ room }) {
          emitOrQueue(createStatusEvent("connected", `Relay room ${room} is ready`));
        },
        onPaired({ remotePublicKey }) {
          const fingerprint = bytesToHex(remotePublicKey).slice(0, 16);
          emitOrQueue(createStatusEvent("paired", `Secure peer connected (${fingerprint}...)`));
        },
        onReconnectScheduled({ delayMs }) {
          emitOrQueue(createStatusEvent(
            "connecting",
            `Connection lost. Retrying in ${Math.max(1, Math.round(delayMs / 1000))}s.`,
          ));
        },
      },
    });

    const payload = runtime.qrPayload;
    if (!payload) {
      throw new Error("Scout did not produce a pairing QR payload.");
    }

    ready = true;
    emit({
      type: "pairing_ready",
      payload,
      qrArt: renderQRCode(payload),
      relay: activeRelayUrl,
      identityFingerprint,
      trustedPeerCount: trustedPeerCount(),
      config: {
        relay: activeRelayUrl,
        workspaceRoot: config.workspaceRoot,
        secure: config.secure,
        sessionCount: config.sessions.length,
        port: config.port,
      },
      paths,
    });

    for (const event of pendingEvents) {
      emit(event);
    }

    return {
      relayUrl: activeRelayUrl,
      managedRelay: relay !== null,
      async stop() {
        emit(createStatusEvent("closed", "Scout pair mode stopped."));
        await runtime?.stop();
        relay?.stop();
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emit(createStatusEvent("error", detail));
    await runtime?.stop().catch(() => {});
    relay?.stop();
    throw error;
  }
}
