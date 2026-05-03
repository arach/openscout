import { spawn } from "node:child_process";
import { join } from "node:path";

import type { IrohMeshEntrypoint } from "@openscout/protocol";
import {
  OPENSCOUT_IROH_MESH_ALPN,
  OPENSCOUT_MESH_PROTOCOL_VERSION,
} from "@openscout/protocol";

import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export type IrohBridgeMeshRoute =
  | "messages"
  | "invocations"
  | "collaboration/records"
  | "collaboration/events";

export interface IrohBridgeForwardOptions {
  timeoutMs?: number;
  bridgeBin?: string;
  identityPath?: string;
}

export interface IrohBridgeResponse<TBody = unknown> {
  status: number;
  body: TBody;
}

export function resolveIrohBridgeBin(): string | null {
  const explicit = process.env.OPENSCOUT_IROH_BRIDGE_BIN?.trim();
  return explicit || null;
}

export function resolveIrohBridgeIdentityPath(): string {
  const explicit = process.env.OPENSCOUT_IROH_IDENTITY_PATH?.trim();
  if (explicit) {
    return explicit;
  }
  return join(resolveOpenScoutSupportPaths().runtimeDirectory, "mesh", "iroh.key");
}

export function canUseIrohBridge(options: IrohBridgeForwardOptions = {}): boolean {
  return Boolean(options.bridgeBin?.trim() || resolveIrohBridgeBin());
}

function readEndpointId(endpointAddr: unknown): string | undefined {
  if (!endpointAddr || typeof endpointAddr !== "object" || Array.isArray(endpointAddr)) {
    return undefined;
  }
  const value = (endpointAddr as { id?: unknown }).id;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveIrohMeshEntrypointFromEnv(env: NodeJS.ProcessEnv = process.env): IrohMeshEntrypoint | undefined {
  const rawEndpointAddr = env.OPENSCOUT_IROH_ENDPOINT_ADDR_JSON?.trim();
  if (!rawEndpointAddr) {
    return undefined;
  }

  let endpointAddr: unknown;
  try {
    endpointAddr = JSON.parse(rawEndpointAddr);
  } catch (error) {
    throw new Error("OPENSCOUT_IROH_ENDPOINT_ADDR_JSON must be valid JSON", { cause: error });
  }

  const endpointId = env.OPENSCOUT_IROH_ENDPOINT_ID?.trim() || readEndpointId(endpointAddr);
  if (!endpointId) {
    throw new Error("OPENSCOUT_IROH_ENDPOINT_ID is required when endpointAddr JSON does not include an id");
  }

  return {
    kind: "iroh",
    endpointId,
    endpointAddr,
    alpn: OPENSCOUT_IROH_MESH_ALPN,
    bridgeProtocolVersion: OPENSCOUT_MESH_PROTOCOL_VERSION,
    lastSeenAt: Date.now(),
  };
}

function readChildOutput(stream: NodeJS.ReadableStream, onChunk?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buffer);
      onChunk?.(buffer.toString("utf8"));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export async function forwardIrohMeshEnvelope<TResponse>(
  entrypoint: IrohMeshEntrypoint,
  route: IrohBridgeMeshRoute,
  payload: unknown,
  options: IrohBridgeForwardOptions = {},
): Promise<IrohBridgeResponse<TResponse>> {
  const bridgeBin = options.bridgeBin?.trim() || resolveIrohBridgeBin();
  if (!bridgeBin) {
    throw new Error("OPENSCOUT_IROH_BRIDGE_BIN is not configured");
  }

  const identityPath = options.identityPath?.trim() || resolveIrohBridgeIdentityPath();
  const args = [
    "forward",
    "--identity-path",
    identityPath,
    "--endpoint-addr-json",
    JSON.stringify(entrypoint.endpointAddr),
    "--route",
    route,
    "--timeout-ms",
    String(options.timeoutMs ?? 5_000),
  ];

  const child = spawn(bridgeBin, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, options.timeoutMs ?? 5_000);

  const stderrChunks: string[] = [];
  const stdoutPromise = readChildOutput(child.stdout);
  const stderrPromise = readChildOutput(child.stderr, (chunk) => {
    stderrChunks.push(chunk);
  });

  child.stdin.end(JSON.stringify(payload));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  }).finally(() => {
    clearTimeout(timeout);
  });

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `Iroh bridge exited with ${exitCode}`);
  }

  try {
    return JSON.parse(stdout) as IrohBridgeResponse<TResponse>;
  } catch (error) {
    const detail = stderrChunks.join("").trim();
    throw new Error(`Iroh bridge returned invalid JSON${detail ? `: ${detail}` : ""}`, { cause: error });
  }
}
