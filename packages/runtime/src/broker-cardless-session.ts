import { basename, resolve } from "node:path";

import type {
  ActorIdentity,
  AgentEndpoint,
  AgentHarness,
} from "@openscout/protocol";

import type { ManagedLocalSessionTransport } from "./broker-managed-session-helpers.js";
import { isStaleLocalEndpoint } from "./broker-endpoint-selection.js";
import { resolveHarnessSessionDefaults } from "./harness-catalog.js";
import type { RuntimeRegistrySnapshot } from "./registry.js";
import { expandHomePath } from "./tool-resolution.js";

/**
 * SCO-070 — Scout-initiated cardless sessions.
 *
 * A cardless session inverts ownership: it belongs to a project path, not to an
 * agent card. It occupies the broker identity slot with its OWN session-kind
 * actor (id = the Scout session marker) and an endpoint owned by that same
 * marker — no `AgentDefinition` card is minted. The session routes through the
 * `resolved_session` variant (see resolveSessionTarget), and the runtime treats
 * the marker as an endpoint owner rather than a card id.
 */

export const CARDLESS_SESSION_SOURCE = "scout-cardless-session";

export type CardlessSessionSpawnTransport =
  | "claude_stream_json"
  | "codex_app_server"
  | "grok_acp"
  | "tmux";

/** Harness/transport policy for broker-created sessions that have no agent card. */
export function resolveCardlessSessionSpawnTarget(
  requestedHarness: string | undefined,
  options: { claudeTransport?: string } = {},
): { harness: AgentHarness; transport: CardlessSessionSpawnTransport } {
  const defaults = resolveHarnessSessionDefaults(requestedHarness ?? "claude", {
    transportOverride: options.claudeTransport,
  });
  if (defaults && isCardlessSessionSpawnTransport(defaults.transport)) {
    return {
      harness: defaults.harness as AgentHarness,
      transport: defaults.transport,
    };
  }
  throw new Error(
    `cannot auto-spawn a session for harness "${requestedHarness}"; `
    + `the harness catalog has no supported session defaults. `
    + `Bring a worker online first (scout up) to use other harnesses.`,
  );
}

function isCardlessSessionSpawnTransport(value: string): value is CardlessSessionSpawnTransport {
  return value === "claude_stream_json"
    || value === "codex_app_server"
    || value === "grok_acp"
    || value === "tmux";
}

export interface CardlessSessionInput {
  /** Scout's broker-local session marker. Provider ids are attached later. */
  sessionId: string;
  /** Human-addressable handle for this session actor. */
  handle?: string;
  transport: ManagedLocalSessionTransport | "pairing_bridge" | "grok_acp" | "tmux";
  harness: AgentHarness;
  cwd: string;
  projectRoot?: string;
  nodeId: string;
  displayName?: string;
  externalSessionId?: string;
  pairingSessionId?: string;
  model?: string;
  reasoningEffort?: string;
  launchArgs?: string[];
  /** Provenance only: the preset/card a cardless session was stamped with, if any. */
  viaCard?: string;
}

function resolveCardlessSessionPath(path: string): string {
  return resolve(expandHomePath(path));
}

function cleanCardlessSessionHandle(input: CardlessSessionInput): string {
  return input.handle?.trim().replace(/^@+/, "") || input.sessionId;
}

function titleCaseHandle(handle: string): string {
  return handle
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || handle;
}

const PROVISIONAL_HANDLE_PREFIXES = ["project", "spawn", "sess"] as const;

/** Strip broker allocation prefixes (project-hooke → hooke). */
export function bareProvisionalAlias(handle: string): string {
  const trimmed = handle.trim().replace(/^@+/, "");
  for (const prefix of PROVISIONAL_HANDLE_PREFIXES) {
    const marker = `${prefix}-`;
    if (trimmed.startsWith(marker)) {
      const bare = trimmed.slice(marker.length).trim();
      if (bare) {
        return bare;
      }
    }
  }
  return trimmed;
}

/** Human label: {project}-{alias} (scope-hooke), not project-hooke or Project Hooke. */
export function cardlessSessionDisplayName(input: {
  handle: string;
  projectName?: string | null;
}): string {
  const project = input.projectName?.trim();
  const bareAlias = bareProvisionalAlias(input.handle);
  if (project) {
    return `${project}-${bareAlias}`;
  }
  const trimmed = input.handle.trim().replace(/^@+/, "");
  if (/^(project|spawn|sess)-/u.test(trimmed)) {
    return bareAlias;
  }
  return titleCaseHandle(trimmed);
}

/** Build the session-kind actor that occupies the identity slot (no card). */
export function buildCardlessSessionActor(input: CardlessSessionInput): ActorIdentity {
  const projectRoot = resolveCardlessSessionPath(input.projectRoot ?? input.cwd);
  const projectName = basename(projectRoot) || projectRoot;
  const shortId = input.sessionId.length > 8 ? input.sessionId.slice(0, 8) : input.sessionId;
  const handle = cleanCardlessSessionHandle(input);
  return {
    id: input.sessionId,
    kind: "session",
    displayName: input.displayName?.trim() || (input.handle?.trim()
      ? cardlessSessionDisplayName({ handle, projectName })
      : `${projectName}:${shortId}`),
    handle,
    labels: ["cardless-session", "session"],
    metadata: {
      source: CARDLESS_SESSION_SOURCE,
      sessionBacked: true,
      cardless: true,
      handle,
      project: projectName,
      projectRoot,
      ...(input.viaCard ? { viaCard: input.viaCard } : {}),
    },
  };
}

/** Build the endpoint whose owner marker is the session id (no backing card). */
export function buildCardlessSessionEndpoint(input: CardlessSessionInput): AgentEndpoint {
  const projectRoot = resolveCardlessSessionPath(input.projectRoot ?? input.cwd);
  const cwd = resolveCardlessSessionPath(input.cwd);
  const projectName = basename(projectRoot) || projectRoot;
  const externalSessionId = input.externalSessionId?.trim();
  const endpointSessionId = input.pairingSessionId?.trim() || input.sessionId;
  const launchArgs = input.launchArgs?.map((entry) => entry.trim()).filter(Boolean);
  const handle = cleanCardlessSessionHandle(input);
  const displayName = input.displayName?.trim() || (input.handle?.trim()
    ? cardlessSessionDisplayName({ handle, projectName })
    : undefined);
  return {
    id: `endpoint.${input.sessionId}.${input.nodeId}.${input.transport}`,
    agentId: input.sessionId,
    nodeId: input.nodeId,
    harness: input.harness,
    transport: input.transport,
    state: "idle",
    cwd,
    projectRoot,
    sessionId: endpointSessionId,
    metadata: {
      source: CARDLESS_SESSION_SOURCE,
      sessionBacked: true,
      cardless: true,
      externalSource: "local-session",
      handle,
      ...(displayName ? { displayName } : {}),
      project: projectName,
      projectRoot,
      pendingExternalSession: !externalSessionId,
      ...(externalSessionId ? {
        externalSessionId,
        ...(input.transport === "codex_app_server" ? { threadId: externalSessionId } : {}),
      } : {}),
      ...(input.pairingSessionId?.trim() ? {
        pairingSessionId: input.pairingSessionId.trim(),
        pairingAdapterType: input.harness,
      } : {}),
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      ...(input.reasoningEffort?.trim() ? { reasoningEffort: input.reasoningEffort.trim() } : {}),
      ...(launchArgs && launchArgs.length > 0 ? { launchArgs } : {}),
      ...(input.viaCard ? { viaCard: input.viaCard } : {}),
      startedAt: String(Date.now()),
    },
  };
}

/** Minimal sink the broker's in-memory runtime already satisfies. */
export interface CardlessSessionRegistry {
  upsertActor: (actor: ActorIdentity) => Promise<void> | void;
  upsertEndpoint: (endpoint: AgentEndpoint) => Promise<void> | void;
}

/**
 * Seam 1: register a cardless session against the control plane — upsert the
 * session-kind actor and its endpoint, no card, no relay override. Callers feed
 * the broker-selected transport. Direct managed transports attach their
 * provider session id after launch; tmux starts as a pending external session.
 */
export async function registerCardlessSession(
  registry: CardlessSessionRegistry,
  input: CardlessSessionInput,
): Promise<{ endpointId: string; sessionId: string; actorId: string }> {
  const actor = buildCardlessSessionActor(input);
  const endpoint = buildCardlessSessionEndpoint(input);
  await registry.upsertActor(actor);
  await registry.upsertEndpoint(endpoint);
  return { endpointId: endpoint.id, sessionId: input.sessionId, actorId: actor.id };
}

export function isCardlessSessionEndpoint(endpoint: AgentEndpoint): boolean {
  return endpoint.metadata?.source === CARDLESS_SESSION_SOURCE
    || endpoint.metadata?.cardless === true;
}

/**
 * Seam 4: group live cardless-session endpoints by their (resolved) project root.
 * Reuses `resolve()` — the same normalization the endpoint builder stores — and
 * the session-aware staleness filter so dead sessions drop out of the list.
 */
export function cardlessSessionEndpointsByProjectRoot(
  snapshot: RuntimeRegistrySnapshot,
): Map<string, AgentEndpoint[]> {
  const byRoot = new Map<string, AgentEndpoint[]>();
  for (const endpoint of Object.values(snapshot.endpoints)) {
    if (!isCardlessSessionEndpoint(endpoint)) continue;
    if (isStaleLocalEndpoint(snapshot, endpoint)) continue;
    const root = resolveCardlessSessionPath(endpoint.projectRoot ?? endpoint.cwd ?? ".");
    const list = byRoot.get(root);
    if (list) {
      list.push(endpoint);
    } else {
      byRoot.set(root, [endpoint]);
    }
  }
  return byRoot;
}

/** Seam 4: the live cardless sessions for one project root. */
export function cardlessSessionsForProjectRoot(
  snapshot: RuntimeRegistrySnapshot,
  projectRoot: string,
): AgentEndpoint[] {
  const root = resolveCardlessSessionPath(projectRoot);
  return cardlessSessionEndpointsByProjectRoot(snapshot).get(root) ?? [];
}
