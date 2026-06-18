import { basename } from "node:path";

import {
  BUILT_IN_AGENT_DEFINITION_IDS,
  normalizeAgentSelectorSegment,
} from "@openscout/protocol";
import {
  buildRelayAgentInstance,
  findNearestProjectRoot,
  readProjectConfig,
  readRelayAgentOverrides,
} from "@openscout/runtime/setup";
import { isCodingAgentHost } from "@openscout/runtime";
import { resolveOperatorName } from "@openscout/runtime/user-config";

export function resolveScoutAgentName(agentName?: string | null): string {
  const trimmed = agentName?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (process.env.OPENSCOUT_AGENT?.trim()) {
    return process.env.OPENSCOUT_AGENT.trim();
  }
  return resolveOperatorName();
}

export function resolveHumanAskSenderName(
  agentName: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (agentName?.trim()) {
    return agentName.trim();
  }
  if (isCodingAgentHost(env)) {
    return undefined;
  }
  return "operator";
}

function resolveConfiguredSenderIdForProjectRoot(
  overrides: Awaited<ReturnType<typeof readRelayAgentOverrides>>,
  projectRoot: string,
  preferredDefinitionIds: string[] = [],
): string | null {
  let fallbackSenderId: string | null = null;
  const normalizedPreferredDefinitionIds = preferredDefinitionIds
    .map((value) => normalizeAgentSelectorSegment(value))
    .filter(Boolean);

  for (const preferredDefinitionId of normalizedPreferredDefinitionIds) {
    for (const [agentId, override] of Object.entries(overrides)) {
      if (BUILT_IN_AGENT_DEFINITION_IDS.has(agentId)) {
        continue;
      }
      if (!override.projectRoot || override.projectRoot !== projectRoot) {
        continue;
      }
      if (override.definitionId === preferredDefinitionId) {
        return agentId;
      }
    }
  }

  for (const [agentId, override] of Object.entries(overrides)) {
    if (BUILT_IN_AGENT_DEFINITION_IDS.has(agentId)) {
      continue;
    }
    if (!override.projectRoot || override.projectRoot !== projectRoot) {
      continue;
    }
    fallbackSenderId ??= agentId;
  }
  return fallbackSenderId;
}

async function inferSenderIdForProjectRoot(
  projectRoot: string,
): Promise<string> {
  const overrides = await readRelayAgentOverrides();
  const projectConfig = await readProjectConfig(projectRoot);
  const configuredDefinitionId = normalizeAgentSelectorSegment(
    projectConfig?.agent?.id?.trim() ?? "",
  );
  const projectDefaultDefinitionIds = [
    configuredDefinitionId,
    projectConfig?.project?.id,
    basename(projectRoot),
  ].filter((value): value is string => Boolean(value));
  const configuredSenderId = resolveConfiguredSenderIdForProjectRoot(
    overrides,
    projectRoot,
    projectDefaultDefinitionIds,
  );
  if (configuredSenderId) {
    return configuredSenderId;
  }

  const definitionId =
    configuredDefinitionId ||
    normalizeAgentSelectorSegment(basename(projectRoot)) ||
    "agent";
  return buildRelayAgentInstance(definitionId, projectRoot).id;
}

export async function resolveScoutSenderId(
  agentName: string | null | undefined,
  currentDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (agentName?.trim()) {
    return agentName.trim();
  }
  if (env.OPENSCOUT_AGENT?.trim()) {
    return env.OPENSCOUT_AGENT.trim();
  }
  const projectRoot = await findNearestProjectRoot(currentDirectory);
  if (!projectRoot) {
    return resolveOperatorName();
  }
  return inferSenderIdForProjectRoot(projectRoot);
}
