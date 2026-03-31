import { homedir } from "node:os";

import { createAdapter as createClaudeCode } from "./adapters/claude-code";
import { createAdapter as createCodex } from "./adapters/codex";
import { createAdapter as createOpenAI } from "./adapters/openai-compat";
import { createAdapter as createOpenCode } from "./adapters/opencode";
import { createAdapter as createPi } from "./adapters/pi";
import { Bridge } from "./bridge/bridge";
import { type AdapterEntry, resolveConfig, type SessionEntry } from "./bridge/config";
import { startFileServer, type FileServer } from "./bridge/fileserver";
import { connectToRelay, type RelayConnection, type RelayEventHandlers } from "./bridge/relay-client";
import { startBridgeServer } from "./bridge/server";
import { loadOrCreateIdentity, type KeyPair, type QRPayload } from "./security";
import type { AdapterFactory } from "./protocol";

export type DispatchRuntimeEvents = RelayEventHandlers;

export type StartedDispatchRuntime = {
  bridge: Bridge;
  fileServer: FileServer;
  identity: KeyPair;
  config: ReturnType<typeof resolveConfig>;
  relayConnection: RelayConnection | null;
  qrPayload: QRPayload | null;
  stop: () => Promise<void>;
};

export function createDispatchAdapterRegistry(configAdapters?: Record<string, AdapterEntry>) {
  const adapters: Record<string, AdapterFactory> = {
    "claude-code": createClaudeCode,
    codex: createCodex,
    pi: createPi,
    opencode: createOpenCode,
    openai: createOpenAI,
  };

  if (configAdapters) {
    for (const [name, entry] of Object.entries(configAdapters)) {
      const baseFactory = adapters[entry.type];
      if (!baseFactory) {
        console.warn(`[dispatch] config adapter "${name}" references unknown type "${entry.type}" — skipped`);
        continue;
      }

      adapters[name] = (adapterConfig) => {
        const merged = {
          ...adapterConfig,
          options: { ...entry.options, ...adapterConfig.options },
        };
        return baseFactory(merged);
      };
    }
  }

  return adapters;
}

export async function startDispatchRuntime(options?: {
  relayUrl?: string | null;
  relayEvents?: DispatchRuntimeEvents;
}) : Promise<StartedDispatchRuntime> {
  const config = resolveConfig();
  const identity = loadOrCreateIdentity();
  const adapters = createDispatchAdapterRegistry(config.adapters);
  const bridge = new Bridge({
    port: config.port,
    adapters,
  });

  const server = startBridgeServer(bridge, config.port, {
    secure: config.secure,
    identity: config.secure ? identity : undefined,
  });
  const fileServer = startFileServer({ port: config.port + 2 });

  const relayUrl = options?.relayUrl?.trim() || config.relay || null;
  if (!relayUrl) {
    fileServer.stop();
    server.stop();
    throw new Error("Dispatch relay URL is not configured.");
  }

  const relayConnection = connectToRelay(relayUrl, identity, bridge, {
    secure: true,
    events: options?.relayEvents,
  });

  await autoStartConfiguredSessions(bridge, config.sessions);

  return {
    bridge,
    fileServer,
    identity,
    config,
    relayConnection,
    qrPayload: relayConnection.qrPayload,
    async stop() {
      relayConnection.disconnect();
      fileServer.stop();
      await bridge.shutdown();
      server.stop();
    },
  };
}

async function autoStartConfiguredSessions(bridge: Bridge, sessions: SessionEntry[] | undefined) {
  if (!sessions?.length) {
    return;
  }

  console.log(`[bridge] auto-starting ${sessions.length} session(s)...`);
  for (const entry of sessions) {
    try {
      const session = await bridge.createSession(entry.adapter, {
        name: entry.name,
        cwd: entry.cwd?.replace(/^~/, homedir()),
        options: entry.options,
      });
      console.log(`[bridge] session started: ${session.name} (${entry.adapter})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bridge] failed to start session "${entry.name}": ${message}`);
    }
  }
}
