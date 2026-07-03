import { basename } from "node:path";

import type { ActorIdentity, AgentEndpoint } from "@openscout/protocol";

import type { RuntimeSnapshot } from "./scout-dispatcher.js";

function metadataStringValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Provisional handle for a cardless/session actor (e.g. project-chopin). */
export function sessionActorAlias(
  snapshot: RuntimeSnapshot,
  actorId: string,
): string | null {
  const actor = snapshot.actors[actorId];
  if (!actor || actor.kind !== "session") {
    return null;
  }
  const endpoint = Object.values(snapshot.endpoints).find((entry) => entry.agentId === actorId);
  const candidates = [
    actor.handle,
    metadataStringValue(actor.metadata, "handle"),
    metadataStringValue(endpoint?.metadata, "handle"),
  ];
  for (const value of candidates) {
    const trimmed = value?.trim().replace(/^@+/, "");
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

export function sessionActorSid(
  snapshot: RuntimeSnapshot,
  actorId: string,
): string | null {
  const actor = snapshot.actors[actorId];
  const endpoint = Object.values(snapshot.endpoints).find((entry) => entry.agentId === actorId);
  const candidates = [
    metadataStringValue(actor?.metadata, "sid"),
    metadataStringValue(endpoint?.metadata, "sid"),
  ];
  for (const value of candidates) {
    const trimmed = value?.trim().replace(/^sid:/, "");
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

export function isCardlessSessionActor(
  snapshot: RuntimeSnapshot,
  actorId: string,
): boolean {
  const actor = snapshot.actors[actorId];
  if (actor?.kind === "session" && actor.metadata?.cardless === true) {
    return true;
  }
  const endpoint = Object.values(snapshot.endpoints).find((entry) => entry.agentId === actorId);
  return endpoint?.metadata?.cardless === true;
}

/** Pointer-forward label: alias → session (project, harness). */
export function formatSessionAliasPointer(input: {
  alias: string;
  sessionId: string;
  projectRoot?: string | null;
  harness?: string | null;
}): string {
  const project = input.projectRoot?.trim()
    ? basename(input.projectRoot.trim())
    : null;
  const scope = [project, input.harness?.trim()].filter(Boolean).join(", ");
  const target = input.sessionId.length > 24
    ? `${input.sessionId.slice(0, 12)}…${input.sessionId.slice(-6)}`
    : input.sessionId;
  return scope
    ? `alias ${input.alias} → ${target} (${scope})`
    : `alias ${input.alias} → ${target}`;
}

export function formatSessionSid(sid: string): string {
  const trimmed = sid.trim().replace(/^sid:/, "");
  return `sid:${trimmed}`;
}

export function sessionAliasAckSummary(input: {
  snapshot: RuntimeSnapshot;
  actorId: string;
  endpoint?: AgentEndpoint;
  strategy: string;
}): string {
  const alias = sessionActorAlias(input.snapshot, input.actorId);
  if (!alias || !isCardlessSessionActor(input.snapshot, input.actorId)) {
    return "";
  }
  const endpoint = input.endpoint
    ?? Object.values(input.snapshot.endpoints).find((entry) => entry.agentId === input.actorId);
  const pointer = formatSessionAliasPointer({
    alias,
    sessionId: input.actorId,
    projectRoot: endpoint?.projectRoot ?? endpoint?.cwd ?? null,
    harness: endpoint?.harness ?? null,
  });
  return `${pointer} acknowledged via ${input.strategy}.`;
}

export function sessionHandoffAckSummary(input: {
  snapshot: RuntimeSnapshot;
  actorId: string;
  endpoint?: AgentEndpoint;
  strategy: string;
}): string {
  if (!isCardlessSessionActor(input.snapshot, input.actorId)) {
    return "";
  }
  const sid = sessionActorSid(input.snapshot, input.actorId);
  if (sid) {
    return `${formatSessionSid(sid)} acknowledged via ${input.strategy}.`;
  }
  return sessionAliasAckSummary(input);
}

export function projectPrefixedSessionAlias(alias: string): string {
  const trimmed = alias.trim().replace(/^@+/, "");
  if (!trimmed || trimmed.startsWith("project-")) {
    return trimmed;
  }
  return `project-${trimmed}`;
}
