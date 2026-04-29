import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const VOX_CLIENT_ID = "openscout-web";
const DEFAULT_VOX_RPC_PORT = 42137;
const DEFAULT_VOX_RPC_HOST = "127.0.0.1";
const VOX_RPC_TIMEOUT_MS = 30_000;
const OPENSCOUT_VOX_ORIGINS = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "http://[::1]:*",
  "https://127.0.0.1:*",
  "https://localhost:*",
  "https://[::1]:*",
];

export type VoxSpeechResult = {
  contentType: string;
  audioBase64: string;
  modelId: string;
  voiceId: string;
  audioBytes: number;
};

export async function synthesizeVoxSpeech(input: {
  text: string;
  modelId?: string;
  voiceId?: string;
  speed?: number;
}): Promise<VoxSpeechResult> {
  const result = await callVoxRpc("synthesize.generate", {
    clientId: VOX_CLIENT_ID,
    text: input.text,
    modelId: input.modelId ?? "avspeech:system",
    voiceId: input.voiceId,
    format: "wav",
    speed: input.speed,
  });

  const audioBase64 = stringValue(result.audioBase64);
  if (!audioBase64) {
    throw new Error("Vox returned no audio.");
  }

  return {
    contentType: stringValue(result.contentType) || "audio/wav",
    audioBase64,
    modelId: stringValue(result.modelId) || input.modelId || "avspeech:system",
    voiceId: stringValue(result.voiceId) || input.voiceId || "",
    audioBytes: Number(result.audioBytes ?? 0),
  };
}

export function ensureOpenScoutVoxOrigins(): void {
  const originsPath = resolveOpenScoutVoxOriginsPath();
  const body = `${JSON.stringify({ origins: OPENSCOUT_VOX_ORIGINS }, null, 2)}\n`;

  try {
    if (existsSync(originsPath) && readFileSync(originsPath, "utf8") === body) {
      return;
    }

    mkdirSync(dirname(originsPath), { recursive: true });
    writeFileSync(originsPath, body, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[vox] Could not register OpenScout browser origins: ${message}`);
  }
}

function resolveOpenScoutVoxOriginsPath(): string {
  return join(resolveVoxHome(), "origins.d", "openscout.json");
}

function resolveVoxHome(): string {
  return process.env.VOX_HOME ?? join(homedir(), ".vox");
}

export function resolveVoxRpcPort(): number {
  const runtimePath = process.env.VOX_RUNTIME_PATH ?? join(resolveVoxHome(), "runtime.json");
  if (!existsSync(runtimePath)) {
    const port = Number(process.env.VOX_PORT);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_VOX_RPC_PORT;
  }

  try {
    const parsed = JSON.parse(readFileSync(runtimePath, "utf8")) as { port?: unknown };
    const port = Number(parsed.port);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_VOX_RPC_PORT;
  } catch {
    return DEFAULT_VOX_RPC_PORT;
  }
}

async function callVoxRpc(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = VOX_RPC_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const port = resolveVoxRpcPort();
  const socket = new WebSocket(`ws://${DEFAULT_VOX_RPC_HOST}:${port}`);
  const id = randomUUID();

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Vox ${method} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    socket.onopen = () => {
      socket.send(JSON.stringify({ id, method, params }));
    };

    socket.onmessage = (event) => {
      const payload = parseRpcPayload(event.data);
      if (!payload || payload.id !== id) return;
      cleanup();
      if (payload.error) {
        reject(new Error(typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error)));
        return;
      }
      resolve(payload.result && typeof payload.result === "object"
        ? payload.result as Record<string, unknown>
        : {});
    };

    socket.onerror = () => {
      cleanup();
      reject(new Error(`Could not connect to Vox on port ${port}.`));
    };

    socket.onclose = () => {
      cleanup();
      reject(new Error("Vox closed the connection before returning a result."));
    };
  });
}

function parseRpcPayload(data: unknown): Record<string, unknown> | null {
  const raw = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : "";
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
