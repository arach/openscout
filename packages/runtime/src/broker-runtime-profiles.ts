import {
  normalizeReservedRuntimeProfileId,
  normalizeRuntimeProfileReasoningEffort,
  type InvocationExecutionPreference,
  type ScoutReservedRuntimeProfileId,
} from "@openscout/protocol";

export interface BrokerRuntimeProfile {
  id: ScoutReservedRuntimeProfileId;
  displayName: string;
  execution: InvocationExecutionPreference & { session: "new" };
}

const BROKER_RUNTIME_PROFILES: Record<ScoutReservedRuntimeProfileId, BrokerRuntimeProfile> = {
  fable: {
    id: "fable",
    displayName: "Fable",
    execution: { harness: "claude", model: "fable", session: "new" },
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi",
    execution: { harness: "kimi", session: "new" },
  },
  grok: {
    id: "grok",
    displayName: "Grok",
    execution: { harness: "grok", session: "new" },
  },
  opus: {
    id: "opus",
    displayName: "Opus",
    execution: { harness: "claude", model: "opus", session: "new" },
  },
};

export function resolveBrokerRuntimeProfile(
  profileId: string,
): BrokerRuntimeProfile | null {
  const normalized = normalizeReservedRuntimeProfileId(profileId);
  return normalized ? BROKER_RUNTIME_PROFILES[normalized] : null;
}

export function executionForBrokerRuntimeProfile(input: {
  profileId: string;
  reasoningEffort?: string;
}): InvocationExecutionPreference | null {
  const profile = resolveBrokerRuntimeProfile(input.profileId);
  if (!profile) {
    return null;
  }
  const reasoningEffort = input.reasoningEffort
    ? normalizeRuntimeProfileReasoningEffort(input.reasoningEffort)
    : null;
  if (input.reasoningEffort && !reasoningEffort) {
    return null;
  }
  return {
    ...profile.execution,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}
