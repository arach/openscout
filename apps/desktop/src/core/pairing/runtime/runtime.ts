import { homedir } from "node:os";

import {
  createClaudeCodeAdapter as createClaudeCode,
  createCodexAdapter as createCodex,
  createOpenAiCompatAdapter as createOpenAI,
  createOpencodeAdapter as createOpenCode,
  createPiAdapter as createPi,
  type AdapterFactory,
} from "@openscout/agent-sessions";
import { Bridge } from "./bridge/bridge";
import { type AdapterEntry, resolveConfig, type SessionEntry } from "./bridge/config";
import { startFileServer, type FileServer } from "./bridge/fileserver";
import { connectToRelay, type RelayConnection, type RelayEventHandlers } from "./bridge/relay-client";
import { startBridgeServerTRPC as startBridgeServer } from "./bridge/server-trpc";
import { loadOrCreateIdentity, type KeyPair, type QRPayload } from "./security";

export type PairingRuntimeEvents = RelayEventHandlers;

export type StartedPairingRuntime = {
  bridge: Bridge;
  fileServer: FileServer;
  identity: KeyPair;
  config: ReturnType<typeof resolveConfig>;
  relayConnection: RelayConnection | null;
  qrPayload: QRPayload | null;
  stop: () => Promise<void>;
};

export function createPairingAdapterRegistry(configAdapters?: Record<string, AdapterEntry>) {
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
        console.warn(`[pairing] config adapter "${name}" references unknown type "${entry.type}" — skipped`);
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

export async function startPairingRuntime(options?: {
  relayUrl?: string | null;
  relayEvents?: PairingRuntimeEvents;
}) : Promise<StartedPairingRuntime> {
  const config = resolveConfig();
  const identity = loadOrCreateIdentity();
  const adapters = createPairingAdapterRegistry(config.adapters);
  const bridge = new Bridge({
    port: config.port,
    adapters,
  });

  const server = startBridgeServer({
    bridge,
    port: config.port,
    secure: config.secure,
    identity: config.secure ? identity : undefined,
  });
  const fileServer = startFileServer({ port: config.port + 2, bridge });

  const relayUrl = options?.relayUrl?.trim() || config.relay || null;
  if (!relayUrl) {
    fileServer.stop();
    server.stop();
    throw new Error("Pairing relay URL is not configured.");
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
