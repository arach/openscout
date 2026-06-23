import {
  allocateProvisionalAgentName,
  collectOccupiedDefinitionIds,
  definitionIdFromOccupancyKey,
  normalizeAgentSelectorSegment,
} from "@openscout/protocol";

import type { ScoutBrokerSnapshot } from "./scout-broker.js";
import { loadProvisionalAgentNamePool } from "./provisional-agent-names-config.js";

export function collectOccupiedDefinitionIdsFromBrokerSnapshot(
  snapshot: Pick<ScoutBrokerSnapshot, "agents">,
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
  return collectOccupiedDefinitionIds(references);
}

export function resolveProvisionalAgentName(input: {
  explicitName?: string | null;
  occupied: ReadonlySet<string> | Iterable<string>;
  startIndex?: number;
}): string {
  const explicit = input.explicitName?.trim();
  if (explicit) {
    const normalized = normalizeAgentSelectorSegment(explicit);
    if (!normalized) {
      throw new Error(`Invalid agent name "${explicit}".`);
    }
    return normalized;
  }
  return allocateProvisionalAgentName(input.occupied, {
    startIndex: input.startIndex,
    pool: loadProvisionalAgentNamePool(),
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
  PROVISIONAL_AGENT_NAMES,
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