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
  const body =
    attachments.length === 0 && instructions
      ? { ...payload, seed: { instructions } }
      : payload;

  const result = await api<SessionInitiationResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const conversationId = result.conversationId?.trim();
  if (conversationId && attachments.length > 0) {
    await sendConversationAttachments({
      conversationId,
      body: instructions || "Shared capture",
      attachments,
    });
  }

  return result;
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