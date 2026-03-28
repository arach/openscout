import type { ScoutId } from "./common.js";

export interface AgentSelector {
  raw: string;
  label: string;
  definitionId: ScoutId;
  nodeQualifier?: string;
  workspaceQualifier?: string;
}

export interface AgentSelectorCandidate {
  agentId: ScoutId;
  definitionId?: ScoutId;
  nodeQualifier?: string;
  workspaceQualifier?: string;
  aliases?: string[];
}

function trimSelectorPrefix(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/[.,!?;:)\]]+$/, "");
}

export function normalizeAgentSelectorSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseAgentSelector(value: string): AgentSelector | null {
  const raw = trimSelectorPrefix(value);
  if (!raw) {
    return null;
  }

  const [definitionAndNode, workspacePart] = raw.split("#", 2);
  const [definitionPart, nodePart] = definitionAndNode.split("@", 2);
  const definitionId = normalizeAgentSelectorSegment(definitionPart);
  const nodeQualifier = nodePart ? normalizeAgentSelectorSegment(nodePart) : undefined;
  const workspaceQualifier = workspacePart ? normalizeAgentSelectorSegment(workspacePart) : undefined;

  if (!definitionId) {
    return null;
  }

  return {
    raw,
    label: formatAgentSelector({
      definitionId,
      nodeQualifier,
      workspaceQualifier,
    }),
    definitionId,
    ...(nodeQualifier ? { nodeQualifier } : {}),
    ...(workspaceQualifier ? { workspaceQualifier } : {}),
  };
}

export function formatAgentSelector(input: {
  definitionId: ScoutId;
  nodeQualifier?: string;
  workspaceQualifier?: string;
}, options: { includeSigil?: boolean } = {}): string {
  const definitionId = normalizeAgentSelectorSegment(input.definitionId);
  if (!definitionId) {
    return options.includeSigil === false ? "" : "@";
  }

  const nodeQualifier = input.nodeQualifier ? normalizeAgentSelectorSegment(input.nodeQualifier) : "";
  const workspaceQualifier = input.workspaceQualifier ? normalizeAgentSelectorSegment(input.workspaceQualifier) : "";
  const prefix = options.includeSigil === false ? "" : "@";

  return [
    `${prefix}${definitionId}`,
    nodeQualifier ? `@${nodeQualifier}` : "",
    workspaceQualifier ? `#${workspaceQualifier}` : "",
  ].join("");
}

export function extractAgentSelectors(text: string): AgentSelector[] {
  const matches = Array.from(
    text.matchAll(/(^|\s)@([a-z0-9._/-]+(?:@[a-z0-9._/-]+)?(?:#[a-z0-9._/-]+)?)/gi),
  );
  const selectors = new Map<string, AgentSelector>();

  for (const match of matches) {
    const candidate = parseAgentSelector(match[2] ?? "");
    if (!candidate) {
      continue;
    }

    selectors.set(candidate.label, candidate);
  }

  return Array.from(selectors.values());
}

function candidateAliases(candidate: AgentSelectorCandidate): string[] {
  const definitionId = normalizeAgentSelectorSegment(candidate.definitionId || candidate.agentId);
  const nodeQualifier = candidate.nodeQualifier ? normalizeAgentSelectorSegment(candidate.nodeQualifier) : undefined;
  const workspaceQualifier = candidate.workspaceQualifier ? normalizeAgentSelectorSegment(candidate.workspaceQualifier) : undefined;
  const aliases = [
    definitionId,
    formatAgentSelector({ definitionId, nodeQualifier }),
    formatAgentSelector({ definitionId, workspaceQualifier }),
    formatAgentSelector({ definitionId, nodeQualifier, workspaceQualifier }),
    ...((candidate.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)),
  ];

  return Array.from(new Set(aliases.map((alias) => trimSelectorPrefix(alias)).filter(Boolean)));
}

export function agentSelectorMatches(selector: AgentSelector, candidate: AgentSelectorCandidate): boolean {
  const definitionId = normalizeAgentSelectorSegment(candidate.definitionId || candidate.agentId);
  if (selector.definitionId !== definitionId) {
    return false;
  }

  const nodeQualifier = candidate.nodeQualifier ? normalizeAgentSelectorSegment(candidate.nodeQualifier) : undefined;
  if (selector.nodeQualifier && selector.nodeQualifier !== nodeQualifier) {
    return candidateAliases(candidate).includes(trimSelectorPrefix(selector.label));
  }

  const workspaceQualifier = candidate.workspaceQualifier ? normalizeAgentSelectorSegment(candidate.workspaceQualifier) : undefined;
  if (selector.workspaceQualifier && selector.workspaceQualifier !== workspaceQualifier) {
    return candidateAliases(candidate).includes(trimSelectorPrefix(selector.label));
  }

  return true;
}

export function resolveAgentSelector<T extends AgentSelectorCandidate>(
  selector: AgentSelector,
  candidates: T[],
): T | null {
  const matches = candidates.filter((candidate) => agentSelectorMatches(selector, candidate));
  if (matches.length === 1) {
    return matches[0];
  }

  if (!selector.nodeQualifier && !selector.workspaceQualifier) {
    return matches.find((candidate) => normalizeAgentSelectorSegment(candidate.agentId) === selector.definitionId) ?? matches[0] ?? null;
  }

  return null;
}
