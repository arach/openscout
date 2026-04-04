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

  let sawPositionalWorkspace = false;
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

    if (sawPositionalWorkspace) {
      return null;
    }

    const value = normalizeAgentIdentitySegment(part);
    if (!value) {
      return null;
    }

    next.workspaceQualifier = value;
    sawPositionalWorkspace = true;
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
  const matches = Array.from(
    text.matchAll(/(^|\s)@([a-z0-9][a-z0-9._/:-]*)/gi),
  );
  const identities = new Map<string, AgentIdentity>();

  for (const match of matches) {
    const candidate = parseAgentIdentity(match[2] ?? "");
    if (!candidate) {
      continue;
    }

    identities.set(candidate.label, candidate);
  }

  return Array.from(identities.values());
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

export function agentIdentityMatches(
  identity: AgentIdentity,
  candidate: AgentIdentityCandidate,
): boolean {
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
  const matches = candidates.filter((candidate) => agentIdentityMatches(identity, candidate));
  if (matches.length === 1) {
    return matches[0];
  }

  if (!identity.nodeQualifier && !identity.workspaceQualifier && !identity.profile && !identity.harness) {
    return matches.find((candidate) => normalizeAgentIdentitySegment(candidate.agentId) === identity.definitionId)
      ?? matches[0]
      ?? null;
  }

  return null;
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
