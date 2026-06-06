/**
 * Filesystem path helpers for the web server's read-side queries: home-path
 * compaction and harness log/session resolvers. Lifted from db-queries.ts as
 * part of SCO-031 Phase A.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { relayAgentLogsDirectory } from "@openscout/runtime/support-paths";

import { metadataString } from "./parse.ts";

/* ── Compact home paths (~/...) ── */

export const HOME = homedir();

export function compact(p: string | null): string | null {
  if (!p) return null;
  return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

export function pairingHarnessLogPath(
  adapterType: string | null,
  sessionId: string | null,
): string | null {
  const normalizedAdapter = adapterType?.trim();
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedAdapter || !normalizedSessionId) {
    return null;
  }
  return join(HOME, ".scout", "pairing", normalizedAdapter, normalizedSessionId, "logs", "stdout.log");
}

export function relayHarnessLogPath(agentId: string): string {
  return join(relayAgentLogsDirectory(agentId), "stdout.log");
}

export function resolveHarnessSessionId(
  transport: string | null,
  endpointSessionId: string | null,
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (transport === "tmux") {
    return metadataString(metadata, "tmuxSession") ?? endpointSessionId;
  }

  if (transport === "pairing_bridge") {
    const attachedTransport = metadataString(metadata, "attachedTransport");
    if (attachedTransport === "codex_app_server") {
      return metadataString(metadata, "threadId")
        ?? metadataString(metadata, "externalSessionId")
        ?? endpointSessionId;
    }
    return metadataString(metadata, "externalSessionId") ?? endpointSessionId;
  }

  if (transport === "codex_app_server") {
    return metadataString(metadata, "threadId") ?? endpointSessionId;
  }

  if (transport === "claude_stream_json") {
    return metadataString(metadata, "externalSessionId") ?? endpointSessionId;
  }

  if (transport === "acp_stdio") {
    return metadataString(metadata, "externalSessionId") ?? endpointSessionId;
  }

  return null;
}

export function resolveHarnessLogPath(
  agentId: string,
  transport: string | null,
  endpointSessionId: string | null,
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (transport === "pairing_bridge") {
    const pairingSessionId = metadataString(metadata, "pairingSessionId") ?? endpointSessionId;
    const attachedTransport = metadataString(metadata, "attachedTransport");
    const adapterType = metadataString(metadata, "pairingAdapterType")
      ?? (attachedTransport === "codex_app_server"
        ? "codex"
        : attachedTransport === "claude_stream_json"
          ? "claude"
          : attachedTransport === "acp_stdio"
            ? "acp"
            : null);
    return pairingHarnessLogPath(adapterType, pairingSessionId);
  }

  if (transport === "codex_app_server" || transport === "claude_stream_json" || transport === "acp_stdio") {
    return relayHarnessLogPath(agentId);
  }

  return null;
}
