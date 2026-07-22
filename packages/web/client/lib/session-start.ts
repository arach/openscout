import { ensureAgentChat } from "./agent-chat.ts";
import { api } from "./api.ts";
import type { OutgoingAttachment } from "./media-blobs.ts";
import type { Agent } from "./types.ts";
import { newSessionPayloadForAgent, type SessionInitiationResult } from "../screens/agents/model.ts";

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
        },
      }
    : payload;

  const result = await api<SessionInitiationResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return result;
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
