import type { ScoutId } from "./common.js";

export type AgentIdentityDimension = "workspace" | "profile" | "harness" | "node";

export interface AgentIdentity {
  raw: string;
  label: string;
  definitionId: ScoutId;
  nodeQualifier?: string;
  workspaceQualifier?: string;
  profile?: string;
  harness?: string;
}

export interface AgentIdentityCandidate {
  agentId: ScoutId;
  definitionId?: ScoutId;
  nodeQualifier?: string;
  workspaceQualifier?: string;
  profile?: string;
  harness?: string;
  aliases?: string[];
}

export interface AgentIdentityInput {
  definitionId: ScoutId;
  nodeQualifier?: string;
  workspaceQualifier?: string;
  profile?: string;
  harness?: string;
}

export interface AgentIdentityAlias {
  alias: string;
  target: AgentIdentityInput;
}

const DIMENSION_ALIASES: Record<string, AgentIdentityDimension> = {
  workspace: "workspace",
  worktree: "workspace",
  branch: "workspace",
  profile: "profile",
  persona: "profile",
  harness: "harness",
  runtime: "harness",
  node: "node",
  host: "node",
};

function trimIdentityPrefix(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/[.,!?;)\]]+$/, "");
}

export function normalizeAgentIdentitySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const normalizeAgentSelectorSegment = normalizeAgentIdentitySegment;

export const SCOUT_DISPATCHER_AGENT_ID = "scout";

const RESERVED_AGENT_DEFINITION_IDS: ReadonlySet<string> = new Set([
  SCOUT_DISPATCHER_AGENT_ID,
]);

export function isReservedAgentDefinitionId(value: string | null | undefined): boolean {
  if (!value) return false;
  return RESERVED_AGENT_DEFINITION_IDS.has(normalizeAgentIdentitySegment(value));
}

function normalizeDimensionKey(value: string): AgentIdentityDimension | null {
  return DIMENSION_ALIASES[normalizeAgentIdentitySegment(value)] ?? null;
}

function canonicalizeIdentity(input: AgentIdentityInput): AgentIdentityInput | null {
  const definitionId = normalizeAgentIdentitySegment(input.definitionId);
  const workspaceQualifier = input.workspaceQualifier
    ? normalizeAgentIdentitySegment(input.workspaceQualifier)
    : undefined;
  const profile = input.profile ? normalizeAgentIdentitySegment(input.profile) : undefined;
  const harness = input.harness ? normalizeAgentIdentitySegment(input.harness) : undefined;
  const nodeQualifier = input.nodeQualifier
    ? normalizeAgentIdentitySegment(input.nodeQualifier)
    : undefined;

  if (!definitionId) {
    return null;
  }

  return {
    definitionId,
    ...(workspaceQualifier ? { workspaceQualifier } : {}),
    ...(profile ? { profile } : {}),
    ...(harness ? { harness } : {}),
    ...(nodeQualifier ? { nodeQualifier } : {}),
  };
}

function parseSegmentedIdentity(raw: string): AgentIdentity | null {
  const parts = raw.split(".").filter(Boolean);
  const definitionPart = parts.shift();
  if (!definitionPart) {
    return null;
  }

  const next: AgentIdentityInput = {
    definitionId: definitionPart,
  };

  // Collect positional (non-keyed) segments
  const positional: string[] = [];
  for (const part of parts) {
    if (part.includes(":")) {
      const [rawKey, rawValue = ""] = part.split(":", 2);
      const key = normalizeDimensionKey(rawKey);
      const value = normalizeAgentIdentitySegment(rawValue);
      if (!key || !value) {
        return null;
      }

      if (key === "workspace") {
        next.workspaceQualifier = value;
      } else if (key === "profile") {
        next.profile = value;
      } else if (key === "harness") {
        next.harness = value;
      } else if (key === "node") {
        next.nodeQualifier = value;
      }
      continue;
    }

    positional.push(part);
  }

  // 1 positional → workspaceQualifier  (@agent.branch)
  // 2 positionals → workspaceQualifier.nodeQualifier  (@agent.branch.node — node is always last)
  // 3+ positionals → invalid
  if (positional.length === 1) {
    const value = normalizeAgentIdentitySegment(positional[0]);
    if (!value) return null;
    next.workspaceQualifier = value;
  } else if (positional.length === 2) {
    const workspaceValue = normalizeAgentIdentitySegment(positional[0]);
    const nodeValue = normalizeAgentIdentitySegment(positional[1]);
    if (!workspaceValue || !nodeValue) return null;
    if (!next.workspaceQualifier) next.workspaceQualifier = workspaceValue;
    if (!next.nodeQualifier) next.nodeQualifier = nodeValue;
  } else if (positional.length > 2) {
    return null;
  }

  return constructAgentIdentity(next, { raw });
}

export function parseAgentIdentity(value: string): AgentIdentity | null {
  const raw = trimIdentityPrefix(value);
  if (!raw) {
    return null;
  }

  if (raw.includes("@") || raw.includes("#")) {
    return null;
  }

  return parseSegmentedIdentity(raw);
}

export function formatAgentIdentity(
  input: AgentIdentityInput,
  options: { includeSigil?: boolean } = {},
): string {
  const canonical = canonicalizeIdentity(input);
  if (!canonical) {
    return options.includeSigil === false ? "" : "@";
  }

  const prefix = options.includeSigil === false ? "" : "@";
  const segments = [`${prefix}${canonical.definitionId}`];

  if (canonical.workspaceQualifier) {
    segments.push(canonical.workspaceQualifier);
  }
  if (canonical.profile) {
    segments.push(`profile:${canonical.profile}`);
  }
  if (canonical.harness) {
    segments.push(`harness:${canonical.harness}`);
  }
  if (canonical.nodeQualifier) {
    segments.push(`node:${canonical.nodeQualifier}`);
  }

  return segments.join(".");
}

export function constructAgentIdentity(
  input: AgentIdentityInput,
  options: { raw?: string } = {},
): AgentIdentity | null {
  const canonical = canonicalizeIdentity(input);
  if (!canonical) {
    return null;
  }

  return {
    raw: options.raw ?? formatAgentIdentity(canonical, { includeSigil: false }),
    label: formatAgentIdentity(canonical),
    definitionId: canonical.definitionId,
    ...(canonical.nodeQualifier ? { nodeQualifier: canonical.nodeQualifier } : {}),
    ...(canonical.workspaceQualifier ? { workspaceQualifier: canonical.workspaceQualifier } : {}),
    ...(canonical.profile ? { profile: canonical.profile } : {}),
    ...(canonical.harness ? { harness: canonical.harness } : {}),
  };
}

export function extractAgentIdentities(text: string): AgentIdentity[] {
  return extractAgentMentions(text).parsed;
}

export function extractAgentMentions(text: string): { parsed: AgentIdentity[]; unparsed: string[] } {
  const matches = Array.from(
    text.matchAll(/(^|\s)@([a-z0-9][a-z0-9._/:-]*)/gi),
  );
  const identities = new Map<string, AgentIdentity>();
  const unparsed: string[] = [];

  for (const match of matches) {
    const raw = match[2] ?? "";
    const candidate = parseAgentIdentity(raw);
    if (!candidate) {
      if (raw) unparsed.push(`@${raw}`);
      continue;
    }

    identities.set(candidate.label, candidate);
  }

  return {
    parsed: Array.from(identities.values()),
    unparsed: Array.from(new Set(unparsed)),
  };
}

function candidateAliases(candidate: AgentIdentityCandidate): string[] {
  const canonical = canonicalizeIdentity({
    definitionId: candidate.definitionId || candidate.agentId,
    nodeQualifier: candidate.nodeQualifier,
    workspaceQualifier: candidate.workspaceQualifier,
    profile: candidate.profile,
    harness: candidate.harness,
  });
  if (!canonical) {
    return [];
  }

  const aliases = [
    canonical.definitionId,
    formatAgentIdentity(canonical),
    canonical.workspaceQualifier
      ? formatAgentIdentity({ definitionId: canonical.definitionId, workspaceQualifier: canonical.workspaceQualifier })
      : "",
    canonical.profile
      ? formatAgentIdentity({ definitionId: canonical.definitionId, profile: canonical.profile })
      : "",
    canonical.harness
      ? formatAgentIdentity({ definitionId: canonical.definitionId, harness: canonical.harness })
      : "",
    canonical.nodeQualifier
      ? formatAgentIdentity({ definitionId: canonical.definitionId, nodeQualifier: canonical.nodeQualifier })
      : "",
    ...((candidate.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)),
  ];

  return Array.from(new Set(aliases.map((alias) => trimIdentityPrefix(alias)).filter(Boolean)));
}

function explicitCandidateAliases(candidate: AgentIdentityCandidate): string[] {
  return Array.from(new Set(
    (candidate.aliases ?? [])
      .map((alias) => normalizeAgentIdentitySegment(trimIdentityPrefix(alias)))
      .filter(Boolean),
  ));
}

function canonicalizeAliasValue(value: string): string {
  const parsed = parseAgentIdentity(value.startsWith("@") ? value : `@${value}`);
  if (parsed) {
    return trimIdentityPrefix(parsed.label);
  }

  return normalizeAgentIdentitySegment(value);
}

function identityAliasKeys(identity: AgentIdentity): string[] {
  return Array.from(new Set([
    trimIdentityPrefix(identity.label),
    trimIdentityPrefix(identity.raw),
    trimIdentityPrefix(formatAgentIdentity(identity, { includeSigil: false })),
  ].filter(Boolean)));
}

function candidateCanonicalIdentity(candidate: AgentIdentityCandidate): AgentIdentity | null {
  return constructAgentIdentity({
    definitionId: candidate.definitionId || candidate.agentId,
    nodeQualifier: candidate.nodeQualifier,
    workspaceQualifier: candidate.workspaceQualifier,
    profile: candidate.profile,
    harness: candidate.harness,
  });
}

function candidateDimensionValue(
  candidate: AgentIdentityCandidate,
  dimension: AgentIdentityDimension,
): string | undefined {
  const canonical = candidateCanonicalIdentity(candidate);
  if (!canonical) {
    return undefined;
  }

  if (dimension === "workspace") return canonical.workspaceQualifier;
  if (dimension === "profile") return canonical.profile;
  if (dimension === "harness") return canonical.harness;
  return canonical.nodeQualifier;
}

export function agentIdentityMatches(
  identity: AgentIdentity,
  candidate: AgentIdentityCandidate,
): boolean {
  const aliasKeys = identityAliasKeys(identity);
  const candidateAliasKeys = explicitCandidateAliases(candidate).map(canonicalizeAliasValue);
  if (aliasKeys.some((key) => candidateAliasKeys.includes(key))) {
    return true;
  }

  const canonical = canonicalizeIdentity({
    definitionId: candidate.definitionId || candidate.agentId,
    nodeQualifier: candidate.nodeQualifier,
    workspaceQualifier: candidate.workspaceQualifier,
    profile: candidate.profile,
    harness: candidate.harness,
  });
  if (!canonical || identity.definitionId !== canonical.definitionId) {
    return false;
  }

  if (identity.nodeQualifier && identity.nodeQualifier !== canonical.nodeQualifier) {
    return candidateAliases(candidate).includes(trimIdentityPrefix(identity.label));
  }
  if (identity.workspaceQualifier && identity.workspaceQualifier !== canonical.workspaceQualifier) {
    return candidateAliases(candidate).includes(trimIdentityPrefix(identity.label));
  }
  if (identity.profile && identity.profile !== canonical.profile) {
    return candidateAliases(candidate).includes(trimIdentityPrefix(identity.label));
  }
  if (identity.harness && identity.harness !== canonical.harness) {
    return candidateAliases(candidate).includes(trimIdentityPrefix(identity.label));
  }

  return true;
}

export function resolveAgentIdentity<T extends AgentIdentityCandidate>(
  identity: AgentIdentity,
  candidates: T[],
): T | null {
  const diagnosis = diagnoseAgentIdentity(identity, candidates);
  return diagnosis.kind === "resolved" ? diagnosis.match : null;
}

export type AgentIdentityDiagnosis<T extends AgentIdentityCandidate> =
  | { kind: "resolved"; match: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "unknown" };

export function diagnoseAgentIdentity<T extends AgentIdentityCandidate>(
  identity: AgentIdentity,
  candidates: T[],
): AgentIdentityDiagnosis<T> {
  const aliasKeys = identityAliasKeys(identity);
  const exactAliasMatches = candidates.filter((candidate) => {
    const candidateAliasKeys = explicitCandidateAliases(candidate).map(canonicalizeAliasValue);
    return aliasKeys.some((key) => candidateAliasKeys.includes(key));
  });
  if (exactAliasMatches.length === 1) {
    return { kind: "resolved", match: exactAliasMatches[0] };
  }
  if (exactAliasMatches.length > 1) {
    return { kind: "ambiguous", candidates: exactAliasMatches };
  }

  const matches = candidates.filter((candidate) => agentIdentityMatches(identity, candidate));
  if (matches.length === 1) {
    return { kind: "resolved", match: matches[0] };
  }
  if (matches.length === 0) {
    return { kind: "unknown" };
  }

  if (!identity.nodeQualifier && !identity.workspaceQualifier && !identity.profile && !identity.harness) {
    const exactIdMatch = matches.find(
      (candidate) => normalizeAgentIdentitySegment(candidate.agentId) === identity.definitionId,
    );
    if (exactIdMatch) {
      return { kind: "resolved", match: exactIdMatch };
    }
    return { kind: "ambiguous", candidates: matches };
  }

  return { kind: "ambiguous", candidates: matches };
}

export function constructAgentAlias(input: {
  alias: string;
  target: AgentIdentityInput;
}): AgentIdentityAlias | null {
  const alias = normalizeAgentIdentitySegment(trimIdentityPrefix(input.alias));
  const target = canonicalizeIdentity(input.target);
  if (!alias || !target) {
    return null;
  }

  return { alias, target };
}

export function formatAgentAlias(alias: AgentIdentityAlias, options: { includeSigil?: boolean } = {}): string {
  const prefix = options.includeSigil === false ? "" : "@";
  return `${prefix}${normalizeAgentIdentitySegment(alias.alias)}`;
}

export function resolveAgentAlias(
  value: string,
  aliases: AgentIdentityAlias[],
): AgentIdentity | null {
  const aliasKey = normalizeAgentIdentitySegment(trimIdentityPrefix(value));
  if (!aliasKey) {
    return null;
  }

  const matches = aliases.filter((alias) => normalizeAgentIdentitySegment(alias.alias) === aliasKey);
  if (matches.length !== 1) {
    return null;
  }

  return constructAgentIdentity(matches[0].target);
}

function identitiesDifferOnDimension(
  left: AgentIdentityCandidate,
  right: AgentIdentityCandidate,
  dimension: AgentIdentityDimension,
): boolean {
  return candidateDimensionValue(left, dimension) !== candidateDimensionValue(right, dimension);
}

function buildIdentitySubset(
  candidate: AgentIdentityCandidate,
  dimensions: AgentIdentityDimension[],
): AgentIdentity | null {
  const canonical = candidateCanonicalIdentity(candidate);
  if (!canonical) {
    return null;
  }

  return constructAgentIdentity({
    definitionId: canonical.definitionId,
    ...(dimensions.includes("workspace") && canonical.workspaceQualifier
      ? { workspaceQualifier: canonical.workspaceQualifier }
      : {}),
    ...(dimensions.includes("profile") && canonical.profile ? { profile: canonical.profile } : {}),
    ...(dimensions.includes("harness") && canonical.harness ? { harness: canonical.harness } : {}),
    ...(dimensions.includes("node") && canonical.nodeQualifier ? { nodeQualifier: canonical.nodeQualifier } : {}),
  });
}

export function formatMinimalAgentIdentity<T extends AgentIdentityCandidate>(
  candidate: T,
  candidates: T[],
  options: { includeSigil?: boolean } = {},
): string {
  const canonical = candidateCanonicalIdentity(candidate);
  if (!canonical) {
    return options.includeSigil === false ? "" : "@";
  }

  const peers = candidates.filter((peer) => {
    const peerCanonical = candidateCanonicalIdentity(peer);
    return peerCanonical && peerCanonical.definitionId === canonical.definitionId;
  });

  const aliasMatches = explicitCandidateAliases(candidate)
    .map((alias) => ({ alias, identity: parseAgentIdentity(`@${alias}`) }))
    .filter((entry): entry is { alias: string; identity: AgentIdentity } => Boolean(entry.identity))
    .filter((entry) => resolveAgentIdentity(entry.identity, candidates) === candidate)
    .sort((left, right) => left.alias.length - right.alias.length || left.alias.localeCompare(right.alias));
  if (aliasMatches.length > 0) {
    return formatAgentIdentity({ definitionId: aliasMatches[0].alias }, options);
  }

  if (peers.length <= 1) {
    return formatAgentIdentity({ definitionId: canonical.definitionId }, options);
  }

  const orderedDimensions: AgentIdentityDimension[] = ["workspace", "profile", "harness", "node"];
  const selectedDimensions: AgentIdentityDimension[] = [];
  let remainingPeers = peers.filter((peer) => peer !== candidate);

  for (const dimension of orderedDimensions) {
    const value = candidateDimensionValue(candidate, dimension);
    if (!value) {
      continue;
    }
    const splitsRemainingPeers = remainingPeers.some((peer) => identitiesDifferOnDimension(candidate, peer, dimension));
    if (!splitsRemainingPeers) {
      continue;
    }

    selectedDimensions.push(dimension);
    remainingPeers = remainingPeers.filter((peer) => (
      !identitiesDifferOnDimension(candidate, peer, dimension)
    ));
    const current = buildIdentitySubset(candidate, selectedDimensions);
    if (current && resolveAgentIdentity(current, candidates)) {
      return formatAgentIdentity(current, options);
    }
  }

  return formatAgentIdentity(canonical, options);
}

export type AgentAddress = AgentIdentity;
export type AgentAddressCandidate = AgentIdentityCandidate;
export type AgentSelector = AgentIdentity;
export type AgentSelectorCandidate = AgentIdentityCandidate;

export const parseAgentAddress = parseAgentIdentity;
export const formatAgentAddress = formatAgentIdentity;
export const constructAgentAddress = constructAgentIdentity;
export const extractAgentAddresses = extractAgentIdentities;
export const agentAddressMatches = agentIdentityMatches;
export const resolveAgentAddress = resolveAgentIdentity;

export const parseAgentSelector = parseAgentIdentity;
export const formatAgentSelector = formatAgentIdentity;
export const extractAgentSelectors = extractAgentIdentities;
export const agentSelectorMatches = agentIdentityMatches;
export const resolveAgentSelector = resolveAgentIdentity;
