import {
  allocateProvisionalAgentName,
  collectOccupiedDefinitionIds,
  definitionIdFromOccupancyKey,
  normalizeAgentSelectorSegment,
  provisionalAgentNameStartIndexForSeed,
  type ProvisionalAgentNameSeedPart,
} from "@openscout/protocol";

import type { ScoutBrokerSnapshot } from "./scout-broker.js";
import { loadProvisionalAgentNamePool } from "./provisional-agent-names-config.js";

export function collectOccupiedDefinitionIdsFromBrokerSnapshot(
  snapshot: Pick<ScoutBrokerSnapshot, "agents"> & Partial<Pick<ScoutBrokerSnapshot, "actors">>,
): Set<string> {
  const references: string[] = [];
  for (const agent of Object.values(snapshot.agents)) {
    references.push(agent.id);
    if (agent.definitionId) {
      references.push(agent.definitionId);
    }
    if (agent.handle) {
      references.push(agent.handle);
    }
  }
  for (const actor of Object.values(snapshot.actors ?? {})) {
    references.push(actor.id);
    if (actor.handle) {
      references.push(actor.handle);
    }
    if (typeof actor.metadata?.handle === "string") {
      references.push(actor.metadata.handle);
    }
  }
  return collectOccupiedDefinitionIds(references);
}

export function resolveProvisionalAgentName(input: {
  explicitName?: string | null;
  occupied: ReadonlySet<string> | Iterable<string>;
  startIndex?: number;
  seedParts?: Iterable<ProvisionalAgentNameSeedPart>;
}): string {
  const explicit = input.explicitName?.trim();
  if (explicit) {
    const normalized = normalizeAgentSelectorSegment(explicit);
    if (!normalized) {
      throw new Error(`Invalid agent name "${explicit}".`);
    }
    return normalized;
  }
  const pool = loadProvisionalAgentNamePool();
  const startIndex = input.startIndex
    ?? (input.seedParts ? provisionalAgentNameStartIndexForSeed(input.seedParts, pool) : undefined);
  return allocateProvisionalAgentName(input.occupied, {
    startIndex,
    pool,
  });
}

export {
  allocateProvisionalAgentName,
  collectOccupiedDefinitionIds,
  definitionIdFromOccupancyKey,
  isProvisionalAgentName,
  normalizeProvisionalAgentNameCandidates,
  parseProvisionalAgentNamesJson,
  parseProvisionalAgentNamesText,
  provisionalAgentNameStartIndexForSeed,
  PROVISIONAL_AGENT_NAMES,
  type ProvisionalAgentNameSeedPart,
} from "@openscout/protocol";

export {
  applyProvisionalAgentNamesFromBody,
  defaultProvisionalAgentNamesPath,
  describeProvisionalAgentNamePool,
  formatProvisionalAgentNamePoolSource,
  loadProvisionalAgentNamePool,
  mergeProvisionalAgentNamePool,
  normalizeProvisionalAgentNamesSetting,
  provisionalAgentNamesApiFields,
  resolveProvisionalAgentNamePool,
  resolveProvisionalAgentNamesMode,
  seedProvisionalAgentNamesInUserConfig,
  writeProvisionalAgentNamesFile,
  type ProvisionalAgentNamePoolSource,
  type ResolvedProvisionalAgentNamePool,
} from "./provisional-agent-names-config.js";
