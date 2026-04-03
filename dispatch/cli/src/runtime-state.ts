import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

import { dispatchPaths, resolvedDispatchConfig } from "./config";
import { loadOrCreateIdentity, trustedPeerCount, bytesToHex } from "./security";

export type DispatchRuntimeStatus =
  | "stopped"
  | "starting"
  | "connecting"
  | "connected"
  | "paired"
  | "closed"
  | "error";

export type DispatchPairingSnapshot = {
  relay: string;
  room: string;
  publicKey: string;
  expiresAt: number;
  qrArt: string;
  qrValue: string;
};

export type DispatchRuntimeSnapshot = {
  version: 1;
  pid: number;
  childPid: number | null;
  status: DispatchRuntimeStatus;
  statusLabel: string;
  statusDetail: string | null;
  relay: string | null;
  secure: boolean;
  workspaceRoot: string | null;
  sessionCount: number;
  identityFingerprint: string | null;
  trustedPeerCount: number;
  pairing: DispatchPairingSnapshot | null;
  startedAt: number;
  updatedAt: number;
};

type SnapshotSeed = {
  pid: number;
  childPid?: number | null;
  startedAt?: number;
};

export function readDispatchRuntimeSnapshot(): DispatchRuntimeSnapshot | null {
  const { runtimeStatePath } = dispatchPaths();
  if (!existsSync(runtimeStatePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(runtimeStatePath, "utf8")) as DispatchRuntimeSnapshot;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDispatchRuntimeSnapshot(
  snapshot: Omit<DispatchRuntimeSnapshot, "version">,
): DispatchRuntimeSnapshot {
  const { rootDir, runtimeStatePath } = dispatchPaths();
  mkdirSync(rootDir, { recursive: true });
  const fullSnapshot: DispatchRuntimeSnapshot = {
    version: 1,
    ...snapshot,
  };
  writeJsonAtomically(runtimeStatePath, fullSnapshot);
  return fullSnapshot;
}

export function clearDispatchRuntimeSnapshot() {
  const { runtimeStatePath } = dispatchPaths();
  try {
    unlinkSync(runtimeStatePath);
  } catch {
    // noop
  }
}

export function readDispatchRuntimePid(): number | null {
  const { runtimePidPath } = dispatchPaths();
  if (!existsSync(runtimePidPath)) {
    return null;
  }

  try {
    const raw = readFileSync(runtimePidPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function writeDispatchRuntimePid(pid: number) {
  const { rootDir, runtimePidPath } = dispatchPaths();
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(runtimePidPath, `${pid}\n`);
}

export function clearDispatchRuntimePid() {
  const { runtimePidPath } = dispatchPaths();
  try {
    unlinkSync(runtimePidPath);
  } catch {
    // noop
  }
}

export function isProcessRunning(pid: number | null | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function staleDispatchRuntimeOwnerPid() {
  const pid = readDispatchRuntimePid();
  if (!pid) {
    return null;
  }
  return isProcessRunning(pid) ? null : pid;
}

export function clearStaleDispatchRuntimeFiles() {
  if (staleDispatchRuntimeOwnerPid() === null) {
    return;
  }
  clearDispatchRuntimePid();
  clearDispatchRuntimeSnapshot();
}

export function createDispatchRuntimeSnapshot(
  seed: SnapshotSeed,
  patch: Pick<
    DispatchRuntimeSnapshot,
    "status" | "statusLabel" | "statusDetail" | "relay" | "pairing"
  >,
): DispatchRuntimeSnapshot {
  const config = resolvedDispatchConfig();
  const identity = loadOrCreateIdentity();
  const startedAt = seed.startedAt ?? Date.now();
  return {
    version: 1,
    pid: seed.pid,
    childPid: seed.childPid ?? null,
    status: patch.status,
    statusLabel: patch.statusLabel,
    statusDetail: patch.statusDetail,
    relay: patch.relay,
    secure: config.secure,
    workspaceRoot: config.workspaceRoot,
    sessionCount: config.sessions.length,
    identityFingerprint: bytesToHex(identity.publicKey).slice(0, 16),
    trustedPeerCount: trustedPeerCount(),
    pairing: patch.pairing,
    startedAt,
    updatedAt: Date.now(),
  };
}

function writeJsonAtomically(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n");
  renameSync(tempPath, filePath);
}
