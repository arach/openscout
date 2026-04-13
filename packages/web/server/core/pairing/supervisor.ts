import {
  PAIRING_QR_TTL_MS,
  resolvedPairingConfig,
} from "./runtime/config.ts";
import { renderQRCode } from "./runtime/bridge/qr.ts";
import { startManagedRelay, type StartedManagedRelay } from "./runtime/relay-runtime.ts";
import {
  clearPairingRuntimePid,
  clearStalePairingRuntimeFiles,
  createPairingRuntimeSnapshot,
  isProcessRunning,
  readPairingRuntimePid,
  writePairingRuntimePid,
  writePairingRuntimeSnapshot,
  type PairingRuntimeSnapshot,
  type PairingRuntimeStatus,
} from "./runtime/runtime-state.ts";
import {
  bytesToHex,
  loadOrCreateIdentity,
  trustedPeerCount,
  type PairingQrPayload,
} from "./runtime/security.ts";
import {
  startPairingRuntime,
  type StartedPairingRuntime,
} from "./runtime/runtime.ts";

const SCOUT_PAIR_REFRESH_LEEWAY_MS = 30_000;
const SCOUT_PAIR_RESTART_DELAY_MS = 2_000;

type SupervisorState = {
  current: PairingRuntimeSnapshot;
  restartTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  intentionalStop: boolean;
  runtime: StartedPairingRuntime | null;
  relay: StartedManagedRelay | null;
};

export async function runScoutPairingSupervisor(): Promise<void> {
  clearStalePairingRuntimeFiles();

  const existingPid = readPairingRuntimePid();
  if (existingPid && existingPid !== process.pid && isProcessRunning(existingPid)) {
    console.error(`Scout pair supervisor is already running (pid ${existingPid}).`);
    process.exit(1);
  }

  writePairingRuntimePid(process.pid);

  const state: SupervisorState = {
    current: writePairingRuntimeSnapshot(createPairingRuntimeSnapshot(
      { pid: process.pid },
      {
        status: "starting",
        statusLabel: "Starting",
        statusDetail: "Launching Scout pair mode.",
        connectedPeerFingerprint: null,
        relay: null,
        pairing: null,
      },
    )),
    restartTimer: null,
    refreshTimer: null,
    intentionalStop: false,
    runtime: null,
    relay: null,
  };

  const shutdown = async () => {
    state.intentionalStop = true;
    clearSupervisorTimers(state);
    await stopSupervisorRuntime(state);
    writeCurrent(state, {
      status: "stopped",
      statusLabel: "Stopped",
      statusDetail: "Scout pair mode is stopped.",
      connectedPeerFingerprint: null,
      relay: null,
      pairing: null,
      childPid: null,
    });
    clearPairingRuntimePid();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await startSupervisorRuntime(state);
}

async function startSupervisorRuntime(state: SupervisorState): Promise<void> {
  clearSupervisorTimers(state);
  await stopSupervisorRuntime(state);

  const config = resolvedPairingConfig();
  const relayPort = config.port + 1;
  const resolvedRelayUrl = config.relay?.trim() || null;

  writeCurrent(state, {
    status: "starting",
    statusLabel: "Starting",
    statusDetail: "Launching Scout pair mode.",
    connectedPeerFingerprint: null,
    relay: null,
    pairing: null,
    childPid: null,
  });

  const emitStatus = createStatusWriter(state);

  try {
    const activeRelayUrl = resolvedRelayUrl ?? (() => {
      state.relay = startManagedRelay(relayPort);
      return state.relay.relayUrl;
    })();

    state.runtime = await startPairingRuntime({
      relayUrl: activeRelayUrl,
      relayEvents: {
        onConnecting() {
          emitStatus("connecting", `Connecting to ${activeRelayUrl}`);
        },
        onConnected({ room }) {
          emitStatus("connected", `Relay room ${room} is ready`);
        },
        onPaired({ remotePublicKey }) {
          clearRefreshTimer(state);
          emitStatus("paired", `Secure peer connected (${bytesToHex(remotePublicKey).slice(0, 16)}...)`, {
            connectedPeerFingerprint: bytesToHex(remotePublicKey).slice(0, 16),
          });
        },
        onReconnectScheduled({ delayMs }) {
          emitStatus("connecting", `Connection lost. Retrying in ${Math.max(1, Math.round(delayMs / 1000))}s.`);
        },
      },
    });

    const payload = state.runtime.qrPayload;
    if (!payload) {
      throw new Error("Scout pairing runtime did not produce a QR payload.");
    }

    const identity = loadOrCreateIdentity();
    writeCurrent(state, {
      status: "connecting",
      statusLabel: "Pairing Ready",
      statusDetail: `Relay room ${payload.room} is waiting for Scout.`,
      connectedPeerFingerprint: null,
      relay: activeRelayUrl,
      pairing: {
        relay: payload.relay,
        room: payload.room,
        publicKey: payload.publicKey,
        expiresAt: payload.expiresAt,
        qrArt: renderQRCode(payload),
        qrValue: JSON.stringify(payload),
      },
      childPid: null,
    }, {
      identityFingerprint: bytesToHex(identity.publicKey).slice(0, 16),
      trustedPeerCount: trustedPeerCount(),
    });

    schedulePairingRefresh(state, payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    writeCurrent(state, {
      status: "error",
      statusLabel: "Error",
      statusDetail: detail,
      connectedPeerFingerprint: null,
      relay: null,
      pairing: null,
      childPid: null,
    });
    if (!state.intentionalStop) {
      scheduleRestart(state);
    }
  }
}

function createStatusWriter(state: SupervisorState) {
  return (
    status: PairingRuntimeStatus,
    detail: string | null,
    options: { connectedPeerFingerprint?: string | null } = {},
  ) => {
    const labelByStatus: Record<PairingRuntimeStatus, string> = {
      stopped: "Stopped",
      starting: "Starting",
      connecting: "Connecting",
      connected: "Connected",
      paired: "Paired",
      closed: "Closed",
      error: "Error",
    };

    writeCurrent(state, {
      status,
      statusLabel: labelByStatus[status],
      statusDetail: detail,
      connectedPeerFingerprint: options.connectedPeerFingerprint ?? null,
    });
  };
}

function scheduleRestart(state: SupervisorState): void {
  clearRestartTimer(state);
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    void startSupervisorRuntime(state);
  }, SCOUT_PAIR_RESTART_DELAY_MS);
}

function schedulePairingRefresh(state: SupervisorState, payload: PairingQrPayload): void {
  clearRefreshTimer(state);
  const delayMs = Math.max(1_000, payload.expiresAt - Date.now() - SCOUT_PAIR_REFRESH_LEEWAY_MS);
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null;
    if (state.current.status === "paired") {
      return;
    }
    void startSupervisorRuntime(state);
  }, Math.min(delayMs, PAIRING_QR_TTL_MS));
}

function clearSupervisorTimers(state: SupervisorState): void {
  clearRestartTimer(state);
  clearRefreshTimer(state);
}

function clearRestartTimer(state: SupervisorState): void {
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
}

function clearRefreshTimer(state: SupervisorState): void {
  if (state.refreshTimer) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = null;
  }
}

async function stopSupervisorRuntime(state: SupervisorState): Promise<void> {
  try {
    await state.runtime?.stop();
  } catch {
    // noop
  }
  try {
    state.relay?.stop();
  } catch {
    // noop
  }
  state.runtime = null;
  state.relay = null;
}

function writeCurrent(
  state: SupervisorState,
  patch: Partial<Pick<PairingRuntimeSnapshot, "status" | "statusLabel" | "statusDetail" | "connectedPeerFingerprint" | "relay" | "pairing" | "childPid">>,
  overrides: Partial<Pick<PairingRuntimeSnapshot, "identityFingerprint" | "trustedPeerCount">> = {},
): void {
  state.current = writePairingRuntimeSnapshot({
    ...state.current,
    ...patch,
    ...overrides,
    pid: process.pid,
    childPid: patch.childPid ?? state.current.childPid ?? null,
    updatedAt: Date.now(),
  });
}
