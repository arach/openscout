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

/** Runtime/tmux refs — not provider harness conversation ids. */
export function isTransportSessionRef(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return /^relay[-:]/i.test(trimmed);
}

function providerHarnessSessionId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || isTransportSessionRef(trimmed)) return null;
  return trimmed;
}

export function resolveHarnessSessionId(
  transport: string | null,
  endpointSessionId: string | null,
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (transport === "tmux" || transport === "zellij") {
    return null;
  }

  if (transport === "pairing_bridge") {
    const attachedTransport = metadataString(metadata, "attachedTransport");
    if (attachedTransport === "codex_app_server") {
      return providerHarnessSessionId(
        metadataString(metadata, "threadId")
        ?? metadataString(metadata, "externalSessionId"),
      );
    }
    return providerHarnessSessionId(metadataString(metadata, "externalSessionId"));
  }

  if (transport === "codex_app_server") {
    return providerHarnessSessionId(
      metadataString(metadata, "threadId")
      ?? metadataString(metadata, "externalSessionId"),
    );
  }

  if (transport === "claude_stream_json") {
    const externalSessionId = providerHarnessSessionId(metadataString(metadata, "externalSessionId"));
    if (externalSessionId) {
      return externalSessionId;
    }
    const runtimeInstanceId = metadataString(metadata, "runtimeInstanceId")
      ?? metadataString(metadata, "runtimeSessionId");
    const endpoint = endpointSessionId?.trim() ?? null;
    if (!endpoint || endpoint === runtimeInstanceId) {
      return null;
    }
    return providerHarnessSessionId(endpoint);
  }

  return providerHarnessSessionId(
    metadataString(metadata, "externalSessionId")
    ?? metadataString(metadata, "threadId"),
  );
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
          : null);
    return pairingHarnessLogPath(adapterType, pairingSessionId);
  }

  if (transport === "codex_app_server" || transport === "claude_stream_json") {
    return relayHarnessLogPath(agentId);
  }

  return null;
}
