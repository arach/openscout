import {
  normalizeAgentSelectorSegment,
  scoutReservedVocabularyKind,
  type AgentDefinition,
} from "@openscout/protocol";

export function assertNoReservedStoredAgentNames(
  agents: Record<string, AgentDefinition>,
): void {
  for (const agent of Object.values(agents)) {
    const metadataDefinitionId = typeof agent.metadata?.definitionId === "string"
      ? agent.metadata.definitionId
      : undefined;
    const definitionId = normalizeAgentSelectorSegment(
      agent.definitionId || metadataDefinitionId || agent.id,
    );
    const kind = scoutReservedVocabularyKind(definitionId);
    if (!kind || kind === "built_in" || kind === "product") {
      continue;
    }
    throw new Error(
      `reserved_name_existing: stored agent ${agent.id} uses reserved ${kind} name "${definitionId}"; `
        + `repair the project or registry identity before starting Scout`,
    );
  }
}
