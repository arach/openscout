import { normalizeAgentSelectorSegment } from "./agent-identity.js";

/**
 * Reserved natural-language profile names. Their execution definitions stay
 * broker-owned; clients use this list only to recognize unambiguous syntax.
 */
export const SCOUT_RESERVED_RUNTIME_PROFILE_IDS = [
  "fable",
  "kimi",
  "grok",
  "opus",
] as const;

export type ScoutReservedRuntimeProfileId =
  (typeof SCOUT_RESERVED_RUNTIME_PROFILE_IDS)[number];

export const SCOUT_RUNTIME_PROFILE_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

export type ScoutRuntimeProfileReasoningEffort =
  (typeof SCOUT_RUNTIME_PROFILE_REASONING_EFFORTS)[number];

export function normalizeReservedRuntimeProfileId(
  value: string,
): ScoutReservedRuntimeProfileId | null {
  const normalized = normalizeAgentSelectorSegment(value);
  return SCOUT_RESERVED_RUNTIME_PROFILE_IDS.find((id) => id === normalized) ?? null;
}

export function normalizeRuntimeProfileReasoningEffort(
  value: string,
): ScoutRuntimeProfileReasoningEffort | null {
  const normalized = normalizeAgentSelectorSegment(value);
  return SCOUT_RUNTIME_PROFILE_REASONING_EFFORTS.find((effort) => effort === normalized) ?? null;
}
