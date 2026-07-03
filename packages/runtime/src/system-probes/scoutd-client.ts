import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";

import {
  ProbeBackendError,
  probeRunOutput,
  type ProbeBackendMetadata,
  type ProbeCtx,
  type ProbeRunOutput,
} from "./registry.js";

const CAPABILITIES_SCHEMA = "openscout.probe.capabilities/v1";
const REQUEST_SCHEMA = "openscout.probe.request/v1";
const SNAPSHOT_SCHEMA = "openscout.probe.snapshot/v1";
const ERROR_SCHEMA = "openscout.probe.error/v1";
const CAPABILITY_RECHECK_MS = 10_000;
const SOCKET_TIMEOUT_MS = 900;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type ScoutdProbeFamilyCapability = {
  probeId: string;
  schemaVersion: number;
  ttlMs: number;
};

export type ScoutdProbeClientDiagnostics = {
  socketPath: string;
  socketExists: boolean;
  daemonObserved: boolean;
  daemonVersion: string | null;
  supportedProbeIds: string[];
  lastCapabilityCheckAt: number | null;
  lastError: string | null;
};

type Capabilities = {
  daemonVersion: string;
  families: Map<string, ScoutdProbeFamilyCapability>;
};

type ScoutdSnapshotResponse<T> = {
  schema: typeof SNAPSHOT_SCHEMA;
  probeId: string;
  key?: string | null;
  generatedAt: number;
  ttlMs: number;
  value: T;
  error: { code?: string; message?: string; timedOut?: boolean } | null;
  daemonVersion: string;
};

type ScoutdProbeOutcome<T> =
  | {
      state: "scoutd";
      value: T;
      generatedAt: number;
      daemonVersion: string;
    }
  | {
      state: "local";
      fallbackSince?: number;
      fallbackReason?: string;
    };

type FallbackState = {
  since: number;
  reason: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fallbackMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

export function resolveScoutdProbesSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENSCOUT_PROBES_SOCKET?.trim();
  if (explicit) {
    return explicit;
  }
  const openScoutHome = env.OPENSCOUT_HOME?.trim() || join(homedir(), ".openscout");
  return join(openScoutHome, "run", "scoutd-probes.sock");
}

export class ScoutdProbeClient {
  private capabilities: Capabilities | null = null;
  private lastCapabilityCheckAt: number | null = null;
  private lastError: string | null = null;
  private daemonObserved = false;
  private readonly fallbackByProbe = new Map<string, FallbackState>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async requestProbe<T>(input: {
    probeId: string;
    key?: string;
    maxAgeMs?: number;
  }): Promise<ScoutdProbeOutcome<T>> {
    const socketPath = resolveScoutdProbesSocketPath(this.env);
    const socketExists = existsSync(socketPath);
    if (!socketExists) {
      this.capabilities = null;
      this.lastError = null;
      return this.daemonObserved
        ? this.fallback(input.probeId, input.key, `probe socket is missing: ${socketPath}`)
        : { state: "local" };
    }
    this.daemonObserved = true;

    const capabilities = await this.ensureCapabilities(socketPath);
    if (!capabilities) {
      return this.fallback(input.probeId, input.key, this.lastError ?? "probe capabilities unavailable");
    }
    if (!capabilities.families.has(input.probeId)) {
      return this.fallback(input.probeId, input.key, `scoutd does not serve ${input.probeId}`);
    }

    try {
      const response = await requestJson<ScoutdSnapshotResponse<T>>(socketPath, {
        schema: REQUEST_SCHEMA,
        probeId: input.probeId,
        key: input.key ?? null,
        maxAgeMs: input.maxAgeMs,
      });
      if (!isRecord(response) || response.schema !== SNAPSHOT_SCHEMA) {
        throw new Error("scoutd returned an invalid probe snapshot envelope");
      }
      if (response.error) {
        const message = readString(response.error.message) ?? readString(response.error.code) ?? "scoutd probe failed";
        throw new Error(message);
      }
      this.fallbackByProbe.delete(fallbackKey(input.probeId, input.key));
      this.lastError = null;
      return {
        state: "scoutd",
        value: response.value,
        generatedAt: readNumber(response.generatedAt) ?? Date.now(),
        daemonVersion: readString(response.daemonVersion) ?? capabilities.daemonVersion,
      };
    } catch (error) {
      this.capabilities = null;
      this.lastCapabilityCheckAt = null;
      this.lastError = fallbackMessage(error);
      return this.fallback(input.probeId, input.key, this.lastError);
    }
  }

  diagnostics(): ScoutdProbeClientDiagnostics {
    const socketPath = resolveScoutdProbesSocketPath(this.env);
    return {
      socketPath,
      socketExists: existsSync(socketPath),
      daemonObserved: this.daemonObserved,
      daemonVersion: this.capabilities?.daemonVersion ?? null,
      supportedProbeIds: this.capabilities ? [...this.capabilities.families.keys()].sort() : [],
      lastCapabilityCheckAt: this.lastCapabilityCheckAt,
      lastError: this.lastError,
    };
  }

  resetForTests(): void {
    this.capabilities = null;
    this.lastCapabilityCheckAt = null;
    this.lastError = null;
    this.daemonObserved = false;
    this.fallbackByProbe.clear();
  }

  private async ensureCapabilities(socketPath: string): Promise<Capabilities | null> {
    const now = Date.now();
    if (this.capabilities && this.lastCapabilityCheckAt !== null && now - this.lastCapabilityCheckAt < CAPABILITY_RECHECK_MS) {
      return this.capabilities;
    }

    this.lastCapabilityCheckAt = now;
    try {
      const response = await requestJson<unknown>(socketPath, { schema: CAPABILITIES_SCHEMA });
      if (!isRecord(response) || response.schema !== CAPABILITIES_SCHEMA) {
        throw new Error("scoutd returned an invalid capabilities envelope");
      }
      const daemonVersion = readString(response.daemonVersion) ?? "unknown";
      const families = new Map<string, ScoutdProbeFamilyCapability>();
      if (Array.isArray(response.families)) {
        for (const entry of response.families) {
          if (!isRecord(entry)) continue;
          const probeId = readString(entry.probeId);
          const schemaVersion = readNumber(entry.schemaVersion);
          const ttlMs = readNumber(entry.ttlMs);
          if (probeId && schemaVersion !== null && ttlMs !== null) {
            families.set(probeId, { probeId, schemaVersion, ttlMs });
          }
        }
      }
      this.capabilities = { daemonVersion, families };
      this.daemonObserved = true;
      this.lastError = null;
      return this.capabilities;
    } catch (error) {
      this.capabilities = null;
      this.lastError = fallbackMessage(error);
      return null;
    }
  }

  private fallback(probeId: string, key: string | undefined, reason: string): ScoutdProbeOutcome<never> {
    const id = fallbackKey(probeId, key);
    let state = this.fallbackByProbe.get(id);
    if (!state || state.reason !== reason) {
      state = { since: Date.now(), reason };
      this.fallbackByProbe.set(id, state);
    }
    return {
      state: "local",
      fallbackSince: state.since,
      fallbackReason: state.reason,
    };
  }
}

let singletonClient: ScoutdProbeClient | null = null;

export function getScoutdProbeClient(): ScoutdProbeClient {
  singletonClient ??= new ScoutdProbeClient();
  return singletonClient;
}

export function resetScoutdProbeClientForTests(): void {
  singletonClient?.resetForTests();
  singletonClient = null;
}

export async function runWithScoutdFallback<T>(input: {
  probeId: string;
  key?: string;
  ctx: ProbeCtx;
  local: () => Promise<T>;
}): Promise<ProbeRunOutput<T>> {
  const client = getScoutdProbeClient();
  const scoutd = await client.requestProbe<T>({
    probeId: input.probeId,
    key: input.key,
    maxAgeMs: input.ctx.maxAgeMs,
  });

  if (scoutd.state === "scoutd") {
    return probeRunOutput(scoutd.value, {
      backend: "scoutd",
      generatedAt: scoutd.generatedAt,
    });
  }

  const metadata: ProbeBackendMetadata = scoutd.fallbackSince
    ? {
        backend: "local-fallback",
        fallbackSince: scoutd.fallbackSince,
        fallbackReason: scoutd.fallbackReason ?? "scoutd unavailable",
      }
    : { backend: "local" };

  try {
    const local = await input.local();
    return probeRunOutput(local, metadata);
  } catch (error) {
    throw new ProbeBackendError(
      error instanceof Error ? error.message : String(error),
      metadata,
    );
  }
}

async function requestJson<T>(socketPath: string, payload: unknown): Promise<T> {
  const bun = (globalThis as typeof globalThis & {
    Bun?: {
      connect?: (options: {
        unix: string;
        socket: {
          open?: (socket: { write: (data: string) => unknown; end?: () => unknown }) => void;
          data?: (socket: unknown, data: Uint8Array) => void;
          close?: () => void;
          error?: (socket: unknown, error: Error) => void;
        };
      }) => Promise<{ end?: () => unknown }>;
    };
  }).Bun;
  if (bun?.connect) {
    return await requestJsonWithBun<T>(bun.connect, socketPath, payload);
  }

  return await new Promise<T>((resolve, reject) => {
    const socket = new Socket();
    let response = "";
    let settled = false;

    const finish = (error: Error | null, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`scoutd probe socket timed out after ${SOCKET_TIMEOUT_MS}ms`));
    }, SOCKET_TIMEOUT_MS);
    timer.unref?.();

    const finishFromResponse = (): void => {
      if (settled) return;
      try {
        const parsed = JSON.parse(response) as unknown;
        if (isRecord(parsed) && parsed.schema === ERROR_SCHEMA) {
          const error = isRecord(parsed.error) ? parsed.error : {};
          const message = readString(error.message) ?? readString(error.code) ?? "scoutd probe request failed";
          finish(new Error(message));
          return;
        }
        finish(null, parsed as T);
      } catch (error) {
        finish(new Error(`scoutd probe response was not JSON: ${fallbackMessage(error)}`));
      }
    };

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response, "utf8") > MAX_RESPONSE_BYTES) {
        finish(new Error("scoutd probe response exceeded output limit"));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", finishFromResponse);
    socket.on("close", () => {
      if (!settled) {
        if (response.length === 0) {
          finish(new Error("scoutd probe socket closed without a response"));
        } else {
          finishFromResponse();
        }
      }
    });
    socket.connect(socketPath);
  });
}

async function requestJsonWithBun<T>(
  connect: NonNullable<NonNullable<(typeof globalThis & {
    Bun?: { connect?: unknown };
  })["Bun"]>["connect"]> extends (...args: infer A) => infer R ? (...args: A) => R : never,
  socketPath: string,
  payload: unknown,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let response = "";
    let settled = false;
    let socketRef: { end?: () => unknown } | null = null;
    const decoder = new TextDecoder();

    const finish = (error: Error | null, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socketRef?.end?.();
      } catch {
        // Best-effort close only.
      }
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };

    const finishFromResponse = (): void => {
      if (settled) return;
      try {
        const parsed = JSON.parse(response) as unknown;
        if (isRecord(parsed) && parsed.schema === ERROR_SCHEMA) {
          const error = isRecord(parsed.error) ? parsed.error : {};
          const message = readString(error.message) ?? readString(error.code) ?? "scoutd probe request failed";
          finish(new Error(message));
          return;
        }
        finish(null, parsed as T);
      } catch (error) {
        finish(new Error(`scoutd probe response was not JSON: ${fallbackMessage(error)}`));
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`scoutd probe socket timed out after ${SOCKET_TIMEOUT_MS}ms`));
    }, SOCKET_TIMEOUT_MS);
    timer.unref?.();

    void connect({
      unix: socketPath,
      socket: {
        open(socket) {
          socketRef = socket;
          socket.write(`${JSON.stringify(payload)}\n`);
        },
        data(_socket, data) {
          response += decoder.decode(data, { stream: true });
          if (Buffer.byteLength(response, "utf8") > MAX_RESPONSE_BYTES) {
            finish(new Error("scoutd probe response exceeded output limit"));
          }
        },
        close() {
          if (response.length === 0) {
            finish(new Error("scoutd probe socket closed without a response"));
          } else {
            response += decoder.decode();
            finishFromResponse();
          }
        },
        error(_socket, error) {
          finish(error);
        },
      },
    }).then((socket) => {
      socketRef = socket;
    }, (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function fallbackKey(probeId: string, key: string | undefined): string {
  return `${probeId}\u0000${key ?? ""}`;
}
