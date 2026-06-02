import type { WebAgent } from "../../db/types/web.ts";
import type { ScoutConversationSummary } from "../conversations/service.ts";
import type {
  EntityAgentRef,
  EntityAgentState,
  EntityConversationRef,
  EntityProjectRef,
  EntityRefs,
} from "./entity-ref-contract.ts";

type EntityRefResolverInput = {
  agents: WebAgent[];
};

export type EntityRefResolver = {
  forAgent(agent: WebAgent): EntityRefs;
  forConversation(conversation: ScoutConversationSummary): EntityRefs;
  projectForAgent(agent: WebAgent): EntityProjectRef | null;
};

const GENERIC_PROJECT_TITLES = new Set(["", "unknown", "unscoped"]);

export function buildEntityRefResolver(input: EntityRefResolverInput): EntityRefResolver {
  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]));

  return {
    forAgent(agent) {
      const project = projectRefFromAgent(agent);
      return {
        project,
        agent: agentRef(agent, project),
        conversation: {
          id: agent.conversationId,
          kind: "direct",
          title: agent.name,
        },
        flight: null,
      };
    },
    forConversation(conversation) {
      const agent = conversation.agentId ? agentsById.get(conversation.agentId) ?? null : null;
      const project = agent
        ? projectRefFromAgent(agent)
        : projectRefFromConversation(conversation);
      return {
        project,
        agent: agent
          ? agentRef(agent, project)
          : conversation.agentId
            ? inferredAgentRef(conversation, project)
            : null,
        conversation: conversationRef(conversation),
        flight: null,
      };
    },
    projectForAgent: projectRefFromAgent,
  };
}

export function normalizeEntityAgentState(state: string | null): EntityAgentState {
  if (state === "working") return "working";
  if (state === "available") return "available";
  if (!state || state === "offline") return "offline";
  return "available";
}

export function entityAgentStateRank(state: EntityAgentState): number {
  switch (state) {
    case "working": return 0;
    case "available": return 1;
    case "offline": return 2;
    default: return 3;
  }
}

export function projectKeyFrom(title: string | null | undefined, root: string | null | undefined): string {
  const normalizedTitle = title?.trim().toLowerCase() ?? "";
  if (!GENERIC_PROJECT_TITLES.has(normalizedTitle)) {
    return `project:${normalizedTitle}`;
  }
  const normalizedRoot = root?.trim().replace(/\/+$/, "") ?? "";
  return normalizedRoot ? `root:${normalizedRoot}` : "project:unscoped";
}

export function humanizeProjectTitle(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/\/+$/, "").split("/").at(-1)?.trim() || trimmed;
  if (!base) return null;
  return base
    .split(/[-_]+/g)
    .filter((token) => token.length > 0)
    .map((token) => `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`)
    .join(" ");
}

function normalizeRoot(root: string | null | undefined): string | null {
  const trimmed = root?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "") || null;
}

function projectRefFromAgent(agent: WebAgent): EntityProjectRef | null {
  const root = normalizeRoot(agent.projectRoot ?? agent.cwd);
  const title = agent.project?.trim() || humanizeProjectTitle(root);
  if (!title && !root) return null;
  return {
    key: projectKeyFrom(title, root),
    title: title || "Unscoped",
    root,
    source: "agent",
  };
}

function projectRefFromConversation(conversation: ScoutConversationSummary): EntityProjectRef | null {
  if (conversation.kind !== "direct" || !conversation.agentId) {
    return null;
  }

  const root = normalizeRoot(conversation.workspaceRoot);
  const title = humanizeProjectTitle(root)
    ?? conversation.agentName
    ?? conversation.title
    ?? null;
  if (!title && !root) return null;
  return {
    key: projectKeyFrom(title, root),
    title: title || "Unscoped",
    root,
    source: root ? "conversation" : "inferred",
  };
}

function agentRef(agent: WebAgent, project: EntityProjectRef | null): EntityAgentRef {
  const state = normalizeEntityAgentState(agent.state);
  return {
    id: agent.id,
    name: agent.name,
    state,
    active: state === "working" || state === "available",
    retired: agent.retiredFromFleet,
    harness: agent.harness,
    projectKey: project?.key ?? null,
  };
}

function inferredAgentRef(
  conversation: ScoutConversationSummary,
  project: EntityProjectRef | null,
): EntityAgentRef {
  return {
    id: conversation.agentId!,
    name: conversation.agentName ?? conversation.title ?? conversation.agentId!,
    state: "unknown",
    active: false,
    retired: true,
    harness: conversation.harness,
    projectKey: project?.key ?? null,
  };
}

function conversationRef(conversation: ScoutConversationSummary): EntityConversationRef {
  return {
    id: conversation.id,
    kind: conversation.kind,
    title: conversation.title,
  };
}
