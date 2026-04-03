import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  clearDispatchRuntimePid,
  clearDispatchRuntimeSnapshot,
  clearStaleDispatchRuntimeFiles,
  createDispatchRuntimeSnapshot,
  isProcessRunning,
  readDispatchRuntimePid,
  writeDispatchRuntimePid,
  writeDispatchRuntimeSnapshot,
  type DispatchRuntimeSnapshot,
} from "./runtime-state";

const PAIR_REFRESH_LEEWAY_MS = 30_000;
const MAIN_FILE = fileURLToPath(new URL("./main.ts", import.meta.url));

type PairingReadyEvent = {
  type: "pairing_ready";
  relay: string;
  trustedPeerCount: number;
  payload: {
    relay: string;
    room: string;
    publicKey: string;
    expiresAt: number;
  };
  qrArt: string;
  identityFingerprint: string;
};

type PairingStatusEvent = {
  type: "status";
  status: "connecting" | "connected" | "paired" | "closed" | "error";
  detail: string | null;
};

type PairingEvent = PairingReadyEvent | PairingStatusEvent;

type SupervisorState = {
  child: ChildProcessWithoutNullStreams | null;
  stdoutBuffer: string;
  restartTimer: ReturnType<typeof setTimeout> | null;
  intentionalStop: boolean;
  pendingRestart: boolean;
  launchFailed: boolean;
  lastStderrDetail: string | null;
  current: DispatchRuntimeSnapshot;
};

export async function runDispatchSupervisor() {
  clearStaleDispatchRuntimeFiles();

  const existingPid = readDispatchRuntimePid();
  if (existingPid && existingPid !== process.pid && isProcessRunning(existingPid)) {
    console.error(`Dispatch supervisor is already running (pid ${existingPid}).`);
    process.exit(1);
  }

  writeDispatchRuntimePid(process.pid);

  const state: SupervisorState = {
    child: null,
    stdoutBuffer: "",
    restartTimer: null,
    intentionalStop: false,
    pendingRestart: false,
    launchFailed: false,
    lastStderrDetail: null,
    current: writeDispatchRuntimeSnapshot(createDispatchRuntimeSnapshot(
      { pid: process.pid },
      {
        status: "starting",
        statusLabel: "Starting",
        statusDetail: "Launching Dispatch pair mode.",
        relay: null,
        pairing: null,
      },
    )),
  };

  const shutdown = async () => {
    state.intentionalStop = true;
    state.pendingRestart = false;
    clearRestartTimer(state);
    if (state.child) {
      state.child.kill("SIGTERM");
      state.child = null;
    }
    writeCurrent(state, {
      status: "stopped",
      statusLabel: "Stopped",
      statusDetail: "Dispatch service is stopped. Start it to generate a fresh QR code.",
      relay: null,
      pairing: null,
      childPid: null,
    });
    clearDispatchRuntimePid();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  startManagedPairProcess(state);
}

function startManagedPairProcess(state: SupervisorState) {
  clearRestartTimer(state);
  state.stdoutBuffer = "";
  state.launchFailed = false;
  state.lastStderrDetail = null;
  writeCurrent(state, {
    status: "starting",
    statusLabel: "Starting",
    statusDetail: "Launching Dispatch pair mode.",
    relay: null,
    pairing: null,
    childPid: null,
  });

  const child = spawn(process.execPath, [MAIN_FILE, "start"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  state.child = child;
  writeCurrent(state, { childPid: child.pid ?? null });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    state.stdoutBuffer += chunk;
    drainStdoutBuffer(state);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const detail = chunk.trim();
    if (!detail) {
      return;
    }
    state.lastStderrDetail = simplifyDispatchFailure(detail);
  });

  child.on("error", (error) => {
    state.launchFailed = true;
    state.child = null;
    writeCurrent(state, {
      status: "error",
      statusLabel: "Error",
      statusDetail: error.message,
      pairing: null,
      childPid: null,
    });
  });

  child.on("close", (code, signal) => {
    const wasIntentional = state.intentionalStop;
    const launchFailed = state.launchFailed;
    state.child = null;
    writeCurrent(state, { childPid: null });

    if (wasIntentional) {
      state.intentionalStop = false;
      if (state.pendingRestart) {
        state.pendingRestart = false;
        startManagedPairProcess(state);
      }
      return;
    }

    if (launchFailed) {
      state.launchFailed = false;
      return;
    }

    if (state.lastStderrDetail && code !== 0) {
      writeCurrent(state, {
        status: "error",
        statusLabel: "Error",
        statusDetail: state.lastStderrDetail,
      });
      state.lastStderrDetail = null;
      return;
    }

    writeCurrent(state, {
      status: "closed",
      statusLabel: "Closed",
      statusDetail: code === 0
        ? "Dispatch pair mode stopped."
        : signal
          ? `Dispatch pair mode exited (${signal}).`
          : `Dispatch pair mode exited (${code ?? "unknown"}).`,
    });

    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      startManagedPairProcess(state);
    }, 2_000);
  });
}

function drainStdoutBuffer(state: SupervisorState) {
  while (true) {
    const newlineIndex = state.stdoutBuffer.indexOf("\n");
    if (newlineIndex === -1) {
      break;
    }

    const line = state.stdoutBuffer.slice(0, newlineIndex).trim();
    state.stdoutBuffer = state.stdoutBuffer.slice(newlineIndex + 1);
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      handlePairingEvent(state, JSON.parse(line) as PairingEvent);
    } catch {
      // Ignore malformed event lines.
    }
  }
}

function handlePairingEvent(state: SupervisorState, event: PairingEvent) {
  if (event.type === "pairing_ready") {
    writeCurrent(state, {
      status: "connecting",
      statusLabel: "Pairing Ready",
      statusDetail: `Relay room ${event.payload.room} is waiting for Dispatch.`,
      relay: event.relay,
      pairing: {
        relay: event.payload.relay,
        room: event.payload.room,
        publicKey: event.payload.publicKey,
        expiresAt: event.payload.expiresAt,
        qrArt: event.qrArt,
        qrValue: JSON.stringify(event.payload),
      },
    });
    scheduleExpiryRefresh(state, event.payload.expiresAt);
    return;
  }

  const labelByStatus: Record<PairingStatusEvent["status"], string> = {
    connecting: "Connecting",
    connected: "Connected",
    paired: "Paired",
    closed: "Closed",
    error: "Error",
  };

  if (event.status === "paired") {
    clearRestartTimer(state);
  }

  writeCurrent(state, {
    status: event.status,
    statusLabel: labelByStatus[event.status],
    statusDetail: event.detail,
  });
}

function scheduleExpiryRefresh(state: SupervisorState, expiresAt: number) {
  clearRestartTimer(state);
  const delay = Math.max(1_000, expiresAt - Date.now() - PAIR_REFRESH_LEEWAY_MS);
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    state.pendingRestart = true;
    state.intentionalStop = true;
    if (state.child) {
      state.child.kill("SIGTERM");
      return;
    }
    state.intentionalStop = false;
    state.pendingRestart = false;
    startManagedPairProcess(state);
  }, delay);
}

function clearRestartTimer(state: SupervisorState) {
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
}

function writeCurrent(
  state: SupervisorState,
  patch: Partial<DispatchRuntimeSnapshot> & { childPid?: number | null },
) {
  const next = {
    ...state.current,
    ...patch,
    updatedAt: Date.now(),
  };
  state.current = writeDispatchRuntimeSnapshot(next);
}

function simplifyDispatchFailure(detail: string) {
  if (/EADDRINUSE|address already in use/i.test(detail)) {
    return "Dispatch could not start because the pairing relay port is already in use. Stop the other Dispatch process or restart the relay.";
  }
  return detail;
}
