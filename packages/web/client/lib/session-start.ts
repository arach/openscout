import { ensureAgentChat } from "./agent-chat.ts";
import { api } from "./api.ts";
import type { OutgoingAttachment } from "./media-blobs.ts";
import type { Agent, AgentConfigurationProject } from "./types.ts";
import { newSessionPayloadForAgent, type SessionInitiationResult } from "../screens/agents/model.ts";

export type ProjectLaunchTarget = {
  id: string;
  title: string;
  root: string;
  defaultHarness: string;
  source: "inventory" | "agent";
  registrationKind: string | null;
};

function normalizedProjectRoot(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > 1 ? trimmed.replace(/\/+$/u, "") : trimmed;
}

function projectLeaf(root: string): string {
  return root.split("/").filter(Boolean).at(-1) ?? root;
}

/**
 * Canonical New Chat targets come from Scout's project inventory. Agent roots
 * only fill gaps while discovery is loading (or for a transient project not in
 * the inventory yet); they never replace richer inventory metadata.
 */
export function buildProjectLaunchTargets(
  projects: readonly AgentConfigurationProject[],
  agents: readonly Agent[],
  fallbackHarness = "claude",
): ProjectLaunchTarget[] {
  const byRoot = new Map<string, ProjectLaunchTarget>();

  for (const project of projects) {
    const root = normalizedProjectRoot(project.root);
    if (!root) continue;
    byRoot.set(root, {
      id: project.id || `project:${root}`,
      title: project.title?.trim() || projectLeaf(root),
      root,
      defaultHarness: project.defaultHarness?.trim() || fallbackHarness,
      source: "inventory",
      registrationKind: project.registrationKind?.trim() || null,
    });
  }

  for (const agent of agents) {
    const root = normalizedProjectRoot(agent.projectRoot ?? agent.cwd);
    if (!root || byRoot.has(root)) continue;
    byRoot.set(root, {
      id: `agent-project:${root}`,
      title: agent.project?.trim() || projectLeaf(root),
      root,
      defaultHarness: agent.harness?.trim() || fallbackHarness,
      source: "agent",
      registrationKind: null,
    });
  }

  return [...byRoot.values()].sort((left, right) =>
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      || left.root.localeCompare(right.root)
  );
}

function projectSearchScore(project: ProjectLaunchTarget, query: string): number | null {
  const title = project.title.toLocaleLowerCase();
  const root = project.root.toLocaleLowerCase();
  const leaf = projectLeaf(project.root).toLocaleLowerCase();
  if (title === query || leaf === query || root === query) return 0;
  if (title.startsWith(query) || leaf.startsWith(query)) return 1;
  if (root.startsWith(query)) return 2;
  const terms = query.split(/\s+/u).filter(Boolean);
  if (terms.every((term) => title.includes(term) || root.includes(term))) return 3;
  return null;
}

/** Search every known project, then rank exact/title-prefix matches first. */
export function searchProjectLaunchTargets(
  projects: readonly ProjectLaunchTarget[],
  rawQuery: string,
): ProjectLaunchTarget[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [...projects];
  return projects
    .map((project) => ({ project, score: projectSearchScore(project, query) }))
    .filter((entry): entry is { project: ProjectLaunchTarget; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score
      || left.project.title.localeCompare(right.project.title, undefined, { sensitivity: "base" })
      || left.project.root.localeCompare(right.project.root))
    .map((entry) => entry.project);
}

function pathIsWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** Prefer explicit route context, then the deepest project containing cwd. */
export function chooseInitialProjectLaunchTarget(
  projects: readonly ProjectLaunchTarget[],
  input: { preferredRoot?: string | null; currentDirectory?: string | null },
): ProjectLaunchTarget | null {
  const preferredRoot = normalizedProjectRoot(input.preferredRoot);
  if (preferredRoot) {
    const preferred = projects.find((project) => project.root === preferredRoot);
    if (preferred) return preferred;
  }
  const currentDirectory = normalizedProjectRoot(input.currentDirectory);
  if (currentDirectory) {
    const containing = projects
      .filter((project) => pathIsWithin(currentDirectory, project.root))
      .sort((left, right) => right.root.length - left.root.length)[0];
    if (containing) return containing;
  }
  return projects[0] ?? null;
}

export async function sendConversationAttachments(input: {
  conversationId: string;
  body?: string;
  attachments: OutgoingAttachment[];
}): Promise<void> {
  await api("/api/send", {
    method: "POST",
    body: JSON.stringify({
      conversationId: input.conversationId,
      body: input.body?.trim() ?? "",
      attachments: input.attachments,
    }),
  });
}

export async function startAgentSession(
  agent: Agent,
  input?: {
    instructions?: string;
    attachments?: OutgoingAttachment[];
    clientMessageId?: string;
  },
): Promise<SessionInitiationResult> {
  const attachments = input?.attachments?.filter(Boolean) ?? [];
  const instructions = input?.instructions?.trim();
  const payload = newSessionPayloadForAgent(agent);
  const body = instructions || attachments.length > 0
    ? {
        ...payload,
        seed: {
          ...(instructions ? { instructions } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(input?.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
        },
      }
    : payload;

  const result = await api<SessionInitiationResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return result;
}

/**
 * Start New Chat by project/capability, not by a previously observed agent.
 * The broker resolves or launches a worker for the project and returns the
 * concrete agent/session handles. One-time persistence avoids minting a durable
 * card for every casual chat; users can promote a routed worker deliberately.
 */
export async function startProjectSession(input: {
  projectPath: string;
  harness?: string;
  model?: string;
  reasoningEffort?: string;
  instructions?: string;
  attachments?: OutgoingAttachment[];
  clientMessageId?: string;
  fromMessageId?: string;
  fromConversationId?: string;
}): Promise<SessionInitiationResult> {
  const projectPath = input.projectPath.trim();
  const harness = input.harness?.trim();
  const model = input.model?.trim();
  const reasoningEffort = input.reasoningEffort?.trim();
  const instructions = input.instructions?.trim();
  const fromMessageId = input.fromMessageId?.trim();
  const fromConversationId = input.fromConversationId?.trim();
  const attachments = input.attachments?.filter(Boolean) ?? [];
  return api<SessionInitiationResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      target: { projectPath },
      execution: {
        session: "new",
        ...(harness ? { harness } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
      agent: { persistence: "one_time" },
      ...(instructions || attachments.length > 0 || (fromMessageId && fromConversationId)
        ? {
            seed: {
              ...(instructions ? { instructions } : {}),
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
              ...(fromMessageId && fromConversationId
                ? { fromMessageId, fromConversationId }
                : {}),
            },
          }
        : {}),
    }),
  });
}

export async function resumeAgentSession(input: {
  agentId: string;
  sessionId: string;
  instructions: string;
}): Promise<SessionInitiationResult> {
  return api<SessionInitiationResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      target: { agentId: input.agentId.trim() },
      execution: {
        session: "existing",
        targetSessionId: input.sessionId.trim(),
      },
      seed: { instructions: input.instructions.trim() },
    }),
  });
}

/**
 * Map an observe/transcript `adapterType` (e.g. "claude-code") to the broker's
 * canonical harness id (e.g. "claude"). Returns undefined when the adapter is
 * unknown so the broker falls back to project detection rather than being fed a
 * value it will reject.
 */
export function harnessFromAdapterType(
  adapterType: string | null | undefined,
): string | undefined {
  const normalized = adapterType?.trim().toLowerCase();
  if (!normalized) return undefined;
  switch (normalized) {
    case "claude":
    case "claude-code":
    case "claude_code":
    case "claude_stream_json":
      return "claude";
    case "codex":
    case "codex_app_server":
      return "codex";
    case "pi":
    case "pi_rpc":
      return "pi";
    case "cursor":
    case "cursor_exec":
      return "cursor";
    case "grok":
      return "grok";
    default:
      return undefined;
  }
}

/**
 * Invoke (resume) a session directly from its own metadata — no pre-existing
 * agent identity required. The broker resolves the project path, resumes the
 * given session on the session's *own* harness/model, and mints an agent
 * identity as a byproduct (returned as `agentId`). This is the "engage any
 * session" path for bare history transcripts where `agentId` is null.
 */
export async function invokeSession(input: {
  projectPath: string;
  sessionId: string;
  harness?: string;
  model?: string;
  reasoningEffort?: string;
  instructions: string;
}): Promise<SessionInitiationResult> {
  const projectPath = input.projectPath.trim();
  const sessionId = input.sessionId.trim();
  const instructions = input.instructions.trim();
  const harness = input.harness?.trim() || undefined;
  const model = input.model?.trim() || undefined;
  const reasoningEffort = input.reasoningEffort?.trim() || undefined;
  return api<SessionInitiationResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      target: { projectPath },
      execution: {
        session: "existing",
        targetSessionId: sessionId,
        ...(harness ? { harness } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
      seed: { instructions },
    }),
  });
}

export type CaptureDeliveryMode = "new-session" | "existing-chat";

export async function routeCaptureToAgent(
  agent: Agent,
  input: {
    mode: CaptureDeliveryMode;
    message?: string;
    attachments: OutgoingAttachment[];
  },
): Promise<{ conversationId: string; agentId: string }> {
  const message = input.message?.trim();

  if (input.mode === "existing-chat") {
    const conversationId = await ensureAgentChat(agent);
    await sendConversationAttachments({
      conversationId,
      body: message || "Shared capture",
      attachments: input.attachments,
    });
    return { conversationId, agentId: agent.id };
  }

  const result = await startAgentSession(agent, {
    instructions: message || "Shared capture for context.",
    attachments: input.attachments,
  });
  const conversationId = result.conversationId?.trim();
  if (!conversationId) {
    throw new Error("Session started, but no conversation was returned.");
  }
  return {
    conversationId,
    agentId: result.agentId?.trim() || agent.id,
  };
}
